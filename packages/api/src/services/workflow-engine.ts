// Workflow engine (ADR 0014).
//
// A workflow run owns one worktree + branch for its whole life. Each agent
// node is an ordinary `agent_runs` row spawned through `spawnAgentRun`; the
// runner reports every terminal step back through `onStepFinished`, and the
// engine picks the next node from the run's frozen `graph_snapshot`. Nothing
// here waits on the scheduler tick: the next node spawns as soon as the
// previous one finishes. Push, PR and worktree cleanup happen once, at End.
//
// Git helpers (`ensureWorktree`, `pushWorktree`, `openPullRequest`,
// `cleanupWorktreeAfterPush`) each take `withProjectGitLock` internally and
// the lock is not re-entrant — never wrap them in another lock here.

import { randomUUID } from 'node:crypto';
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
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { eventsLog } from './events-log.js';
import { notificationsService } from './notifications.js';
import { sendExternalForNotification } from './external-notifications.js';
import { externalLinks, parseGithubPrUrl, fetchGithubPrTitle } from './external-links.js';
import { commentsService } from './comments.js';
import { assertDepsAllDoneForDispatch } from './dependency-guard.js';
import { decideRunRouting } from './agent-runner-outcome-routing.js';
import {
    WORKTREE_BRANCH_RE,
    ensureWorktree,
    pushWorktree,
    openPullRequest,
    cleanupWorktreeAfterPush,
} from './worktree-orchestrator.js';
import { buildGitAuth, cleanupGitConfig } from './git-credentials.js';
import { gitInvokeEnv } from './git-env.js';
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
    current_node_id: string | null;
    parked_node_id: string | null;
    loop_count: number;
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

function broadcastRun(run: Pick<RunRow, 'id' | 'workflow_id' | 'item_id'>, status: WorkflowRunStatus, nodeId: string | null): void {
    broadcastSSE({
        type: 'workflow_run_updated',
        workflowId: run.workflow_id,
        workflowRunId: run.id,
        workflowRunStatus: status,
        nodeId,
        ...(run.item_id ? { issueId: run.item_id } : {}),
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

export async function startWorkflowRun(workflowId: string, itemId: string | null): Promise<string> {
    const workflow = await loadWorkflow(workflowId);
    if (!workflow) throw new WorkflowStartError('not_found', 'Workflow not found');
    const graph = workflow.graph;
    const graphErrors = validateWorkflowGraph(graph);
    if (graphErrors.length > 0) {
        throw new WorkflowStartError('invalid', `Workflow graph is invalid: ${graphErrors[0]?.message ?? ''}`);
    }
    const start = graph.nodes.find((n) => n.type === 'start');
    const firstNodeId = start ? nextNodeId(graph, start.id, 'pass') : null;
    if (!firstNodeId) throw new WorkflowStartError('invalid', 'Workflow Start is not connected');

    let item: Awaited<ReturnType<typeof loadItem>>;
    if (workflow.input_kind === 'item') {
        if (!itemId) throw new WorkflowStartError('invalid', 'This workflow runs on an item — pick one to start it');
        item = await loadItem(itemId);
        if (!item) throw new WorkflowStartError('not_found', 'Item not found');
        if (workflow.project_id && item.project_id !== workflow.project_id) {
            throw new WorkflowStartError('invalid', "Item belongs to a different project than the workflow");
        }
        if (item.status === 'done') throw new WorkflowStartError('invalid', 'Item is already done');
        const firstAgent = nodeById(graph, firstNodeId)?.agent_id ?? workflowId;
        await assertDepsAllDoneForDispatch(item.id, firstAgent);
    } else if (itemId) {
        throw new WorkflowStartError('invalid', 'This workflow runs on the project, not on an item');
    }

    const runId = randomUUID();
    const projectId = item?.project_id ?? workflow.project_id;
    const itemBranch = item?.worktree_branch && WORKTREE_BRANCH_RE.test(item.worktree_branch) ? item.worktree_branch : null;
    const branch = workflow.use_worktree ? (itemBranch ?? `atlas/wf/${item?.id ?? runId.slice(0, 8)}`) : null;

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
        if (branch && branch !== item.worktree_branch) {
            await db.updateTable('items').set({ worktree_branch: branch }).where('id', '=', item.id).execute();
        }
    }

    if (workflow.use_worktree && branch && projectId) {
        const project = await db
            .selectFrom('projects')
            .select(['id', 'git_path', 'credential_id', 'default_branch'])
            .where('id', '=', projectId)
            .executeTakeFirst();
        try {
            if (!project?.git_path) throw new Error('Project has no cloned repository on disk');
            // item: null — the path lives on workflow_runs only. Writing it to
            // items.worktree_path would let the boot orphan reaper push and
            // delete the shared worktree between steps.
            const wt = await ensureWorktree({
                item: null,
                branch,
                project: {
                    id: project.id,
                    git_path: project.git_path,
                    credential_id: project.credential_id,
                    default_branch: project.default_branch,
                },
                pushUpstream: workflow.push_code,
            });
            await db.updateTable('workflow_runs').set({ worktree_path: wt.path }).where('id', '=', runId).execute();
            run.worktree_path = wt.path;
        } catch (err) {
            await park(run, firstNodeId, `Could not prepare the worktree: ${(err as Error).message}`);
            return runId;
        }
    }

    await goTo(run, firstNodeId);
    return runId;
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
    await spawnNode(run, node);
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
    if (step.status === 'error' || step.status === 'setup_failed') {
        await park(run, step.node_id, step.status === 'setup_failed' ? 'Project setup script failed' : 'The agent step errored');
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
            const lastStep = await db
                .selectFrom('agent_runs')
                .select('agent_id')
                .where('workflow_run_id', '=', run.id)
                .orderBy('created_at', 'desc')
                .executeTakeFirst();
            try {
                await commentsService.create({
                    author: 'agent',
                    agent_id: lastStep?.agent_id ?? null,
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
    const parked = nodeById(run.graph_snapshot, run.parked_node_id);
    if (!parked) {
        const start = run.graph_snapshot.nodes.find((n) => n.type === 'start');
        const first = start ? nextNodeId(run.graph_snapshot, start.id, 'pass') : null;
        if (first) await goTo(run, first);
        return;
    }
    broadcastRun(run, 'running', parked.id);
    if (parked.type === 'owner') {
        const next = nextNodeId(run.graph_snapshot, parked.id, 'pass');
        if (next) await goTo(run, next);
        return;
    }
    if (parked.type === 'end') {
        await finishRun(run, parked);
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
    /** Set when a delivery step the workflow asked for did not happen. */
    failure: string | null;
    log: string[];
}

async function deliver(run: RunRow, opts: { openPr: boolean }): Promise<DeliveryResult> {
    const log: string[] = [];
    const result: DeliveryResult = { pushed: false, prUrl: null, failure: null, log };
    const workflow = await loadWorkflow(run.workflow_id);
    if (!workflow || !run.worktree_path || !run.branch || !run.project_id) return result;
    const project = await db
        .selectFrom('projects')
        .select(['id', 'name', 'git_path', 'credential_id', 'default_branch'])
        .where('id', '=', run.project_id)
        .executeTakeFirst();
    if (!project) return result;

    let pushOk = !workflow.push_code;
    if (workflow.push_code) {
        const committed = await commitPending(run.worktree_path, project.credential_id, run.id);
        if (committed) log.push(committed);
        const push = await pushWorktree(run.worktree_path, run.branch, project.credential_id, project.id);
        pushOk = push.pushed || push.alreadyUpToDate;
        result.pushed = push.pushed;
        log.push(pushOk ? `pushed ${run.branch}` : `push failed: ${push.error ?? 'unknown'}`);
        if (!pushOk) result.failure = `Push failed: ${push.error ?? 'unknown error'}`;
    }

    if (opts.openPr && workflow.raises_pr && workflow.push_code && pushOk) {
        const item = run.item_id ? await loadItem(run.item_id) : undefined;
        const title = item ? `[${item.id}] ${String(item.title).slice(0, 80)}` : `[${workflow.name}] ${project.name}`;
        const body = [
            `Opened by the **${workflow.name}** workflow.`,
            '',
            ...(item ? [`- Item: ${item.id}`] : [`- Project: ${project.name}`]),
            `- Workflow run: \`${run.id}\``,
        ].join('\n');
        const pr = await openPullRequest({
            worktreePath: run.worktree_path,
            branch: run.branch,
            base: project.default_branch?.trim() ? project.default_branch : 'main',
            title,
            body,
            credentialId: project.credential_id,
            projectId: project.id,
        });
        if (pr.url) {
            result.prUrl = pr.url;
            log.push(`pr: ${pr.url}`);
            if (item) {
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
                    log.push(`could not link the PR: ${(err as Error).message}`);
                }
            }
        } else {
            log.push(`pr failed: ${pr.error ?? 'unknown'}`);
            result.failure = `Pull request failed: ${pr.error ?? 'unknown error'}`;
        }
    }

    // Any delivery failure keeps the worktree so a resumed run can retry
    // from exactly this state.
    if (pushOk && !result.failure && project.git_path) {
        const cleanup = await cleanupWorktreeAfterPush({
            itemId: null,
            projectId: project.id,
            projectGitPath: project.git_path,
            worktreePath: run.worktree_path,
            branch: run.branch,
            credentialId: project.credential_id,
        });
        log.push(...cleanup.warnings);
    }
    return result;
}

async function finishRun(run: RunRow, endNode: IWorkflowNode): Promise<void> {
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
        .set({ status: 'completed', finished_at: now, pr_url: delivery.prUrl })
        .where('id', '=', run.id)
        .execute();
    broadcastRun(run, 'completed', endNode.id);

    const workflow = await loadWorkflow(run.workflow_id);
    const name = workflow?.name ?? 'Workflow';
    let routedChildren = 0;
    if (run.item_id) {
        const finalStatus = delivery.prUrl ? 'in_review' : 'done';
        await setItemStatus(run.item_id, finalStatus, `workflow_completed: ${name}`, { clearAssignee: true });
        routedChildren = await routeChildren(run, endNode);
        const suffix = delivery.prUrl ? ` PR: ${delivery.prUrl}` : '';
        await notifyOwner(
            run,
            `${name} finished ${run.item_id}.${suffix}${delivery.log.length ? ` (${delivery.log.join('; ')})` : ''}`,
            delivery.prUrl ? 'needs_you' : 'update',
            delivery.prUrl ? 'item.status_changed:in_review' : null,
        );
    } else {
        routedChildren = await routeChildren(run, endNode);
        await notifyOwner(run, `${name} finished.${delivery.prUrl ? ` PR: ${delivery.prUrl}` : ''}`, 'update', 'agent.run_finished_no_item');
    }
    // Start the next queued run (this workflow's queue or a child workflow)
    // now instead of waiting for the next minute tick.
    void kickWorkflowDispatch(routedChildren > 0 ? 'children' : 'finished');
}

async function routeChildren(run: RunRow, endNode: IWorkflowNode): Promise<number> {
    let q = db
        .selectFrom('items')
        .select(['id', 'type', 'status', 'workflow_id'])
        .where((eb) =>
            eb.or([
                eb('created_by_workflow_run_id', '=', run.id),
                ...(run.item_id ? [eb.and([eb('parent_id', '=', run.item_id), eb('created_at', '>=', run.started_at)])] : []),
            ]),
        );
    q = q.where('status', 'in', ['draft', 'ready']);
    const children = await q.execute();
    let routed = 0;
    for (const child of children) {
        const workflowId = child.workflow_id ?? endNode.child_workflow_id ?? null;
        if (!workflowId) continue;
        await db.updateTable('items').set({ workflow_id: workflowId, status: 'ready' }).where('id', '=', child.id).execute();
        if (child.status !== 'ready') {
            await eventsLog.record({
                item_id: child.id,
                item_type: child.type as IssueType,
                event_type: 'status_changed',
                actor_agent_id: null,
                field: 'status',
                from_value: child.status,
                to_value: 'ready',
                detail: `queued_for_workflow: ${workflowId}`,
            });
        }
        broadcastSSE({ type: 'counts_changed', issueType: child.type as IssueType, issueId: child.id });
        routed++;
    }
    return routed;
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
    const updated = await db
        .updateTable('workflow_runs')
        .set({ status: 'cancelled', finished_at: new Date().toISOString() })
        .where('id', '=', runId)
        .where('status', 'in', ['running', 'waiting_for_owner'])
        .executeTakeFirst();
    if (Number(updated.numUpdatedRows ?? 0) === 0) return;
    const run = (await loadRun(runId)) as RunRow;
    broadcastRun(run, 'cancelled', run.current_node_id);

    const live = await db
        .selectFrom('agent_runs')
        .select('id')
        .where('workflow_run_id', '=', runId)
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

    // Keep what the agents committed, but a stopped run opens no PR.
    try {
        await deliver(run, { openPr: false });
    } catch {
        /* the worktree stays on disk when delivery fails */
    }
    if (run.item_id) {
        await setItemStatus(run.item_id, 'waiting_for_info', 'workflow_run_cancelled', { clearAssignee: true });
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

async function oldestReadyItem(workflowId: string, readyBy: string | null): Promise<string | null> {
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
        .orderBy('i.updated_at', 'asc')
        .limit(1);
    if (readyBy) q = q.where('i.updated_at', '<=', readyBy);
    const row = await q.executeTakeFirst();
    return row?.id ?? null;
}

/**
 * One dispatch pass. A workflow runs one item at a time: it only starts a
 * run when none of its runs is `running`. Parked runs don't hold the queue,
 * so one unanswered question doesn't stall every other item.
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
            const busy = await db
                .selectFrom('workflow_runs')
                .select('id')
                .where('workflow_id', '=', wf.id)
                .where('status', '=', 'running')
                .executeTakeFirst();

            if (wf.trigger === 'schedule') {
                const due = wf.next_run_at !== null && new Date(wf.next_run_at).getTime() <= now.getTime();
                if (due) {
                    const next = wf.cron_expr ? computeNextWorkflowFire(wf.cron_expr, now, tz) : null;
                    await db
                        .updateTable('workflows')
                        .set({ next_run_at: next?.toISOString() ?? null, last_run_at: now.toISOString() })
                        .where('id', '=', wf.id)
                        .execute();
                    wf.last_run_at = now.toISOString();
                } else if (wf.next_run_at === null && wf.cron_expr) {
                    const next = computeNextWorkflowFire(wf.cron_expr, now, tz);
                    await db.updateTable('workflows').set({ next_run_at: next?.toISOString() ?? null }).where('id', '=', wf.id).execute();
                }
                if (busy) continue;
                if (wf.input_kind === 'none') {
                    if (due) {
                        await startWorkflowRun(wf.id, null);
                        started++;
                    }
                    continue;
                }
                // A scheduled item workflow drains the items that were ready
                // at its last fire; later arrivals wait for the next fire.
                if (!wf.last_run_at) continue;
                const itemId = await oldestReadyItem(wf.id, wf.last_run_at);
                if (itemId) {
                    await startWorkflowRun(wf.id, itemId);
                    started++;
                }
                continue;
            }

            if (busy || wf.input_kind !== 'item') continue;
            const itemId = await oldestReadyItem(wf.id, null);
            if (itemId) {
                await startWorkflowRun(wf.id, itemId);
                started++;
            }
        } catch (err) {
            console.warn(`[workflow-dispatch] ${wf.id}: ${(err as Error).message}`);
        }
    }
    return started;
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
