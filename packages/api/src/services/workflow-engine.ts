// Workflow engine (ADR 0014, ADR 0015).
//
// A workflow run owns one worktree + branch for its whole life. Each agent
// node is an ordinary `agent_runs` row spawned through `spawnAgentRun`; the
// runner reports every terminal step back through `onStepFinished`, and the
// engine picks the next node from the run's frozen `graph_snapshot`. Nothing
// here waits on the scheduler tick: the next node spawns as soon as the
// previous one finishes. Push, PR and worktree cleanup happen once, at End.
//
// A Task run's Sub-tasks step works the Task's sub-tasks one at a time: each
// gets a child run (`parent_workflow_run_id`) of the step's sub-workflow that
// shares the parent's worktree and branch and never delivers. A child that
// parks parks its parent; a child that finishes hands back to the parent.
//
// Git helpers (`ensureWorktree`, `pushWorktree`, `openPullRequest`,
// `cleanupWorktreeAfterPush`) each take `withProjectGitLock` internally and
// the lock is not re-entrant — never wrap them in another lock here.

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Cron } from 'croner';
import {
    validateWorkflowGraph,
    type IRunOutcome,
    type IWorkflowGraph,
    type IWorkflowNode,
    type IssueType,
    type WorkflowRunStatus,
} from '@atlas/shared';
import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { eventsLog } from './events-log.js';
import { notificationsService } from './notifications.js';
import { sendExternalForNotification } from './external-notifications.js';
import { externalLinks, parseGithubPrUrl, fetchGithubPrTitle } from './external-links.js';
import { commentsService } from './comments.js';
import { assertDepsAllDoneForDispatch } from './dependency-guard.js';
import { decideRunRouting } from './agent-runner-outcome-routing.js';
import { runNamedCommand } from './verification-gate.js';
import { decideCheckCommand } from './gate-check-routing.js';
import { parseRunOutcome } from './run-outcome-parser.js';
import { recordGateResult } from './run-gate-results.js';
import {
    WORKTREE_BRANCH_RE,
    ensureWorktree,
    pushWorktree,
    openPullRequest,
    cleanupWorktreeAfterPush,
} from './worktree-orchestrator.js';
import { buildGitAuth, cleanupGitConfig } from './git-credentials.js';
import { gitInvokeEnv } from './git-env.js';
import { runRepos } from './run-repos.js';
import { spawnAgentRun, cancelRun } from './agent-runner.js';

const exec = promisify(execFile);

// A `running` workflow run with no live step for this long is presumed
// orphaned (API restart, a terminal path that never reported back). Longer
// than the worst End push + PR so delivery isn't mistaken for a hang.
export const WORKFLOW_RECONCILE_AFTER_MS = 10 * 60 * 1000;

export type WorkflowStartErrorCode = 'not_found' | 'invalid' | 'conflict';

export class WorkflowStartError extends Error {
    constructor(
        public readonly code: WorkflowStartErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'WorkflowStartError';
    }
}

interface RunRow {
    id: string;
    workflow_id: string;
    item_id: string | null;
    project_id: string | null;
    status: WorkflowRunStatus;
    graph_snapshot: IWorkflowGraph;
    parent_workflow_run_id: string | null;
    parent_node_id: string | null;
    current_node_id: string | null;
    parked_node_id: string | null;
    loop_count: number;
    gate_rounds: number;
    branch: string | null;
    worktree_path: string | null;
    setup_done: boolean;
    started_at: string;
}

async function loadRun(runId: string): Promise<RunRow | undefined> {
    const row = await db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirst();
    return row as unknown as RunRow | undefined;
}

async function loadWorkflow(workflowId: string) {
    return db.selectFrom('workflows').selectAll().where('id', '=', workflowId).executeTakeFirst();
}

async function loadItem(itemId: string) {
    return db
        .selectFrom('items')
        .select(['id', 'type', 'title', 'status', 'project_id', 'worktree_branch'])
        .where('id', '=', itemId)
        .executeTakeFirst();
}

function nodeById(graph: IWorkflowGraph, nodeId: string | null): IWorkflowNode | undefined {
    return graph.nodes.find((n) => n.id === nodeId);
}

function nextNodeId(graph: IWorkflowGraph, nodeId: string, kind: 'pass' | 'fail'): string | null {
    return graph.edges.find((e) => e.source === nodeId && e.kind === kind)?.target ?? null;
}

function broadcastRun(
    run: Pick<RunRow, 'id' | 'workflow_id' | 'item_id' | 'parent_workflow_run_id'>,
    status: WorkflowRunStatus,
    nodeId: string | null,
): void {
    broadcastSSE({
        type: 'workflow_run_updated',
        workflowId: run.workflow_id,
        workflowRunId: run.id,
        workflowRunStatus: status,
        nodeId,
        ...(run.item_id ? { issueId: run.item_id } : {}),
        ...(run.parent_workflow_run_id ? { parentWorkflowRunId: run.parent_workflow_run_id } : {}),
    });
}

async function setItemStatus(
    itemId: string,
    to: string,
    detail: string,
    opts: { clearAssignee?: boolean; assigneeAgentId?: string | null } = {},
): Promise<void> {
    const item = await loadItem(itemId);
    if (!item) return;
    const assignee =
        opts.clearAssignee === true ? { assignee_agent_id: null } :
        opts.assigneeAgentId !== undefined ? { assignee_agent_id: opts.assigneeAgentId } : {};
    await db.updateTable('items').set({ status: to, ...assignee }).where('id', '=', itemId).execute();
    if (item.status !== to) {
        await eventsLog.record({
            item_id: itemId,
            item_type: item.type as IssueType,
            event_type: 'status_changed',
            actor_agent_id: null,
            field: 'status',
            from_value: item.status,
            to_value: to,
            detail,
        });
    }
    broadcastSSE({ type: 'counts_changed', issueType: item.type as IssueType, issueId: itemId });
}

async function notifyOwner(
    run: RunRow,
    message: string,
    kind: 'needs_you' | 'update',
    eventKey: 'item.status_changed:waiting_for_info' | 'item.status_changed:in_review' | 'agent.run_finished_no_item' | null,
): Promise<void> {
    try {
        const item = run.item_id ? await loadItem(run.item_id) : undefined;
        const notification = await notificationsService.create({
            event_type: 'workflow_run',
            message,
            issue_type: (item?.type as IssueType | undefined) ?? null,
            issue_id: run.item_id,
            agent_id: null,
            kind,
        });
        if (eventKey) await sendExternalForNotification(notification.id, message, eventKey);
    } catch {
        /* notifications are best-effort */
    }
}

// ─── Start ──────────────────────────────────────────────────────────────────

/** The Task run (and its Sub-tasks step) a sub-task's run is started from. */
interface ParentStep {
    run: RunRow;
    nodeId: string;
}

/** The Sub-tasks step reached first from Start along pass connections. */
function firstSubtasksStep(graph: IWorkflowGraph): string | null {
    const start = graph.nodes.find((n) => n.type === 'start');
    const seen = new Set<string>();
    const queue = start ? [start.id] : [];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (nodeById(graph, id)?.type === 'subtasks') return id;
        const next = nextNodeId(graph, id, 'pass');
        if (next) queue.push(next);
    }
    return null;
}

export async function startWorkflowRun(
    workflowId: string,
    itemId: string | null,
    parent?: ParentStep,
    opts: { fromSubtasks?: boolean } = {},
): Promise<string> {
    const workflow = await loadWorkflow(workflowId);
    if (!workflow) throw new WorkflowStartError('not_found', 'Workflow not found');
    const graph = workflow.graph;
    const graphErrors = validateWorkflowGraph(graph);
    if (graphErrors.length > 0) {
        throw new WorkflowStartError('invalid', `Workflow graph is invalid: ${graphErrors[0]?.message ?? ''}`);
    }
    const start = graph.nodes.find((n) => n.type === 'start');
    // Continuing a Task after review skips planning: its open sub-tasks run
    // on the branch the first run left, and End updates the same PR.
    const firstNodeId = opts.fromSubtasks ? firstSubtasksStep(graph) : start ? nextNodeId(graph, start.id, 'pass') : null;
    if (!firstNodeId) {
        throw new WorkflowStartError(
            'invalid',
            opts.fromSubtasks ? 'This workflow has no Sub-tasks step to continue from' : 'Workflow Start is not connected',
        );
    }

    if ((workflow.input_kind === 'sub_task') !== Boolean(parent)) {
        throw new WorkflowStartError('invalid', 'A sub-task workflow runs only from a Task workflow’s Sub-tasks step');
    }
    let item: Awaited<ReturnType<typeof loadItem>>;
    if (workflow.input_kind !== 'none') {
        if (!itemId) throw new WorkflowStartError('invalid', 'This workflow runs on a Task — pick one to start it');
        item = await loadItem(itemId);
        if (!item) throw new WorkflowStartError('not_found', 'Item not found');
        const wantType = workflow.input_kind === 'item' ? 'task' : 'sub_task';
        if (item.type !== wantType) {
            throw new WorkflowStartError('invalid', wantType === 'task' ? 'Only Tasks run through this workflow' : 'Only sub-tasks run through a sub-task workflow');
        }
        if (workflow.project_id && item.project_id !== workflow.project_id) {
            throw new WorkflowStartError('invalid', "Item belongs to a different project than the workflow");
        }
        if (item.status === 'done') throw new WorkflowStartError('invalid', 'Item is already done');
        // Sub-tasks run in the order the Task's Sub-tasks step picks them.
        if (!parent) {
            const firstAgent = nodeById(graph, firstNodeId)?.agent_id ?? workflowId;
            await assertDepsAllDoneForDispatch(item.id, firstAgent);
        }
    } else if (itemId) {
        throw new WorkflowStartError('invalid', 'This workflow runs on the project, not on an item');
    }

    const runId = randomUUID();
    const projectId = item?.project_id ?? workflow.project_id;
    const itemBranch = item?.worktree_branch && WORKTREE_BRANCH_RE.test(item.worktree_branch) ? item.worktree_branch : null;
    // A sub-task's run works in its Task's worktree, whatever the
    // sub-workflow's own worktree setting says.
    const branch = parent
        ? parent.run.branch
        : workflow.use_worktree ? (itemBranch ?? `atlas/wf/${item?.id ?? runId.slice(0, 8)}`) : null;

    try {
        await db
            .insertInto('workflow_runs')
            .values({
                id: runId,
                workflow_id: workflowId,
                item_id: item?.id ?? null,
                project_id: projectId,
                graph_snapshot: JSON.stringify(graph),
                branch,
                ...(parent
                    ? {
                          parent_workflow_run_id: parent.run.id,
                          parent_node_id: parent.nodeId,
                          worktree_path: parent.run.worktree_path,
                          setup_done: parent.run.setup_done,
                      }
                    : {}),
            })
            .execute();
    } catch (err) {
        if ((err as { code?: string }).code === '23505') {
            throw new WorkflowStartError('conflict', `Item ${itemId ?? ''} already has a live workflow run`);
        }
        throw err;
    }
    const run = (await loadRun(runId)) as RunRow;
    await db.updateTable('workflows').set({ last_run_at: new Date().toISOString() }).where('id', '=', workflowId).execute();
    broadcastRun(run, 'running', null);

    if (item) {
        await setItemStatus(item.id, 'in_progress', `workflow_run_started: ${workflow.name}`);
        if (!parent && branch && branch !== item.worktree_branch) {
            await db.updateTable('items').set({ worktree_branch: branch }).where('id', '=', item.id).execute();
        }
    }

    if (workflow.use_worktree && !parent) {
        const failure = await prepareWorktree(run, pushesRunBranch(workflow));
        if (failure) {
            await park(run, firstNodeId, `Could not prepare the worktree: ${failure}`);
            return runId;
        }
    }

    await goTo(run, firstNodeId);
    return runId;
}

/** A workflow that pushes to the default branch never publishes its run branch. */
function pushesRunBranch(workflow: { push_code: boolean; push_to_default: boolean }): boolean {
    return workflow.push_code && !workflow.push_to_default;
}

/**
 * Provisions the run's worktree, or — when it already exists — brings the
 * branch onto the latest default branch (ensureWorktree pulls ff-only and
 * rebases its commits onto fresh origin/<default>). Returns why it failed, or
 * null. ensureWorktree discards uncommitted files, so leftovers are committed
 * first.
 */
async function prepareWorktree(run: RunRow, pushUpstream: boolean): Promise<string | null> {
    if (!run.branch || !run.project_id) return null;
    const branch = run.branch;
    try {
        // ADR 0017 — one checkout per repo of the Task; several sit side by
        // side in one workspace, which becomes the run's worktree_path (cwd).
        const { repos, workspace } = await runRepos(run);
        for (const { repo, path } of repos) {
            if (!repo.git_path) {
                throw new Error(workspace ? `Repo ${repo.name} has no cloned repository on disk` : 'Project has no cloned repository on disk');
            }
            if (run.worktree_path) await commitPending(path, repo.credential_id, run.id);
            // item: null — the path lives on workflow_runs only. Writing it to
            // items.worktree_path would let the boot orphan reaper push and
            // delete the shared worktree between steps.
            const wt = await ensureWorktree({
                item: null,
                branch,
                repo: {
                    id: repo.id,
                    git_path: repo.git_path,
                    credential_id: repo.credential_id,
                    default_branch: repo.default_branch,
                },
                pushUpstream,
                ...(workspace ? { path } : {}),
            });
            run.worktree_path = workspace ?? wt.path;
            // Written per repo: preparing several can outlast the reconciler's
            // idle window, and updated_at is what it watches.
            await db
                .updateTable('workflow_runs')
                .set({ worktree_path: run.worktree_path, updated_at: new Date().toISOString() })
                .where('id', '=', run.id)
                .execute();
        }
        return null;
    } catch (err) {
        return (err as Error).message;
    }
}

// ─── Moving through the graph ───────────────────────────────────────────────

async function goTo(run: RunRow, nodeId: string, why?: string): Promise<void> {
    const node = nodeById(run.graph_snapshot, nodeId);
    if (!node) {
        await park(run, run.current_node_id, `Workflow graph has no node ${nodeId}`);
        return;
    }
    if (node.type === 'owner') {
        await park(run, node.id, why ? `Sent back to you: ${why}` : 'The workflow reached an Owner step — review and reply to continue');
        return;
    }
    if (node.type === 'end') {
        await finishRun(run, node);
        return;
    }
    if (node.type === 'subtasks') {
        await runNextSubtask(run, node);
        return;
    }
    if (node.type === 'gate') {
        await runGateNode(run, node);
        return;
    }
    await spawnNode(run, node);
}

/**
 * The checker whose answer also becomes the repo's pre-push verify command.
 *
 * Every project's "is the suite green" question is the same question the
 * pre-push gate asks, so the tests checker's command is written to
 * `project_repos.verify_command` the first time it names one. That is what
 * keeps ADR 0020's guarantee without a second dispatch per run, and without
 * Atlas guessing a stack's test command.
 */
const TESTS_CHECKER_AGENT_ID = 'agent-tests-check';

/**
 * A gate step, ADR 0024: dispatch a checker agent, then run the command it
 * named and route on that exit code.
 *
 * Two entries per gate. The first finds no command recorded for this node and
 * dispatches the checker; `onStepFinished` routes back here through
 * `finishGateNode` once it reports. Every later entry — a fixer looping back —
 * finds the command in `run_gate_results` and re-runs it with no dispatch at
 * all, which is what keeps the repair loop at one checker dispatch per gate per
 * run rather than one per traversal.
 *
 * ponytail: the memo is the audit row, not a cache table — the newest
 * `run_gate_results` row for this (run, node) carrying a command. It means the
 * Owner can see exactly what was re-run. If a fixer ever ADDS the tooling the
 * checker said was absent, the stale answer survives to the end of the run;
 * the next run re-discovers it. Give the memo an invalidation hook if that ever
 * bites.
 */
async function runGateNode(run: RunRow, node: IWorkflowNode): Promise<void> {
    const memo = await db
        .selectFrom('run_gate_results')
        .select('command')
        .where('workflow_run_id', '=', run.id)
        .where('node_id', '=', node.id)
        .where('command', 'is not', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();

    if (memo?.command) {
        await executeGateCheck(run, node, memo.command);
        return;
    }
    // No answer yet for this gate: ask the checker. `spawnNode` sets
    // `current_node_id`, assigns the item and parks on a missing agent.
    await spawnNode(run, node);
}

/**
 * The checker reported. Decide what that means, then run what it named.
 *
 * `decideCheckCommand` is pure and lives in its own file; everything that can
 * park, write or execute is here. The bias is ADR 0020's: a checker that named
 * no proof produced no evidence, and absence of evidence parks with the Owner
 * rather than taking the pass edge.
 */
async function finishGateNode(run: RunRow, node: IWorkflowNode, outcome: IRunOutcome | null): Promise<void> {
    const decision = decideCheckCommand(outcome);

    if (decision.kind === 'park') {
        await park(run, node.id, `This check could not be determined: ${decision.why}`);
        return;
    }

    if (decision.kind === 'skip') {
        // Recorded, not silent. "There is nothing here to check" is a claim the
        // Owner should be able to audit, and `gate_verdicts_all_pass` counts a
        // run where every gate skipped as unchecked rather than green.
        const { repos } = await runRepos(run);
        for (const { repo } of repos) {
            await recordGateResult({
                workflow_run_id: run.id,
                node_id: node.id,
                repo_id: repo.id,
                script_id: node.agent_id ?? node.id,
                verdict: 'skipped',
                output_tail: decision.why,
            });
        }
        const pass = nextNodeId(run.graph_snapshot, node.id, 'pass');
        /* v8 ignore next 4 -- every non-end node needs exactly one pass
           connection to validate at all, and the run walks a frozen snapshot
           that was validated before the first step. */
        if (!pass) {
            await park(run, node.id, 'No pass connection from this gate');
            return;
        }
        await goTo(run, pass);
        return;
    }

    await executeGateCheck(run, node, decision.command);
}

/**
 * Run the checker's command in every repo the Task touches (ADR 0017) and route
 * on the first repo that fails, so the fixer gets one problem rather than a
 * pile.
 *
 * `unavailable` parks rather than fails, exactly as ADR 0020 requires: a check
 * that could not run is absence of evidence, and treating it as red would
 * convert an unenforced gate into one that blocks every delivery.
 *
 * ponytail: one command, run in each repo — the same shape the scripts had. It
 * will be wrong for the first genuinely mixed-stack multi-repo Task; that wants
 * a command per repo, which wants the checker to answer per repo.
 */
async function executeGateCheck(run: RunRow, node: IWorkflowNode, command: string): Promise<void> {
    await db
        .updateTable('workflow_runs')
        .set({ current_node_id: node.id, updated_at: new Date().toISOString() })
        .where('id', '=', run.id)
        .execute();

    const item = run.item_id ? await loadItem(run.item_id) : undefined;
    const { repos, workspace } = await runRepos(run);
    if (repos.length === 0) {
        await park(run, node.id, `The check \`${command}\` had no repo to run in`);
        return;
    }

    for (const { repo, path } of repos) {
        const tag = workspace ? `${repo.name}: ` : '';
        const result = await runNamedCommand({ repoPath: path, projectId: repo.project_id, command });
        await recordGateResult({
            workflow_run_id: run.id,
            node_id: node.id,
            repo_id: repo.id,
            // The checker's id, where the script id used to go: it is what the
            // scorecard groups a gate's verdicts by, and it stays stable across
            // projects in a way the command string never could.
            script_id: node.agent_id ?? node.id,
            command,
            verdict: result.kind,
            ...(result.kind === 'fail' || result.kind === 'needs_review'
                ? { exit_code: result.exitCode ?? null, output_tail: result.output }
                : {}),
            ...(result.kind === 'pass' && result.output ? { output_tail: result.output } : {}),
            // A skip takes the pass edge but is recorded as itself: it means
            // "could not check", not "checked and fine" (migration 013).
            ...(result.kind === 'skipped' ? { output_tail: result.output } : {}),
            ...(result.kind === 'unavailable' ? { output_tail: result.reason } : {}),
        });

        // The pre-push gate asks this repo the same question (ADR 0020), so the
        // answer is kept. `where verify_command = ''` and nothing else: an
        // Owner value is authoritative and is never overwritten by an agent.
        if (node.agent_id === TESTS_CHECKER_AGENT_ID && result.kind !== 'unavailable') {
            await db
                .updateTable('project_repos')
                .set({ verify_command: command })
                .where('id', '=', repo.id)
                .where('verify_command', '=', '')
                .execute();
        }

        if (result.kind === 'unavailable') {
            await park(
                run,
                node.id,
                `${tag}The check \`${command}\` could not run (${result.reason}), so nothing was checked. ` +
                    `This is not a failure — resume the run to retry.`,
            );
            return;
        }
        if (result.kind === 'fail' || result.kind === 'needs_review') {
            const failTarget = nextNodeId(run.graph_snapshot, node.id, 'fail');
            const detail = `${tag}${result.output}`;
            if (!failTarget) {
                // A gate with nobody to route a failure to is still a real
                // verdict; it parks with the Owner rather than passing.
                await park(run, node.id, detail);
                return;
            }
            const workflow = await loadWorkflow(run.workflow_id);
            const loops = run.loop_count + 1;
            if (loops > (workflow?.max_loops ?? 3)) {
                await park(run, node.id, `Loop limit reached (${workflow?.max_loops ?? 3}): ${detail}`);
                return;
            }
            await db.updateTable('workflow_runs').set({ loop_count: loops }).where('id', '=', run.id).execute();
            run.loop_count = loops;
            // The command's own output IS the fixer's contract, so it is posted
            // on the item the way a rejecting reviewer's `reason` is — the next
            // step reads it from `.atlas/current-task.md`.
            if (run.item_id) {
                try {
                    await commentsService.create({
                        author: 'agent',
                        agent_id: null,
                        issue_type: item?.type as IssueType,
                        issue_id: run.item_id,
                        body: `\`${command}\` did not pass.\n\n\`\`\`\n${detail}\n\`\`\``,
                    });
                } catch {
                    /* the park reason and the gate row already carry the signal */
                }
            }
            await goTo(run, failTarget, `${command} did not pass`);
            return;
        }
    }

    const pass = nextNodeId(run.graph_snapshot, node.id, 'pass');
    /* v8 ignore next 4 -- unreachable by construction: every non-end node needs
       exactly one pass connection to validate, and the run walks the frozen
       snapshot that was validated before the first step. */
    if (!pass) {
        await park(run, node.id, 'No pass connection from this gate');
        return;
    }
    await goTo(run, pass);
}

/**
 * The Task's open sub-tasks this step claims, in run order: the Owner's
 * hand-set order first (`sort_order`), then oldest first. A step with a label
 * takes the sub-tasks carrying it; a step without one takes those no other
 * Sub-tasks step in the graph claims. Open = not yet in review or done.
 */
function openSubtasksQuery(taskId: string, graph: IWorkflowGraph, node: IWorkflowNode) {
    const claimed = graph.nodes.flatMap((n) => (n.type === 'subtasks' && n.label && n.id !== node.id ? [n.label] : []));
    let q = db
        .selectFrom('items')
        .select(['id', 'title'])
        .where('parent_id', '=', taskId)
        .where('type', '=', 'sub_task')
        .where('status', 'not in', ['in_review', 'done'])
        // Postgres sorts NULL last ascending: unordered sub-tasks follow.
        .orderBy('sort_order', 'asc')
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc');
    if (node.label) {
        q = q.where('labels', '@>', JSON.stringify([node.label]) as never);
    } else if (claimed.length > 0) {
        q = q.where((eb) => eb.not(eb.or(claimed.map((l) => eb('labels', '@>', JSON.stringify([l]) as never)))));
    }
    return q;
}

async function runNextSubtask(run: RunRow, node: IWorkflowNode): Promise<void> {
    await db
        .updateTable('workflow_runs')
        .set({ current_node_id: node.id, status: 'running', parked_node_id: null, park_reason: null })
        .where('id', '=', run.id)
        .execute();
    run.current_node_id = node.id;
    run.status = 'running';
    broadcastRun(run, 'running', node.id);
    const next = run.item_id ? await openSubtasksQuery(run.item_id, run.graph_snapshot, node).executeTakeFirst() : undefined;
    if (!next) {
        const target = nextNodeId(run.graph_snapshot, node.id, 'pass');
        if (!target) {
            await park(run, node.id, 'No pass connection from this step');
            return;
        }
        await goTo(run, target);
        return;
    }
    try {
        await startWorkflowRun(node.sub_workflow_id ?? '', next.id, { run, nodeId: node.id });
    } catch (err) {
        await park(run, node.id, `Could not start sub-task ${next.id}: ${(err as Error).message}`);
    }
}

async function spawnNode(run: RunRow, node: IWorkflowNode): Promise<void> {
    const agent = node.agent_id
        ? await db.selectFrom('agents').select(['id', 'name', 'status']).where('id', '=', node.agent_id).executeTakeFirst()
        : undefined;
    if (!agent || agent.status !== 'active') {
        await park(run, node.id, `Agent ${node.agent_id ?? '(none)'} is missing or inactive`);
        return;
    }
    await db
        .updateTable('workflow_runs')
        .set({ current_node_id: node.id, status: 'running', parked_node_id: null, park_reason: null })
        .where('id', '=', run.id)
        .execute();
    run.current_node_id = node.id;
    const item = run.item_id ? await loadItem(run.item_id) : undefined;
    if (item) {
        await db.updateTable('items').set({ assignee_agent_id: agent.id }).where('id', '=', item.id).execute();
    }
    broadcastRun(run, 'running', node.id);
    try {
        await spawnAgentRun({
            agentId: agent.id,
            issueType: (item?.type as IssueType | undefined) ?? null,
            issueId: item?.id ?? null,
            projectId: item ? null : run.project_id,
            workflowRun: {
                id: run.id,
                nodeId: node.id,
                worktreePath: run.worktree_path,
                branch: run.branch,
                skipSetup: run.setup_done,
            },
        });
    } catch (err) {
        await park(run, node.id, `Could not start ${agent.name}: ${(err as Error).message}`);
    }
}

/**
 * Called by the runner at every terminal exit of an agent run (completed,
 * error, setup_failed, cancelled — including sweeps that never reach
 * completeRun). Runs outside a workflow return immediately.
 */
export async function onStepFinished(agentRunId: string): Promise<void> {
    const step = await db
        .selectFrom('agent_runs')
        .select([
            'workflow_run_id',
            'node_id',
            'agent_id',
            'status',
            'outcome_kind',
            'outcome_summary',
            'outcome_reason',
            'outcome_checklist',
        ])
        .where('id', '=', agentRunId)
        .executeTakeFirst();
    if (!step?.workflow_run_id || !step.node_id) return;
    const run = await loadRun(step.workflow_run_id);
    // A stale report (the run already moved on, was stopped or parked) must
    // not advance anything.
    if (!run || run.status !== 'running' || run.current_node_id !== step.node_id) return;

    if (step.status === 'cancelled') {
        await cancelWorkflowRun(run.id);
        return;
    }
    if (step.status === 'setup_failed') {
        await park(run, step.node_id, 'Project setup script failed');
        return;
    }
    if (step.status === 'error') {
        // The runner, reaper and watchdog each leave a tagged line in
        // output_text; the Owner needs it to decide whether to just reply.
        const row = await db.selectFrom('agent_runs').select('output_text').where('id', '=', agentRunId).executeTakeFirst();
        const line = row?.output_text
            ?.split('\n')
            .reverse()
            .find((l) => l.startsWith('[ERROR]') || l.startsWith('[watchdog]'));
        const detail = line?.replace(/^\[ERROR\]\s*/, '').slice(0, 300);
        await park(run, step.node_id, detail ? `The agent step errored: ${detail}` : 'The agent step errored');
        return;
    }
    if (step.status !== 'completed') return;

    if (!run.setup_done) {
        await db.updateTable('workflow_runs').set({ setup_done: true }).where('id', '=', run.id).execute();
        run.setup_done = true;
    }

    const outcome: IRunOutcome | null = step.outcome_kind
        ? {
              kind: step.outcome_kind,
              ...(step.outcome_summary ? { summary: step.outcome_summary } : {}),
              ...(step.outcome_reason ? { reason: step.outcome_reason } : {}),
              ...(step.outcome_checklist ? { checklist: step.outcome_checklist } : {}),
          }
        : null;
    // A gate's checker does not route through `decideRunRouting`: its answer is
    // a command to run, not a verdict on the work (ADR 0024).
    //
    // Re-parsed from `output_text` rather than read from the `outcome_*`
    // columns, because `applies` and `command` have no columns — and giving
    // them two would add a migration and a write path for two keys only this
    // branch reads. The parse is the same one `completeRun` already ran, over
    // bytes that are already stored.
    const finishedNode = nodeById(run.graph_snapshot, step.node_id);
    if (finishedNode?.type === 'gate') {
        const raw = await db
            .selectFrom('agent_runs')
            .select('output_text')
            .where('id', '=', agentRunId)
            .executeTakeFirst();
        await finishGateNode(run, finishedNode, parseRunOutcome(raw?.output_text) ?? outcome);
        return;
    }

    const checklistRows = await db
        .selectFrom('agent_checklists')
        .select(['id', 'label'])
        .where('agent_id', '=', step.agent_id)
        .where('required', '=', true)
        .execute();
    // agent_checklists.id is bigint → pg returns a string.
    const requiredChecklist = checklistRows.map((r) => ({ id: Number(r.id), label: r.label as string }));
    const decision = decideRunRouting({ outcome, requiredChecklist });

    if (decision.kind === 'park_waiting_for_info') {
        await park(run, step.node_id, outcome?.reason ?? decision.detail ?? 'The agent needs input', Boolean(outcome?.reason));
        return;
    }
    if (decision.kind === 'apply_on_pass') {
        const target = nextNodeId(run.graph_snapshot, step.node_id, 'pass');
        if (!target) {
            await park(run, step.node_id, 'No pass connection from this step');
            return;
        }
        await goTo(run, target);
        return;
    }
    const failTarget = nextNodeId(run.graph_snapshot, step.node_id, 'fail');
    if (!failTarget) {
        const reasonPosted = Boolean(outcome?.reason) && decision.detail === outcome?.reason;
        await park(run, step.node_id, decision.detail ?? 'The agent rejected the work', reasonPosted);
        return;
    }
    const workflow = await loadWorkflow(run.workflow_id);
    const loops = run.loop_count + 1;
    if (loops > (workflow?.max_loops ?? 3)) {
        await park(run, step.node_id, `Loop limit reached (${workflow?.max_loops ?? 3}): ${decision.detail ?? 'rejected'}`);
        return;
    }
    await db.updateTable('workflow_runs').set({ loop_count: loops }).where('id', '=', run.id).execute();
    run.loop_count = loops;
    await goTo(run, failTarget, decision.detail ?? 'the step failed');
}

// ─── Park / resume ──────────────────────────────────────────────────────────

async function park(run: RunRow, nodeId: string | null, reason: string, stepPostedReason = false): Promise<void> {
    await db
        .updateTable('workflow_runs')
        .set({ status: 'waiting_for_owner', parked_node_id: nodeId, current_node_id: nodeId, park_reason: reason.slice(0, 1000) })
        .where('id', '=', run.id)
        .execute();
    run.status = 'waiting_for_owner';
    broadcastRun(run, 'waiting_for_owner', nodeId);
    const workflow = await loadWorkflow(run.workflow_id);
    const name = workflow?.name ?? 'Workflow';
    if (run.item_id) {
        await setItemStatus(run.item_id, 'waiting_for_info', `workflow_parked: ${reason}`.slice(0, 280), { clearAssignee: true });
        // A step that asked or rejected already posted this exact reason in its
        // completion comment; a second comment would only repeat it.
        if (!stepPostedReason) {
            const item = await loadItem(run.item_id);
            try {
                // No agent_id: the workflow speaks here, not the last agent
                // (the comment thread labels it "Workflow").
                await commentsService.create({
                    author: 'agent',
                    agent_id: null,
                    issue_type: item?.type as IssueType,
                    issue_id: run.item_id,
                    body: `**${name}** is waiting for you: ${reason}\n\nReply here to continue the workflow.`,
                });
            } catch {
                /* the item status + notification already carry the signal */
            }
        }
        await notifyOwner(run, `${name} needs you on ${run.item_id}: ${reason}`, 'needs_you', 'item.status_changed:waiting_for_info');
    } else {
        await notifyOwner(run, `${name} needs you: ${reason}`, 'needs_you', 'agent.run_finished_no_item');
    }
    if (run.parent_workflow_run_id) await waitOnChild(run, reason);
}

/**
 * A parked sub-task holds its Task run at the Sub-tasks step. The sub-task
 * already carries the comment and the notification, so the Task only changes
 * status — replying on either one resumes both.
 */
async function waitOnChild(child: RunRow, reason: string): Promise<void> {
    const parent = child.parent_workflow_run_id ? await loadRun(child.parent_workflow_run_id) : undefined;
    if (!parent || parent.status !== 'running') return;
    const why = `Sub-task ${child.item_id ?? ''} is waiting for you: ${reason}`.slice(0, 1000);
    await db
        .updateTable('workflow_runs')
        .set({ status: 'waiting_for_owner', parked_node_id: child.parent_node_id, current_node_id: child.parent_node_id, park_reason: why })
        .where('id', '=', parent.id)
        .execute();
    broadcastRun(parent, 'waiting_for_owner', child.parent_node_id);
    if (parent.item_id) {
        await setItemStatus(parent.item_id, 'waiting_for_info', `workflow_parked: ${why}`.slice(0, 280), { clearAssignee: true });
    }
}

/** Owner-initiated resume (project-level runs have no item to reply on). */
export async function resumeWorkflowRun(runId: string): Promise<void> {
    const updated = await db
        .updateTable('workflow_runs')
        .set({ status: 'running', park_reason: null })
        .where('id', '=', runId)
        .where('status', '=', 'waiting_for_owner')
        .executeTakeFirst();
    if (Number(updated.numUpdatedRows ?? 0) === 0) {
        throw new WorkflowStartError('conflict', 'Only a run that is waiting for you can be resumed');
    }
    const run = (await loadRun(runId)) as RunRow;
    if (run.item_id) await setItemStatus(run.item_id, 'in_progress', 'workflow_resumed');
    await continueResumedRun(runId);
}

export async function continueResumedRun(runId: string): Promise<void> {
    const run = await loadRun(runId);
    if (!run || run.status !== 'running') return;
    if (run.parent_workflow_run_id) {
        // The Owner answered on the sub-task: its Task run is working again.
        const reopened = await db
            .updateTable('workflow_runs')
            .set({ status: 'running', park_reason: null, parked_node_id: null })
            .where('id', '=', run.parent_workflow_run_id)
            .where('status', '=', 'waiting_for_owner')
            .executeTakeFirst();
        const parent = await loadRun(run.parent_workflow_run_id);
        if (parent && Number(reopened.numUpdatedRows ?? 0) > 0) {
            broadcastRun(parent, 'running', parent.current_node_id);
            if (parent.item_id) await setItemStatus(parent.item_id, 'in_progress', 'workflow_resumed');
        }
    }
    const parked = nodeById(run.graph_snapshot, run.parked_node_id);
    if (!parked) {
        const start = run.graph_snapshot.nodes.find((n) => n.type === 'start');
        const first = start ? nextNodeId(run.graph_snapshot, start.id, 'pass') : null;
        if (first) await goTo(run, first);
        return;
    }
    broadcastRun(run, 'running', parked.id);
    // A sub-task's run shares its Task's worktree; the Task run refreshes it.
    if (parked.type !== 'end' && !run.parent_workflow_run_id) {
        // A parked run can wait days. Refresh the branch onto the latest
        // default branch so the next step sees what merged meanwhile.
        const workflow = await loadWorkflow(run.workflow_id);
        if (workflow?.use_worktree) {
            const failure = await prepareWorktree(run, pushesRunBranch(workflow));
            if (failure) {
                await park(run, parked.id, `Could not refresh the worktree onto the latest default branch: ${failure}`);
                return;
            }
        }
    }
    if (parked.type === 'owner') {
        const next = nextNodeId(run.graph_snapshot, parked.id, 'pass');
        if (next) await goTo(run, next);
        return;
    }
    if (parked.type === 'end') {
        await finishRun(run, parked);
        return;
    }
    if (parked.type === 'subtasks') {
        // Parked because a sub-task asked: resume that sub-task, not the step.
        const waiting = await db
            .updateTable('workflow_runs')
            .set({ status: 'running', park_reason: null })
            .where('parent_workflow_run_id', '=', run.id)
            .where('status', '=', 'waiting_for_owner')
            .returning(['id', 'item_id'])
            .executeTakeFirst();
        if (waiting) {
            if (waiting.item_id) await setItemStatus(waiting.item_id, 'in_progress', 'workflow_resumed');
            await continueResumedRun(waiting.id);
            return;
        }
        await runNextSubtask(run, parked);
        return;
    }
    // Re-run the step that asked, with a fresh loop budget: the Owner's reply
    // is new information, not another bounce.
    await db.updateTable('workflow_runs').set({ loop_count: 0 }).where('id', '=', run.id).execute();
    run.loop_count = 0;
    await goTo(run, parked.id);
}

// ─── End / cancel ───────────────────────────────────────────────────────────

async function commitPending(worktreePath: string, credentialId: string | null, runId: string): Promise<string | null> {
    const auth = credentialId ? await buildGitAuth(credentialId).catch(() => null) : null;
    const env = gitInvokeEnv(auth?.configPath ?? null);
    try {
        const status = await exec('git', ['-C', worktreePath, 'status', '--porcelain'], { env, timeout: 60_000 });
        if (!status.stdout.trim()) return null;
        await exec('git', ['-C', worktreePath, 'add', '-A'], { env, timeout: 60_000 });
        const args = ['-c', 'core.hooksPath=.husky/_', '-C', worktreePath, 'commit', '-m', `chore(atlas): uncommitted changes from workflow run ${runId.slice(0, 8)}`];
        if (auth?.humanName && auth.humanEmail) args.push('--trailer', `Co-Authored-By: ${auth.humanName} <${auth.humanEmail}>`);
        await exec('git', args, { env, timeout: 60_000 });
        return 'committed leftover changes';
    } catch (err) {
        return `could not commit leftover changes: ${(err as Error).message}`;
    } finally {
        if (auth?.configPath) cleanupGitConfig(auth.configPath);
    }
}

interface DeliveryResult {
    pushed: boolean;
    prUrl: string | null;
    /** Every PR opened this delivery, in repo order. `prUrl` is its first. */
    prUrls: string[];
    /** Set when a delivery step the workflow asked for did not happen. */
    failure: string | null;
    log: string[];
}

/** False only when git proves the branch has nothing beyond the atlas .gitignore commit. */
async function hasChanges(worktreePath: string, base: string): Promise<boolean> {
    try {
        await exec('git', ['-C', worktreePath, 'diff', '--quiet', `origin/${base}`, 'HEAD', '--', '.', ':!.gitignore'], {
            env: gitInvokeEnv(null),
            timeout: 60_000,
        });
        return false;
    } catch {
        return true;
    }
}

async function deliver(run: RunRow, opts: { openPr: boolean }): Promise<DeliveryResult> {
    const log: string[] = [];
    const result: DeliveryResult = { pushed: false, prUrl: null, prUrls: [], failure: null, log };
    const workflow = await loadWorkflow(run.workflow_id);
    if (!workflow || !run.worktree_path || !run.branch || !run.project_id) return result;
    const project = await db.selectFrom('projects').select(['id', 'name']).where('id', '=', run.project_id).executeTakeFirst();
    if (!project) return result;
    const branch = run.branch;
    const { repos, workspace } = await runRepos(run);
    const item = run.item_id ? await loadItem(run.item_id) : undefined;
    const title = item ? `[${item.id}] ${String(item.title).slice(0, 80)}` : `[${workflow.name}] ${project.name}`;
    const body = [
        `Opened by the **${workflow.name}** workflow.`,
        '',
        ...(item ? [`- Task: ${item.id}`] : [`- Project: ${project.name}`]),
        `- Workflow run: \`${run.id}\``,
        ...(await subtaskSummaryLines(run)),
    ].join('\n');
    const opened: { repo: (typeof repos)[number]['repo']; path: string; base: string; url: string }[] = [];

    // ADR 0017 — each repo of the Task delivers on its own; a multi-repo Task
    // skips the repos it did not change (their PR would be empty).
    for (const { repo, path } of repos) {
        const tag = workspace ? `${repo.name}: ` : '';
        const base = repo.default_branch?.trim() ? repo.default_branch : 'main';
        let pushOk = !workflow.push_code;
        if (workflow.push_code) {
            const committed = await commitPending(path, repo.credential_id, run.id);
            if (committed) log.push(tag + committed);
            if (workspace && !(await hasChanges(path, base))) {
                log.push(`${tag}no changes`);
                continue;
            }
            // ADR 0020 — the verification gate. Every reviewer up to this point
            // reported green by asserting it; this is the one place Atlas finds
            // out for itself, and it runs in the repo that is about to be
            // pushed so a red sibling cannot block a clean one.
            //
            // ADR 0024 — the command is the repo's own, set by the Owner or
            // written back by `agent-tests-check` on its first run. An empty
            // one is `unavailable`, not a pass: Atlas will not guess a stack's
            // test command, and it will not push what it could not verify.
            const gate =
                repo.verify_command.trim() === ''
                    ? ({
                          kind: 'unavailable',
                          reason: 'this repo has no verify command — set one in the project\'s Setup tab',
                      } as const)
                    : await runNamedCommand({
                          repoPath: path,
                          projectId: repo.project_id,
                          command: repo.verify_command,
                      });
            // Migration 011 — the verdict becomes a row, not just a log line.
            // `node_id` is null: this gate belongs to delivery, not to a node.
            await recordGateResult({
                workflow_run_id: run.id,
                repo_id: repo.id,
                // A stable key across projects, so the scorecard can still group
                // pre-push verdicts; the command itself goes in `command`.
                script_id: 'pre-push',
                ...(gate.kind === 'unavailable' ? {} : { command: repo.verify_command }),
                verdict: gate.kind,
                ...(gate.kind === 'fail' || gate.kind === 'needs_review'
                    ? { exit_code: gate.exitCode ?? null }
                    : {}),
                output_tail:
                    gate.kind === 'fail' || gate.kind === 'skipped' || gate.kind === 'needs_review'
                        ? gate.output
                        : gate.kind === 'unavailable'
                          ? gate.reason
                          : null,
            });
            // `needs_review` lands here with `fail` on purpose. Before a push,
            // "a check could not conclude" is not permission to ship — and
            // until this line existed it fell through and was logged as a pass.
            if (gate.kind === 'fail' || gate.kind === 'needs_review') {
                log.push(`${tag}verification gate FAILED\n${gate.output}`);
                result.failure ??= `${tag}The verification gate failed — \`${repo.verify_command}\` did not pass, whatever the reviewer reported. Fix it on the branch, then resume the run.\n\n${gate.output}`;
                continue;
            }
            if (gate.kind === 'unavailable') {
                log.push(`${tag}verification gate unavailable: ${gate.reason}`);
                result.failure ??= `${tag}The verification gate could not run (${gate.reason}), so nothing was pushed. This is not a test failure — Atlas simply could not confirm the suite. Resume the run to retry.`;
                continue;
            }
            // A skip pushes, exactly as before — but it must not be logged as a
            // pass. "I checked and it is fine" and "there was nothing I could
            // check" are the two things migration 013 exists to separate.
            log.push(
                gate.kind === 'skipped'
                    ? `${tag}verification gate skipped: ${gate.output}`
                    : `${tag}verification gate passed`,
            );

            // push_to_default publishes straight onto the default branch; on a
            // non-fast-forward pushWorktree rebases onto it and retries once.
            const target = workflow.push_to_default ? base : branch;
            const push = await pushWorktree(path, target, repo.credential_id, repo.id);
            pushOk = push.pushed || push.alreadyUpToDate;
            if (push.pushed) result.pushed = true;
            log.push(pushOk ? `${tag}pushed ${target}` : `${tag}push failed: ${push.error ?? 'unknown'}`);
            if (!pushOk) result.failure ??= `${tag}Push failed: ${push.error ?? 'unknown error'}`;
            if (workspace) await db.updateTable('workflow_runs').set({ updated_at: new Date().toISOString() }).where('id', '=', run.id).execute();
        }

        if (opts.openPr && workflow.raises_pr && workflow.push_code && !workflow.push_to_default && pushOk) {
            const pr = await openPullRequest({
                worktreePath: path,
                branch,
                base,
                title,
                body,
                credentialId: repo.credential_id,
                projectId: repo.id,
            });
            if (pr.url) {
                opened.push({ repo, path, base, url: pr.url });
                log.push(`${tag}pr: ${pr.url}`);
                if (item) {
                    // Agents read the PR from `pr_url` (Automation checks the dev PR is merged).
                    if (opened.length === 1) await db.updateTable('items').set({ pr_url: pr.url }).where('id', '=', item.id).execute();
                    try {
                        const parsed = parseGithubPrUrl(pr.url);
                        await externalLinks.create({
                            itemId: item.id,
                            url: pr.url,
                            linkKind: 'pull_request',
                            title: await fetchGithubPrTitle(pr.url).catch(() => null),
                            externalRef: parsed?.number ?? null,
                            createdByRunId: null,
                            actorAgentId: null,
                        });
                    } catch (err) {
                        log.push(`${tag}could not link the PR: ${(err as Error).message}`);
                    }
                }
            } else {
                log.push(`${tag}pr failed: ${pr.error ?? 'unknown'}`);
                result.failure ??= `${tag}Pull request failed: ${pr.error ?? 'unknown error'}`;
            }
        }
    }
    result.prUrl = opened[0]?.url ?? null;
    // F-018 — keep every PR, not just the first. `prUrl` stays the first so
    // agents and `items.pr_url` are unchanged.
    result.prUrls = opened.map((o) => o.url);

    // Each PR names its siblings: they only make sense merged together. An
    // existing PR gets its body edited, so this second pass is safe to repeat.
    if (opened.length > 1) {
        for (const o of opened) {
            const siblings = opened.filter((x) => x !== o).map((x) => `- ${x.repo.name}: ${x.url}`);
            await openPullRequest({
                worktreePath: o.path,
                branch,
                base: o.base,
                title,
                body: [body, '', '**Also part of this Task:**', ...siblings].join('\n'),
                credentialId: o.repo.credential_id,
                projectId: o.repo.id,
            });
        }
    }

    // Any delivery failure keeps the worktrees so a resumed run can retry
    // from exactly this state. Without a push the worktree and its branch are
    // the only copy of the work ("keep local"), so they stay too.
    if (workflow.push_code && !result.failure) {
        for (const { repo, path } of repos) {
            if (!repo.git_path) continue;
            const cleanup = await cleanupWorktreeAfterPush({
                itemId: null,
                projectId: repo.id,
                repoGitPath: repo.git_path,
                worktreePath: path,
                branch,
                credentialId: repo.credential_id,
            });
            log.push(...cleanup.warnings);
        }
        if (workspace) rmSync(workspace, { recursive: true, force: true });
    }
    return result;
}

async function finishRun(run: RunRow, endNode: IWorkflowNode): Promise<void> {
    if (run.parent_workflow_run_id) {
        await finishChildRun(run, endNode);
        return;
    }
    if (run.item_id && (await sendBackToSubtasks(run, endNode))) return;

    await db
        .updateTable('workflow_runs')
        .set({ current_node_id: endNode.id })
        .where('id', '=', run.id)
        .execute();
    broadcastRun(run, 'running', endNode.id);
    const delivery = await deliver(run, { openPr: true });
    if (delivery.failure) {
        // Parked at End: fixing the cause (e.g. the project credential) and
        // resuming re-runs delivery against the kept worktree.
        await park(run, endNode.id, `${delivery.failure}. Resume the run to retry delivery.`);
        return;
    }

    const now = new Date().toISOString();
    await db
        .updateTable('workflow_runs')
        .set({ status: 'completed', finished_at: now, pr_url: delivery.prUrl, pr_urls: JSON.stringify(delivery.prUrls) as never })
        .where('id', '=', run.id)
        .execute();
    broadcastRun(run, 'completed', endNode.id);

    const workflow = await loadWorkflow(run.workflow_id);
    const name = workflow?.name ?? 'Workflow';
    if (run.item_id) {
        // A PR waits for review, and so does a Task whose sub-tasks do: the
        // Owner closes them after verifying the branch.
        const openSubtask = await db
            .selectFrom('items')
            .select('id')
            .where('parent_id', '=', run.item_id)
            .where('status', '!=', 'done')
            .executeTakeFirst();
        const finalStatus = delivery.prUrl || openSubtask ? 'in_review' : 'done';
        await setItemStatus(run.item_id, finalStatus, `workflow_completed: ${name}`, { clearAssignee: true });
        const suffix = delivery.prUrl ? ` PR: ${delivery.prUrl}` : '';
        await notifyOwner(
            run,
            `${name} finished ${run.item_id}.${suffix}${delivery.log.length ? ` (${delivery.log.join('; ')})` : ''}`,
            delivery.prUrl ? 'needs_you' : 'update',
            delivery.prUrl ? 'item.status_changed:in_review' : null,
        );
    } else {
        await notifyOwner(run, `${name} finished.${delivery.prUrl ? ` PR: ${delivery.prUrl}` : ''}`, 'update', 'agent.run_finished_no_item');
    }
    // Start the next queued Task now instead of waiting for the next tick.
    void kickWorkflowDispatch('finished');
}

/**
 * End gate for a Task run with Sub-tasks steps: the run is complete only when
 * every sub-task is. A sub-task created after its step already passed (e.g. a
 * fix a QA step asked for) sends the run back to the step that claims it —
 * counted in `gate_rounds` against `max_loops`, apart from the reviewers'
 * fail loops; one that no step claims parks the run.
 * Returns true when the run did not reach End.
 */
async function sendBackToSubtasks(run: RunRow, endNode: IWorkflowNode): Promise<boolean> {
    const steps = run.graph_snapshot.nodes.filter((n) => n.type === 'subtasks');
    if (!run.item_id || steps.length === 0) return false;
    for (const step of steps) {
        const open = await openSubtasksQuery(run.item_id, run.graph_snapshot, step).executeTakeFirst();
        if (!open) continue;
        const workflow = await loadWorkflow(run.workflow_id);
        const rounds = run.gate_rounds + 1;
        if (rounds > (workflow?.max_loops ?? 3)) {
            await park(run, endNode.id, `Sent back for late sub-tasks ${workflow?.max_loops ?? 3} times: sub-task ${open.id} is still open`);
            return true;
        }
        await db.updateTable('workflow_runs').set({ gate_rounds: rounds }).where('id', '=', run.id).execute();
        run.gate_rounds = rounds;
        await runNextSubtask(run, step);
        return true;
    }
    const stray = await db
        .selectFrom('items')
        .select('id')
        .where('parent_id', '=', run.item_id)
        .where('type', '=', 'sub_task')
        .where('status', 'not in', ['in_review', 'done'])
        .orderBy('created_at', 'asc')
        .execute();
    if (stray.length === 0) return false;
    await park(
        run,
        endNode.id,
        `No Sub-tasks step runs ${stray.map((i) => i.id).join(', ')} (no matching label). Label or close them, then resume.`,
    );
    return true;
}

/** A sub-task's run never delivers: its work stays on the Task's branch. */
async function finishChildRun(run: RunRow, endNode: IWorkflowNode): Promise<void> {
    // The next sub-task starts from a clean tree, in every repo of the Task.
    if (run.worktree_path) {
        for (const { repo, path } of (await runRepos(run)).repos) await commitPending(path, repo.credential_id, run.id);
    }
    await db
        .updateTable('workflow_runs')
        .set({ status: 'completed', finished_at: new Date().toISOString(), current_node_id: endNode.id })
        .where('id', '=', run.id)
        .execute();
    broadcastRun(run, 'completed', endNode.id);
    const workflow = await loadWorkflow(run.workflow_id);
    if (run.item_id) {
        await setItemStatus(run.item_id, 'in_review', `workflow_completed: ${workflow?.name ?? 'Workflow'}`, { clearAssignee: true });
    }

    const parent = run.parent_workflow_run_id ? await loadRun(run.parent_workflow_run_id) : undefined;
    if (!parent) return;
    if (run.setup_done && !parent.setup_done) {
        await db.updateTable('workflow_runs').set({ setup_done: true }).where('id', '=', parent.id).execute();
        parent.setup_done = true;
    }
    const step = nodeById(parent.graph_snapshot, run.parent_node_id);
    if (!step || parent.status !== 'running' || parent.current_node_id !== step.id) return;
    await runNextSubtask(parent, step);
}

/**
 * The PR body's list of what the Task's sub-tasks did, for the Owner's
 * review — every sub-task any run of this Task finished, so a run that
 * continues after review keeps the earlier ones in the list.
 */
async function subtaskSummaryLines(run: RunRow): Promise<string[]> {
    if (!run.item_id) return [];
    const rows = await db
        .selectFrom('workflow_runs as wr')
        .innerJoin('items as i', 'i.id', 'wr.item_id')
        .select(['wr.id as run_id', 'i.id as item_id', 'i.title'])
        .where('i.parent_id', '=', run.item_id)
        .where('wr.parent_workflow_run_id', 'is not', null)
        .where('wr.status', '=', 'completed')
        .orderBy('wr.started_at', 'asc')
        .execute();
    if (rows.length === 0) return [];
    const steps = await db
        .selectFrom('agent_runs')
        .select(['workflow_run_id', 'outcome_summary'])
        .where('workflow_run_id', 'in', rows.map((r) => r.run_id))
        .where('outcome_kind', '=', 'done')
        .orderBy('created_at', 'asc')
        .execute();
    // The last passing step's summary per sub-task; a re-run sub-task keeps its latest run.
    const summaryByRun = new Map(steps.map((st) => [st.workflow_run_id, st.outcome_summary]));
    const byItem = new Map(rows.map((r) => [r.item_id, r]));
    const oneLine = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return [
        '',
        '## Sub-tasks',
        '',
        ...[...byItem.values()].map((r) => {
            const summary = oneLine(summaryByRun.get(r.run_id));
            return `- **${r.item_id}** ${r.title}${summary ? ` — ${summary}` : ''}`;
        }),
    ];
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
    // Stopping a sub-task stops its Task: the sub-tasks share one branch.
    const target = await loadRun(runId);
    if (target?.parent_workflow_run_id) {
        const parent = await loadRun(target.parent_workflow_run_id);
        if (parent && (parent.status === 'running' || parent.status === 'waiting_for_owner')) {
            await cancelWorkflowRun(parent.id);
            return;
        }
    }
    const now = new Date().toISOString();
    const updated = await db
        .updateTable('workflow_runs')
        .set({ status: 'cancelled', finished_at: now })
        .where('id', '=', runId)
        .where('status', 'in', ['running', 'waiting_for_owner'])
        .executeTakeFirst();
    if (Number(updated.numUpdatedRows ?? 0) === 0) return;
    const run = (await loadRun(runId)) as RunRow;
    broadcastRun(run, 'cancelled', run.current_node_id);

    const children = await db
        .updateTable('workflow_runs')
        .set({ status: 'cancelled', finished_at: now })
        .where('parent_workflow_run_id', '=', runId)
        .where('status', 'in', ['running', 'waiting_for_owner'])
        .returningAll()
        .execute();
    for (const child of children) broadcastRun(child as unknown as RunRow, 'cancelled', child.current_node_id);

    const live = await db
        .selectFrom('agent_runs')
        .select('id')
        .where('workflow_run_id', 'in', [runId, ...children.map((c) => c.id)])
        .where('status', 'in', ['queued', 'in_progress'])
        .execute();
    for (const step of live) {
        await db
            .updateTable('agent_runs')
            .set({ status: 'cancelled', completed_at: new Date().toISOString() })
            .where('id', '=', step.id)
            .execute();
        await cancelRun(step.id).catch(() => ({ cancelled: false }));
    }

    // Keep what the agents committed, but a stopped run opens no PR. A
    // sub-task's run owns no delivery of its own.
    if (!run.parent_workflow_run_id) {
        try {
            await deliver(run, { openPr: false });
        } catch {
            /* the worktree stays on disk when delivery fails */
        }
    }
    for (const r of [run, ...children]) {
        if (r.item_id) await setItemStatus(r.item_id, 'waiting_for_info', 'workflow_run_cancelled', { clearAssignee: true });
    }
    void kickWorkflowDispatch('finished');
}

// ─── Reconcile + dispatch tick ──────────────────────────────────────────────

export async function reconcileWorkflowRuns(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - WORKFLOW_RECONCILE_AFTER_MS).toISOString();
    const stale = await db
        .selectFrom('workflow_runs as wr')
        .select(['wr.id'])
        .where('wr.status', '=', 'running')
        .where('wr.updated_at', '<', cutoff)
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('agent_runs as ar')
                        .select('ar.id')
                        .whereRef('ar.workflow_run_id', '=', 'wr.id')
                        .where('ar.status', 'in', ['queued', 'in_progress']),
                ),
            ),
        )
        // A Task run at its Sub-tasks step works through its running child;
        // the child is reconciled on its own, and its park reaches the Task.
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('workflow_runs as c')
                        .select('c.id')
                        .whereRef('c.parent_workflow_run_id', '=', 'wr.id')
                        .where('c.status', '=', 'running'),
                ),
            ),
        )
        .execute();
    for (const { id } of stale) {
        const run = await loadRun(id);
        if (run) await park(run, run.current_node_id, 'A step stopped reporting back (the API may have restarted)');
    }
    return stale.length;
}

export function computeNextWorkflowFire(cronExpr: string, from: Date, timezone?: string): Date | null {
    try {
        return new Cron(cronExpr, { paused: true, ...(timezone ? { timezone } : {}) }).nextRun(from) ?? null;
    } catch {
        return null;
    }
}

async function schedulingTimezone(): Promise<string | undefined> {
    const row = await db.selectFrom('settings').select('quiet_hours_timezone').where('id', '=', 1).executeTakeFirst();
    return row?.quiet_hours_timezone ?? undefined;
}

async function oldestReadyItem(workflowId: string, readyByLastFire: boolean): Promise<string | null> {
    let q = db
        .selectFrom('items as i')
        .select('i.id')
        .where('i.workflow_id', '=', workflowId)
        .where('i.status', '=', 'ready')
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('workflow_runs as wr')
                        .select('wr.id')
                        .whereRef('wr.item_id', '=', 'i.id')
                        .where('wr.status', 'in', ['running', 'waiting_for_owner']),
                ),
            ),
        )
        // Skip items still waiting on a depends_on target, so one blocked
        // item doesn't hold the whole queue (startWorkflowRun would refuse it).
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('item_links as l')
                        .innerJoin('items as t', 't.id', 'l.to_id')
                        .select('l.from_id')
                        .whereRef('l.from_id', '=', 'i.id')
                        .where('l.relation_type', '=', 'depends_on')
                        .where('t.status', '!=', 'done'),
                ),
            ),
        )
        .orderBy('i.updated_at', 'asc')
        .limit(1);
    if (readyByLastFire) {
        q = q.where(sql<boolean>`i.updated_at <= (SELECT w.last_run_at FROM workflows w WHERE w.id = ${workflowId})`);
    }
    const row = await q.executeTakeFirst();
    return row?.id ?? null;
}

/**
 * One dispatch pass. A workflow runs up to `max_parallel_runs` Tasks at once,
 * each in its own worktree. Parked runs don't hold a slot, so one unanswered
 * question doesn't stall every other Task. Sub-task runs are started by their
 * Task run, never here.
 */
export async function tickWorkflowDispatch(now: Date = new Date()): Promise<number> {
    const workflows = await db
        .selectFrom('workflows')
        .selectAll()
        .where('status', '=', 'active')
        .where('trigger', 'in', ['schedule', 'item_ready'])
        .execute();
    const tz = await schedulingTimezone();
    let started = 0;
    for (const wf of workflows) {
        try {
            const running = await db
                .selectFrom('workflow_runs')
                .select((eb) => eb.fn.countAll().as('n'))
                .where('workflow_id', '=', wf.id)
                .where('status', '=', 'running')
                .where('parent_workflow_run_id', 'is', null)
                .executeTakeFirst();
            let free = wf.max_parallel_runs - Number(running?.n ?? 0);

            if (wf.trigger === 'schedule') {
                const due = wf.next_run_at !== null && new Date(wf.next_run_at).getTime() <= now.getTime();
                if (due) {
                    const next = wf.cron_expr ? computeNextWorkflowFire(wf.cron_expr, now, tz) : null;
                    // The DB clock stamps the fire: "ready at the fire" is then
                    // compared against items.updated_at on one clock (the
                    // Postgres VM's clock can run ms ahead of the host's).
                    await db
                        .updateTable('workflows')
                        .set({ next_run_at: next?.toISOString() ?? null, last_run_at: sql`now()` as never })
                        .where('id', '=', wf.id)
                        .execute();
                    wf.last_run_at = now.toISOString();
                } else if (wf.next_run_at === null && wf.cron_expr) {
                    const next = computeNextWorkflowFire(wf.cron_expr, now, tz);
                    await db.updateTable('workflows').set({ next_run_at: next?.toISOString() ?? null }).where('id', '=', wf.id).execute();
                }
                if (free <= 0) continue;
                if (wf.input_kind === 'none') {
                    if (due) {
                        await startWorkflowRun(wf.id, null);
                        started++;
                    }
                    continue;
                }
                // A scheduled item workflow drains the items that were ready
                // at its last fire; later arrivals wait for the next fire.
                if (!wf.last_run_at || wf.input_kind !== 'item') continue;
                for (; free > 0; free--) {
                    const itemId = await oldestReadyItem(wf.id, true);
                    if (!itemId) break;
                    await startWorkflowRun(wf.id, itemId);
                    started++;
                }
                continue;
            }

            if (wf.input_kind !== 'item') continue;
            for (; free > 0; free--) {
                const itemId = await oldestReadyItem(wf.id, false);
                if (!itemId) break;
                await startWorkflowRun(wf.id, itemId);
                started++;
            }
        } catch (err) {
            await reportDispatchFailure(wf, (err as Error).message);
        }
    }
    return started;
}

// ponytail: in-memory, so a restart re-notifies once. A table would need a
// migration to say nothing the notification itself doesn't already say.
const lastDispatchFailure = new Map<string, { message: string; at: number }>();
const DISPATCH_FAILURE_REARM_MS = 60 * 60 * 1000;

/**
 * A failed dispatch used to be a `console.warn` nobody reads, leaving the Task
 * at `ready` forever with no trace in the UI. Notify once per distinct message
 * per workflow — the tick runs every minute and would otherwise spam — and
 * re-arm hourly so a long-running failure doesn't go quiet for good.
 */
async function reportDispatchFailure(
    wf: { id: string; name: string },
    message: string,
): Promise<void> {
    const seen = lastDispatchFailure.get(wf.id);
    const now = Date.now();
    if (seen && seen.message === message && now - seen.at < DISPATCH_FAILURE_REARM_MS) return;
    lastDispatchFailure.set(wf.id, { message, at: now });
    await notificationsService.create({
        event_type: 'workflow_run',
        message: `${wf.name}: could not start a queued item — ${message}`,
        kind: 'needs_you',
        agent_id: null,
    });
}

let kickPending = false;

async function kickWorkflowDispatch(_reason: string): Promise<void> {
    if (kickPending) return;
    kickPending = true;
    try {
        await tickWorkflowDispatch();
    } catch (err) {
        console.warn(`[workflow-dispatch] kick failed: ${(err as Error).message}`);
    } finally {
        kickPending = false;
    }
}
