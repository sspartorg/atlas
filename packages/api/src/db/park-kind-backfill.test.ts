import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { BACKFILL_PARK_KIND_SQL } from './migrations/014_workflow_park_kind.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

// Migration 014's one-off backfill over the prose the engine wrote before
// `park_kind` existed. Run inside a rolled-back transaction with the CHECK
// dropped, so pre-014 rows (no kind) can be written at all.

const ROLLBACK = new Error('rollback');

const REASONS: Array<[string, string]> = [
    ['Sub-task ATL-9 is waiting for you: What colour?', 'subtask_waiting'],
    ['checklist_failed: tests added', 'checklist_failed'],
    ['Loop limit reached (3): still red', 'loop_limit'],
    ['Sent back for late sub-tasks 3 times: sub-task ATL-4 is still open', 'loop_limit'],
    ['The Script step "Lint" has no command. Type one in the workflow builder, then resume the run.', 'wiring_gap'],
    ['The check `pnpm test` could not run (no pnpm), so nothing was checked.', 'check_unavailable'],
    ['The check `pnpm test` had no repo to run in', 'check_unavailable'],
    ['Sent back to you: rejected: no', 'review_requested'],
    ['The workflow reached an Owner step — review and reply to continue', 'review_requested'],
    ['No pass connection from this step', 'wiring_gap'],
    ['Workflow graph has no node n9', 'wiring_gap'],
    ['No Sub-tasks step runs ATL-3 (no matching label). Label or close them, then resume.', 'wiring_gap'],
    ['Could not push: auth. Resume the run to retry delivery.', 'delivery_failed'],
    ['Could not prepare the worktree: dirty', 'setup_failed'],
    ['Could not refresh the worktree onto the latest default branch: x', 'setup_failed'],
    ['Project setup script failed', 'setup_failed'],
    ['Could not start sub-task ATL-5: boom', 'dispatch_failed'],
    ['Could not start Coder: boom', 'dispatch_failed'],
    ['Agent agent-x is missing or inactive', 'missing_agent'],
    ['The agent step errored again after an automatic retry: oom', 'step_error'],
    ['A step stopped reporting back (the API may have restarted)', 'lost_step'],
    ['agent_did_not_signal_outcome', 'no_outcome'],
    ['The agent rejected the work', 'rejected'],
];

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await testDb
        .insertInto('workflows')
        .values({ id: 'wf', project_id: 'p1', name: 'wf', graph: '{}', input_kind: 'item', trigger: 'manual' } as never)
        .execute();
    await testDb
        .insertInto('workflow_runs')
        .values({ id: 'r1', workflow_id: 'wf', project_id: 'p1', status: 'waiting_for_owner', graph_snapshot: '{}' } as never)
        .execute();
});

afterAll(closeTestDb);

describe('migration 014 park_kind backfill', () => {
    it('classifies the old prose, falls back to the step for free text, and leaves the rest as other', async () => {
        let got: Record<string, string | null> = {};
        await testDb
            .transaction()
            .execute(async (trx) => {
                await sql`ALTER TABLE workflow_run_events DROP CONSTRAINT workflow_run_events_park_kind_check`.execute(trx);
                const ev = (id: string, reason: string | null, node: string | null = null, kind = 'parked', at = '2026-10-10T00:10:00Z') =>
                    trx
                        .insertInto('workflow_run_events')
                        .values({ id, workflow_run_id: 'r1', kind, reason, node_id: node, created_at: at } as never)
                        .execute();
                for (const [i, [reason]] of REASONS.entries()) await ev(`e${i}`, reason);
                // Free text: an agent question, an agent's rejection reason, a gate's raw output.
                for (const [id, node, outcome] of [['a1', 'ask', 'asked_question'], ['a2', 'rej', 'rejected']] as const) {
                    await trx
                        .insertInto('agent_runs')
                        .values({ id, agent_id: 'agent-coder', status: 'completed', workflow_run_id: 'r1', node_id: node, outcome_kind: outcome, created_at: '2026-10-10T00:00:00Z' } as never)
                        .execute();
                }
                await trx
                    .insertInto('run_gate_results')
                    .values({ id: 'g1', workflow_run_id: 'r1', node_id: 'gate', script_id: 'gate', verdict: 'fail', created_at: '2026-10-10T00:00:00Z' } as never)
                    .execute();
                await ev('free-ask', 'Which database?', 'ask');
                await ev('free-rej', 'Out of scope for this Task.', 'rej');
                await ev('free-gate', '3 tests failed', 'gate');
                await ev('free-none', 'Something nobody wrote down', 'gone');
                await ev('resume', null, 'ask', 'resumed');

                await sql.raw(BACKFILL_PARK_KIND_SQL).execute(trx);
                const rows = await trx.selectFrom('workflow_run_events').select(['id', 'park_kind']).execute();
                got = Object.fromEntries(rows.map((r) => [r.id, r.park_kind]));
                throw ROLLBACK;
            })
            .catch((e: unknown) => {
                if (e !== ROLLBACK) throw e;
            });

        expect(Object.fromEntries(REASONS.map(([reason], i) => [reason, got[`e${i}`]]))).toEqual(Object.fromEntries(REASONS));
        expect(got['free-ask']).toBe('question');
        expect(got['free-rej']).toBe('rejected');
        expect(got['free-gate']).toBe('gate_failed');
        expect(got['free-none']).toBe('other');
        expect(got['resume']).toBeNull();
    });

    it('the CHECK makes every park carry a known kind and every resume none', async () => {
        const ins = (id: string, kind: string, park_kind: string | null) =>
            testDb.insertInto('workflow_run_events').values({ id, workflow_run_id: 'r1', kind, park_kind } as never).execute();
        await expect(ins('x1', 'parked', null)).rejects.toThrow(/park_kind_check/);
        await expect(ins('x2', 'parked', 'made_up')).rejects.toThrow(/park_kind_check/);
        await expect(ins('x3', 'resumed', 'question')).rejects.toThrow(/park_kind_check/);
        await ins('x4', 'parked', 'question');
        await ins('x5', 'resumed', null);
    });
});
