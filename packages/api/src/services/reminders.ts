import { sql } from 'kysely';
import { Cron } from 'croner';
import { db } from '../db/kysely-client.js';
import { notificationsService } from './notifications.js';
import { sendExternalForNotification } from './external-notifications.js';
import { ApiError } from '../utils/errors.js';
import type {
    IReminder,
    IReminderFire,
    ReminderChannel,
    ReminderSchedule,
    ReminderScheduleKind,
    ReminderStatus,
} from '@atlas/shared';

// Theme 07 — reminder runtime. `setReminder` MCP tool calls `create()`;
// `agent-schedule-registry.tick()` calls `fireDueReminders()` each minute.
// Delivery channels: in-app notification (always recorded) and/or the
// external-notification channel (when `r.channel` ∈ {'external', 'both'}
// and the channel is configured — the actual provider (Telegram / Teams) is
// selected via `settings.external_notification_provider`).

interface CreateReminderInput {
    label: string;
    body: string;
    schedule: ReminderSchedule;
    channel?: ReminderChannel | undefined;
    created_by_agent_id?: string | null | undefined;
}

interface UpdateReminderInput {
    label?: string | undefined;
    body?: string | undefined;
    schedule?: ReminderSchedule | undefined;
    channel?: ReminderChannel | undefined;
    status?: 'active' | 'paused' | undefined;
}

// Encode the schedule union into the (schedule_kind, schedule_value) pair
// the table stores. Reverse of `parseSchedule` below.
function encodeSchedule(s: ReminderSchedule): { kind: ReminderScheduleKind; value: string } {
    switch (s.kind) {
        case 'once':
            return { kind: 'once', value: s.at };
        case 'daily':
            return { kind: 'daily', value: s.time_of_day };
        case 'weekly':
            return { kind: 'weekly', value: `${s.time_of_day}|${s.weekdays.join(',')}` };
        case 'cron':
            return { kind: 'cron', value: s.expr };
    }
}

function parseSchedule(kind: ReminderScheduleKind, value: string): ReminderSchedule {
    switch (kind) {
        case 'once':
            return { kind: 'once', at: value };
        case 'daily':
            return { kind: 'daily', time_of_day: value };
        case 'weekly': {
            const [timeOfDay, weekdaysStr] = value.split('|');
            return {
                kind: 'weekly',
                // `value.split('|')[0]` always exists (String.split never
                // returns an empty array), so `timeOfDay` is never
                // `undefined` — the `?? '09:00'` fallback is defensive only.
                /* v8 ignore next */
                time_of_day: timeOfDay ?? '09:00',
                weekdays: (weekdaysStr ?? '').split(',').filter(Boolean).map((n) => Number(n)),
            };
        }
        case 'cron':
            return { kind: 'cron', expr: value };
    }
}

// The daily/weekly equivalent cron, so every recurring kind goes through croner
// and its `timezone` option (ISO Sun=7 → cron 0).
function scheduleCron(schedule: Exclude<ReminderSchedule, { kind: 'once' }>): string {
    if (schedule.kind === 'cron') return schedule.expr;
    const [hh, mm] = schedule.time_of_day.split(':').map((n) => Number(n));
    const dow = schedule.kind === 'daily' ? '*' : schedule.weekdays.map((d) => d % 7).join(',');
    return `${mm ?? 0} ${hh ?? 9} * * ${dow}`;
}

/**
 * Next fire after `from`. Daily, weekly and cron schedules run in `timezone`
 * (the Owner's, from settings) so "09:00" means 09:00 where the Owner is, not
 * where the server is; with no zone they run in server time. A zone croner
 * rejects falls back to server time rather than breaking the reminder.
 * 'once' returns its instant as-is (in the past = fire on the next tick).
 */
export function computeNextFire(schedule: ReminderSchedule, from: Date = new Date(), timezone?: string): Date {
    if (schedule.kind === 'once') return new Date(schedule.at);
    const expr = scheduleCron(schedule);
    let next: Date | null;
    try {
        next = new Cron(expr, { paused: true, ...(timezone ? { timezone } : {}) }).nextRun(from);
    } catch (e) {
        if (!timezone) throw e;
        next = new Cron(expr, { paused: true }).nextRun(from);
    }
    if (!next) throw new Error(`Schedule "${expr}" has no future fire`);
    return next;
}

async function ownerTimezone(): Promise<string | undefined> {
    const row = await db.selectFrom('settings').select('quiet_hours_timezone').where('id', '=', 1).executeTakeFirst();
    return row?.quiet_hours_timezone ?? undefined;
}

function rowToReminder(row: Record<string, unknown>): IReminder {
    return {
        id: Number(row['id']),
        label: row['label'] as string,
        body: row['body'] as string,
        schedule_kind: row['schedule_kind'] as ReminderScheduleKind,
        schedule_value: row['schedule_value'] as string,
        channel: row['channel'] as ReminderChannel,
        next_fire_at: row['next_fire_at'] as string,
        last_fired_at: (row['last_fired_at'] as string | null) ?? null,
        fire_count: Number(row['fire_count'] ?? 0),
        created_by_agent_id: (row['created_by_agent_id'] as string | null) ?? null,
        status: row['status'] as ReminderStatus,
        created_at: row['created_at'] as string,
        updated_at: row['updated_at'] as string,
    };
}

const HISTORY_STATUSES: ReminderStatus[] = ['cancelled', 'completed'];

// Every read carries fire_count; the partial index on notifications.reminder_id
// keeps the per-row count an index-only lookup.
function selectReminders() {
    return db
        .selectFrom('reminders')
        .selectAll('reminders')
        .select((eb) =>
            eb
                .selectFrom('notifications')
                .select(eb.fn.countAll<string>().as('c'))
                .whereRef('notifications.reminder_id', '=', 'reminders.id')
                .as('fire_count')
        );
}

async function getOrThrow(id: number): Promise<IReminder> {
    const r = await remindersService.get(id);
    if (!r) throw new ApiError('not_found', 'reminder not found', 404);
    return r;
}

async function setRow(id: number, update: Record<string, unknown>): Promise<IReminder> {
    await db
        .updateTable('reminders')
        .set({ ...update, updated_at: sql<string>`now()` })
        .where('id', '=', id)
        .execute();
    return getOrThrow(id);
}

export const remindersService = {
    async create(input: CreateReminderInput): Promise<IReminder> {
        const enc = encodeSchedule(input.schedule);
        const nextFire = computeNextFire(input.schedule, new Date(), await ownerTimezone()).toISOString();
        const row = await db
            .insertInto('reminders')
            .values({
                label: input.label,
                body: input.body,
                schedule_kind: enc.kind,
                schedule_value: enc.value,
                channel: input.channel ?? 'notification',
                next_fire_at: nextFire,
                created_by_agent_id: input.created_by_agent_id ?? null,
                status: 'active',
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        return rowToReminder({ ...row, fire_count: 0 } as never);
    },

    /**
     * Patch a reminder's label / body / schedule / channel, or pause / resume
     * it (`status`). Only callable on `active` or `paused` rows — cancelled /
     * completed reminders are frozen (snooze revives a completed once-reminder).
     * A schedule change or a resume recomputes next_fire_at from now, so a
     * resumed reminder never fires for the slots it missed while paused.
     */
    async update(id: number, patch: UpdateReminderInput): Promise<IReminder | undefined> {
        const existing = await this.get(id);
        if (!existing) return undefined;
        if (existing.status !== 'active' && existing.status !== 'paused') {
            throw new Error(`Cannot edit reminder ${id} in status '${existing.status}'`);
        }

        const update: Record<string, unknown> = {};
        if (patch.label !== undefined) update['label'] = patch.label;
        if (patch.body !== undefined) update['body'] = patch.body;
        if (patch.channel !== undefined) update['channel'] = patch.channel;
        if (patch.status !== undefined) update['status'] = patch.status;
        const resuming = patch.status === 'active' && existing.status === 'paused';
        if (patch.schedule !== undefined || resuming) {
            const schedule = patch.schedule ?? parseSchedule(existing.schedule_kind, existing.schedule_value);
            if (patch.schedule !== undefined) {
                const enc = encodeSchedule(patch.schedule);
                update['schedule_kind'] = enc.kind;
                update['schedule_value'] = enc.value;
            }
            update['next_fire_at'] = computeNextFire(schedule, new Date(), await ownerTimezone()).toISOString();
        }
        return setRow(id, update);
    },

    /**
     * Fire again `minutes` from now. Active and paused reminders become active;
     * a completed once-reminder is revived (it completes again after this
     * fire). A recurring one goes back to its schedule after the snoozed fire,
     * because the claim recomputes next_fire_at from the fire time.
     */
    async snooze(id: number, minutes: number, now: Date = new Date()): Promise<IReminder> {
        const r = await getOrThrow(id);
        if (r.status === 'cancelled') throw new ApiError('conflict', 'A cancelled reminder cannot be snoozed', 409);
        return setRow(id, {
            status: 'active',
            next_fire_at: new Date(now.getTime() + minutes * 60_000).toISOString(),
        });
    },

    async cancel(id: number): Promise<IReminder | undefined> {
        const r = await this.get(id);
        if (!r) return undefined;
        return setRow(id, { status: 'cancelled' });
    },

    /** Delete a finished (cancelled / completed) reminder; its notifications stay, unlinked. */
    async hardDelete(id: number): Promise<void> {
        const r = await getOrThrow(id);
        if (!HISTORY_STATUSES.includes(r.status)) {
            throw new ApiError('conflict', 'Only a cancelled or completed reminder can be deleted — cancel it first', 409);
        }
        await db.deleteFrom('reminders').where('id', '=', id).execute();
    },

    /**
     * `status` takes one or more statuses. A history-only filter (cancelled /
     * completed) lists most recently finished first, since next_fire_at is
     * stale there; everything else lists by next fire.
     */
    async list(filter?: {
        status?: ReminderStatus | ReminderStatus[] | undefined;
        channel?: ReminderChannel | undefined;
        since?: string | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
    }): Promise<IReminder[]> {
        const statuses = filter?.status === undefined ? [] : [filter.status].flat();
        let q = selectReminders();
        if (statuses.length > 0) q = q.where('reminders.status', 'in', statuses);
        if (filter?.channel) q = q.where('reminders.channel', '=', filter.channel);
        if (filter?.since) q = q.where('reminders.next_fire_at', '>=', filter.since);
        const historyOnly = statuses.length > 0 && statuses.every((st) => HISTORY_STATUSES.includes(st));
        q = historyOnly
            ? q.orderBy('reminders.updated_at', 'desc').orderBy('reminders.id', 'desc')
            : q.orderBy('reminders.next_fire_at', 'asc').orderBy('reminders.id', 'asc');
        if (filter?.limit !== undefined) q = q.limit(filter.limit);
        if (filter?.offset !== undefined) q = q.offset(filter.offset);
        const rows = await q.execute();
        return rows.map((r) => rowToReminder(r as never));
    },

    async get(id: number): Promise<IReminder | undefined> {
        const row = await selectReminders().where('reminders.id', '=', id).executeTakeFirst();
        return row ? rowToReminder(row as never) : undefined;
    },

    /** The reminder's logged fires, newest first, with how each was delivered. */
    async fires(id: number, limit = 20): Promise<IReminderFire[]> {
        await getOrThrow(id);
        const rows = await db
            .selectFrom('notifications')
            .select(['id', 'created_at', 'push_status', 'external_status', 'failure_reason', 'push_failure_reason'])
            .where('reminder_id', '=', id)
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .limit(limit)
            .execute();
        return rows.map((r) => ({
            notification_id: Number(r.id),
            // timestamptz arrives as a Date from node-postgres whatever the column type says.
            fired_at: new Date(r.created_at as unknown as string | Date).toISOString(),
            push_status: r.push_status,
            external_status: r.external_status,
            failure_reason: r.failure_reason ?? r.push_failure_reason ?? null,
        }));
    },

    /**
     * Find every active reminder whose `next_fire_at` is in the past and
     * deliver it. Called from the per-minute scheduler tick. Returns the
     * count of reminders fired this round so callers can log it. Paused,
     * cancelled and completed rows never fire.
     *
     * Concurrency contract: each due row is CLAIMED atomically (UPDATE
     * gated by the pre-read `next_fire_at` and `status='active'`, RETURNING
     * the row) before its side-effects fire. Overlapping ticks — e.g. the
     * previous tick still awaiting a slow external-notification send when the
     * next tick arrives — see the row already advanced and skip it; a pause
     * that lands between the read and the claim wins too. If the process dies
     * AFTER the claim but BEFORE the side-effects, that specific fire is lost
     * — an acceptable tradeoff vs. unbounded duplicate sends on the same
     * recurring row.
     */
    async fireDueReminders(now: Date = new Date()): Promise<number> {
        const due = await db
            .selectFrom('reminders')
            .selectAll()
            .where('status', '=', 'active')
            .where('next_fire_at', '<=', now.toISOString())
            .execute();
        if (due.length === 0) return 0;
        const tz = await ownerTimezone();
        let fired = 0;
        for (const row of due) {
            const r = rowToReminder(row as never);
            const claimed = await claimReminder(r, now, tz);
            if (!claimed) continue; // another tick beat us to it
            await fireOne(r);
            fired += 1;
        }
        return fired;
    },
};

/**
 * Advance the reminder's next fire (or mark it completed) atomically,
 * gated by the original `next_fire_at`. Returns `true` if this call
 * claimed the row; `false` if another tick advanced it first (compare-
 * and-swap on `next_fire_at`).
 */
async function claimReminder(r: IReminder, now: Date, tz: string | undefined): Promise<boolean> {
    const schedule = parseSchedule(r.schedule_kind, r.schedule_value);
    const updates =
        r.schedule_kind === 'once'
            ? {
                  status: 'completed' as const,
                  last_fired_at: now.toISOString(),
                  updated_at: sql<string>`now()`,
              }
            : {
                  next_fire_at: computeNextFire(schedule, now, tz).toISOString(),
                  last_fired_at: now.toISOString(),
                  updated_at: sql<string>`now()`,
              };
    const updated = await db
        .updateTable('reminders')
        .set(updates)
        .where('id', '=', r.id)
        .where('status', '=', 'active')
        .where('next_fire_at', '=', r.next_fire_at)
        .returning('id')
        .executeTakeFirst();
    return updated !== undefined;
}

async function fireOne(r: IReminder): Promise<void> {
    // Side-effects only — the row has already been advanced by
    // `claimReminder`. Never call this without a successful claim; doing
    // so re-introduces the double-fire race the claim was written to
    // close.
    // Every channel gets a notifications row: an external send needs it to
    // track delivery (and to be held through quiet hours), and its
    // reminder_id is the fire log. An external-only reminder's row is
    // log-only (`in_app: false`): Notification Log yes, feed / badge / push no.
    // `create()` broadcasts `notification_created` itself.
    const message = r.body ? `${r.label}: ${r.body}` : r.label;
    const n = await notificationsService.create({
        event_type: 'reminder',
        message,
        kind: 'system',
        agent_id: r.created_by_agent_id,
        issue_id: null,
        project_id: null,
        link_url: '/reminders',
        reminder_id: r.id,
        in_app: r.channel !== 'external',
    });
    if (r.channel === 'external' || r.channel === 'both') {
        try {
            await sendExternalForNotification(n.id, message);
        } catch {
            /* External notification optional. */
        }
    }
}
