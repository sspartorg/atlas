import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { agentQualification, suiteVerdict } from './agent-qualification.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertProject } from '../../tests/_items.js';

// "How do we know ABC Agent does what it is supposed to?" — and, the half that
// makes the first half worth anything, "is that still true of the agent as it
// is configured right now?"

let seq = 0;

async function fixture(over: { id?: string; agent?: string; name?: string; source?: string | null } = {}) {
    const id = over.id ?? `t-${++seq}`;
    await testDb
        .insertInto('agent_tests')
        .values({
            id,
            agent_id: over.agent ?? 'agent-coder',
            project_id: null,
            name: over.name ?? `fixture ${id}`,
            item_template: JSON.stringify({ issue_type: 'task', title: 'x' }) as never,
            expectations: JSON.stringify({ outcome_kind: 'done' }) as never,
            source_test_id: over.source === undefined ? null : over.source,
        } as never)
        .execute();
    return id;
}

/** One judged sample, with the configuration the dispatch ran against. */
async function sample(over: {
    test: string;
    verdict: 'passed' | 'failed' | 'errored' | 'running';
    batch?: string;
    index?: number;
    at?: string;
    model?: string;
    effort?: string;
    prompt_version?: number;
    agent?: string;
}) {
    const runId = `ar-${++seq}`;
    await testDb
        .insertInto('agent_runs')
        .values({
            id: runId,
            agent_id: over.agent ?? 'agent-coder',
            status: 'completed',
            cli: 'claude',
            model: over.model ?? 'claude-sonnet-5',
            effort: over.effort ?? 'medium',
            prompt_version: over.prompt_version ?? 1,
        } as never)
        .execute();
    await testDb
        .insertInto('agent_test_runs')
        .values({
            id: `r-${seq}`,
            agent_test_id: over.test,
            agent_run_id: runId,
            verdict: over.verdict,
            failures: JSON.stringify(over.verdict === 'failed' ? ['expected done, got rejected'] : []) as never,
            batch_id: over.batch ?? `b-${over.test}`,
            sample_index: over.index ?? 0,
            created_at: over.at ?? '2026-09-20T10:00:00Z',
        } as never)
        .execute();
}

const of = async (agentId = 'agent-coder') => (await agentQualification(agentId))[0]!;

beforeEach(async () => {
    seq = 0;
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', model: 'claude-sonnet-5', effort: 'medium' });
});

afterAll(async () => {
    await closeTestDb();
});

// The fold, with no database in the way. These four are the honesty rules;
// everything else in the file is plumbing that feeds them.
describe('suiteVerdict', () => {
    it('is no_tests when the agent has none', () => {
        expect(suiteVerdict({ fixtures: 0, never_run: 0, failed: 0, blocked: 0, stale: false })).toBe('no_tests');
    });

    it('is never_run — not qualified — when nothing has ever been proven', () => {
        expect(suiteVerdict({ fixtures: 3, never_run: 3, failed: 0, blocked: 0, stale: false })).toBe('never_run');
    });

    it('is blocked, not failing, when the latest batch judged nothing', () => {
        // ADR 0020's distinction at the suite level: a CLI that would not start
        // is a broken environment, not an agent that got it wrong.
        expect(suiteVerdict({ fixtures: 3, never_run: 0, failed: 0, blocked: 1, stale: false })).toBe('blocked');
    });

    it('prefers failing over blocked when something actually failed', () => {
        expect(suiteVerdict({ fixtures: 3, never_run: 0, failed: 1, blocked: 1, stale: false })).toBe('failing');
    });

    it('is stale when a passing suite ran against a different configuration', () => {
        expect(suiteVerdict({ fixtures: 3, never_run: 0, failed: 0, blocked: 0, stale: true })).toBe('stale');
    });

    it('is qualified only when every fixture has run and passed on this configuration', () => {
        expect(suiteVerdict({ fixtures: 3, never_run: 0, failed: 0, blocked: 0, stale: false })).toBe('qualified');
    });
});

describe('agentQualification', () => {
    it('reads no_tests for an agent with no fixtures', async () => {
        expect(await of()).toMatchObject({ verdict: 'no_tests', fixtures: 0 });
    });

    it('counts pass@1 and pass@k over the latest batch of each fixture', async () => {
        const a = await fixture({ name: 'does the job' });
        const b = await fixture({ name: 'refuses without a contract' });
        await sample({ test: a, verdict: 'passed', index: 0 });
        // b passes only on the second sample: pass@k yes, pass@1 no, flaky.
        await sample({ test: b, verdict: 'failed', index: 0 });
        await sample({ test: b, verdict: 'passed', index: 1 });

        const q = await of();
        expect(q).toMatchObject({ fixtures: 2, passed_at_1: 1, passed_at_k: 2, failed: 0, flaky: 1 });
        expect(q.verdict).toBe('qualified');
    });

    it('is failing when a fixture never passed in its latest batch', async () => {
        const a = await fixture();
        await sample({ test: a, verdict: 'failed' });
        const q = await of();
        expect(q).toMatchObject({ verdict: 'failing', failed: 1 });
        expect(q.per_fixture[0]?.failures).toContain('expected done, got rejected');
    });

    it('goes stale — with the field named — when the model changed since the last run', async () => {
        const a = await fixture();
        await sample({ test: a, verdict: 'passed', model: 'claude-sonnet-5' });
        expect(await of()).toMatchObject({ verdict: 'qualified', stale: false });

        await testDb.updateTable('agents').set({ model: 'haiku' }).where('id', '=', 'agent-coder').execute();
        const q = await of();
        expect(q.verdict).toBe('stale');
        expect(q.stale_reason).toContain('claude-sonnet-5');
        expect(q.stale_reason).toContain('haiku');
    });

    it('goes stale when the prompt version moved past the one it was proven on', async () => {
        const a = await fixture();
        await sample({ test: a, verdict: 'passed', prompt_version: 1 });
        await testDb.updateTable('agents').set({ prompt_version: 2 }).where('id', '=', 'agent-coder').execute();
        expect((await of()).stale_reason).toContain('v1 → v2');
    });

    // The signal has to survive ordinary editing or it gets ignored. An accent
    // colour is not a reason to re-spend a suite.
    it('does not go stale over an edit that cannot change behaviour', async () => {
        const a = await fixture();
        await sample({ test: a, verdict: 'passed' });
        await testDb.updateTable('agents').set({ accent_color: '#123456' }).where('id', '=', 'agent-coder').execute();
        expect(await of()).toMatchObject({ verdict: 'qualified', stale: false });
    });

    it('reports a fixture whose whole batch errored as blocked, not failed', async () => {
        const a = await fixture();
        await sample({ test: a, verdict: 'errored' });
        expect(await of()).toMatchObject({ verdict: 'blocked', blocked: 1, failed: 0 });
    });

    it('labels each fixture catalog, edited or owner', async () => {
        await fixture({ name: 'mine', source: null });
        // Adopted and untouched: the hash matches what `adoptStarterTests` wrote.
        const adopted = await fixture({ name: 'shipped', source: 'ships-with-it' });
        // Through the service, not a hand-rolled hash: the point is that a
        // round-trip through jsonb still reads as untouched.
        const { bodyHashForTest } = await import('./agent-starter-tests.js');
        await testDb
            .updateTable('agent_tests')
            .set({
                source_hash: bodyHashForTest({
                    name: 'shipped',
                    item_template: { title: 'x', issue_type: 'task' },
                    expectations: { outcome_kind: 'done' },
                }),
            })
            .where('id', '=', adopted)
            .execute();

        const q = await of();
        const byName = new Map(q.per_fixture.map((f) => [f.name, f.provenance]));
        expect(byName.get('mine')).toBe('owner');
        expect(byName.get('shipped')).toBe('catalog');

        // The Owner renames it: now theirs, and an upgrade must not touch it.
        await testDb.updateTable('agent_tests').set({ name: 'shipped, my way' }).where('id', '=', adopted).execute();
        const after = await of();
        expect(after.per_fixture.find((f) => f.name === 'shipped, my way')?.provenance).toBe('edited');
    });

    it('returns every agent when no id is given, and does not mix their fixtures up', async () => {
        await insertAgent({ id: 'agent-reviewer' });
        await fixture({ agent: 'agent-coder' });
        await fixture({ agent: 'agent-reviewer' });
        await fixture({ agent: 'agent-reviewer' });

        const all = await agentQualification();
        const byAgent = new Map(all.map((q) => [q.agent_id, q.fixtures]));
        expect(byAgent.get('agent-coder')).toBe(1);
        expect(byAgent.get('agent-reviewer')).toBe(2);
    });

    // A fleet read must not judge anything. Firing 72 judge passes and 72
    // writes because somebody opened the Agents page is not a read.
    it('does not write anything', async () => {
        const a = await fixture();
        await sample({ test: a, verdict: 'passed' });
        const before = await testDb.selectFrom('agent_test_runs').select(['id', 'verdict']).execute();
        await agentQualification();
        expect(await testDb.selectFrom('agent_test_runs').select(['id', 'verdict']).execute()).toEqual(before);
    });
});
