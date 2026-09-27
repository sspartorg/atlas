import type { IExternalCiCheck } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { commentsService } from './comments.js';
import { notificationsService } from './notifications.js';
import { subTasksService } from './sub-tasks.js';
import { startWorkflowRun } from './workflow-engine.js';
import { decideCiAction, MAX_CI_FIX_ATTEMPTS } from './ci-routing.js';

// Follow through after the PR (migration 023): a Task in review whose PR went
// red. `external-links.ts` notices; this acts. It is imported dynamically from
// there because workflow-engine already imports external-links statically.

export interface RedPr {
    linkId: number;
    url: string;
    headSha: string;
    handledSha: string | null;
    failing: IExternalCiCheck[];
}

function checkLines(failing: IExternalCiCheck[]): string {
    // A failure with nothing named is possible (a check with no name and no
    // output); say so rather than render an empty list.
    if (failing.length === 0) return '- (GitHub did not name the failing check)';
    return failing.map((c) => `- **${c.name}**${c.detail ? `: ${c.detail}` : ''}`).join('\n');
}

export async function followThroughRedCi(taskId: string, pr: RedPr): Promise<void> {
    const item = await db.selectFrom('items').select(['type', 'status']).where('id', '=', taskId).executeTakeFirst();
    if (!item) return;
    const { attempts } = await db
        .selectFrom('item_external_links')
        .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('ci_fix_attempts'), eb.lit(0)).as('attempts'))
        .where('item_id', '=', taskId)
        .executeTakeFirstOrThrow();
    const live = await db
        .selectFrom('workflow_runs')
        .select('id')
        .where('item_id', '=', taskId)
        .where('status', 'in', ['running', 'waiting_for_owner'])
        .executeTakeFirst();
    const last = await db
        .selectFrom('workflow_runs as r')
        .innerJoin('workflows as w', 'w.id', 'r.workflow_id')
        .select(['w.id', 'w.name', 'w.graph'])
        .where('r.item_id', '=', taskId)
        .where('r.parent_workflow_run_id', 'is', null)
        .where('r.status', '=', 'completed')
        .orderBy('r.started_at', 'desc')
        .executeTakeFirst();

    const action = decideCiAction({
        itemType: item.type,
        itemStatus: item.status,
        ciState: 'failure',
        headSha: pr.headSha,
        handledSha: pr.handledSha,
        // SUM over bigint-free integers still comes back as a string from pg.
        attempts: Number(attempts),
        liveRun: Boolean(live),
        lastWorkflowId: last?.id ?? null,
        // The CURRENT graph, not the run's snapshot: that is what
        // startWorkflowRun validates and walks.
        hasSubtasksStep: Boolean(last?.graph.nodes.some((n) => n.type === 'subtasks')),
    });
    if (action.kind === 'none') return;

    // Claim the commit before acting. The tick and a page-driven refresh can
    // both land here for the same sha; only the one whose UPDATE matches acts.
    const claimed = await db
        .updateTable('item_external_links')
        .set({ ci_handled_sha: pr.headSha })
        .where('id', '=', pr.linkId)
        .where((eb) => eb.or([eb('ci_handled_sha', 'is', null), eb('ci_handled_sha', '!=', pr.headSha)]))
        .returning('id')
        .executeTakeFirst();
    if (!claimed) return;

    let outcome: string;
    if (action.kind === 'notify') {
        outcome = `No automatic fix: ${action.why}.`;
    } else {
        const attempt = Number(attempts) + 1;
        const wfName = last?.name ?? 'the workflow';
        try {
            if (action.kind === 'fix_subtask') {
                const names = pr.failing.map((c) => c.name).join(', ') || 'CI';
                const sub = await subTasksService.create({
                    task_id: taskId,
                    title: `Fix failing CI: ${names}`.slice(0, 200),
                    description:
                        `CI failed on ${pr.url} at commit \`${pr.headSha.slice(0, 7)}\`.\n\n` +
                        `Failing checks:\n${checkLines(pr.failing)}\n\n` +
                        'Make these checks pass on the Task branch.',
                });
                // The "continue after review" path: skip planning, run the open
                // sub-tasks on the branch the last run left, End updates the PR.
                await startWorkflowRun(action.workflowId, taskId, undefined, { fromSubtasks: true });
                outcome = `Atlas added sub-task ${sub.id} and continued **${wfName}** to fix it (automatic fix ${attempt} of ${MAX_CI_FIX_ATTEMPTS}).`;
            } else {
                // items.worktree_branch is reused, so the restart works on the
                // same branch and End updates the same PR.
                await startWorkflowRun(action.workflowId, taskId);
                outcome = `Atlas restarted **${wfName}** on the same branch to fix it (automatic fix ${attempt} of ${MAX_CI_FIX_ATTEMPTS}).`;
            }
            await db
                .updateTable('item_external_links')
                .set((eb) => ({ ci_fix_attempts: eb('ci_fix_attempts', '+', 1) }))
                .where('id', '=', pr.linkId)
                .execute();
        } catch (err) {
            outcome = `Could not start an automatic fix: ${(err as Error).message}`;
        }
    }

    const body = `**CI failed** on ${pr.url} (commit \`${pr.headSha.slice(0, 7)}\`):\n\n${checkLines(pr.failing)}\n\n${outcome}`;
    try {
        // No agent_id: the workflow speaks here, like a park comment. `system`
        // keeps it "Workflow" even though the fix run just started an agent
        // on this Task (comments otherwise borrow the live run's agent).
        await commentsService.create({ author: 'agent', agent_id: null, issue_type: 'task', issue_id: taskId, body, system: true });
    } catch {
        /* the notification still carries the signal */
    }
    try {
        const names = pr.failing.map((c) => c.name).join(', ') || 'a check';
        await notificationsService.create({
            event_type: 'ci_failed',
            message: `CI failed on ${taskId} (${names}). ${outcome}`,
            issue_type: 'task',
            issue_id: taskId,
            agent_id: null,
            kind: 'needs_you',
        });
    } catch {
        /* best-effort, like every other Owner notification */
    }
}
