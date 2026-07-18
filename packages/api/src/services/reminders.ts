import { sql } from 'kysely';
import { Cron } from 'croner';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { notificationsService } from './notifications.js';
import { sendExternalForNotification } from './external-notifications.js';
import type {
    IReminder,
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

// Compute the next fire time from a schedule + a reference instant.
// - 'once': returns the literal datetime (in the past = fire immediately,
//   then `completed` status flip).
// - 'daily': next HH:MM in process-local time from `from`.
// - 'weekly': next slot matching one of the chosen weekdays at HH:MM.
// - 'cron': croner's nextRun() from `from`.
function computeNextFire(schedule: ReminderSchedule, from: Date = new Date()): Date {
    if (schedule.kind === 'once') {
        return new Date(schedule.at);
    }
    if (schedule.kind === 'cron') {
        const next = new Cron(schedule.expr).nextRun(from);
        if (!next) throw new Error(`Cron expression "${schedule.expr}" has no future fire`);
        return next;
    }
    if (schedule.kind === 'daily') {
        const [hh, mm] = schedule.time_of_day.split(':').map((n) => Number(n));
        const next = new Date(from);
        // `time_of_day.split(':')[0]` always exists, so `hh` is never
        // `undefined` — only `mm` (index 1) can be when there's no colon.
        /* v8 ignore next */
        const hour = hh ?? 9;
        next.setHours(hour, mm ?? 0, 0, 0);
        if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
        return next;
    }
    // weekly
    const [hh, mm] = schedule.time_of_day.split(':').map((n) => Number(n));
    // Same as the daily branch above: `hh` (split index 0) is never
    // undefined; only the `mm ?? 0` fallback below is reachable.
    /* v8 ignore next */
    const weeklyHour = hh ?? 9;
    const validIso = new Set(schedule.weekdays);
    for (let offset = 0; offset < 14; offset++) {
        const candidate = new Date(from);
        candidate.setDate(candidate.getDate() + offset);
        candidate.setHours(weeklyHour, mm ?? 0, 0, 0);
        // JS Sun=0..Sat=6; ISO Mon=1..Sun=7
        const iso = candidate.getDay() === 0 ? 7 : candidate.getDay();
        if (!validIso.has(iso)) continue;
        if (candidate.getTime() <= from.getTime()) continue;
        return candidate;
    }
    throw new Error('weekly: no future slot found within 14 days');
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
        created_by_agent_id: (row['created_by_agent_id'] as string | null) ?? null,
        status: row['status'] as ReminderStatus,
        created_at: row['created_at'] as string,
        updated_at: row['updated_at'] as string,
    };
}

export const remindersService = {
    async create(input: CreateReminderInput): Promise<IReminder> {
        const enc = encodeSchedule(input.schedule);
        const nextFire = computeNextFire(input.schedule).toISOString();
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
        return rowToReminder(row as never);
    },

    /**
     * Patch a reminder's label / body / schedule / channel. Only callable on
     * `active` or `paused` rows — cancelled / completed reminders are frozen
     * (use a new `setReminder` if you want to revive them). When the schedule
     * changes, next_fire_at is recomputed from now.
     */
    async update(id: number, patch: UpdateReminderInput): Promise<IReminder | undefined> {
        const existing = await this.get(id);
        if (!existing) return undefined;
        if (existing.status !== 'active' && existing.status !== 'paused') {
            throw new Error(`Cannot edit reminder ${id} in status '${existing.status}'`);
        }

        const update: Record<string, unknown> = { updated_at: sql<string>`now()` };
        if (patch.label !== undefined) update['label'] = patch.label;
        if (patch.body !== undefined) update['body'] = patch.body;
        if (patch.channel !== undefined) update['channel'] = patch.channel;
        if (patch.schedule !== undefined) {
            const enc = encodeSchedule(patch.schedule);
            update['schedule_kind'] = enc.kind;
            update['schedule_value'] = enc.value;
            update['next_fire_at'] = computeNextFire(patch.schedule).toISOString();
        }

        const row = await db
            .updateTable('reminders')
            .set(update)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
        // TOCTOU race only: `existing` was just confirmed present above and
        // there's no delete API on this service, so `row` going missing here
        // would require an external deletion between the two queries — not
        // reachable from a single-threaded test.
        /* v8 ignore next */
        return row ? rowToReminder(row as never) : undefined;
    },

    async cancel(id: number): Promise<IReminder | undefined> {
        const row = await db
            .updateTable('reminders')
            .set({ status: 'cancelled', updated_at: sql<string>`now()` })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();
        return row ? rowToReminder(row as never) : undefined;
    },

    async list(filter?: {
        status?: ReminderStatus;
        channel?: ReminderChannel;
        since?: string;
    }): Promise<IReminder[]> {
        let q = db.selectFrom('reminders').selectAll();
        if (filter?.status) q = q.where('status', '=', filter.status);
        if (filter?.channel) q = q.where('channel', '=', filter.channel);
        if (filter?.since) q = q.where('next_fire_at', '>=', filter.since);
        const rows = await q.orderBy('next_fire_at', 'asc').execute();
        return rows.map((r) => rowToReminder(r as never));
    },

    async get(id: number): Promise<IReminder | undefined> {
        const row = await db
            .selectFrom('reminders')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();
        return row ? rowToReminder(row as never) : undefined;
    },

    /**
     * Find every active reminder whose `next_fire_at` is in the past and
     * deliver it. Called from the per-minute scheduler tick. Returns the
     * count of reminders fired this round so callers can log it.
     *
     * Concurrency contract: each due row is CLAIMED atomically (UPDATE
     * gated by the pre-read `next_fire_at`, RETURNING the row) before its
     * side-effects fire. Overlapping ticks — e.g. the previous tick still
     * awaiting a slow external-notification send when the next tick arrives
     * — see the row already advanced and skip it. If the process dies AFTER
     * the claim but BEFORE the side-effects, that specific fire is lost —
     * an acceptable tradeoff vs. the previous shape, which risked unbounded
     * duplicate sends on the same recurring row.
     */
    async fireDueReminders(now: Date = new Date()): Promise<number> {
        const due = await db
            .selectFrom('reminders')
            .selectAll()
            .where('status', '=', 'active')
            .where('next_fire_at', '<=', now.toISOString())
            .execute();
        let fired = 0;
        for (const row of due) {
            const r = rowToReminder(row as never);
            const claimed = await claimReminder(r);
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
async function claimReminder(r: IReminder): Promise<boolean> {
    const schedule = parseSchedule(r.schedule_kind, r.schedule_value);
    const updates =
        r.schedule_kind === 'once'
            ? {
                  status: 'completed' as const,
                  last_fired_at: new Date().toISOString(),
                  updated_at: sql<string>`now()`,
              }
            : {
                  next_fire_at: computeNextFire(schedule, new Date()).toISOString(),
                  last_fired_at: new Date().toISOString(),
                  updated_at: sql<string>`now()`,
              };
    const updated = await db
        .updateTable('reminders')
        .set(updates)
        .where('id', '=', r.id)
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
    // Always create an in-app notification row. The notifications.create
    // service broadcasts SSE so the web UI surfaces a toast.
    const message = r.body ? `${r.label}: ${r.body}` : r.label;
    let notificationId: number | undefined;
    if (r.channel === 'notification' || r.channel === 'both') {
        const n = await notificationsService.create({
            event_type: 'reminder',
            message,
            kind: 'system',
            agent_id: r.created_by_agent_id,
            issue_id: null,
            project_id: null,
        });
        notificationId = n.id;
        broadcastSSE({ type: 'notification_created', notificationId: n.id, notificationKind: 'system' });
    }
    if (r.channel === 'external' || r.channel === 'both') {
        if (notificationId !== undefined) {
            try {
                await sendExternalForNotification(notificationId, message);
            } catch {
                /* External notification optional. */
            }
        } else {
            // External-channel-only path: we still want a notifications row so
            // the user has a record + a notification_id for sendExternalForNotification.
            const n = await notificationsService.create({
                event_type: 'reminder',
                message,
                kind: 'system',
                agent_id: r.created_by_agent_id,
                issue_id: null,
                project_id: null,
            });
            try {
                await sendExternalForNotification(n.id, message);
            } catch {
                /* External notification optional. */
            }
        }
    }
}
