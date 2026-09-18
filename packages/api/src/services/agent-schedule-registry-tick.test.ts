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

// The workflow engine (reconcile + dispatch) runs for real against the
// empty test DB; mock the runner so nothing could spawn a CLI.
vi.mock('./agent-runner.js', () => ({
    spawnAgentRun: vi.fn().mockResolvedValue('mock-run-id'),
    cancelRun: vi.fn(),
}));

import { tickAgentScheduler } from './agent-schedule-registry.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent } from '../../tests/_items.js';

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
