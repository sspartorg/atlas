import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';
import { sql } from 'kysely';

import { SKIPPED_MATCH } from './migrations/015_backfill_skipped_verdicts.js';

// Migration 013 added `skipped` and taught the runner to record it, but left
// the rows already in the table alone — 82 of them saying `pass` while their
// own `output_tail` began `<id>: skipped - …`.
//
// That was visible in the product the moment the run timeline shipped: a
// golden-set run showed `gate-coverage` in green as **passed**, with
// `skipped - no coverage script declared` printed directly underneath. An
// Owner reading that page would conclude coverage had been checked.

const EMPTY_GRAPH = JSON.stringify({ nodes: [], edges: [] });

async function seedVerdict(id: string, verdict: string, output: string | null): Promise<void> {
    await testDb
        .insertInto('run_gate_results')
        .values({ id, workflow_run_id: 'r1', script_id: 'gate-x', verdict, output_tail: output } as never)
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await testDb.insertInto('workflows').values({ id: 'w1', project_id: 'p1', name: 'w', input_kind: 'item' } as never).execute();
    await testDb
        .insertInto('workflow_runs')
        .values({ id: 'r1', workflow_id: 'w1', project_id: 'p1', status: 'running', graph_snapshot: EMPTY_GRAPH } as never)
        .execute();
});

afterAll(async () => {
    await closeTestDb();
});

/**
 * The migration's own UPDATE, run through Kysely.
 *
 * Migrations take a knex handle and the test DB is Kysely, and the repo's
 * convention (`migrations-rollback.test.ts`) is not to execute migrations in
 * tests at all. What is worth testing here is the PREDICATE — which rows get
 * rewritten — so the pattern is imported from the migration rather than copied,
 * and only the plumbing differs.
 */
async function runBackfill(): Promise<void> {
    await sql`
        UPDATE run_gate_results
           SET verdict = 'skipped'
         WHERE verdict = 'pass'
           AND output_tail ~* ${SKIPPED_MATCH}
    `.execute(testDb as never);
}

async function verdictOf(id: string): Promise<string> {
    const row = await testDb.selectFrom('run_gate_results').select('verdict').where('id', '=', id).executeTakeFirst();
    return row!.verdict as string;
}

describe('015 backfill: a pass whose output says skipped', () => {
    it('is corrected to skipped', async () => {
        await seedVerdict('a', 'pass', 'gate-coverage: skipped - no coverage script declared');
        await runBackfill();
        expect(await verdictOf('a')).toBe('skipped');
    });

    it('leaves a genuine pass alone', async () => {
        await seedVerdict('b', 'pass', 'gate-perf: within budget');
        await runBackfill();
        expect(await verdictOf('b')).toBe('pass');
    });

    it('leaves a silent pass alone', async () => {
        await seedVerdict('c', 'pass', null);
        await runBackfill();
        expect(await verdictOf('c')).toBe('pass');
    });

    it('never touches a failure', async () => {
        await seedVerdict('d', 'fail', 'gate-hygiene:\n1. skipped something');
        await runBackfill();
        expect(await verdictOf('d')).toBe('fail');
    });

    // The marker has to be the script's own first-line announcement. A run that
    // merely mentions skipped tests further down passed, and rewriting it would
    // be inventing evidence rather than correcting it.
    it('does not rewrite a pass that only mentions "skipped" later', async () => {
        await seedVerdict('e', 'pass', 'gate-hygiene: clean\n3 tests skipped');
        await runBackfill();
        expect(await verdictOf('e')).toBe('pass');
    });

    it('is safe to run twice', async () => {
        await seedVerdict('f', 'pass', 'gate-visual: skipped - no UI files changed');
        await runBackfill();
        await runBackfill();
        expect(await verdictOf('f')).toBe('skipped');
    });
});
