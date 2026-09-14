import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import {
    sweepStuckRuns,
    startAgentSchedulerPoller,
    stopAgentSchedulerPoller,
    STUCK_RUN_THRESHOLD_MS,
} from './agent-schedule-registry.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

// Silence the scheduler's verbose console.log output so test output is clean.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

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
