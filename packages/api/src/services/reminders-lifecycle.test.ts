// Reminders against the real notifications service: Owner-timezone schedules
// (server pinned to TZ=UTC by vitest.config), pause / resume, snooze, the fire
// log, hard delete, the status filter, the single-fire claim and the
// quiet-hours hold on outward sends. Only `Date` is faked where a test needs a
// clock, so the pg driver's timers keep working.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => undefined,
    broadcastSSE: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn(async (_m: string) => {}));
vi.mock('./transports/telegram.js', () => ({
    telegramTransport: { send, test: vi.fn(), isConfigured: () => true },
}));

import { computeNextFire, remindersService } from './reminders.js';
import { settingsService } from './settings.js';
import { ApiError } from '../utils/errors.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

const iso = (d: Date) => d.toISOString();

async function setOwnerTz(tz: string | null) {
    await settingsService.updateNotifications({ quiet_hours_timezone: tz });
}

beforeEach(async () => {
    await truncateAll();
    await testDb.deleteFrom('reminders').execute();
    await settingsService.updateNotifications({ quiet_hours_enabled: 0, quiet_hours_timezone: null });
    send.mockClear();
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(async () => {
    await settingsService.updateNotifications({ quiet_hours_enabled: 0, quiet_hours_timezone: null });
    await closeTestDb();
});

describe('computeNextFire — Owner timezone, server in UTC', () => {
    it('runs on a UTC server clock', () => {
        expect(process.env['TZ']).toBe('UTC');
        expect(new Date('2026-10-16T09:00:00').getUTCHours()).toBe(9);
    });

    it('daily 09:00 in Asia/Kolkata is 03:30Z, not 09:00Z', () => {
        const s = { kind: 'daily', time_of_day: '09:00' } as const;
        expect(iso(computeNextFire(s, new Date('2026-10-16T00:00:00Z'), 'Asia/Kolkata'))).toBe(
            '2026-10-16T03:30:00.000Z',
        );
        // Already past 09:00 IST today → tomorrow.
        expect(iso(computeNextFire(s, new Date('2026-10-16T04:00:00Z'), 'Asia/Kolkata'))).toBe(
            '2026-10-17T03:30:00.000Z',
        );
        // The deprecated alias the browser can still report resolves the same.
        expect(iso(computeNextFire(s, new Date('2026-10-16T00:00:00Z'), 'Asia/Calcutta'))).toBe(
            '2026-10-16T03:30:00.000Z',
        );
    });

    it('with no Owner zone, falls back to server time', () => {
        const s = { kind: 'daily', time_of_day: '09:00' } as const;
        expect(iso(computeNextFire(s, new Date('2026-10-16T00:00:00Z')))).toBe('2026-10-16T09:00:00.000Z');
    });

    it('a zone croner rejects falls back to server time instead of throwing', () => {
        const s = { kind: 'daily', time_of_day: '09:00' } as const;
        expect(iso(computeNextFire(s, new Date('2026-10-16T00:00:00Z'), 'Not/AZone'))).toBe(
            '2026-10-16T09:00:00.000Z',
        );
    });

    it('daily 09:00 America/New_York keeps 09:00 local across both DST changes', () => {
        const s = { kind: 'daily', time_of_day: '09:00' } as const;
        const ny = 'America/New_York';
        // Sat 2026-10-31 09:00 EDT = 13:00Z; DST ends Sun 2026-11-01 → 09:00 EST = 14:00Z.
        expect(iso(computeNextFire(s, new Date('2026-10-31T12:00:00Z'), ny))).toBe('2026-10-31T13:00:00.000Z');
        expect(iso(computeNextFire(s, new Date('2026-10-31T14:00:00Z'), ny))).toBe('2026-11-01T14:00:00.000Z');
        // Sat 2026-03-07 09:00 EST = 14:00Z; DST starts Sun 2026-03-08 → 09:00 EDT = 13:00Z.
        expect(iso(computeNextFire(s, new Date('2026-03-07T15:00:00Z'), ny))).toBe('2026-03-08T13:00:00.000Z');
    });

    it('weekly picks the weekday in the Owner zone, even when UTC is still the day before', () => {
        // Mon 01:00 IST = Sun 19:30Z. Server-time logic would say Mon 01:00Z.
        const s = { kind: 'weekly', weekdays: [1], time_of_day: '01:00' } as const;
        expect(iso(computeNextFire(s, new Date('2026-10-18T00:00:00Z'), 'Asia/Kolkata'))).toBe(
            '2026-10-18T19:30:00.000Z',
        );
    });

    it('weekly maps ISO Sunday (7) and skips to the next chosen weekday', () => {
        // From Fri 2026-10-16: Sun 10:00 IST = 04:30Z on the 18th.
        const sun = { kind: 'weekly', weekdays: [7], time_of_day: '10:00' } as const;
        expect(iso(computeNextFire(sun, new Date('2026-10-16T00:00:00Z'), 'Asia/Kolkata'))).toBe(
            '2026-10-18T04:30:00.000Z',
        );
        // Mon + Wed at 08:00 New York, from Mon after 08:00 → Wed.
        const mw = { kind: 'weekly', weekdays: [1, 3], time_of_day: '08:00' } as const;
        expect(iso(computeNextFire(mw, new Date('2026-10-19T13:00:00Z'), 'America/New_York'))).toBe(
            '2026-10-21T12:00:00.000Z',
        );
    });

    it('cron expressions run in the Owner zone too', () => {
        const s = { kind: 'cron', expr: '30 7 * * *' } as const;
        expect(iso(computeNextFire(s, new Date('2026-10-16T00:00:00Z'), 'Asia/Kolkata'))).toBe(
            '2026-10-16T02:00:00.000Z',
        );
    });
});

describe('create / fire with the Owner zone from settings', () => {
    it('create schedules 09:00 IST, and the claim keeps the next slot in IST', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
        await setOwnerTz('Asia/Kolkata');
        const r = await remindersService.create({
            label: 'IST standup',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        expect(iso(new Date(r.next_fire_at))).toBe('2026-10-16T03:30:00.000Z');

        vi.setSystemTime(new Date('2026-10-16T03:30:20Z'));
        expect(await remindersService.fireDueReminders()).toBe(1);
        const after = await remindersService.get(r.id);
        expect(iso(new Date(after!.next_fire_at))).toBe('2026-10-17T03:30:00.000Z');
        expect(after!.last_fired_at).not.toBeNull();
    });
});

describe('pause / resume', () => {
    it('a paused reminder never fires; resume recomputes next_fire_at from now', async () => {
        const r = await remindersService.create({
            label: 'Water',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await remindersService.update(r.id, { status: 'paused' });
        // Make it overdue while paused.
        await testDb.updateTable('reminders').set({ next_fire_at: '2000-01-01T00:00:00Z' }).where('id', '=', r.id).execute();
        expect(await remindersService.fireDueReminders()).toBe(0);
        expect((await remindersService.get(r.id))!.status).toBe('paused');

        const resumed = await remindersService.update(r.id, { status: 'active' });
        expect(resumed!.status).toBe('active');
        expect(new Date(resumed!.next_fire_at).getTime()).toBeGreaterThan(Date.now());
        // Missed slots are not replayed.
        expect(await remindersService.fireDueReminders()).toBe(0);
    });

    it('re-sending active to an active reminder leaves next_fire_at alone', async () => {
        const r = await remindersService.create({
            label: 'Same',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        const again = await remindersService.update(r.id, { status: 'active' });
        expect(new Date(again!.next_fire_at).getTime()).toBe(new Date(r.next_fire_at).getTime());
    });
});

describe('claim CAS', () => {
    it('two overlapping ticks fire a due reminder once', async () => {
        await remindersService.create({
            label: 'Once only',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await testDb.updateTable('reminders').set({ next_fire_at: '2000-01-01T00:00:00Z' }).execute();
        const [a, b] = await Promise.all([
            remindersService.fireDueReminders(),
            remindersService.fireDueReminders(),
        ]);
        expect(a + b).toBe(1);
        expect(await testDb.selectFrom('notifications').selectAll().execute()).toHaveLength(1);
    });
});

describe('snooze', () => {
    it('revives a completed once-reminder, fires it, and completes it again', async () => {
        const r = await remindersService.create({
            label: 'Call back',
            body: '',
            schedule: { kind: 'once', at: '2000-01-01T00:00:00.000Z' },
        });
        expect(await remindersService.fireDueReminders()).toBe(1);
        expect((await remindersService.get(r.id))!.status).toBe('completed');

        const now = new Date();
        const snoozed = await remindersService.snooze(r.id, 10, now);
        expect(snoozed.status).toBe('active');
        expect(new Date(snoozed.next_fire_at).getTime()).toBe(now.getTime() + 10 * 60_000);

        expect(await remindersService.fireDueReminders(new Date(now.getTime() + 11 * 60_000))).toBe(1);
        const done = await remindersService.get(r.id);
        expect(done!.status).toBe('completed');
        expect(done!.fire_count).toBe(2);
    });

    it('a recurring reminder fires at the snooze time, then returns to its schedule', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-16T10:00:00Z'));
        const r = await remindersService.create({
            label: 'Stretch',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        expect(iso(new Date(r.next_fire_at))).toBe('2026-10-17T09:00:00.000Z');
        const snoozed = await remindersService.snooze(r.id, 60);
        expect(iso(new Date(snoozed.next_fire_at))).toBe('2026-10-16T11:00:00.000Z');

        vi.setSystemTime(new Date('2026-10-16T11:00:30Z'));
        expect(await remindersService.fireDueReminders()).toBe(1);
        const back = await remindersService.get(r.id);
        expect(back!.status).toBe('active');
        expect(iso(new Date(back!.next_fire_at))).toBe('2026-10-17T09:00:00.000Z');
    });

    it('snoozing a paused reminder makes it active', async () => {
        const r = await remindersService.create({
            label: 'Paused',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await remindersService.update(r.id, { status: 'paused' });
        expect((await remindersService.snooze(r.id, 10)).status).toBe('active');
    });

    it('rejects a cancelled reminder (409) and a missing one (404)', async () => {
        const r = await remindersService.create({
            label: 'Gone',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await remindersService.cancel(r.id);
        await expect(remindersService.snooze(r.id, 10)).rejects.toMatchObject({ status: 409 });
        await expect(remindersService.snooze(999_999, 10)).rejects.toBeInstanceOf(ApiError);
        await expect(remindersService.snooze(999_999, 10)).rejects.toMatchObject({ status: 404 });
    });
});

describe('fire log', () => {
    it('each fire links its notification; fires() lists newest first with delivery status', async () => {
        const r = await remindersService.create({
            label: 'Log me',
            body: 'twice',
            schedule: { kind: 'daily', time_of_day: '09:00' },
            channel: 'both',
        });
        await testDb.updateTable('reminders').set({ next_fire_at: '2000-01-01T00:00:00Z' }).execute();
        await remindersService.fireDueReminders();
        await remindersService.snooze(r.id, 1);
        await remindersService.fireDueReminders(new Date(Date.now() + 2 * 60_000));

        const fires = await remindersService.fires(r.id);
        expect(fires).toHaveLength(2);
        expect(new Date(fires[0]!.fired_at).getTime()).toBeGreaterThanOrEqual(new Date(fires[1]!.fired_at).getTime());
        expect(fires[0]!.external_status).toBe('sent');
        expect(fires[0]!.push_status).toBeDefined();
        expect(send).toHaveBeenCalledTimes(2);

        expect(await remindersService.fires(r.id, 1)).toHaveLength(1);
        expect((await remindersService.get(r.id))!.fire_count).toBe(2);
        expect((await remindersService.list())[0]!.fire_count).toBe(2);
        const n = await testDb.selectFrom('notifications').select('reminder_id').executeTakeFirstOrThrow();
        expect(Number(n.reminder_id)).toBe(r.id);
    });

    it('a new reminder has fire_count 0 and an empty log; a missing one 404s', async () => {
        const r = await remindersService.create({
            label: 'Fresh',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        expect(r.fire_count).toBe(0);
        expect(await remindersService.fires(r.id)).toEqual([]);
        await expect(remindersService.fires(999_999)).rejects.toMatchObject({ status: 404 });
    });
});

describe('quiet hours still hold reminder external sends', () => {
    it('an external reminder firing inside the Owner-zone window is held, logged as pending', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // 23:00 IST = 17:30Z, inside 22:00 → 08:00 IST.
        vi.setSystemTime(new Date('2026-10-16T17:29:00Z'));
        await settingsService.updateNotifications({
            quiet_hours_enabled: 1,
            quiet_hours_from: '22:00',
            quiet_hours_to: '08:00',
            quiet_hours_timezone: 'Asia/Kolkata',
        });
        const r = await remindersService.create({
            label: 'Night',
            body: '',
            schedule: { kind: 'daily', time_of_day: '23:00' },
            channel: 'external',
        });
        expect(iso(new Date(r.next_fire_at))).toBe('2026-10-16T17:30:00.000Z');
        vi.setSystemTime(new Date('2026-10-16T17:30:10Z'));
        expect(await remindersService.fireDueReminders()).toBe(1);
        expect(send).not.toHaveBeenCalled();
        const [fire] = await remindersService.fires(r.id);
        expect(fire!.external_status).toBe('pending');
        const row = await testDb.selectFrom('notifications').select('external_deferred_at').executeTakeFirstOrThrow();
        expect(row.external_deferred_at).not.toBeNull();
    });
});

describe('hard delete', () => {
    it('refuses an active or paused reminder with 409', async () => {
        const r = await remindersService.create({
            label: 'Live',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await expect(remindersService.hardDelete(r.id)).rejects.toMatchObject({ status: 409 });
        await remindersService.update(r.id, { status: 'paused' });
        await expect(remindersService.hardDelete(r.id)).rejects.toMatchObject({ status: 409 });
        expect(await remindersService.get(r.id)).toBeDefined();
    });

    it('deletes a cancelled or completed reminder and keeps its notifications, unlinked', async () => {
        const r = await remindersService.create({
            label: 'Done',
            body: '',
            schedule: { kind: 'once', at: '2000-01-01T00:00:00.000Z' },
        });
        await remindersService.fireDueReminders();
        await remindersService.hardDelete(r.id);
        expect(await remindersService.get(r.id)).toBeUndefined();
        const n = await testDb.selectFrom('notifications').select('reminder_id').executeTakeFirstOrThrow();
        expect(n.reminder_id).toBeNull();

        const c = await remindersService.create({
            label: 'Cancelled',
            body: '',
            schedule: { kind: 'daily', time_of_day: '09:00' },
        });
        await remindersService.cancel(c.id);
        await remindersService.hardDelete(c.id);
        expect(await remindersService.get(c.id)).toBeUndefined();
        await expect(remindersService.hardDelete(c.id)).rejects.toMatchObject({ status: 404 });
    });
});

describe('status filter + paging', () => {
    it('filters by several statuses; history lists most recently finished first and pages', async () => {
        const mk = (label: string) =>
            remindersService.create({ label, body: '', schedule: { kind: 'daily', time_of_day: '09:00' } });
        const a = await mk('a');
        const p = await mk('p');
        await remindersService.update(p.id, { status: 'paused' });
        const c1 = await mk('c1');
        const c2 = await mk('c2');
        await remindersService.cancel(c1.id);
        await remindersService.cancel(c2.id);
        // c1 finished later than c2.
        await testDb.updateTable('reminders').set({ updated_at: '2026-01-02T00:00:00Z' }).where('id', '=', c1.id).execute();
        await testDb.updateTable('reminders').set({ updated_at: '2026-01-01T00:00:00Z' }).where('id', '=', c2.id).execute();

        const live = await remindersService.list({ status: ['active', 'paused'] });
        expect(live.map((r) => r.id).sort()).toEqual([a.id, p.id].sort());

        const history = await remindersService.list({ status: ['cancelled', 'completed'] });
        expect(history.map((r) => r.label)).toEqual(['c1', 'c2']);
        expect((await remindersService.list({ status: ['cancelled', 'completed'], limit: 1, offset: 1 })).map((r) => r.label)).toEqual(['c2']);
        expect(await remindersService.list({ status: 'cancelled', limit: 1 })).toHaveLength(1);
        expect(await remindersService.list()).toHaveLength(4);
    });
});
