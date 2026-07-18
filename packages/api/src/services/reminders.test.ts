import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

// Mock events so broadcastSSE in fireOne doesn't need a real SSE connection
vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => { /* no-op */ },
    broadcastSSE: vi.fn(),
}));
// Mock notifications so in-app notification creation is traceable
vi.mock('./notifications.js', () => ({
    notificationsService: {
        create: vi.fn().mockResolvedValue({ id: 999 }),
        list: vi.fn().mockResolvedValue([]),
        markAllRead: vi.fn(),
        markRead: vi.fn(),
        updateExternalStatus: vi.fn(),
    },
}));
// Mock external notifications to prevent real HTTP calls
vi.mock('./external-notifications.js', () => ({
    sendExternalForNotification: vi.fn().mockResolvedValue(undefined),
}));

import { sql } from 'kysely';
import { remindersService } from './reminders.js';
import { closeTestDb, testDb } from '../../tests/_pg-db.js';

beforeEach(async () => {
    // Clear the reminders table before each test
    await sql`DELETE FROM reminders`.execute(testDb);
});

afterAll(async () => {
    await closeTestDb();
});

// ── Schedule kinds ──────────────────────────────────────────────────────────

describe('remindersService.create — schedule kind: once (encodeSchedule + computeNextFire once branch)', () => {
    it('creates a reminder with a once schedule', async () => {
        const at = new Date(Date.now() + 3_600_000).toISOString(); // 1 hour from now
        const r = await remindersService.create({
            label: 'RMS-once',
            body: 'One-shot reminder',
            schedule: { kind: 'once', at },
        });
        expect(r.schedule_kind).toBe('once');
        expect(r.schedule_value).toBe(at);
        expect(r.status).toBe('active');
    });
});

describe('remindersService.create — schedule kind: weekly (encodeSchedule + computeNextFire weekly branch)', () => {
    it('creates a reminder with a weekly schedule', async () => {
        const r = await remindersService.create({
            label: 'RMS-weekly',
            body: 'Weekly reminder',
            schedule: { kind: 'weekly', time_of_day: '08:00', weekdays: [1, 3, 5] },
        });
        expect(r.schedule_kind).toBe('weekly');
        // encodeSchedule: "08:00|1,3,5"
        expect(r.schedule_value).toBe('08:00|1,3,5');
    });
});

describe('remindersService.create — schedule kind: cron (encodeSchedule + computeNextFire cron branch)', () => {
    it('creates a reminder with a cron schedule', async () => {
        const r = await remindersService.create({
            label: 'RMS-cron',
            body: 'Cron reminder',
            schedule: { kind: 'cron', expr: '0 9 * * 1-5' },
        });
        expect(r.schedule_kind).toBe('cron');
        expect(r.schedule_value).toBe('0 9 * * 1-5');
    });
});

// ── Update with schedule change (recomputes next_fire_at) ───────────────────

describe('remindersService.update — schedule change (computeNextFire re-run)', () => {
    it('updates schedule from daily to weekly and recomputes next_fire_at', async () => {
        const created = await remindersService.create({
            label: 'RMS-upd-sched',
            body: 'Updating schedule',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        const origFire = created.next_fire_at;

        const updated = await remindersService.update(created.id, {
            schedule: { kind: 'weekly', time_of_day: '10:00', weekdays: [2, 4] },
        });
        expect(updated).toBeDefined();
        expect(updated!.schedule_kind).toBe('weekly');
        // next_fire_at is recomputed; compare as epoch ms to handle both
        // string and Date return shapes from the pg driver.
        const toMs = (v: unknown) => new Date(v as string | Date).getTime();
        expect(updated!.next_fire_at).not.toBeNull();
        expect(toMs(updated!.next_fire_at)).not.toBe(toMs(origFire));
    });

    it('throws when trying to update a cancelled reminder', async () => {
        const r = await remindersService.create({
            label: 'RMS-cancel-upd',
            body: 'Will be cancelled',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await remindersService.cancel(r.id);

        await expect(
            remindersService.update(r.id, { label: 'New label' }),
        ).rejects.toThrow(/Cannot edit reminder/);
    });
});

// ── fireDueReminders ─────────────────────────────────────────────────────────
// These tests exercise the internal `fireOne` function via fireDueReminders.

describe('remindersService.fireDueReminders — no due reminders', () => {
    it('returns 0 when there are no due reminders', async () => {
        const count = await remindersService.fireDueReminders(new Date());
        expect(count).toBe(0);
    });
});

describe('remindersService.fireDueReminders — fires a due daily reminder (notification channel)', () => {
    it('fires the reminder and returns count=1', async () => {
        // Insert a past next_fire_at so it fires
        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-daily', 'Fire me', 'daily', '09:00', 'notification', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        const count = await remindersService.fireDueReminders(new Date());
        expect(count).toBe(1);
        // After firing a daily reminder, status stays active with updated next_fire_at
        const rows = await sql<{ status: string }>`SELECT status FROM reminders WHERE label = 'RMS-fire-daily'`.execute(testDb);
        expect(rows.rows[0]?.status).toBe('active');
    });
});

describe('remindersService.fireDueReminders — fires a due once reminder (parseSchedule once + status → completed)', () => {
    it('marks a once reminder as completed after firing', async () => {
        const pastAt = new Date(0).toISOString();
        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-once', 'One shot', 'once', ${pastAt}, 'notification', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        const count = await remindersService.fireDueReminders(new Date());
        expect(count).toBe(1);
        const rows = await sql<{ status: string }>`SELECT status FROM reminders WHERE label = 'RMS-fire-once'`.execute(testDb);
        expect(rows.rows[0]?.status).toBe('completed');
    });
});

describe('remindersService.fireDueReminders — fires a due weekly reminder (parseSchedule weekly branch)', () => {
    it('fires and recomputes next fire for a weekly reminder', async () => {
        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-weekly', 'Weekly fire', 'weekly', '09:00|1,3,5', 'notification', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        const count = await remindersService.fireDueReminders(new Date());
        expect(count).toBe(1);
        // Still active (recurring)
        const rows = await sql<{ status: string }>`SELECT status FROM reminders WHERE label = 'RMS-fire-weekly'`.execute(testDb);
        expect(rows.rows[0]?.status).toBe('active');
    });
});

describe('remindersService.fireDueReminders — fires with external channel (fireOne external branch)', () => {
    it('fires external-channel reminder (creates notification + calls external)', async () => {
        const { sendExternalForNotification } = await import('./external-notifications.js');
        const { notificationsService } = await import('./notifications.js');
        (notificationsService.create as ReturnType<typeof vi.fn>).mockClear();
        (sendExternalForNotification as ReturnType<typeof vi.fn>).mockClear();

        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-external', 'External msg', 'daily', '09:00', 'external', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        await remindersService.fireDueReminders(new Date());
        // external channel: creates a notification row, then calls sendExternalForNotification
        expect(notificationsService.create).toHaveBeenCalled();
        expect(sendExternalForNotification).toHaveBeenCalled();
    });
});

describe('remindersService.fireDueReminders — fires with both channel (fireOne both branch)', () => {
    it('fires both-channel reminder (creates notification AND calls external)', async () => {
        const { sendExternalForNotification } = await import('./external-notifications.js');
        const { notificationsService } = await import('./notifications.js');
        (notificationsService.create as ReturnType<typeof vi.fn>).mockClear();
        (sendExternalForNotification as ReturnType<typeof vi.fn>).mockClear();

        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-both', 'Both channels', 'daily', '09:00', 'both', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        await remindersService.fireDueReminders(new Date());
        // both channel: notification + external call
        expect(notificationsService.create).toHaveBeenCalled();
        expect(sendExternalForNotification).toHaveBeenCalled();
    });
});

describe('remindersService.fireDueReminders — fires reminder with empty body (fireOne body ternary)', () => {
    it('uses just the label when body is empty string', async () => {
        const { notificationsService } = await import('./notifications.js');
        (notificationsService.create as ReturnType<typeof vi.fn>).mockClear();

        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-empty-body', '', 'daily', '09:00', 'notification', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        await remindersService.fireDueReminders(new Date());
        // body is empty string (falsy), so message = label only
        const createCall = (notificationsService.create as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(createCall?.[0]?.message).toBe('RMS-fire-empty-body');
    });
});

describe('remindersService.fireDueReminders — cron reminder fires (parseSchedule cron + computeNextFire cron)', () => {
    it('fires and recomputes next fire for a cron reminder', async () => {
        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-fire-cron', 'Cron fire', 'cron', '0 9 * * 1-5', 'notification', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        const count = await remindersService.fireDueReminders(new Date());
        expect(count).toBe(1);
        // Cron reminder stays active with updated next fire
        const rows = await sql<{ status: string }>`SELECT status FROM reminders WHERE label = 'RMS-fire-cron'`.execute(testDb);
        expect(rows.rows[0]?.status).toBe('active');
    });
});

describe('remindersService.fireDueReminders — external channel + sendExternalForNotification throws (catch branch)', () => {
    it('does not throw when external notification fails (catch swallows error)', async () => {
        const { sendExternalForNotification } = await import('./external-notifications.js');
        (sendExternalForNotification as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('External notification API down'),
        );

        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-ext-throw', 'Should not throw', 'daily', '09:00', 'external', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        // Should not throw even if external notification fails
        await expect(remindersService.fireDueReminders(new Date())).resolves.toBe(1);
    });
});

// ── R1 coverage — computeNextFire / parseSchedule edge branches ─────────────

describe('remindersService.create — cron with no future fire (computeNextFire cron throw branch)', () => {
    it('throws when the cron expression has no future run', async () => {
        // Feb 30th never exists, so croner.nextRun() returns null.
        await expect(
            remindersService.create({
                label: 'RMS-cron-no-future',
                body: '',
                schedule: { kind: 'cron', expr: '0 0 30 2 *' },
            }),
        ).rejects.toThrow(/has no future fire/);
    });
});

describe('remindersService.create — daily time_of_day with no minutes (computeNextFire daily mm fallback)', () => {
    it('defaults minutes to 0 when time_of_day has no colon', async () => {
        const r = await remindersService.create({
            label: 'RMS-daily-no-mm',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09' },
        });
        expect(r.schedule_value).toBe('09');
        const fireHour = new Date(r.next_fire_at).getUTCHours();
        const fireMinute = new Date(r.next_fire_at).getUTCMinutes();
        expect(fireHour).toBe(9);
        expect(fireMinute).toBe(0);
    });
});

describe('remindersService.create — weekly schedule_value with no weekdays segment (parseSchedule weekdaysStr fallback)', () => {
    it('recomputes next_fire_at from a weekly schedule missing the weekdays segment', async () => {
        // Drive parseSchedule's `weekdaysStr ?? ''` fallback (used by
        // fireOne -> parseSchedule) by inserting a weekly reminder whose
        // schedule_value has no `|` separator, then firing it.
        await sql`
            INSERT INTO reminders (label, body, schedule_kind, schedule_value, channel, next_fire_at, status)
            VALUES ('RMS-weekly-no-weekdays', 'x', 'weekly', '09:00', 'notification', ${new Date(0).toISOString()}, 'active')
        `.execute(testDb);

        // With an empty weekdays set, computeNextFire's weekly loop never
        // finds a valid slot within 14 days and throws — fireOne doesn't
        // catch this, so fireDueReminders rejects. This still exercises the
        // `weekdaysStr ?? ''` fallback in parseSchedule before the throw.
        await expect(remindersService.fireDueReminders(new Date())).rejects.toThrow(
            /no future slot found/,
        );
    });
});

describe('remindersService.create — weekly schedule landing on a Sunday (computeNextFire ISO weekday mapping)', () => {
    it('maps JS Sunday (0) to ISO weekday 7', async () => {
        vi.useFakeTimers();
        try {
            // Monday 2026-06-29T10:00:00Z.
            vi.setSystemTime(new Date('2026-06-29T10:00:00Z'));
            const r = await remindersService.create({
                label: 'RMS-weekly-sunday',
                body: '',
                schedule: { kind: 'weekly', time_of_day: '09:00', weekdays: [7] },
            });
            // Next Sunday (ISO 7) at 09:00 is 2026-07-05.
            expect(new Date(r.next_fire_at).toISOString()).toBe('2026-07-05T09:00:00.000Z');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('remindersService.create — weekly candidate slot already in the past today (computeNextFire skip-to-next-week branch)', () => {
    it('skips the current, already-past weekday slot and picks next week', async () => {
        vi.useFakeTimers();
        try {
            // Monday 2026-06-29T10:00:00Z — later than the 09:00 target time,
            // so the offset=0 (today) candidate must be skipped.
            vi.setSystemTime(new Date('2026-06-29T10:00:00Z'));
            const r = await remindersService.create({
                label: 'RMS-weekly-past-today',
                body: '',
                schedule: { kind: 'weekly', time_of_day: '09:00', weekdays: [1] },
            });
            // Next Monday at 09:00 is 2026-07-06 (a week later, not today).
            expect(new Date(r.next_fire_at).toISOString()).toBe('2026-07-06T09:00:00.000Z');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('remindersService.create — weekly time_of_day with no minutes (computeNextFire weekly mm fallback)', () => {
    it('defaults minutes to 0 for a weekly schedule when time_of_day has no colon', async () => {
        const r = await remindersService.create({
            label: 'RMS-weekly-no-mm',
            body: '',
            schedule: { kind: 'weekly', time_of_day: '09', weekdays: [1, 2, 3, 4, 5, 6, 7] },
        });
        expect(new Date(r.next_fire_at).getUTCHours()).toBe(9);
        expect(new Date(r.next_fire_at).getUTCMinutes()).toBe(0);
    });
});

describe('remindersService.create — daily time_of_day already past today (computeNextFire daily rollover branch)', () => {
    it('rolls over to tomorrow when today\'s daily slot has already passed', async () => {
        vi.useFakeTimers();
        try {
            // 10:00 UTC is later than the 09:00 target, so today's
            // candidate must roll to tomorrow.
            vi.setSystemTime(new Date('2026-06-29T10:00:00Z'));
            const r = await remindersService.create({
                label: 'RMS-daily-past-today',
                body: '',
                schedule: { kind: 'daily', time_of_day: '09:00' },
            });
            expect(new Date(r.next_fire_at).toISOString()).toBe('2026-06-30T09:00:00.000Z');
        } finally {
            vi.useRealTimers();
        }
    });
});

// ── R1 coverage — update / cancel / get / list branches ─────────────────────

describe('remindersService.update — reminder not found', () => {
    it('returns undefined when the id does not exist', async () => {
        const result = await remindersService.update(999999, { label: 'x' });
        expect(result).toBeUndefined();
    });
});

describe('remindersService.update — partial patch (only label, other fields omitted)', () => {
    it('leaves body/channel/schedule untouched when only label is patched', async () => {
        const created = await remindersService.create({
            label: 'RMS-partial-orig',
            body: 'orig body',
            schedule: { kind: 'daily', time_of_day: '09:00' },
            channel: 'notification',
        });
        const updated = await remindersService.update(created.id, { label: 'RMS-partial-new' });
        expect(updated).toBeDefined();
        expect(updated!.label).toBe('RMS-partial-new');
        expect(updated!.body).toBe('orig body');
        expect(updated!.channel).toBe('notification');
        expect(updated!.schedule_kind).toBe('daily');
        expect(updated!.schedule_value).toBe('09:00');
    });
});

describe('remindersService.update — patches body (patch.body !== undefined branch)', () => {
    it('updates only the body field', async () => {
        const created = await remindersService.create({
            label: 'RMS-patch-body',
            body: 'orig body',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        const updated = await remindersService.update(created.id, { body: 'new body' });
        expect(updated).toBeDefined();
        expect(updated!.body).toBe('new body');
        expect(updated!.label).toBe('RMS-patch-body');
    });
});

describe('remindersService.update — patches channel (patch.channel !== undefined branch)', () => {
    it('updates only the channel field', async () => {
        const created = await remindersService.create({
            label: 'RMS-patch-channel',
            body: 'body',
            schedule: { kind: 'daily', time_of_day: '09:00' },
            channel: 'notification',
        });
        const updated = await remindersService.update(created.id, { channel: 'both' });
        expect(updated).toBeDefined();
        expect(updated!.channel).toBe('both');
    });
});

describe('remindersService.cancel — reminder not found', () => {
    it('returns undefined when cancelling a nonexistent id', async () => {
        const result = await remindersService.cancel(999999);
        expect(result).toBeUndefined();
    });
});

describe('remindersService.get — reminder not found', () => {
    it('returns undefined for a nonexistent id', async () => {
        const result = await remindersService.get(999999);
        expect(result).toBeUndefined();
    });
});

describe('remindersService.list — filters', () => {
    it('filters by status, channel, and since', async () => {
        const a = await remindersService.create({
            label: 'RMS-list-a',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
            channel: 'notification',
        });
        const b = await remindersService.create({
            label: 'RMS-list-b',
            body: '',
            schedule: { kind: 'daily', time_of_day: '10:00' },
            channel: 'external',
        });
        await remindersService.cancel(b.id);

        const active = await remindersService.list({ status: 'active' });
        expect(active.map((r) => r.id)).toContain(a.id);
        expect(active.map((r) => r.id)).not.toContain(b.id);

        const external = await remindersService.list({ channel: 'external' });
        expect(external.map((r) => r.id)).toContain(b.id);
        expect(external.map((r) => r.id)).not.toContain(a.id);

        // `since` filters on next_fire_at >= the given ISO timestamp; both
        // reminders fire far in the future relative to epoch 0.
        const sinceEpoch = await remindersService.list({ since: new Date(0).toISOString() });
        expect(sinceEpoch.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));

        const unfiltered = await remindersService.list();
        expect(unfiltered.map((r) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    });
});
