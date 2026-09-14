import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ExternalLinksModule from './external-links.js';
import type * as WorktreeOrchestratorModule from './worktree-orchestrator.js';
import { randomUUID } from 'node:crypto';
import type { IWorkflowGraph, RunOutcomeKind, RunStatus } from '@atlas/shared';

// The engine is exercised against the real DB; only the parts that would
// spawn a CLI or touch git are replaced. `spawnAgentRun` just records a live
// step row, the way the real runner's INSERT does.
const spawned: Array<{ agentId: string; nodeId: string; runId: string }> = [];
vi.mock('./agent-runner.js', () => ({
    spawnAgentRun: vi.fn(async (opts: { agentId: string; issueId?: string | null; workflowRun?: { id: string; nodeId: string } | null }) => {
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
        spawned.push({ agentId: opts.agentId, nodeId: opts.workflowRun?.nodeId ?? '', runId: id });
        return id;
    }),
    cancelRun: vi.fn(async () => ({ cancelled: false, pidKilled: null })),
}));

const git = vi.hoisted(() => ({
    ensureWorktree: vi.fn(async () => ({ path: '/tmp/atlas-wf-test', branch: 'atlas/wf/x', freshlyCreated: true })),
    pushWorktree: vi.fn(async () => ({ pushed: true, alreadyUpToDate: false })),
    openPullRequest: vi.fn(async () => ({ opened: true, url: 'https://github.com/o/r/pull/7', alreadyExists: false })),
    cleanupWorktreeAfterPush: vi.fn(async () => ({ worktreeRemoved: true, branchDeleted: true, dbCleared: false, warnings: [] })),
}));
vi.mock('./worktree-orchestrator.js', async (importOriginal) => ({
    ...(await importOriginal<typeof WorktreeOrchestratorModule>()),
    ...git,
}));
vi.mock('./external-links.js', async (importOriginal) => ({
    ...(await importOriginal<typeof ExternalLinksModule>()),
    fetchGithubPrTitle: vi.fn(async () => null),
}));
vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertAgent, insertItem, insertProject } from '../../tests/_items.js';
import {
    cancelWorkflowRun,
    onStepFinished,
    reconcileWorkflowRuns,
    resumeWorkflowRun,
    startWorkflowRun,
    tickWorkflowDispatch,
    WorkflowStartError,
} from './workflow-engine.js';
import { commentsService } from './comments.js';

const node = (id: string, type: 'start' | 'agent' | 'owner' | 'end', extra: Record<string, string> = {}) => ({
    id,
    type,
    position: { x: 0, y: 0 },
    ...extra,
});
const edge = (source: string, target: string, kind: 'pass' | 'fail' = 'pass') => ({
    id: `${source}-${kind}-${target}`,
    source,
    target,
    kind,
});

// Start → Coder → Reviewer → End; Reviewer fails back to Coder, Coder fails to the Owner.
function devGraph(childWorkflowId?: string): IWorkflowGraph {
    return {
        nodes: [
            node('start', 'start'),
            node('coder', 'agent', { agent_id: 'agent-coder' }),
            node('review', 'agent', { agent_id: 'agent-reviewer' }),
            node('owner', 'owner'),
            node('end', 'end', childWorkflowId ? { child_workflow_id: childWorkflowId } : {}),
        ],
        edges: [
            edge('start', 'coder'),
            edge('coder', 'review'),
            edge('coder', 'owner', 'fail'),
            edge('owner', 'coder'),
            edge('review', 'end'),
            edge('review', 'coder', 'fail'),
        ],
    };
}

async function insertWorkflow(id: string, overrides: Record<string, unknown> = {}): Promise<void> {
    await testDb
        .insertInto('workflows')
        .values({
            id,
            project_id: 'p1',
            name: id,
            graph: JSON.stringify(devGraph()),
            max_loops: 2,
            ...overrides,
        } as never)
        .execute();
}

/** Finishes the most recently spawned step the way the runner would. */
async function finishStep(status: RunStatus, outcome: RunOutcomeKind | null = 'done', reason?: string): Promise<void> {
    const step = spawned.at(-1);
    if (!step) throw new Error('no step spawned');
    await testDb
        .updateTable('agent_runs')
        .set({ status, completed_at: new Date().toISOString(), outcome_kind: outcome, outcome_reason: reason ?? null })
        .where('id', '=', step.runId)
        .execute();
    await onStepFinished(step.runId);
}

const runOf = (id: string) => testDb.selectFrom('workflow_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const parkComments = async () =>
    (await commentsService.list('story', 'ATL-2')).filter((c) => c.body.includes('is waiting for you'));
const itemOf = (id: string) =>
    testDb.selectFrom('items').select(['status', 'assignee_agent_id', 'workflow_id']).where('id', '=', id).executeTakeFirstOrThrow();

beforeEach(async () => {
    spawned.length = 0;
    vi.clearAllMocks();
    await truncateAll();
    await insertProject('p1', 'ATL', { git_path: '/tmp/repo' });
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await insertAgent({ id: 'agent-reviewer', status: 'active' });
    await insertItem({ id: 'ATL-100', type: 'epic', project_id: 'p1', title: 'Epic' });
    await insertItem({ id: 'ATL-2', type: 'story', project_id: 'p1', parent_id: 'ATL-100', parent_type: 'epic', title: 'Story', status: 'ready' });
    await insertWorkflow('wf-dev');
});

afterAll(async () => {
    await closeTestDb();
});

describe('workflow engine — happy path', () => {
    it('runs every step back-to-back in one worktree and delivers one PR at End', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');

        expect(git.ensureWorktree).toHaveBeenCalledTimes(1);
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder']);
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_progress', assignee_agent_id: 'agent-coder' });

        await finishStep('completed', 'done');
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'review']);

        await finishStep('completed', 'done');
        expect(git.pushWorktree).toHaveBeenCalledTimes(1);
        expect(git.openPullRequest).toHaveBeenCalledTimes(1);
        expect(git.cleanupWorktreeAfterPush).toHaveBeenCalledTimes(1);
        expect(await runOf(runId)).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/7', worktree_path: '/tmp/atlas-wf-test' });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_review', assignee_agent_id: null });
        const { pr_url } = await testDb.selectFrom('items').select('pr_url').where('id', '=', 'ATL-2').executeTakeFirstOrThrow();
        expect(pr_url).toBe('https://github.com/o/r/pull/7');
    });

    it('parks at End when delivery fails and retries delivery on resume', async () => {
        git.pushWorktree.mockResolvedValueOnce({ pushed: false, alreadyUpToDate: false, error: 'no credential' } as never);
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(await runOf(runId)).toMatchObject({
            status: 'waiting_for_owner',
            parked_node_id: 'end',
            park_reason: 'Push failed: no credential. Resume the run to retry delivery.',
        });
        expect(git.cleanupWorktreeAfterPush).not.toHaveBeenCalled();
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'waiting_for_info' });

        await resumeWorkflowRun(runId);
        expect(git.pushWorktree).toHaveBeenCalledTimes(2);
        expect(await runOf(runId)).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/7' });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_review' });
        expect(spawned).toHaveLength(2);
    });

    it('refuses a second live run on the same item', async () => {
        await startWorkflowRun('wf-dev', 'ATL-2');
        await expect(startWorkflowRun('wf-dev', 'ATL-2')).rejects.toBeInstanceOf(WorkflowStartError);
    });

    it('ignores a stale report for a step the run already moved past', async () => {
        await startWorkflowRun('wf-dev', 'ATL-2');
        const coderStep = spawned[0]!; // reason: startWorkflowRun spawned the first node above
        await finishStep('completed', 'done');
        await onStepFinished(coderStep.runId);
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'review']);
    });
});

describe('workflow engine — loops and parking', () => {
    it('follows fail connections and parks with the Owner past max_loops', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done'); // coder → review
        await finishStep('completed', 'rejected', 'tests missing'); // loop 1 → coder
        await finishStep('completed', 'done'); // coder → review
        await finishStep('completed', 'rejected', 'still missing'); // loop 2 → coder
        await finishStep('completed', 'done'); // coder → review
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'review', 'coder', 'review', 'coder', 'review']);

        await finishStep('completed', 'rejected', 'give up'); // loop 3 > max_loops 2
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'review', loop_count: 2 });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'waiting_for_info', assignee_agent_id: null });
        expect(git.openPullRequest).not.toHaveBeenCalled();
    });

    it('treats a missing outcome block as a question for the Owner', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', null);
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'coder', park_reason: 'agent_did_not_signal_outcome' });
        const parked = await parkComments();
        expect(parked).toHaveLength(1);
        expect(parked[0]).toMatchObject({ author: 'agent', agent_id: null });
    });

    it('re-runs the asking step with a fresh loop budget when the Owner replies on the item', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'rejected', 'x'); // loop 1
        await finishStep('completed', 'asked_question', 'Which API version?');
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'coder' });
        // The step's completion comment already carries the question.
        expect(await parkComments()).toHaveLength(0);

        await commentsService.create({ author: 'owner', issue_type: 'story', issue_id: 'ATL-2', body: 'Use v2.' });
        await vi.waitFor(async () => expect(spawned.at(-1)?.nodeId).toBe('coder'));
        await vi.waitFor(async () => expect(await runOf(runId)).toMatchObject({ status: 'running', loop_count: 0, current_node_id: 'coder' }));
        expect(spawned).toHaveLength(4);
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_progress' });
    });

    it('parks at an Owner node and continues along its pass connection on resume', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'rejected', 'cannot start'); // coder fail → owner
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'owner', park_reason: 'Sent back to you: rejected: cannot start' });

        await resumeWorkflowRun(runId);
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'coder']);
        expect(await runOf(runId)).toMatchObject({ status: 'running', current_node_id: 'coder', park_reason: null });
    });

    it('parks when a step errors or its setup fails', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('setup_failed', null);
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'coder', setup_done: false });
    });
});

describe('workflow engine — stop, reconcile, children, dispatch', () => {
    it('stopping a step cancels the run, keeps pushed work, and opens no PR', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('cancelled', null);
        expect(await runOf(runId)).toMatchObject({ status: 'cancelled' });
        expect(git.pushWorktree).toHaveBeenCalledTimes(1);
        expect(git.openPullRequest).not.toHaveBeenCalled();
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'waiting_for_info' });
    });

    it('cancelWorkflowRun stops the live step', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await cancelWorkflowRun(runId);
        const step = await testDb.selectFrom('agent_runs').select('status').where('id', '=', spawned[0]!.runId).executeTakeFirstOrThrow(); // reason: one step was spawned at start
        expect(step.status).toBe('cancelled');
    });

    it('reconcile parks a running run whose step died without reporting', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await testDb.updateTable('agent_runs').set({ status: 'error' }).where('id', '=', spawned[0]!.runId).execute(); // reason: one step was spawned at start
        const later = new Date(Date.now() + 11 * 60 * 1000);
        expect(await reconcileWorkflowRuns(later)).toBe(1);
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner' });
    });

    it('queues items created during the run for the child workflow and starts it', async () => {
        await insertWorkflow('wf-child', { trigger: 'item_ready', graph: JSON.stringify(devGraph()) });
        await insertWorkflow('wf-qa', { trigger: 'manual' });
        const planning = devGraph('wf-child');
        const planningEnd = planning.nodes.find((n) => n.type === 'end')!; // reason: devGraph always has an End node
        planningEnd.test_child_workflow_id = 'wf-qa';
        await testDb
            .updateTable('workflows')
            .set({ graph: JSON.stringify(planning), push_code: false, raises_pr: false })
            .where('id', '=', 'wf-dev')
            .execute();
        await testDb.updateTable('items').set({ status: 'ready' }).where('id', '=', 'ATL-100').execute();
        await testDb.updateTable('workflows').set({ input_kind: 'item' }).where('id', '=', 'wf-dev').execute();

        const runId = await startWorkflowRun('wf-dev', 'ATL-100');
        await insertItem({ id: 'ATL-9', type: 'story', project_id: 'p1', parent_id: 'ATL-100', parent_type: 'epic', title: 'Child', status: 'draft' });
        await insertItem({ id: 'ATL-10', type: 'story', project_id: 'p1', parent_id: 'ATL-100', parent_type: 'epic', title: 'Child [QA]', status: 'draft' });
        await testDb.insertInto('item_links').values({ from_id: 'ATL-10', to_id: 'ATL-9', relation_type: 'tested_by' }).execute();
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
        expect(await itemOf('ATL-9')).toMatchObject({ workflow_id: 'wf-child' });
        expect(await itemOf('ATL-10')).toMatchObject({ workflow_id: 'wf-qa', status: 'ready' });
        // No PR, but the epic's work moved to its stories: it waits in review, not done.
        expect(await itemOf('ATL-100')).toMatchObject({ status: 'in_review' });
        await vi.waitFor(async () => {
            const childRun = await testDb.selectFrom('workflow_runs').select('status').where('item_id', '=', 'ATL-9').executeTakeFirst();
            expect(childRun?.status).toBe('running');
        });
    });

    it('stamps items an agent creates during a project-level run and routes them at End', async () => {
        await insertWorkflow('wf-child', { trigger: 'manual' });
        await testDb
            .insertInto('workflows')
            .values({
                id: 'wf-intake',
                project_id: 'p1',
                name: 'Intake',
                input_kind: 'none',
                use_worktree: false,
                graph: JSON.stringify({
                    nodes: [
                        node('start', 'start'),
                        node('scout', 'agent', { agent_id: 'agent-coder' }),
                        node('end', 'end', { child_workflow_id: 'wf-child' }),
                    ],
                    edges: [edge('start', 'scout'), edge('scout', 'end')],
                }),
            } as never)
            .execute();

        const runId = await startWorkflowRun('wf-intake', null);
        const { epicsService } = await import('./epics.js');
        const epic = await epicsService.create({ project_id: 'p1', title: 'Imported from Jira', reporter_agent_id: 'agent-coder' });
        const stamped = await testDb.selectFrom('items').select('created_by_workflow_run_id').where('id', '=', epic.id).executeTakeFirstOrThrow();
        expect(stamped.created_by_workflow_run_id).toBe(runId);

        await finishStep('completed', 'done');
        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
        expect(await itemOf(epic.id)).toMatchObject({ workflow_id: 'wf-child', status: 'ready' });
    });

    it('dispatch starts one run per item_ready workflow and a parked run does not hold the queue', async () => {
        await testDb.updateTable('workflows').set({ trigger: 'item_ready' }).where('id', '=', 'wf-dev').execute();
        await insertItem({ id: 'ATL-3', type: 'story', project_id: 'p1', parent_id: 'ATL-100', parent_type: 'epic', title: 'Second', status: 'ready' });
        await testDb.updateTable('items').set({ workflow_id: 'wf-dev' }).where('id', 'in', ['ATL-2', 'ATL-3']).execute();

        expect(await tickWorkflowDispatch()).toBe(1);
        expect(await tickWorkflowDispatch()).toBe(0); // one run at a time

        await finishStep('completed', 'asked_question', 'unclear'); // park the first
        expect(await tickWorkflowDispatch()).toBe(1);
        const live = await testDb.selectFrom('workflow_runs').select(['item_id', 'status']).orderBy('started_at').execute();
        expect(live.map((r) => r.status)).toEqual(['waiting_for_owner', 'running']);
    });

    it('dispatch skips a ready item whose dependency is not done instead of stalling the queue', async () => {
        await testDb.updateTable('workflows').set({ trigger: 'item_ready' }).where('id', '=', 'wf-dev').execute();
        await insertItem({ id: 'ATL-3', type: 'story', project_id: 'p1', parent_id: 'ATL-100', parent_type: 'epic', title: 'Blocker', status: 'in_review' });
        await insertItem({ id: 'ATL-4', type: 'story', project_id: 'p1', parent_id: 'ATL-100', parent_type: 'epic', title: 'Free', status: 'ready' });
        // Queued in this order (a trigger stamps updated_at), so the blocked ATL-2 is first in line.
        await testDb.updateTable('items').set({ workflow_id: 'wf-dev' }).where('id', '=', 'ATL-2').execute();
        await testDb.updateTable('items').set({ workflow_id: 'wf-dev' }).where('id', '=', 'ATL-4').execute();
        await testDb.insertInto('item_links').values({ from_id: 'ATL-2', to_id: 'ATL-3', relation_type: 'depends_on' }).execute();

        expect(await tickWorkflowDispatch()).toBe(1);
        const live = await testDb.selectFrom('workflow_runs').select('item_id').execute();
        expect(live.map((r) => r.item_id)).toEqual(['ATL-4']);
    });

    it('a scheduled project-level workflow starts when its cron fires', async () => {
        await testDb
            .insertInto('workflows')
            .values({
                id: 'wf-news',
                project_id: null,
                name: 'News',
                input_kind: 'none',
                use_worktree: false,
                trigger: 'schedule',
                cron_expr: '0 9 * * *',
                next_run_at: new Date(Date.now() - 60_000).toISOString(),
                graph: JSON.stringify({
                    nodes: [node('start', 'start'), node('scout', 'agent', { agent_id: 'agent-coder' }), node('end', 'end')],
                    edges: [edge('start', 'scout'), edge('scout', 'end')],
                }),
            } as never)
            .execute();
        expect(await tickWorkflowDispatch()).toBe(1);
        const wf = await testDb.selectFrom('workflows').select(['next_run_at', 'last_run_at']).where('id', '=', 'wf-news').executeTakeFirstOrThrow();
        expect(new Date(wf.next_run_at ?? 0).getTime()).toBeGreaterThan(Date.now());
        expect(spawned.at(-1)?.nodeId).toBe('scout');
        expect(git.ensureWorktree).not.toHaveBeenCalled();
    });
});
