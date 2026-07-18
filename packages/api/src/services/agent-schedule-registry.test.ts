import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import {
    computeNextSlot,
    computeNextAgentSlot,
    decideFreedomDispatch,
    sweepStuckRuns,
    startAgentSchedulerPoller,
    stopAgentSchedulerPoller,
    getSchedulingTimezone,
    STUCK_RUN_THRESHOLD_MS,
} from './agent-schedule-registry.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

// Silence the scheduler's verbose console.log output so test output is clean.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

// computeNextSlot is the heart of the simplified scheduler: it produces a
// strictly-future, clock-aligned slot for an agent's cadence. The grid is
// anchored at the server's LOCAL midnight (00:00 in process TZ), so for
// divisor cadences (0.5/1/2/3/6/12/24h) slots land on the natural local
// hour/half-hour boundaries — what the operator expects to read off the
// wall clock, regardless of UTC offset.
//
// These tests construct `now` from local-time components (year/month/day/
// hour/min) via `new Date(y, m, d, hh, mm)` so they pass in any TZ; the
// expected slot is described in local time and compared as a wall-clock
// HH:MM, not an absolute UTC ISO. The legacy "UTC anchored" tests were
// removed when we switched anchors — they pinned a behavior the operator
// explicitly reported as wrong (30-min IST offset).

function localTime(d: Date): string {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

describe('computeNextSlot (local-midnight anchored)', () => {
    it('30-min cadence: local 17:13:42 -> next slot 17:30', () => {
        const now = new Date(2026, 4, 20, 17, 13, 42);
        expect(localTime(computeNextSlot(now, 0.5))).toBe('17:30');
    });

    it('30-min cadence: strictly future on the boundary', () => {
        const now = new Date(2026, 4, 20, 17, 30, 0);
        expect(localTime(computeNextSlot(now, 0.5))).toBe('18:00');
    });

    it('2h cadence: local 09:47 -> next slot 10:00 (operator-reported case)', () => {
        const now = new Date(2026, 4, 20, 9, 47, 0);
        expect(localTime(computeNextSlot(now, 2))).toBe('10:00');
    });

    it('2h cadence: local 10:47 -> next slot 12:00 (the "in 1h 13m" case)', () => {
        const now = new Date(2026, 4, 20, 10, 47, 0);
        expect(localTime(computeNextSlot(now, 2))).toBe('12:00');
    });

    it('6h cadence: local 17:13 -> next slot 18:00', () => {
        const now = new Date(2026, 4, 20, 17, 13, 0);
        expect(localTime(computeNextSlot(now, 6))).toBe('18:00');
    });

    it('6h cadence: local 18:00 -> next slot 00:00 next day', () => {
        const now = new Date(2026, 4, 20, 18, 0, 0);
        const next = computeNextSlot(now, 6);
        expect(localTime(next)).toBe('00:00');
        expect(next.getDate()).toBe(21);
    });

    it('24h cadence: always lands on next local 00:00', () => {
        const now = new Date(2026, 4, 20, 5, 30, 0);
        const next = computeNextSlot(now, 24);
        expect(localTime(next)).toBe('00:00');
        expect(next.getDate()).toBe(21);
    });

    it('1h cadence: lands on the next top of hour', () => {
        const now = new Date(2026, 4, 20, 17, 13, 42);
        expect(localTime(computeNextSlot(now, 1))).toBe('18:00');
    });

    it('sub-minute cadence is clamped to 1 minute', () => {
        const now = new Date(2026, 4, 20, 17, 13, 42);
        expect(localTime(computeNextSlot(now, 0.001))).toBe('17:14');
    });

    it('strictly future: result is always > input', () => {
        const cases: Array<[Date, number]> = [
            [new Date(2026, 4, 20, 0, 0, 0), 6],
            [new Date(2026, 4, 20, 17, 13, 42), 0.5],
            [new Date(2026, 4, 20, 23, 59, 59), 1],
        ];
        for (const [now, hours] of cases) {
            expect(computeNextSlot(now, hours).getTime()).toBeGreaterThan(now.getTime());
        }
    });
});

// Theme 09 — cron_expr overrides preset math.
describe('computeNextAgentSlot — cron_expr override', () => {
    it("'0 9 * * *' from 08:00 local fires at today 09:00", () => {
        const now = new Date(2026, 4, 20, 8, 0, 0);
        const next = computeNextAgentSlot(now, {
            schedule_preset: 'every_n_hours',
            schedule_hours: 24,
            schedule_time_of_day: null,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            cron_expr: '0 9 * * *',
        });
        expect(next.getHours()).toBe(9);
        expect(next.getMinutes()).toBe(0);
        expect(next.getDate()).toBe(now.getDate());
    });

    it("'0 9 * * *' from 10:00 local fires tomorrow 09:00", () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        const next = computeNextAgentSlot(now, {
            schedule_preset: 'every_n_hours',
            schedule_hours: 24,
            schedule_time_of_day: null,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            cron_expr: '0 9 * * *',
        });
        expect(next.getHours()).toBe(9);
        expect(next.getDate()).toBe(now.getDate() + 1);
    });

    it("'0 9 * * *' with an explicit timezone uses the Croner timezone option (timezone ? branch)", () => {
        const now = new Date(2026, 4, 20, 8, 0, 0);
        const next = computeNextAgentSlot(
            now,
            {
                schedule_preset: 'every_n_hours',
                schedule_hours: 24,
                schedule_time_of_day: null,
                schedule_weekdays: null,
                schedule_day_of_month: null,
                cron_expr: '0 9 * * *',
            },
            'America/New_York',
        );
        expect(next).toBeInstanceOf(Date);
        expect(next.getTime()).toBeGreaterThan(now.getTime());
    });

    it("null cron_expr falls back to preset math", () => {
        const now = new Date(2026, 4, 20, 10, 13, 0);
        const next = computeNextAgentSlot(now, {
            schedule_preset: 'every_n_hours',
            schedule_hours: 2,
            schedule_time_of_day: null,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            cron_expr: null,
        });
        // 2h cadence anchored to local-midnight → next slot 12:00.
        expect(next.getHours()).toBe(12);
        expect(next.getMinutes()).toBe(0);
    });
});

// A05 — freedom-mode dispatch gate. The scheduler tick path
// (`dispatchOneAgent`) reads `agent.requires_item` to decide between the
// item-driven branch and the schedule-only branch. The pure decision
// helper isolates that gate so the test doesn't need the DB stack.
describe('decideFreedomDispatch — freedom-mode dispatch gate', () => {
    it('returns not_freedom when requires_item=true (fall through to ready-items lookup)', () => {
        expect(
            decideFreedomDispatch({
                agent: { requires_item: true, concurrent_runs: 1 },
                liveRunCount: 0,
            }),
        ).toEqual({ kind: 'not_freedom' });
    });

    it('returns spawn when requires_item=false and no live runs (the daily-AI-news case)', () => {
        expect(
            decideFreedomDispatch({
                agent: { requires_item: false, concurrent_runs: 1 },
                liveRunCount: 0,
            }),
        ).toEqual({ kind: 'spawn' });
    });

    it('returns at_capacity when requires_item=false and live runs are at the cap', () => {
        expect(
            decideFreedomDispatch({
                agent: { requires_item: false, concurrent_runs: 1 },
                liveRunCount: 1,
            }),
        ).toEqual({ kind: 'at_capacity', liveCount: 1, cap: 1 });
    });

    it('returns at_capacity when live runs exceed the cap (defensive — never spawns past the cap)', () => {
        expect(
            decideFreedomDispatch({
                agent: { requires_item: false, concurrent_runs: 2 },
                liveRunCount: 5,
            }),
        ).toEqual({ kind: 'at_capacity', liveCount: 5, cap: 2 });
    });

    it('concurrent_runs=3 with 2 live → still room for one more', () => {
        expect(
            decideFreedomDispatch({
                agent: { requires_item: false, concurrent_runs: 3 },
                liveRunCount: 2,
            }),
        ).toEqual({ kind: 'spawn' });
    });
});

// ---------------------------------------------------------------------------
// computeNextAgentSlot — all schedule presets
// ---------------------------------------------------------------------------
describe('computeNextAgentSlot — preset dispatching', () => {
    const base = {
        schedule_preset: 'every_n_hours' as const,
        schedule_hours: 1,
        schedule_time_of_day: null,
        schedule_weekdays: null,
        schedule_day_of_month: null,
        cron_expr: null,
    };

    it('every_n_hours: throws when schedule_hours <= 0', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        expect(() =>
            computeNextAgentSlot(now, { ...base, schedule_hours: 0 }),
        ).toThrow('every_n_hours requires schedule_hours > 0');
    });

    it('daily: throws when schedule_time_of_day is missing', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        expect(() =>
            computeNextAgentSlot(now, {
                ...base,
                schedule_preset: 'daily',
                schedule_time_of_day: null,
            }),
        ).toThrow('requires schedule_time_of_day');
    });

    it('daily: fires today at 15:00 when now is 10:00', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'daily',
            schedule_time_of_day: '15:00',
        });
        expect(next.getHours()).toBe(15);
        expect(next.getMinutes()).toBe(0);
        expect(next.getDate()).toBe(20);
    });

    it('daily: fires tomorrow when now is already past time-of-day', () => {
        const now = new Date(2026, 4, 20, 16, 0, 0);
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'daily',
            schedule_time_of_day: '15:00',
        });
        expect(next.getDate()).toBe(21);
    });

    it('weekly: fires on next matching weekday', () => {
        // 2026-05-20 is a Wednesday (ISO 3). Request Saturday (ISO 6).
        const now = new Date(2026, 4, 20, 10, 0, 0);
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [6],
        });
        expect(next.getDay()).toBe(6); // Saturday in JS
    });

    it('weekly: throws when weekdays is empty', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        expect(() =>
            computeNextAgentSlot(now, {
                ...base,
                schedule_preset: 'weekly',
                schedule_time_of_day: '09:00',
                schedule_weekdays: [],
            }),
        ).toThrow('weekly requires schedule_weekdays');
    });

    it('weekly: fires on Sunday (isoWeekday dow===0 -> 7 branch)', () => {
        // 2026-05-24 is a Sunday. Request ISO weekday 7 (Sunday).
        const now = new Date(2026, 4, 20, 10, 0, 0); // Wed May 20
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'weekly',
            schedule_time_of_day: '09:00',
            schedule_weekdays: [7],
        });
        expect(next.getDay()).toBe(0); // Sunday in JS getDay()
        expect(next.getDate()).toBe(24);
    });

    it('daily: throws when schedule_time_of_day has an invalid format (parseTimeOfDay regex fails)', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        expect(() =>
            computeNextAgentSlot(now, {
                ...base,
                schedule_preset: 'daily',
                schedule_time_of_day: '9:00', // missing leading zero -> regex fails
            }),
        ).toThrow('invalid schedule_time_of_day');
    });

    it('monthly: fires this month when day has not passed', () => {
        // Day 28 of the month, today is day 1.
        const now = new Date(2026, 4, 1, 10, 0, 0); // May 1
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 28,
        });
        expect(next.getDate()).toBe(28);
        expect(next.getMonth()).toBe(4); // May
    });

    it('monthly: clamps to last day of month when day > last day', () => {
        // February has 28 days in 2026 (not a leap year). Request day 31.
        const now = new Date(2026, 1, 1, 10, 0, 0); // Feb 1
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 31,
        });
        expect(next.getDate()).toBe(28); // clamped to Feb 28
        expect(next.getMonth()).toBe(1);
    });

    it('monthly: steps forward multiple months when this month\'s day has already passed (loop false-branch)', () => {
        // now = May 20; day_of_month=5 -> this month's clamped candidate
        // (May 5) is already in the past, so the loop must continue past
        // monthOffset=0 (the `if (...) return` false branch) to June 5.
        const now = new Date(2026, 4, 20, 10, 0, 0); // May 20
        const next = computeNextAgentSlot(now, {
            ...base,
            schedule_preset: 'monthly',
            schedule_time_of_day: '09:00',
            schedule_day_of_month: 5,
        });
        expect(next.getMonth()).toBe(5); // June
        expect(next.getDate()).toBe(5);
    });

    it('monthly: throws when day_of_month is missing', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        expect(() =>
            computeNextAgentSlot(now, {
                ...base,
                schedule_preset: 'monthly',
                schedule_time_of_day: '09:00',
                schedule_day_of_month: null,
            }),
        ).toThrow('monthly requires schedule_day_of_month');
    });

    it('cron_expr with invalid expression throws', () => {
        const now = new Date(2026, 4, 20, 10, 0, 0);
        // An expression that never fires (no next run)
        expect(() =>
            computeNextAgentSlot(now, {
                ...base,
                cron_expr: '0 0 31 2 *', // Feb 31 never exists
            }),
        ).toThrow();
    });
});

// ---------------------------------------------------------------------------
// sweepStuckRuns — DB-touching
// ---------------------------------------------------------------------------
describe('sweepStuckRuns', () => {
    beforeEach(async () => {
        await truncateAll();
        await insertProject('p1', 'ATL');
        await insertAgent({ id: 'agent-1' });
    });

    afterAll(async () => {
        await closeTestDb();
    });

    it('returns 0 when no runs are stuck', async () => {
        const count = await sweepStuckRuns();
        expect(count).toBe(0);
    });

    it('errors a run that has been in_progress for more than 30 minutes with no output', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E', status: 'in_progress' });

        // Insert a run that started 31 minutes ago with null output_text.
        const staleTime = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS - 60_000).toISOString();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-stuck-1',
                agent_id: 'agent-1',
                item_id: 'ATL-1',
                status: 'in_progress',
                started_at: staleTime,
                output_text: null,
            })
            .execute();

        const count = await sweepStuckRuns();
        expect(count).toBe(1);

        const row = await testDb
            .selectFrom('agent_runs')
            .selectAll()
            .where('id', '=', 'run-stuck-1')
            .executeTakeFirst();
        expect(row?.status).toBe('error');
        expect(row?.output_text).toContain('watchdog');
    });

    it('does NOT touch a run that has output_text (not stuck)', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E', status: 'in_progress' });

        const staleTime = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS - 60_000).toISOString();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-active-1',
                agent_id: 'agent-1',
                item_id: 'ATL-1',
                status: 'in_progress',
                started_at: staleTime,
                output_text: 'some output',
            })
            .execute();

        const count = await sweepStuckRuns();
        expect(count).toBe(0); // not stuck — has output

        const row = await testDb
            .selectFrom('agent_runs')
            .selectAll()
            .where('id', '=', 'run-active-1')
            .executeTakeFirst();
        expect(row?.status).toBe('in_progress');
    });

    it('does NOT touch a recent in_progress run with no output (within threshold)', async () => {
        await insertItem({ id: 'ATL-1', type: 'epic', project_id: 'p1', title: 'E', status: 'in_progress' });

        // Started only 5 minutes ago — not yet past threshold.
        const recentTime = new Date(Date.now() - 5 * 60_000).toISOString();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'run-recent-1',
                agent_id: 'agent-1',
                item_id: 'ATL-1',
                status: 'in_progress',
                started_at: recentTime,
                output_text: null,
            })
            .execute();

        const count = await sweepStuckRuns();
        expect(count).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// getSchedulingTimezone — DB-touching
// ---------------------------------------------------------------------------
describe('getSchedulingTimezone', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('returns undefined when quiet_hours_timezone is null in settings', async () => {
        // Settings row is seeded by migrations with quiet_hours_timezone = null.
        const tz = await getSchedulingTimezone();
        expect(tz).toBeUndefined();
    });

    it('returns the timezone string when set', async () => {
        await testDb
            .updateTable('settings')
            .set({ quiet_hours_timezone: 'America/New_York' })
            .where('id', '=', 1)
            .execute();
        const tz = await getSchedulingTimezone();
        expect(tz).toBe('America/New_York');
    });
});

// ---------------------------------------------------------------------------
// startAgentSchedulerPoller / stopAgentSchedulerPoller — timer management
// ---------------------------------------------------------------------------
describe('startAgentSchedulerPoller / stopAgentSchedulerPoller', () => {
    // Use fake timers so the setTimeout created by startAgentSchedulerPoller
    // never fires a real tickAgentScheduler(). Without this, a tick that
    // fires near a minute boundary would hold DB connections and block the
    // TRUNCATE ... ACCESS EXCLUSIVE in the ASRTICK test file's beforeEach.
    beforeAll(() => {
        vi.useFakeTimers();
    });
    afterAll(() => {
        stopAgentSchedulerPoller(); // ensure no leaked handles
        vi.useRealTimers();
    });

    it('can be started and stopped without error', () => {
        startAgentSchedulerPoller();
        expect(() => stopAgentSchedulerPoller()).not.toThrow();
    });

    it('calling stop before start is a no-op', () => {
        expect(() => stopAgentSchedulerPoller()).not.toThrow();
    });

    it('calling start twice does not throw (stops existing before re-starting)', () => {
        startAgentSchedulerPoller();
        expect(() => startAgentSchedulerPoller()).not.toThrow();
        stopAgentSchedulerPoller();
    });

    it('stop after the first tick has fired clears the live setInterval handle (pollerHandle truthy branch)', async () => {
        // pollerHandle is only assigned inside the setTimeout callback, once
        // the initial alignment delay elapses. Advance fake time past that
        // boundary so pollerHandle is set, then stop while it's live to
        // cover the `if (pollerHandle)` true branch in
        // stopAgentSchedulerPoller (normally only the null/no-op path is
        // exercised by the other tests in this block).
        startAgentSchedulerPoller();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(() => stopAgentSchedulerPoller()).not.toThrow();
    });
});
