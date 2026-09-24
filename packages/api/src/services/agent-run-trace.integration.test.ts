import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));
// A run with no item notifies the Owner, and with a bot token in the
// environment that is a real HTTP call with real retries — seconds per run, and
// flaky on the network. The subject here is the trace and the verdict.
vi.mock('./external-notifications.js', () => ({
    sendExternalForNotification: vi.fn().mockResolvedValue(undefined),
    sendExternalNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./web-push.js', () => ({ sendWebPushForNotification: vi.fn().mockResolvedValue(undefined) }));
// `notifyStep` does a dynamic `import('./workflow-engine.js')` to break a
// cycle. In production that resolves once and is cached; under vitest it is a
// cold transform of the engine and everything it reaches — 6-14s on the first
// call, which is the whole of this file's runtime. These runs carry no
// `workflow_run_id`, so there is no step to report either way.
vi.mock('./workflow-engine.js', () => ({ onStepFinished: vi.fn().mockResolvedValue(undefined) }));

import { completeRun } from './agent-runner.js';
import { agentTestsService } from './agent-tests.js';
import { evaluateAgentTestRun } from './agent-tests-evaluate-run.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';

// The trace is parsed once, at completion, from the transcript the run already
// wrote — and the verdict is decided there too, instead of whenever somebody
// next opened the Tests tab.

const CWD = '/tmp/atlas-run-x';
const TRANSCRIPT = [
    JSON.stringify({ type: 'system', subtype: 'init', cwd: CWD, model: 'claude-opus-5' }),
    JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-25T10:00:03.000Z',
        message: { content: [{ type: 'thinking', thinking: 'hm' }, { type: 'tool_use', name: 'Read', input: { file_path: `${CWD}/src/a.ts` } }] },
    }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
    // Under `--output-format stream-json` the agent's prose — including its
    // `atlas-outcome` block — arrives inside the final `result` event, not as
    // raw text appended to the stream.
    JSON.stringify({ type: 'result', result: '```atlas-outcome\noutcome: done\nsummary: read the file\n```' }),
].join('\n');

async function seedRun(id: string): Promise<void> {
    await testDb
        .insertInto('agent_runs')
        .values({
            id,
            agent_id: 'agent-coder',
            project_id: 'p1',
            status: 'in_progress',
            started_at: '2026-09-25T10:00:00.000Z',
        } as never)
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    await insertAgent({ id: 'agent-coder', status: 'active' });
});

afterAll(closeTestDb);

// 30s, not the repo's default 15s. `completeRun` fans out to the memory hook,
// the notification path and a dynamic `import('./workflow-engine.js')` that
// vitest transforms cold on first call — 6-14s of harness, none of it the code
// under test (`parseRunTrace` itself is 1.25ms over a 616KB transcript). At the
// default this file passed or failed depending on machine load.
const SLOW = { timeout: 30_000 };

describe('completeRun', () => {
    it('stores what the run actually did, parsed from its own transcript', SLOW, async () => {
        await seedRun('r-trace');
        await completeRun('r-trace', 'agent-coder', null, null, TRANSCRIPT);

        const row = await testDb
            .selectFrom('agent_runs')
            .select(['status', 'trace_summary'])
            .where('id', '=', 'r-trace')
            .executeTakeFirstOrThrow();
        expect(row.status).toBe('completed');
        expect(row.trace_summary).toMatchObject({
            source: 'claude',
            turns: 2,
            tool_calls: 2,
            tools: { Read: 1, Bash: 1 },
            thinking_blocks: 1,
            // Relative to the run's own sandbox, not the absolute temp path.
            files_touched: ['src/a.ts'],
            // Measured against the run's `started_at`; the transcript's init
            // event carries no timestamp of its own.
            ttft_ms: 3000,
        });
    });

    // Every run before migration 017 has none, and a consumer must be able to
    // tell "we did not look" from "it did nothing".
    it('leaves the trace null when there is no transcript to read', SLOW, async () => {
        await seedRun('r-empty');
        await completeRun('r-empty', 'agent-coder', null, null, '');
        const row = await testDb
            .selectFrom('agent_runs')
            .select('trace_summary')
            .where('id', '=', 'r-empty')
            .executeTakeFirstOrThrow();
        expect(row.trace_summary).toBeNull();
    });
});

describe('evaluateAgentTestRun', () => {
    async function makeTestRun(): Promise<string> {
        const test = await agentTestsService.create({
            agent_id: 'agent-coder',
            project_id: 'p1',
            name: 'reads the task',
            item_template: { issue_type: 'task', title: 'Read it' },
            expectations: { outcome_kind: 'done' },
        });
        await insertItem({ id: 'ATL-50', type: 'task', project_id: 'p1', title: 'x' });
        await seedRun('r-hook');
        await testDb
            .insertInto('agent_test_runs')
            // `batch_id` is NOT NULL since migration 018 — one press of Run
            // is a batch, and a lone sample is a batch of one.
            .values({
                id: 'atr-1',
                agent_test_id: test.id,
                agent_run_id: 'r-hook',
                item_id: 'ATL-50',
                batch_id: 'atr-1',
            } as never)
            .execute();
        return test.id;
    }

    const verdictOf = async () =>
        (
            await testDb
                .selectFrom('agent_test_runs')
                .select(['verdict', 'evaluated_at'])
                .where('id', '=', 'atr-1')
                .executeTakeFirstOrThrow()
        );

    // The defect this closes: judging used to happen only on read, so a test
    // run nobody opened stayed `running` in the database for good.
    it('decides the verdict when the dispatch finishes, with nobody watching', SLOW, async () => {
        await makeTestRun();
        await completeRun('r-hook', 'agent-coder', null, null, TRANSCRIPT);
        const judged = await verdictOf();
        expect(judged.verdict).toBe('passed');
        expect(judged.evaluated_at).not.toBeNull();
    });

    it('is a no-op for a run that is not a test', async () => {
        await seedRun('r-plain');
        await expect(evaluateAgentTestRun('r-plain')).resolves.toBeUndefined();
    });

    it('leaves a dispatch that has not finished alone', async () => {
        await makeTestRun();
        await evaluateAgentTestRun('r-hook');
        expect((await verdictOf()).verdict).toBe('running');
    });
});
