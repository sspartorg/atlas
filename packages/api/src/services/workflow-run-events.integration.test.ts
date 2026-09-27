import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ExternalLinksModule from './external-links.js';
import type * as WorktreeOrchestratorModule from './worktree-orchestrator.js';
import { randomUUID } from 'node:crypto';
import type { IWorkflowGraph, RunOutcomeKind } from '@atlas/shared';

// Migration 024 — every park and resume leaves a row, on each path that parks
// or resumes a run. The engine is driven for real against the DB; only the
// CLI spawn and git are replaced, as in `workflow-engine.integration.test.ts`.
const spawned: Array<{ runId: string }> = [];
vi.mock('./agent-runner.js', () => ({
    spawnAgentRun: vi.fn(
        async (opts: { agentId: string; issueId?: string | null; workflowRun?: { id: string; nodeId: string } | null }) => {
            const { testDb } = await import('../../tests/_pg-db.js');
            const id = randomUUID();
            await testDb
                .insertInto('agent_runs')
                .values({
                    id,
                    agent_id: opts.agentId,
                    item_id: opts.issueId ?? null,
                    status: 'in_progress',
                    workflow_run_id: opts.workflowRun?.id ?? null,
                    node_id: opts.workflowRun?.nodeId ?? null,
                    started_at: new Date().toISOString(),
                })
                .execute();
            spawned.push({ runId: id });
            return id;
        },
    ),
    cancelRun: vi.fn(async () => ({ cancelled: false, pidKilled: null })),
}));
vi.mock('./worktree-orchestrator.js', async (importOriginal) => ({
    ...(await importOriginal<typeof WorktreeOrchestratorModule>()),
    ensureWorktree: vi.fn(async () => ({ path: '/tmp/atlas-wf-test', branch: 'atlas/wf/x', freshlyCreated: true })),
    pushWorktree: vi.fn(async () => ({ pushed: true, alreadyUpToDate: false })),
    openPullRequest: vi.fn(async () => ({ opened: true, url: 'https://github.com/o/r/pull/7', alreadyExists: false })),
    cleanupWorktreeAfterPush: vi.fn(async () => ({ worktreeRemoved: true, branchDeleted: true, dbCleared: false, warnings: [] })),
}));
vi.mock('./verification-gate.js', () => ({ runNamedCommand: vi.fn(async () => ({ kind: 'pass' as const })) }));
vi.mock('./external-links.js', async (importOriginal) => ({
    ...(await importOriginal<typeof ExternalLinksModule>()),
    fetchGithubPrTitle: vi.fn(async () => null),
}));
vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';
import { onStepFinished, resumeWorkflowRun, startWorkflowRun } from './workflow-engine.js';
import { commentsService } from './comments.js';
import { recordRunEvent } from './workflow-run-events.js';

const node = (id: string, type: string, extra: Record<string, string> = {}) => ({ id, type, position: { x: 0, y: 0 }, ...extra });
const edge = (source: string, target: string, kind: 'pass' | 'fail' = 'pass') => ({ id: `${source}-${kind}-${target}`, source, target, kind });

// Start → Coder → End, the Coder failing to an Owner node that loops back.
const devGraph = {
    nodes: [node('start', 'start'), node('coder', 'agent', { agent_id: 'agent-coder' }), node('owner', 'owner'), node('end', 'end')],
    edges: [edge('start', 'coder'), edge('coder', 'end'), edge('coder', 'owner', 'fail'), edge('owner', 'coder')],
} as unknown as IWorkflowGraph;

// Start → Sub-tasks (→ wf-dev) → End.
const taskGraph = {
    nodes: [node('start', 'start'), node('build', 'subtasks', { sub_workflow_id: 'wf-dev' }), node('end', 'end')],
    edges: [edge('start', 'build'), edge('build', 'end')],
} as unknown as IWorkflowGraph;

async function insertWorkflow(id: string, graph: IWorkflowGraph, inputKind: string): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({ id, project_id: 'p1', name: id, graph: JSON.stringify(graph), input_kind: inputKind, max_loops: 2 } as never)
        .execute();
}

async function finishStep(outcome: RunOutcomeKind, reason: string): Promise<void> {
    const step = spawned.at(-1);
    if (!step) throw new Error('no step spawned');
    await testDb
        .updateTable('agent_runs')
        .set({ status: 'completed', completed_at: new Date().toISOString(), outcome_kind: outcome, outcome_reason: reason })
        .where('id', '=', step.runId)
        .execute();
    await onStepFinished(step.runId);
}

const eventsOf = (runId: string) =>
    testDb
        .selectFrom('workflow_run_events')
        .select(['kind', 'item_id', 'node_id', 'reason'])
        .where('workflow_run_id', '=', runId)
        .orderBy('created_at', 'asc')
        .execute();

beforeEach(async () => {
    spawned.length = 0;
    await truncateAll();
    await insertProject('p1', 'ATL', { git_path: '/tmp/repo' });
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1', title: 'Task', status: 'ready' });
    await insertWorkflow('wf-dev', devGraph, 'item');
});

afterAll(closeTestDb);

describe('workflow run events', () => {
    it('writes a park with its reason, and the Resume button writes the resume', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('rejected', 'cannot start'); // coder fail → owner

        expect(await eventsOf(runId)).toEqual([
            { kind: 'parked', item_id: 'ATL-2', node_id: 'owner', reason: 'Sent back to you: rejected: cannot start' },
        ]);

        await resumeWorkflowRun(runId);
        expect((await eventsOf(runId)).map((e) => [e.kind, e.node_id])).toEqual([
            ['parked', 'owner'],
            ['resumed', 'owner'],
        ]);
        // The history survives what the run row forgets.
        const run = await testDb.selectFrom('workflow_runs').select('park_reason').where('id', '=', runId).executeTakeFirstOrThrow();
        expect(run.park_reason).toBeNull();
    });

    it('writes the resume when the Owner replies on the item', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('asked_question', 'Which API version?');
        await commentsService.create({ author: 'owner', issue_type: 'task', issue_id: 'ATL-2', body: 'v2' });
        await vi.waitFor(async () => expect(spawned).toHaveLength(2));
        expect((await eventsOf(runId)).map((e) => e.kind)).toEqual(['parked', 'resumed']);
    });

    describe('a sub-task that asks', () => {
        beforeEach(async () => {
            await insertWorkflow('wf-task', taskGraph, 'item');
            await testDb.updateTable('workflows').set({ input_kind: 'sub_task' } as never).where('id', '=', 'wf-dev').execute();
            await insertItem({ id: 'ATL-11', type: 'sub_task', project_id: 'p1', parent_id: 'ATL-2', parent_type: 'task', title: 'Sub', status: 'ready' });
        });

        async function parkedSubtask(): Promise<{ taskRun: string; childRun: string }> {
            const taskRun = await startWorkflowRun('wf-task', 'ATL-2');
            await finishStep('asked_question', 'Which database?');
            const child = await testDb.selectFrom('workflow_runs').select('id').where('item_id', '=', 'ATL-11').executeTakeFirstOrThrow();
            return { taskRun, childRun: child.id };
        }

        it('writes a park for the sub-task run and for the Task run it holds', async () => {
            const { taskRun, childRun } = await parkedSubtask();
            expect(await eventsOf(childRun)).toEqual([{ kind: 'parked', item_id: 'ATL-11', node_id: 'coder', reason: 'Which database?' }]);
            expect(await eventsOf(taskRun)).toEqual([
                { kind: 'parked', item_id: 'ATL-2', node_id: 'build', reason: 'Sub-task ATL-11 is waiting for you: Which database?' },
            ]);
        });

        it('a reply on the sub-task resumes both, and says so for both', async () => {
            const { taskRun, childRun } = await parkedSubtask();
            await commentsService.create({ author: 'owner', issue_type: 'sub_task', issue_id: 'ATL-11', body: 'Postgres.' });
            await vi.waitFor(async () => expect(spawned).toHaveLength(2));
            expect((await eventsOf(childRun)).map((e) => e.kind)).toEqual(['parked', 'resumed']);
            // The Task run's resume is written after its `parked_node_id` is
            // cleared, so the node comes from where it was waiting.
            expect((await eventsOf(taskRun)).map((e) => [e.kind, e.node_id])).toEqual([
                ['parked', 'build'],
                ['resumed', 'build'],
            ]);
        });

        it('a reply on the Task resumes the waiting sub-task, and says so for both', async () => {
            const { taskRun, childRun } = await parkedSubtask();
            await commentsService.create({ author: 'owner', issue_type: 'task', issue_id: 'ATL-2', body: 'Postgres.' });
            await vi.waitFor(async () => expect(spawned).toHaveLength(2));
            expect((await eventsOf(taskRun)).map((e) => e.kind)).toEqual(['parked', 'resumed']);
            expect((await eventsOf(childRun)).map((e) => e.kind)).toEqual(['parked', 'resumed']);
        });
    });

    // Best-effort: a history row must never break the engine it records.
    it('swallows a failed write instead of throwing into the engine', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await expect(recordRunEvent(runId, 'bogus' as never)).resolves.toBeUndefined();
        await expect(recordRunEvent('no-such-run', 'parked')).resolves.toBeUndefined();
        expect(await eventsOf(runId)).toEqual([]);
    });
});
