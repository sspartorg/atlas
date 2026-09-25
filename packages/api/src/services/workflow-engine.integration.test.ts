import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ExternalLinksModule from './external-links.js';
import type * as WorktreeOrchestratorModule from './worktree-orchestrator.js';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IssueStatus, IWorkflowGraph, RunOutcomeKind, RunStatus } from '@atlas/shared';

// The engine is exercised against the real DB; only the parts that would
// spawn a CLI or touch git are replaced. `spawnAgentRun` just records a live
// step row, the way the real runner's INSERT does.
const spawned: Array<{ agentId: string; nodeId: string; runId: string; skipSetup: boolean }> = [];
vi.mock('./agent-runner.js', () => ({
    spawnAgentRun: vi.fn(async (opts: { agentId: string; issueId?: string | null; workflowRun?: { id: string; nodeId: string; skipSetup?: boolean } | null }) => {
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
        spawned.push({ agentId: opts.agentId, nodeId: opts.workflowRun?.nodeId ?? '', runId: id, skipSetup: opts.workflowRun?.skipSetup ?? false });
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
// ADR 0020/0024 — delivery runs the repo's own verify command before pushing,
// and a `gate` step runs the command its checker named. Both go through
// `runNamedCommand`, which really would `bash` something; this file's subject
// is routing and delivery, not execution, so it is mocked alongside
// `pushWorktree` and `openPullRequest`. The runner's own behaviour — that a
// timeout is `unavailable` and never `fail`, that the environment is an
// allowlist — is covered against real commands in `verification-gate.test.ts`.
// The tests below that DO make the verdict the subject override this per case.
const gate = vi.hoisted(() => ({
    runNamedCommand: vi.fn(async () => ({ kind: 'pass' as const })),
}));
vi.mock('./verification-gate.js', () => gate);

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

const node = (id: string, type: 'start' | 'agent' | 'owner' | 'subtasks' | 'gate' | 'end', extra: Record<string, string> = {}) => ({
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
function devGraph(): IWorkflowGraph {
    return {
        nodes: [
            node('start', 'start'),
            node('coder', 'agent', { agent_id: 'agent-coder' }),
            node('review', 'agent', { agent_id: 'agent-reviewer' }),
            node('owner', 'owner'),
            node('end', 'end'),
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
const parkComments = async (type: 'task' | 'sub_task' = 'task', id = 'ATL-2') =>
    (await commentsService.list(type, id)).filter((c) => c.body.includes('is waiting for you'));
const itemOf = (id: string) =>
    testDb.selectFrom('items').select(['status', 'assignee_agent_id', 'workflow_id']).where('id', '=', id).executeTakeFirstOrThrow();

beforeEach(async () => {
    spawned.length = 0;
    vi.clearAllMocks();
    // `clearAllMocks` clears calls, not implementations — and every gate in
    // the file now goes through this one function, so a `fail` left by the
    // previous test would leak into the next one's pre-push gate.
    gate.runNamedCommand.mockResolvedValue({ kind: 'pass' } as never);
    await truncateAll();
    await insertProject('p1', 'ATL', { git_path: '/tmp/repo' });
    await insertAgent({ id: 'agent-coder', status: 'active' });
    await insertAgent({ id: 'agent-reviewer', status: 'active' });
    await insertItem({ id: 'ATL-2', type: 'task', project_id: 'p1', title: 'Task', status: 'ready' });
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

    // ─── ADR 0020: the verification gate ────────────────────────────────
    //
    // F-012's consequence was a Task that opened two PRs with red suites while
    // every reviewer agent reported green. These are the tests that make that
    // impossible. Note what the agent says in each: `finishStep('completed',
    // 'done')` is the agent asserting success. The gate overrules it.

    it('does not push when the gate fails, even though every agent reported done', async () => {
        gate.runNamedCommand.mockResolvedValueOnce({
            kind: 'fail',
            output: 'FAIL src/thing.test.ts (3 failing)',
        } as never);
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        // The whole point: the agents said done, and nothing shipped.
        expect(git.pushWorktree).not.toHaveBeenCalled();
        expect(git.openPullRequest).not.toHaveBeenCalled();
        expect(git.cleanupWorktreeAfterPush).not.toHaveBeenCalled();

        const run = await runOf(runId);
        expect(run).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'end' });
        // The Owner is told it was the gate, not a push error, and is given
        // the script's own output rather than a generic failure.
        expect(String(run?.park_reason)).toContain('verification gate failed');
        expect(String(run?.park_reason)).toContain('3 failing');
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'waiting_for_info' });
    });

    it('retries the gate on resume and delivers once it passes', async () => {
        gate.runNamedCommand.mockResolvedValueOnce({ kind: 'fail', output: 'red' } as never);
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');
        expect(git.pushWorktree).not.toHaveBeenCalled();

        // The Owner fixes the suite on the branch and resumes; the gate is
        // re-run rather than remembered, so the fix is what decides.
        await resumeWorkflowRun(runId);
        expect(gate.runNamedCommand).toHaveBeenCalledTimes(2);
        expect(git.pushWorktree).toHaveBeenCalledTimes(1);
        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
    });

    it('parks — and does NOT fail — when the gate could not run at all', async () => {
        // The distinction ADR 0020 turns on. A missing script or a dead binary
        // is absence of evidence. If this ever took the failure path, a
        // misconfigured project would look identical to a red suite.
        gate.runNamedCommand.mockResolvedValueOnce({
            kind: 'unavailable',
            reason: 'the check timed out after 600000ms',
        } as never);
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(git.pushWorktree).not.toHaveBeenCalled();
        const run = await runOf(runId);
        expect(run).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'end' });
        expect(String(run?.park_reason)).toContain('could not run');
        // Says plainly that this is not a test failure, so the Owner does not
        // go hunting for a bug that isn't there.
        expect(String(run?.park_reason)).toContain('not a test failure');
    });

    // ADR 0024 — the command is the repo's own. Atlas will not invent one, and
    // "I could not verify" is never permission to push.
    it('parks rather than pushing a repo with no verify command', async () => {
        await testDb.updateTable('project_repos').set({ verify_command: '' }).where('id', '=', 'p1').execute();
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(gate.runNamedCommand).not.toHaveBeenCalled();
        expect(git.pushWorktree).not.toHaveBeenCalled();
        const run = await runOf(runId);
        expect(run).toMatchObject({ status: 'waiting_for_owner' });
        expect(String(run?.park_reason)).toContain('no verify command');
    });

    // The bug this line was written for: `needs_review` was not special-cased
    // here, so it fell through, logged "verification gate passed" and PUSHED.
    // Before a push, "a check could not conclude" is not permission to ship.
    it('does not push on needs_review', async () => {
        gate.runNamedCommand.mockResolvedValueOnce({
            kind: 'needs_review',
            output: 'ATLAS_GATE_NEEDS_REVIEW\nno baseline to compare against',
            exitCode: 1,
        } as never);
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(git.pushWorktree).not.toHaveBeenCalled();
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner' });
    });

    it('runs the gate in the repo being pushed, before the push', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');
        expect(await runOf(runId)).toMatchObject({ status: 'completed' });

        // ADR 0017 — each repo carries its own suite, so the gate must be told
        // which checkout to verify, not the workspace root.
        expect(gate.runNamedCommand).toHaveBeenCalledWith(
            expect.objectContaining({ repoPath: '/tmp/atlas-wf-test', command: 'echo verified' }),
        );
        const gateOrder = gate.runNamedCommand.mock.invocationCallOrder[0] ?? 0;
        const pushOrder = git.pushWorktree.mock.invocationCallOrder[0] ?? 0;
        // Verifying after the push would prove nothing — the code is already gone.
        expect(gateOrder).toBeLessThan(pushOrder);
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

        await commentsService.create({ author: 'owner', issue_type: 'task', issue_id: 'ATL-2', body: 'Use v2.' });
        await vi.waitFor(async () => expect(spawned.at(-1)?.nodeId).toBe('coder'));
        await vi.waitFor(async () => expect(await runOf(runId)).toMatchObject({ status: 'running', loop_count: 0, current_node_id: 'coder' }));
        expect(spawned).toHaveLength(4);
        // The resumed step runs on a branch refreshed onto the latest default branch.
        expect(git.ensureWorktree).toHaveBeenCalledTimes(2);
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

    it('parks instead of continuing when the resumed branch cannot be refreshed onto main', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'asked_question', 'Which API version?');
        git.ensureWorktree.mockRejectedValueOnce(new Error('rebase conflict on abc1234'));

        await resumeWorkflowRun(runId);
        expect(spawned).toHaveLength(1);
        expect(await runOf(runId)).toMatchObject({
            status: 'waiting_for_owner',
            parked_node_id: 'coder',
            park_reason: 'Could not refresh the worktree onto the latest default branch: rebase conflict on abc1234',
        });
    });

    it('parks when a step errors or its setup fails', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('setup_failed', null);
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'coder', setup_done: false });
    });

    it('an errored step parks with the error line the reaper left', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        const step = spawned.at(-1)!; // reason: startWorkflowRun spawned the first node above
        await testDb.updateTable('agent_runs').set({ output_text: '{"type":"system"}\n[ERROR] API restarted before run completed' }).where('id', '=', step.runId).execute();
        await finishStep('error', null);
        expect(await runOf(runId)).toMatchObject({
            status: 'waiting_for_owner',
            park_reason: 'The agent step errored: API restarted before run completed',
        });
    });
});

describe('workflow engine — stop, reconcile, dispatch', () => {
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

    it('dispatch starts one run per item_ready workflow and a parked run does not hold the queue', async () => {
        await testDb.updateTable('workflows').set({ trigger: 'item_ready' }).where('id', '=', 'wf-dev').execute();
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'Second', status: 'ready' });
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
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'Blocker', status: 'in_review' });
        await insertItem({ id: 'ATL-4', type: 'task', project_id: 'p1', title: 'Free', status: 'ready' });
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

// A real repo whose origin/main is its first commit plus atlas's own
// .gitignore commit — so "no changes" is decided by real git.
function initRepo(dir: string): void {
    mkdirSync(dir, { recursive: true });
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'test@atlas.local');
    g('config', 'user.name', 'Atlas Test');
    writeFileSync(join(dir, 'README.md'), 'repo\n');
    g('add', '-A');
    g('commit', '-qm', 'init');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    writeFileSync(join(dir, '.gitignore'), '.atlas/\n');
    g('add', '-A');
    g('commit', '-qm', 'chore(atlas): ignore Atlas scratch paths');
}

describe('workflow engine — multi-repo Tasks (ADR 0017/0018)', () => {
    let base = '';
    let ws = '';
    const defaults = {
        ensureWorktree: git.ensureWorktree.getMockImplementation(),
        openPullRequest: git.openPullRequest.getMockImplementation(),
    };

    beforeEach(async () => {
        base = mkdtempSync(join(tmpdir(), 'atlas-multi-'));
        ws = join(base, 'worktrees', 'p1', 'ws', 'atlas__wf__ATL-2');
        // ADR 0018 — both repos are ordinary rows; the project's own carries
        // its id, as migration 045 leaves it.
        await testDb
            .updateTable('project_repos')
            .set({ name: 'core', git_path: join(base, 'core'), git_url: 'https://github.com/o/core' })
            .where('id', '=', 'p1')
            .execute();
        await testDb
            .insertInto('project_repos')
            .values({
                id: 'repo-web',
                project_id: 'p1',
                name: 'web',
                git_url: 'https://github.com/o/web',
                git_path: join(base, 'web'),
                position: 1,
                // ADR 0024 — an empty verify command parks before the push.
                verify_command: 'echo verified',
            })
            .execute();
        await testDb.updateTable('items').set({ repo_ids: JSON.stringify(['p1', 'repo-web']) }).where('id', '=', 'ATL-2').execute();
        git.ensureWorktree.mockImplementation((async (input: { path?: string; branch?: string }) => {
            if (input.path && !existsSync(input.path)) initRepo(input.path);
            return { path: input.path ?? '/tmp/atlas-wf-test', branch: input.branch ?? '', freshlyCreated: true };
        }) as never);
        git.openPullRequest.mockImplementation((async (o: { worktreePath: string }) => ({
            opened: true,
            url: o.worktreePath.endsWith('web') ? 'https://github.com/o/web/pull/2' : 'https://github.com/o/core/pull/1',
            alreadyExists: false,
        })) as never);
    });

    afterEach(() => {
        git.ensureWorktree.mockImplementation(defaults.ensureWorktree as never);
        git.openPullRequest.mockImplementation(defaults.openPullRequest as never);
        rmSync(base, { recursive: true, force: true });
    });

    const linksOf = async () =>
        (await testDb.selectFrom('item_external_links').select('url').where('item_id', '=', 'ATL-2').orderBy('id').execute()).map((l) => l.url);

    it('works every repo side by side in one workspace and opens one cross-linked PR per repo', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        expect(git.ensureWorktree).toHaveBeenCalledWith(
            expect.objectContaining({ path: join(ws, 'core'), repo: expect.objectContaining({ id: 'p1' }) })
        );
        expect(git.ensureWorktree).toHaveBeenCalledWith(
            expect.objectContaining({ path: join(ws, 'web'), repo: expect.objectContaining({ id: 'repo-web' }) })
        );
        expect((await runOf(runId)).worktree_path).toBe(ws);

        // The agents changed both repos (left uncommitted; End commits leftovers).
        writeFileSync(join(ws, 'core', 'api.txt'), 'endpoint\n');
        writeFileSync(join(ws, 'web', 'client.txt'), 'client\n');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(git.pushWorktree).toHaveBeenCalledWith(join(ws, 'core'), 'atlas/wf/ATL-2', null, 'p1');
        expect(git.pushWorktree).toHaveBeenCalledWith(join(ws, 'web'), 'atlas/wf/ATL-2', null, 'repo-web');
        // One PR per repo, then a second pass that lists each PR's sibling.
        expect(git.openPullRequest).toHaveBeenCalledTimes(4);
        const relinked = git.openPullRequest.mock.calls.slice(2).map((c) => (c as unknown as [{ body: string }])[0].body);
        expect(relinked[0]).toContain('- web: https://github.com/o/web/pull/2');
        expect(relinked[1]).toContain('- core: https://github.com/o/core/pull/1');
        expect(git.cleanupWorktreeAfterPush).toHaveBeenCalledTimes(2);
        expect(existsSync(ws)).toBe(false);

        expect(await runOf(runId)).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/core/pull/1' });
        expect(await linksOf()).toEqual(['https://github.com/o/core/pull/1', 'https://github.com/o/web/pull/2']);
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_review' });
    });

    it('skips a repo the Task did not change', async () => {
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        writeFileSync(join(ws, 'core', 'api.txt'), 'endpoint\n');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(git.pushWorktree).toHaveBeenCalledTimes(1);
        expect(git.pushWorktree).toHaveBeenCalledWith(join(ws, 'core'), 'atlas/wf/ATL-2', null, 'p1');
        expect(git.openPullRequest).toHaveBeenCalledTimes(1);
        expect(await linksOf()).toEqual(['https://github.com/o/core/pull/1']);
        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
    });
});

describe('workflow engine — delivery modes', () => {
    it.each([
        { mode: 'keep local', push_code: false, raises_pr: false, pushed: null, pr: false, cleanup: false, status: 'done' },
        { mode: 'push branch', push_code: true, raises_pr: false, pushed: 'atlas/wf/ATL-2', pr: false, cleanup: true, status: 'done' },
        { mode: 'push + PR', push_code: true, raises_pr: true, pushed: 'atlas/wf/ATL-2', pr: true, cleanup: true, status: 'in_review' },
    ])('$mode: pushes $pushed, PR $pr, cleans the worktree $cleanup', async ({ push_code, raises_pr, pushed, pr, cleanup, status }) => {
        await testDb.updateTable('workflows').set({ push_code, raises_pr }).where('id', '=', 'wf-dev').execute();
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
        if (pushed) expect(git.pushWorktree).toHaveBeenCalledWith('/tmp/atlas-wf-test', pushed, null, 'p1');
        else expect(git.pushWorktree).not.toHaveBeenCalled();
        expect(git.openPullRequest).toHaveBeenCalledTimes(pr ? 1 : 0);
        // Without a push the worktree + branch are the only copy of the work.
        expect(git.cleanupWorktreeAfterPush).toHaveBeenCalledTimes(cleanup ? 1 : 0);
        expect(await itemOf('ATL-2')).toMatchObject({ status });
    });

    it('a project-level run pushes and opens a PR titled after the workflow', async () => {
        await testDb
            .insertInto('workflows')
            .values({
                id: 'wf-scan',
                project_id: 'p1',
                name: 'Readiness scan',
                input_kind: 'none',
                graph: JSON.stringify({
                    nodes: [node('start', 'start'), node('scout', 'agent', { agent_id: 'agent-coder' }), node('end', 'end')],
                    edges: [edge('start', 'scout'), edge('scout', 'end')],
                }),
            } as never)
            .execute();
        const runId = await startWorkflowRun('wf-scan', null);
        await finishStep('completed', 'done');
        expect(await runOf(runId)).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/7' });
        const title = (git.openPullRequest.mock.calls[0] as unknown as [{ title: string }])[0].title;
        expect(title).toContain('Readiness scan');
    });

    it('a scheduled Task workflow drains the Tasks ready at its fire, up to its parallel limit', async () => {
        await testDb
            .updateTable('workflows')
            .set({
                trigger: 'schedule',
                cron_expr: '0 9 * * *',
                next_run_at: new Date(Date.now() - 60_000).toISOString(),
                max_parallel_runs: 2,
            })
            .where('id', '=', 'wf-dev')
            .execute();
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'Second', status: 'ready' });
        await insertItem({ id: 'ATL-4', type: 'task', project_id: 'p1', title: 'Third', status: 'ready' });
        await testDb.updateTable('items').set({ workflow_id: 'wf-dev' }).where('id', 'in', ['ATL-2', 'ATL-3', 'ATL-4']).execute();

        expect(await tickWorkflowDispatch()).toBe(2);
        expect(await tickWorkflowDispatch()).toBe(0); // both slots busy
        await finishStep('completed', 'asked_question', 'unclear'); // one parks → its slot frees
        expect(await tickWorkflowDispatch()).toBe(1);
    });

    it('push_to_default pushes the run straight to the default branch and opens no PR', async () => {
        await testDb.updateTable('workflows').set({ push_to_default: true, raises_pr: false }).where('id', '=', 'wf-dev').execute();
        const runId = await startWorkflowRun('wf-dev', 'ATL-2');
        expect(git.ensureWorktree).toHaveBeenCalledWith(expect.objectContaining({ pushUpstream: false }));
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(git.pushWorktree).toHaveBeenCalledWith('/tmp/atlas-wf-test', 'main', null, 'p1');
        expect(git.openPullRequest).not.toHaveBeenCalled();
        expect(await runOf(runId)).toMatchObject({ status: 'completed', pr_url: null });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'done' });
    });
});


describe('workflow engine — gate steps', () => {
    // Start -> Coder -> [gate] -> End, with the gate failing to a fixer that
    // loops back to it. ADR 0024: the gate dispatches a CHECKER agent, which
    // names the command; Atlas runs the command and routes on its exit code.
    function gateGraph(withFixer = true): IWorkflowGraph {
        const nodes = [
            node('start', 'start'),
            node('coder', 'agent', { agent_id: 'agent-coder' }),
            node('cov', 'gate', { agent_id: 'agent-tests-check' }),
            node('end', 'end'),
        ];
        const edges = [edge('start', 'coder'), edge('coder', 'cov'), edge('cov', 'end')];
        if (withFixer) {
            nodes.splice(3, 0, node('fixer', 'agent', { agent_id: 'agent-reviewer' }));
            edges.push(edge('cov', 'fixer', 'fail'), edge('fixer', 'cov'));
        }
        return { nodes, edges } as IWorkflowGraph;
    }

    /**
     * Finish the checker's dispatch with a real `atlas-outcome` block.
     *
     * Through `output_text` rather than the `outcome_*` columns on purpose:
     * `applies` and `command` have no columns, so the engine re-parses the
     * block — and a test that set the columns directly would pass while the
     * real path returned nothing.
     */
    async function finishChecker(body: string): Promise<void> {
        const step = spawned.at(-1);
        if (!step) throw new Error('no step spawned');
        await testDb
            .updateTable('agent_runs')
            .set({
                status: 'completed',
                completed_at: new Date().toISOString(),
                outcome_kind: 'done',
                output_text: '```atlas-outcome\n' + body + '\n```',
            })
            .where('id', '=', step.runId)
            .execute();
        await onStepFinished(step.runId);
    }

    const APPLIES = 'outcome: done\napplies: true\ncommand: pnpm -r test\nsummary: declared in package.json';

    // Gate STEPS only. The pre-push verification gate (ADR 0020) writes to the
    // same table with `node_id` null, because it belongs to the run rather than
    // to any node — a run that reaches End records both, and conflating them
    // would make these assertions depend on whether delivery happened.
    const gateRows = (runId: string) =>
        testDb
            .selectFrom('run_gate_results')
            .select(['node_id', 'script_id', 'command', 'verdict', 'output_tail'])
            .where('workflow_run_id', '=', runId)
            .where('node_id', 'is not', null)
            .orderBy('created_at', 'asc')
            .execute();

    beforeEach(async () => {
        await testDb.deleteFrom('workflows').where('id', '=', 'wf-gate').execute();
        await insertAgent({ id: 'agent-tests-check', status: 'active' });
        await insertWorkflow('wf-gate', { graph: JSON.stringify(gateGraph()) });
    });

    it('dispatches the checker, then runs the command it named', async () => {
        gate.runNamedCommand.mockResolvedValue({ kind: 'pass' } as never);
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done'); // coder -> gate -> checker
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'cov']);

        await finishChecker(APPLIES); // checker -> command -> pass edge -> End
        expect(gate.runNamedCommand).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'pnpm -r test', repoPath: '/tmp/atlas-wf-test' }),
        );
        expect(await gateRows(runId)).toEqual([
            expect.objectContaining({
                node_id: 'cov',
                script_id: 'agent-tests-check',
                command: 'pnpm -r test',
                verdict: 'pass',
            }),
        ]);

        // The pre-push gate is recorded alongside it, distinguished by a null
        // node_id — the scorecard needs to tell "a step checked this" apart
        // from "delivery checked this".
        const all = await testDb
            .selectFrom('run_gate_results')
            .select(['node_id', 'script_id'])
            .where('workflow_run_id', '=', runId)
            .execute();
        expect(all).toContainEqual({ node_id: null, script_id: 'pre-push' });
    });

    // The cost claim of ADR 0024 in one test. A repair loop re-enters the gate
    // once per fixer, and if each re-entry re-dispatched the checker the change
    // would cost a dispatch per traversal instead of one per gate per run.
    it('re-uses the checker command on the loop-back without a second dispatch', async () => {
        gate.runNamedCommand.mockResolvedValueOnce({ kind: 'fail', output: 'red', exitCode: 1 } as never);
        gate.runNamedCommand.mockResolvedValue({ kind: 'pass' } as never);

        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done'); // coder -> checker
        await finishChecker(APPLIES); // command red -> fixer
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'cov', 'fixer']);

        await finishStep('completed', 'done'); // fixer -> gate: memo hit, no dispatch
        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'cov', 'fixer']);
        expect((await gateRows(runId)).map((r) => r.verdict)).toEqual(['fail', 'pass']);
        expect(
            await testDb
                .selectFrom('workflow_runs')
                .select('status')
                .where('id', '=', runId)
                .executeTakeFirstOrThrow(),
        ).toMatchObject({ status: 'completed' });
    });

    it('dispatches the fixer on a red command, with its output as the contract', async () => {
        gate.runNamedCommand.mockResolvedValue({
            kind: 'fail',
            output: 'FAIL src/thing.test.ts\n  1 failed, 40 passed',
            exitCode: 1,
        } as never);
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker(APPLIES);

        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'cov', 'fixer']);
        const rows = await gateRows(runId);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ verdict: 'fail' });
        expect(rows[0]?.output_tail).toContain('1 failed');

        // The fixer reads the gap list from the thread, the same way a Coder
        // reads a rejecting reviewer's reason — and the comment names the exact
        // command so the fixer can re-run it.
        const bodies = (await commentsService.list('task', 'ATL-2')).map((c) => c.body);
        expect(bodies.some((b) => b.includes('pnpm -r test') && b.includes('1 failed'))).toBe(true);
    });

    it('records skipped, and passes, when the checker says the concern does not apply', async () => {
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker('outcome: done\napplies: false\nsummary: no test runner in this repo');

        // Nothing was run, and the row says so rather than reading as a pass:
        // "there was nothing to check" is not "I checked and it is fine".
        expect(gate.runNamedCommand).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: expect.stringContaining('test') }),
        );
        expect((await gateRows(runId))[0]).toMatchObject({
            verdict: 'skipped',
            command: null,
            output_tail: 'no test runner in this repo',
        });
        expect(
            await testDb
                .selectFrom('workflow_runs')
                .select('status')
                .where('id', '=', runId)
                .executeTakeFirstOrThrow(),
        ).toMatchObject({ status: 'completed' });
    });

    // The three ways to reach a pass edge without evidence, none of which may.
    it('parks when the checker names no command', async () => {
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker('outcome: done\napplies: true\nsummary: there is definitely a suite');

        expect(gate.runNamedCommand).not.toHaveBeenCalled();
        const run = await testDb
            .selectFrom('workflow_runs')
            .select(['status', 'parked_node_id', 'park_reason'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(run.status).toBe('waiting_for_owner');
        expect(run.parked_node_id).toBe('cov');
        expect(run.park_reason).toContain('named no command');
    });

    it('parks when the checker never said whether the check applies', async () => {
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker('outcome: done\nsummary: had a look around');

        expect(gate.runNamedCommand).not.toHaveBeenCalled();
        const run = await testDb
            .selectFrom('workflow_runs')
            .select(['status', 'park_reason'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(run.status).toBe('waiting_for_owner');
        expect(run.park_reason).toContain('whether this check applies');
    });

    // The tests checker's answer is the repo's pre-push verify command too, so
    // the first delivery run on a fresh project fills it in — and never
    // overwrites what the Owner typed.
    it("writes the tests checker's command to the repo, but never over an Owner value", async () => {
        gate.runNamedCommand.mockResolvedValue({ kind: 'pass' } as never);
        await testDb.updateTable('project_repos').set({ verify_command: '' }).where('id', '=', 'p1').execute();

        await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker(APPLIES);
        expect(
            await testDb
                .selectFrom('project_repos')
                .select('verify_command')
                .where('id', '=', 'p1')
                .executeTakeFirstOrThrow(),
        ).toMatchObject({ verify_command: 'pnpm -r test' });

        // Second run, Owner value already set: the agent does not get to change it.
        await testDb.updateTable('project_repos').set({ verify_command: 'make check' }).where('id', '=', 'p1').execute();
        await testDb.deleteFrom('workflow_runs').execute();
        await testDb.updateTable('items').set({ status: 'ready', workflow_id: null }).where('id', '=', 'ATL-2').execute();
        await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker(APPLIES);
        expect(
            await testDb
                .selectFrom('project_repos')
                .select('verify_command')
                .where('id', '=', 'p1')
                .executeTakeFirstOrThrow(),
        ).toMatchObject({ verify_command: 'make check' });
    });

    it('routes needs_review down the fail edge — a missing baseline is not breakage', async () => {
        gate.runNamedCommand.mockResolvedValue({
            kind: 'needs_review',
            output: 'ATLAS_GATE_NEEDS_REVIEW\n1. no baseline to compare against',
            exitCode: 1,
        } as never);
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker(APPLIES);

        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'cov', 'fixer']);
        expect((await gateRows(runId))[0]).toMatchObject({ verdict: 'needs_review' });
    });

    it('parks — and does NOT fail — when the command could not run at all', async () => {
        // ADR 0020: absence of evidence is not evidence. Treating this as red
        // would turn an unenforced gate into one that blocks every delivery.
        gate.runNamedCommand.mockResolvedValue({
            kind: 'unavailable',
            reason: 'the check timed out after 600000ms',
        } as never);
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker(APPLIES);

        expect(spawned.map((s) => s.nodeId)).toEqual(['coder', 'cov']);
        const run = await testDb
            .selectFrom('workflow_runs')
            .select(['status', 'parked_node_id', 'park_reason'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(run.status).toBe('waiting_for_owner');
        expect(run.parked_node_id).toBe('cov');
        expect(run.park_reason).toContain('could not run');
        expect((await gateRows(runId))[0]).toMatchObject({ verdict: 'unavailable' });
    });

    it('parks once the command is still red past max_loops', async () => {
        gate.runNamedCommand.mockResolvedValue({ kind: 'fail', output: 'still red', exitCode: 1 } as never);
        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done'); // coder -> checker
        await finishChecker(APPLIES); // red #1 -> fixer
        await finishStep('completed', 'done'); // red #2 -> fixer
        await finishStep('completed', 'done'); // red #3 -> over max_loops (2)

        const run = await testDb
            .selectFrom('workflow_runs')
            .select(['status', 'park_reason'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(run.status).toBe('waiting_for_owner');
        expect(run.park_reason).toContain('Loop limit reached');
    });

    it('parks rather than passing when a red command has nowhere to route', async () => {
        await testDb.deleteFrom('workflows').where('id', '=', 'wf-gate').execute();
        await insertWorkflow('wf-gate', { graph: JSON.stringify(gateGraph(false)) });
        gate.runNamedCommand.mockResolvedValue({ kind: 'fail', output: 'red with no fixer', exitCode: 1 } as never);

        const runId = await startWorkflowRun('wf-gate', 'ATL-2');
        await finishStep('completed', 'done');
        await finishChecker(APPLIES);

        const run = await testDb
            .selectFrom('workflow_runs')
            .select(['status', 'park_reason'])
            .where('id', '=', runId)
            .executeTakeFirstOrThrow();
        expect(run.status).toBe('waiting_for_owner');
        expect(run.park_reason).toContain('red with no fixer');
    });
});

describe('workflow engine — Sub-tasks steps', () => {
    // Start → Planner → Sub-tasks (catch-all → wf-build) → Sub-tasks (qa → wf-test) → End.
    function taskGraph(): IWorkflowGraph {
        return {
            nodes: [
                node('start', 'start'),
                node('planner', 'agent', { agent_id: 'agent-coder' }),
                node('build', 'subtasks', { sub_workflow_id: 'wf-build' }),
                node('test', 'subtasks', { sub_workflow_id: 'wf-test', label: 'qa' }),
                node('end', 'end'),
            ],
            edges: [edge('start', 'planner'), edge('planner', 'build'), edge('build', 'test'), edge('test', 'end')],
        };
    }

    async function subTask(id: string, title: string, labels: string[] = [], status: IssueStatus = 'ready'): Promise<void> {
        await insertItem({ id, type: 'sub_task', project_id: 'p1', parent_id: 'ATL-2', parent_type: 'task', title, status });
        await testDb.updateTable('items').set({ labels: JSON.stringify(labels) as never }).where('id', '=', id).execute();
    }

    const childOf = (itemId: string) =>
        testDb.selectFrom('workflow_runs').selectAll().where('item_id', '=', itemId).orderBy('started_at', 'desc').executeTakeFirstOrThrow();

    beforeEach(async () => {
        await insertWorkflow('wf-build', { input_kind: 'sub_task' });
        await insertWorkflow('wf-test', { input_kind: 'sub_task' });
        await insertWorkflow('wf-task', { graph: JSON.stringify(taskGraph()) });
    });

    it('works each sub-task one at a time in the Task worktree, by label, and delivers one PR listing them', async () => {
        await subTask('ATL-11', 'Add login', ['dev']);
        await subTask('ATL-12', 'Fix typo');
        await subTask('ATL-13', 'Add login [QA]', ['qa']);
        await subTask('ATL-14', 'Shipped already', [], 'done');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done'); // planner → build: ATL-11

        const first = await childOf('ATL-11');
        expect(first).toMatchObject({
            workflow_id: 'wf-build',
            parent_workflow_run_id: runId,
            parent_node_id: 'build',
            branch: 'atlas/wf/ATL-2',
            worktree_path: '/tmp/atlas-wf-test',
            status: 'running',
        });
        expect(await itemOf('ATL-11')).toMatchObject({ status: 'in_progress', assignee_agent_id: 'agent-coder' });
        expect(await runOf(runId)).toMatchObject({ status: 'running', current_node_id: 'build' });

        await finishStep('completed', 'done'); // coder → review
        await finishStep('completed', 'done'); // ATL-11 done → ATL-12
        expect(await itemOf('ATL-11')).toMatchObject({ status: 'in_review' });
        expect(await runOf(first.id)).toMatchObject({ status: 'completed' });
        expect((await childOf('ATL-12')).workflow_id).toBe('wf-build');

        await finishStep('completed', 'done');
        await finishStep('completed', 'done'); // ATL-12 done → test step: ATL-13
        expect((await childOf('ATL-13')).workflow_id).toBe('wf-test');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done'); // ATL-13 done → End

        expect(spawned.map((st) => st.nodeId)).toEqual(['planner', 'coder', 'review', 'coder', 'review', 'coder', 'review']);
        expect(git.ensureWorktree).toHaveBeenCalledTimes(1);
        expect(git.pushWorktree).toHaveBeenCalledTimes(1);
        expect(git.openPullRequest).toHaveBeenCalledTimes(1);
        const prBody = (git.openPullRequest.mock.calls[0] as unknown as [{ body: string }])[0].body;
        expect(prBody).toContain('## Sub-tasks');
        for (const id of ['ATL-11', 'ATL-12', 'ATL-13']) expect(prBody).toContain(`**${id}**`);
        expect(prBody).not.toContain('ATL-14');
        expect(await runOf(runId)).toMatchObject({ status: 'completed', pr_url: 'https://github.com/o/r/pull/7' });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_review' });
        expect(await itemOf('ATL-14')).toMatchObject({ status: 'done' });
    });

    it('a sub-task that asks parks the Task run; the reply on the sub-task resumes both', async () => {
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'asked_question', 'Which database?');

        const child = await childOf('ATL-11');
        expect(child).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'coder' });
        expect(await runOf(runId)).toMatchObject({
            status: 'waiting_for_owner',
            parked_node_id: 'build',
            park_reason: 'Sub-task ATL-11 is waiting for you: Which database?',
        });
        expect(await itemOf('ATL-11')).toMatchObject({ status: 'waiting_for_info' });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'waiting_for_info' });
        expect(await parkComments('task', 'ATL-2')).toHaveLength(0);

        await commentsService.create({ author: 'owner', issue_type: 'sub_task', issue_id: 'ATL-11', body: 'Postgres.' });
        await vi.waitFor(async () => expect(spawned).toHaveLength(3));
        expect(spawned.at(-1)?.nodeId).toBe('coder');
        expect(await runOf(child.id)).toMatchObject({ status: 'running', current_node_id: 'coder' });
        expect(await runOf(runId)).toMatchObject({ status: 'running', current_node_id: 'build', park_reason: null });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_progress' });
        // The sub-task's run shares the Task worktree; only the Task run refreshes it.
        expect(git.ensureWorktree).toHaveBeenCalledTimes(1);
    });

    it('a reply on the Task resumes the sub-task that is waiting', async () => {
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'asked_question', 'Which database?');
        const child = await childOf('ATL-11');

        await commentsService.create({ author: 'owner', issue_type: 'task', issue_id: 'ATL-2', body: 'Postgres.' });
        await vi.waitFor(async () => expect(await runOf(child.id)).toMatchObject({ status: 'running' }));
        expect(await runOf(runId)).toMatchObject({ status: 'running', current_node_id: 'build' });
        expect(await itemOf('ATL-11')).toMatchObject({ status: 'in_progress' });
        expect(spawned.map((st) => st.nodeId)).toEqual(['planner', 'coder', 'coder']);
    });

    it('stopping a sub-task step stops the whole Task run and opens no PR', async () => {
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        const child = await childOf('ATL-11');
        await finishStep('cancelled', null);

        expect(await runOf(runId)).toMatchObject({ status: 'cancelled' });
        expect(await runOf(child.id)).toMatchObject({ status: 'cancelled' });
        expect(git.pushWorktree).toHaveBeenCalledTimes(1);
        expect(git.openPullRequest).not.toHaveBeenCalled();
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'waiting_for_info' });
        expect(await itemOf('ATL-11')).toMatchObject({ status: 'waiting_for_info' });
    });

    it('reconcile leaves a Task run alone while its sub-task runs, and parks both when that step dies', async () => {
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        const later = new Date(Date.now() + 11 * 60 * 1000);
        expect(await reconcileWorkflowRuns(later)).toBe(0);

        // reason: the sub-task's coder step is the last one spawned
        await testDb.updateTable('agent_runs').set({ status: 'error' }).where('id', '=', spawned.at(-1)!.runId).execute();
        expect(await reconcileWorkflowRuns(later)).toBe(1);
        expect(await childOf('ATL-11')).toMatchObject({ status: 'waiting_for_owner' });
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'build' });
    });

    it('runs sub-tasks in the Owner’s hand-set order, then the unordered ones oldest first', async () => {
        await subTask('ATL-11', 'First created');
        await subTask('ATL-12', 'Second created');
        await subTask('ATL-13', 'Third created');
        await testDb.updateTable('items').set({ sort_order: 0 }).where('id', '=', 'ATL-13').execute();
        await testDb.updateTable('items').set({ sort_order: 1 }).where('id', '=', 'ATL-12').execute();
        await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done'); // planner
        const order: string[] = [];
        for (let i = 0; i < 3; i++) {
            const running = await testDb.selectFrom('workflow_runs').select('item_id').where('parent_workflow_run_id', 'is not', null).where('status', '=', 'running').executeTakeFirstOrThrow();
            order.push(running.item_id ?? '');
            await finishStep('completed', 'done');
            await finishStep('completed', 'done');
        }
        expect(order).toEqual(['ATL-13', 'ATL-12', 'ATL-11']);
    });

    it('picks up a sub-task created while the step is still working', async () => {
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');
        await subTask('ATL-15', 'Follow-up fix'); // created while ATL-11 is in review
        await finishStep('completed', 'done'); // ATL-11 done → ATL-15 next, same step

        expect(await childOf('ATL-15')).toMatchObject({ status: 'running', parent_node_id: 'build' });
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');
        expect(await runOf(runId)).toMatchObject({ status: 'completed', loop_count: 0 });
    });

    it('End sends the run back to the step that claims a late sub-task', async () => {
        const graph = taskGraph();
        graph.nodes = [...graph.nodes.filter((n) => n.id !== 'test'), node('final', 'agent', { agent_id: 'agent-reviewer' })];
        graph.edges = [edge('start', 'planner'), edge('planner', 'build'), edge('build', 'final'), edge('final', 'end')];
        await testDb.updateTable('workflows').set({ graph: JSON.stringify(graph) }).where('id', '=', 'wf-task').execute();
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done'); // ATL-11 done → build passes → final
        expect(spawned.at(-1)?.nodeId).toBe('final');

        await subTask('ATL-15', 'Fix the final reviewer found');
        await finishStep('completed', 'done'); // final → End gate → back to build
        expect(await runOf(runId)).toMatchObject({ status: 'running', current_node_id: 'build', gate_rounds: 1, loop_count: 0 });
        expect((await childOf('ATL-15')).status).toBe('running');
        await finishStep('completed', 'done');
        await finishStep('completed', 'done'); // ATL-15 done → final again
        await finishStep('completed', 'done'); // → End
        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
        expect(git.openPullRequest).toHaveBeenCalledTimes(1);
    });

    it('End parks when an open sub-task matches no Sub-tasks step', async () => {
        const graph = taskGraph();
        graph.nodes = graph.nodes.filter((n) => n.id !== 'build');
        graph.edges = [edge('start', 'planner'), edge('planner', 'test'), edge('test', 'end')];
        await testDb.updateTable('workflows').set({ graph: JSON.stringify(graph) }).where('id', '=', 'wf-task').execute();
        await subTask('ATL-12', 'Unlabelled');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');

        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'end' });
        expect((await runOf(runId)).park_reason).toContain('ATL-12');
        expect(git.pushWorktree).not.toHaveBeenCalled();
    });

    it('a sub-task workflow never runs on its own, and a Task workflow never runs on a sub-task', async () => {
        await subTask('ATL-11', 'Add login');
        await expect(startWorkflowRun('wf-build', 'ATL-11')).rejects.toBeInstanceOf(WorkflowStartError);
        await expect(startWorkflowRun('wf-task', 'ATL-11')).rejects.toBeInstanceOf(WorkflowStartError);
    });

    it('an Owner step inside a sub-workflow parks the sub-task and the Task until you answer', async () => {
        const withOwner = devGraph();
        withOwner.edges = [edge('start', 'owner'), edge('owner', 'coder'), edge('coder', 'review'), edge('review', 'end')];
        await testDb.updateTable('workflows').set({ graph: JSON.stringify(withOwner) }).where('id', '=', 'wf-build').execute();
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done'); // planner → build → child parks at its Owner step

        expect(await childOf('ATL-11')).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'owner' });
        expect(await runOf(runId)).toMatchObject({ status: 'waiting_for_owner', parked_node_id: 'build' });
        await commentsService.create({ author: 'owner', issue_type: 'task', issue_id: 'ATL-2', body: 'Go ahead.' });
        await vi.waitFor(async () => expect(spawned.at(-1)?.nodeId).toBe('coder'));
        expect(await childOf('ATL-11')).toMatchObject({ status: 'running', current_node_id: 'coder' });
    });

    it('a sub-workflow’s fail loop is bounded by its own max_loops and parks the Task', async () => {
        await testDb.updateTable('workflows').set({ max_loops: 1 }).where('id', '=', 'wf-build').execute();
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done'); // planner
        await finishStep('completed', 'done'); // coder
        await finishStep('completed', 'rejected', 'tests missing'); // loop 1 → coder
        await finishStep('completed', 'done'); // coder
        await finishStep('completed', 'rejected', 'still missing'); // loop 2 > 1

        expect(await childOf('ATL-11')).toMatchObject({ status: 'waiting_for_owner', loop_count: 1 });
        expect((await runOf(runId)).park_reason).toContain('Loop limit reached');
        expect(git.openPullRequest).not.toHaveBeenCalled();
    });

    it('the Resume button on a Task run resumes the sub-task that is waiting', async () => {
        await subTask('ATL-11', 'Add login');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        await finishStep('completed', 'asked_question', 'Which database?');

        await resumeWorkflowRun(runId);
        expect(await childOf('ATL-11')).toMatchObject({ status: 'running', current_node_id: 'coder' });
        expect(await runOf(runId)).toMatchObject({ status: 'running' });
        expect(spawned.map((st) => st.nodeId)).toEqual(['planner', 'coder', 'coder']);
    });

    it('the project setup runs once per Task, not once per sub-task', async () => {
        await subTask('ATL-11', 'First');
        await subTask('ATL-12', 'Second');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        // The planner is the first step in the worktree: it runs the setup.
        expect(spawned[0]).toMatchObject({ nodeId: 'planner', skipSetup: false });
        await finishStep('completed', 'done');
        expect((await runOf(runId)).setup_done).toBe(true);
        for (let i = 0; i < 4; i++) await finishStep('completed', 'done');
        expect(spawned.slice(1).map((st) => st.skipSetup)).toEqual([true, true, true, true]);
    });

    it('a Task whose sub-tasks are all done already goes straight past the step', async () => {
        await subTask('ATL-11', 'Shipped', [], 'done');
        await subTask('ATL-12', 'Reviewed', [], 'in_review');
        const runId = await startWorkflowRun('wf-task', 'ATL-2');
        await finishStep('completed', 'done');
        expect(await runOf(runId)).toMatchObject({ status: 'completed' });
        expect(spawned.map((st) => st.nodeId)).toEqual(['planner']);
    });

    it('continuing after review runs only the open sub-tasks, on the same branch, into the same PR', async () => {
        await subTask('ATL-11', 'Add login');
        const first = await startWorkflowRun('wf-task', 'ATL-2');
        for (let i = 0; i < 3; i++) await finishStep('completed', 'done'); // planner, coder, review
        expect(await runOf(first)).toMatchObject({ status: 'completed' });
        expect(await itemOf('ATL-2')).toMatchObject({ status: 'in_review' });

        // The Owner checks the branch and files a fix.
        await subTask('ATL-15', 'Fix the empty-password crash');
        const again = await startWorkflowRun('wf-task', 'ATL-2', undefined, { fromSubtasks: true });
        expect(spawned.slice(3).map((st) => st.nodeId)).toEqual(['coder']); // no planner this time
        expect((await childOf('ATL-15')).parent_workflow_run_id).toBe(again);
        await finishStep('completed', 'done');
        await finishStep('completed', 'done');

        expect(await runOf(again)).toMatchObject({ status: 'completed', branch: 'atlas/wf/ATL-2' });
        expect(await itemOf('ATL-11')).toMatchObject({ status: 'in_review' }); // not rebuilt
        expect(git.openPullRequest).toHaveBeenCalledTimes(2);
        const branches = git.openPullRequest.mock.calls.map((c) => (c as unknown as [{ branch: string }])[0].branch);
        expect(new Set(branches)).toEqual(new Set(['atlas/wf/ATL-2']));
        // The refreshed description still lists the first round's sub-task.
        const body = (git.openPullRequest.mock.calls[1] as unknown as [{ body: string }])[0].body;
        expect(body).toContain('**ATL-11**');
        expect(body).toContain('**ATL-15**');
    });

    it('refuses to continue a workflow that has no Sub-tasks step', async () => {
        await expect(startWorkflowRun('wf-dev', 'ATL-2', undefined, { fromSubtasks: true })).rejects.toThrow(
            'This workflow has no Sub-tasks step to continue from',
        );
    });

    it('dispatch runs up to max_parallel_runs Tasks at once', async () => {
        await testDb.updateTable('workflows').set({ trigger: 'item_ready', max_parallel_runs: 2 }).where('id', '=', 'wf-dev').execute();
        await insertItem({ id: 'ATL-3', type: 'task', project_id: 'p1', title: 'Second', status: 'ready' });
        await insertItem({ id: 'ATL-4', type: 'task', project_id: 'p1', title: 'Third', status: 'ready' });
        await testDb.updateTable('items').set({ workflow_id: 'wf-dev' }).where('id', 'in', ['ATL-2', 'ATL-3', 'ATL-4']).execute();

        expect(await tickWorkflowDispatch()).toBe(2);
        expect(await tickWorkflowDispatch()).toBe(0);
    });
});
