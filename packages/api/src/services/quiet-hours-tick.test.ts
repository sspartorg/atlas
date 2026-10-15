// The minute tick across a quiet-hours boundary, on a fake clock: a reminder
// that fires at 23:30 inside a 22:00 → 08:00 window is held, survives the
// 07:59 tick, and goes out on the 08:00 tick. Only `Date` is faked, so the pg
// driver's timers keep working.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => undefined,
    broadcastSSE: vi.fn(),
}));
vi.mock('./agent-runner.js', () => ({
    spawnAgentRun: vi.fn().mockResolvedValue('mock-run-id'),
    cancelRun: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn(async (_m: string) => {}));
vi.mock('./transports/telegram.js', () => ({
    telegramTransport: { send, test: vi.fn(), isConfigured: () => true },
}));

import { tickAgentScheduler } from './agent-schedule-registry.js';
import { remindersService } from './reminders.js';
import { settingsService } from './settings.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

const reminderRow = () =>
    testDb
        .selectFrom('notifications')
        .select(['external_status', 'external_deferred_at', 'link_url'])
        .where('event_type', '=', 'reminder')
        .executeTakeFirstOrThrow();

beforeEach(async () => {
    await truncateAll();
    // truncateAll keeps reminders; another file's leftovers would fire here.
    await testDb.deleteFrom('reminders').execute();
    send.mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    await settingsService.updateNotifications({
        quiet_hours_enabled: 1,
        quiet_hours_from: '22:00',
        quiet_hours_to: '08:00',
        quiet_hours_timezone: 'UTC',
    });
});

afterEach(() => {
    vi.useRealTimers();
});

afterAll(async () => {
    await closeTestDb();
});

describe('minute tick × quiet hours', () => {
    it('holds a reminder fired at 23:30 and sends it on the first tick after 08:00', async () => {
        vi.setSystemTime(new Date('2026-10-16T23:29:00Z'));
        await remindersService.create({
            label: 'Stand-up notes',
            body: 'send them',
            schedule: { kind: 'once', at: '2026-10-16T23:30:00.000Z' },
            channel: 'external',
        });

        vi.setSystemTime(new Date('2026-10-16T23:30:30Z'));
        await tickAgentScheduler();
        let row = await reminderRow();
        expect(row.external_status).toBe('pending');
        expect(row.external_deferred_at).not.toBeNull();
        expect(row.link_url).toBe('/reminders');
        expect(send).not.toHaveBeenCalled();

        vi.setSystemTime(new Date('2026-10-17T07:59:30Z'));
        await tickAgentScheduler();
        expect((await reminderRow()).external_status).toBe('pending');
        expect(send).not.toHaveBeenCalled();

        vi.setSystemTime(new Date('2026-10-17T08:00:30Z'));
        await tickAgentScheduler();
        row = await reminderRow();
        expect(row.external_status).toBe('sent');
        expect(row.external_deferred_at).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
        // The prefix carries the row's created_at (the DB clock, not the fake one).
        expect(send.mock.calls[0]?.[0]).toMatch(
            /^Held during quiet hours · \d\d:\d\d\nStand-up notes: send them$/
        );

        // Nothing is sent twice.
        vi.setSystemTime(new Date('2026-10-17T08:01:30Z'));
        await tickAgentScheduler();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('a reminder outside quiet hours goes out on its own tick, unprefixed', async () => {
        vi.setSystemTime(new Date('2026-10-16T11:59:00Z'));
        await remindersService.create({
            label: 'Lunch',
            body: '',
            schedule: { kind: 'once', at: '2026-10-16T12:00:00.000Z' },
            channel: 'both',
        });
        vi.setSystemTime(new Date('2026-10-16T12:00:30Z'));
        await tickAgentScheduler();
        expect((await reminderRow()).external_status).toBe('sent');
        expect(send.mock.calls[0]?.[0]).toBe('Lunch');
        // One row per fire, whatever the channel.
        expect(await testDb.selectFrom('notifications').select('id').execute()).toHaveLength(1);
    });
});
