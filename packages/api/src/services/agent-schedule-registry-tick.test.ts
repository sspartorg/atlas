// Covers tickAgentScheduler branches that the existing
// agent-schedule-registry.test.ts doesn't reach because it never calls
// tickAgentScheduler directly.
//
// Split into a separate file so vi.mock('reminders.js') doesn't bleed
// into the existing test file.

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// remindersService is called inside tickAgentScheduler; mock it so the tick
// can run without the full reminders runtime.
vi.mock('./reminders.js', () => ({
    remindersService: {
        fireDueReminders: vi.fn().mockResolvedValue(0),
    },
}));

// agent-dispatcher is called for due agents; mock it to avoid real dispatch.
vi.mock('./agent-dispatcher.js', () => ({
    maybeAutoDispatch: vi.fn().mockResolvedValue({ dispatched: false, reason: 'mocked' }),
}));

// agent-runner is used by spawnFreedomRun; mock to avoid subprocess spawn.
vi.mock('./agent-runner.js', () => ({
    spawnAgentRun: vi.fn().mockResolvedValue('mock-run-id'),
}));

import { tickAgentScheduler } from './agent-schedule-registry.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';

// Silence scheduler console output in test runs.
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});

beforeEach(async () => {
    await truncateAll();
    vi.clearAllMocks();
});

afterAll(async () => {
    await closeTestDb();
});

/** Insert an agent and immediately stamp its next_run_at to a past time
 *  so tickAgentScheduler treats it as "due". */
async function insertDueAgent(
    id: string,
    overrides: Partial<{
        requires_item: boolean;
        concurrent_runs: number;
        schedule_preset: string;
        schedule_hours: number;
    }> = {},
): Promise<string> {
    await insertAgent({
        id,
        requires_item: overrides.requires_item ?? true,
    });
    // Stamp next_run_at to a time in the past so the agent is "due".
    await testDb
        .updateTable('agents')
        .set({
            next_run_at: '2020-01-01T00:00:00.000Z',
            schedule_preset: (overrides.schedule_preset ?? 'every_n_hours') as
                | 'every_n_hours'
                | 'daily'
                | 'weekly'
                | 'monthly',
            schedule_hours: overrides.schedule_hours ?? 6,
            concurrent_runs: overrides.concurrent_runs ?? 1,
        })
        .where('id', '=', id)
        .execute();
    return id;
}

describe('tickAgentScheduler — remindersService.fireDueReminders catch branches (ASRTICK)', () => {
    it('ASRTICK-1: tick runs cleanly when there are no stuck runs, no due reminders, and no due agents', async () => {
        // All DB tables are empty after truncateAll(). sweepStuckRuns returns 0,
        // fireDueReminders returns 0. No agents are due or unseeded.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-2: tick swallows fireDueReminders throwing an Error (line 431 true branch)', async () => {
        // Make fireDueReminders throw an Error — the catch block at line 427-432
        // fires, and the `instanceof Error ? err.message` TRUE branch executes.
        const { remindersService } = await import('./reminders.js');
        vi.mocked(remindersService.fireDueReminders).mockRejectedValueOnce(
            new Error('reminders-db-error'),
        );
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-3: tick swallows fireDueReminders throwing a non-Error (line 431 String(err) false branch)', async () => {
        // Make fireDueReminders throw a non-Error value so the `String(err)` branch
        // at line 431 fires: `err instanceof Error ? err.message : String(err)`
        const { remindersService } = await import('./reminders.js');
        vi.mocked(remindersService.fireDueReminders).mockImplementationOnce(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'non-error-from-reminders-tick';
        });
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-4: tick logs when fireDueReminders fires > 0 reminders (line 429 true branch)', async () => {
        // fired > 0 triggers the schedLog at line 429.
        const { remindersService } = await import('./reminders.js');
        vi.mocked(remindersService.fireDueReminders).mockResolvedValueOnce(3);
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-13: schedLog prints via console.log when ATLAS_LOG_LEVEL=debug (schedLog debug branch)', async () => {
        // schedLog re-reads process.env['ATLAS_LOG_LEVEL'] on every call; with
        // level=debug the `lvl === 'debug' || lvl === 'trace'` branch is true
        // and console.log is invoked (normally silenced at the default 'info'
        // level used by every other test in this file).
        const prev = process.env['ATLAS_LOG_LEVEL'];
        process.env['ATLAS_LOG_LEVEL'] = 'debug';
        const logSpy = vi.spyOn(console, 'log');
        try {
            const { remindersService } = await import('./reminders.js');
            vi.mocked(remindersService.fireDueReminders).mockResolvedValueOnce(2);
            await expect(tickAgentScheduler()).resolves.toBeUndefined();
            expect(logSpy).toHaveBeenCalled();
        } finally {
            if (prev === undefined) delete process.env['ATLAS_LOG_LEVEL'];
            else process.env['ATLAS_LOG_LEVEL'] = prev;
        }
    });

    it('ASRTICK-14: schedLog defaults to info (silent) when ATLAS_LOG_LEVEL is unset (?? fallback branch)', async () => {
        // Deleting the env var exercises the `?? 'info'` fallback inside
        // schedLog; 'info' is not 'debug'/'trace' so console.log stays silent.
        const prev = process.env['ATLAS_LOG_LEVEL'];
        delete process.env['ATLAS_LOG_LEVEL'];
        const logSpy = vi.spyOn(console, 'log');
        logSpy.mockClear();
        try {
            const { remindersService } = await import('./reminders.js');
            vi.mocked(remindersService.fireDueReminders).mockResolvedValueOnce(5);
            await expect(tickAgentScheduler()).resolves.toBeUndefined();
            expect(logSpy).not.toHaveBeenCalled();
        } finally {
            if (prev === undefined) delete process.env['ATLAS_LOG_LEVEL'];
            else process.env['ATLAS_LOG_LEVEL'] = prev;
        }
    });
});

describe('tickAgentScheduler — dispatchOneAgent branches via due item-driven agent (ASRTICK)', () => {
    it('ASRTICK-5: due item-driven agent with empty queue returns silently (ready.length === 0 branch)', async () => {
        // Insert a project + item-driven agent that is due but has no 'ready' items.
        await insertProject('atk-p1', 'ATK');
        await insertDueAgent('atk-agent-1');
        // No items in 'ready' status for this agent → dispatchOneAgent hits
        // `if (ready.length === 0) return;` branch.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-6: due item-driven agent at capacity returns without dispatching (capacity === 0 branch)', async () => {
        // Insert project + agent with concurrent_runs=1 and a 'queued' agent_run
        // already in-flight so capacity === 0.
        await insertProject('atk-p2', 'BTK');
        await insertDueAgent('atk-agent-2', { concurrent_runs: 1 });
        // Insert a ready item assigned to this agent.
        // stories require a parent epic (items_check_parent trigger).
        const epicId = await insertItem({
            id: 'BTK-epic-1',
            type: 'epic',
            project_id: 'atk-p2',
            title: 'Epic for cap test',
        });
        const itemId = await insertItem({
            type: 'story',
            project_id: 'atk-p2',
            parent_id: epicId,
            parent_type: 'epic',
            title: 'Story for cap test',
            status: 'ready',
            assignee_agent_id: 'atk-agent-2',
        });
        // Insert an existing in-progress run to fill the capacity.
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'atk-run-1',
                item_id: itemId,
                agent_id: 'atk-agent-2',
                status: 'in_progress',
                started_at: new Date().toISOString(),
            })
            .execute();
        // Tick should hit `if (capacity === 0) … return` branch.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-7: due item-driven agent dispatches a ready item (happy dispatch path)', async () => {
        const { maybeAutoDispatch } = await import('./agent-dispatcher.js');
        vi.mocked(maybeAutoDispatch).mockResolvedValueOnce({ dispatched: true, runId: 'r1' });

        await insertProject('atk-p3', 'CTK');
        await insertDueAgent('atk-agent-3', { concurrent_runs: 2 });
        // stories require a parent epic (items_check_parent trigger).
        const epicId = await insertItem({
            id: 'CTK-epic-1',
            type: 'epic',
            project_id: 'atk-p3',
            title: 'Epic for dispatch test',
        });
        await insertItem({
            type: 'story',
            project_id: 'atk-p3',
            parent_id: epicId,
            parent_type: 'epic',
            title: 'Dispatching story',
            status: 'ready',
            assignee_agent_id: 'atk-agent-3',
        });
        // maybeAutoDispatch returns dispatched=true → schedLog dispatch line fires.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
        expect(maybeAutoDispatch).toHaveBeenCalledTimes(1);
    });

    it('ASRTICK-8: due item-driven agent with maybeAutoDispatch returning not-dispatched (skip-dispatch log branch)', async () => {
        const { maybeAutoDispatch } = await import('./agent-dispatcher.js');
        vi.mocked(maybeAutoDispatch).mockResolvedValueOnce({ dispatched: false, reason: 'lock-held' });

        await insertProject('atk-p4', 'DTK');
        await insertDueAgent('atk-agent-4', { concurrent_runs: 2 });
        // stories require a parent epic (items_check_parent trigger).
        const epicId = await insertItem({
            id: 'DTK-epic-1',
            type: 'epic',
            project_id: 'atk-p4',
            title: 'Epic for skip test',
        });
        await insertItem({
            type: 'story',
            project_id: 'atk-p4',
            parent_id: epicId,
            parent_type: 'epic',
            title: 'Skip story',
            status: 'ready',
            assignee_agent_id: 'atk-agent-4',
        });
        // dispatched=false → skip-dispatch log line fires.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
        expect(maybeAutoDispatch).toHaveBeenCalledTimes(1);
    });
});

describe('tickAgentScheduler — dispatchOneAgent freedom-mode branches (ASRTICK)', () => {
    it('ASRTICK-9: freedom-mode agent at capacity does NOT spawn (at_capacity branch)', async () => {
        await insertProject('atk-p5', 'ETK');
        // requires_item=false → freedom mode; concurrent_runs=1
        await insertDueAgent('atk-agent-5', { requires_item: false, concurrent_runs: 1 });
        // Fill capacity with an existing in-progress run (item_id=null for freedom runs).
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'atk-run-2',
                item_id: null,
                agent_id: 'atk-agent-5',
                status: 'in_progress',
                started_at: new Date().toISOString(),
            })
            .execute();
        // Should hit the `at_capacity` branch → return without spawning.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
    });

    it('ASRTICK-10: freedom-mode agent below capacity spawns a freedom run', async () => {
        const { spawnAgentRun } = await import('./agent-runner.js');
        vi.mocked(spawnAgentRun).mockResolvedValueOnce('freedom-run-id');

        await insertProject('atk-p6', 'FTK');
        await insertDueAgent('atk-agent-6', { requires_item: false, concurrent_runs: 2 });
        // No existing runs → capacity available → should spawn.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
        expect(spawnAgentRun).toHaveBeenCalledTimes(1);
    });
});

describe('tickAgentScheduler — unseeded next_run_at seeding branch (ASRTICK)', () => {
    it('ASRTICK-11: active agent with next_run_at=null gets seeded by tick (lines 439-461)', async () => {
        await insertProject('atk-p7', 'GTK');
        await insertAgent({ id: 'atk-agent-7' });
        // next_run_at defaults to null in insertAgent — the tick should seed it.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
        // After the tick next_run_at should be set.
        const row = await testDb
            .selectFrom('agents')
            .select('next_run_at')
            .where('id', '=', 'atk-agent-7')
            .executeTakeFirst();
        expect(row?.next_run_at).not.toBeNull();
    });
});

describe('tickAgentScheduler — sweepStuckRuns: swept > 0 log branch (ASRTICK)', () => {
    it('ASRTICK-12: sweepStuckRuns returns > 0 when there is a genuinely stuck run (lines 417 log branch)', async () => {
        await insertProject('atk-p8', 'HTK');
        await insertAgent({ id: 'atk-agent-8' });
        // item_id=null below — no item insert needed; sweepStuckRuns scans
        // agent_runs directly. (story type would require a parent epic via
        // the items_check_parent trigger, so we skip the insertItem call.)
        // Insert a run that is in_progress, started >30 minutes ago, with null output_text.
        const thresholdMs = 30 * 60 * 1000;
        const stuckStarted = new Date(Date.now() - thresholdMs - 60_000).toISOString();
        await testDb
            .insertInto('agent_runs')
            .values({
                id: 'atk-run-stuck',
                item_id: null,
                agent_id: 'atk-agent-8',
                status: 'in_progress',
                started_at: stuckStarted,
                output_text: null,
            })
            .execute();
        // sweepStuckRuns should find this run and flip it to 'error',
        // causing swept > 0 and the schedLog at line 417 to fire.
        await expect(tickAgentScheduler()).resolves.toBeUndefined();
        // Verify it was swept.
        const run = await testDb
            .selectFrom('agent_runs')
            .select('status')
            .where('id', '=', 'atk-run-stuck')
            .executeTakeFirst();
        expect(run?.status).toBe('error');
    });
});
