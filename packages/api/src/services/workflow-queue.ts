// What each workflow is working on and has lined up (ADR 0015). Read-only;
// dispatch itself lives in `workflow-engine.ts` (`tickWorkflowDispatch`).

import type { IWorkflowQueue, IWorkflowRunSummary } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { rowToTask } from './items.js';
import { asRunSummary, workflowsService } from './workflows.js';

const LIVE = ['running', 'waiting_for_owner'] as const;

/** The dashboard's slice of the queue: live runs in full, waiting Tasks only counted. */
export interface IDashboardPipelines {
    runs: Array<IWorkflowRunSummary & { workflow_name: string }>;
    queued: Array<{ workflow_id: string; workflow_name: string; count: number }>;
    unassigned: number;
}

// Tasks waiting for dispatch: `ready` (and `draft`, only to feed `unassigned`)
// with no live run, in dispatch order (`oldestReadyItem`).
function waitingTasks(projectId?: string) {
    let q = db
        .selectFrom('items_live as i')
        .where('i.type', '=', 'task')
        // `draft` is here only to feed `unassigned` below. A Jira source
        // with no workflow deliberately leaves its Task a draft (ADR 0016),
        // and a draft with no workflow used to appear nowhere at all — the
        // notification was the single trace of it. Dispatch still only ever
        // takes `ready`, so listing it changes nothing about what runs.
        .where('i.status', 'in', ['draft', 'ready'])
        .where(({ not, exists, selectFrom }) =>
            not(
                exists(
                    selectFrom('workflow_runs as wr')
                        .select('wr.id')
                        .whereRef('wr.item_id', '=', 'i.id')
                        .where('wr.status', 'in', LIVE)
                )
            )
        );
    if (projectId) q = q.where('i.project_id', '=', projectId);
    return q;
}

function liveRuns(workflowIds: string[]) {
    return workflowIds.length === 0
        ? Promise.resolve([])
        : db
              .selectFrom('workflow_runs as wr')
              .leftJoin('items as i', 'i.id', 'wr.item_id')
              .selectAll('wr')
              .select('i.title as item_title')
              .where('wr.workflow_id', 'in', workflowIds)
              .where('wr.parent_workflow_run_id', 'is', null)
              .where('wr.status', 'in', LIVE)
              .orderBy('wr.started_at', 'asc')
              .execute()
              .then((rows) => rows.map((r) => asRunSummary(r as never)));
}

export const workflowQueueService = {
    async get(projectId?: string): Promise<IWorkflowQueue> {
        // Sub-task workflows only run inside a Task's run, so they never queue.
        const workflows = (await workflowsService.list(projectId)).filter(
            (w) => w.input_kind !== 'sub_task'
        );
        const ids = workflows.map((w) => w.id);

        const [runs, taskRows] = await Promise.all([
            liveRuns(ids),
            waitingTasks(projectId).selectAll('i').orderBy('i.updated_at', 'asc').execute(),
        ]);
        const tasks = taskRows.map((r) => rowToTask(r as never));

        const entries = workflows.map((workflow) => ({
            workflow,
            running: runs.filter((r) => r.workflow_id === workflow.id && r.status === 'running'),
            waiting: runs.filter(
                (r) => r.workflow_id === workflow.id && r.status === 'waiting_for_owner'
            ),
            queued: tasks.filter((t) => t.workflow_id === workflow.id && t.status === 'ready'),
        }));
        return {
            // A project-run (`none`) workflow never has Tasks queued; it shows
            // only while one of its runs is live, so the page lists everything
            // Atlas is doing right now.
            workflows: entries.filter(
                (e) => e.workflow.input_kind === 'item' || e.running.length + e.waiting.length > 0
            ),
            unassigned: tasks.filter((t) => t.workflow_id === null),
        };
    },

    /**
     * What the dashboard's Running now panel shows, without shipping every
     * waiting Task: on a large backlog `get()` is hundreds of KB of Tasks the
     * panel only counts.
     */
    async dashboardSummary(): Promise<IDashboardPipelines> {
        const workflows = (await workflowsService.list()).filter(
            (w) => w.input_kind !== 'sub_task'
        );
        const byId = new Map(workflows.map((w) => [w.id, w]));
        const [runs, counts] = await Promise.all([
            liveRuns(workflows.map((w) => w.id)),
            waitingTasks()
                .select(['i.workflow_id', 'i.status'])
                .select(({ fn }) => fn.countAll<string>().as('n'))
                .groupBy(['i.workflow_id', 'i.status'])
                .execute(),
        ]);
        return {
            runs: runs.map((r) => ({ ...r, workflow_name: byId.get(r.workflow_id)?.name ?? '' })),
            queued: counts
                .filter(
                    (c) => c.status === 'ready' && c.workflow_id !== null && byId.has(c.workflow_id)
                )
                .map((c) => ({
                    workflow_id: c.workflow_id as string,
                    workflow_name: byId.get(c.workflow_id as string)?.name ?? '',
                    count: Number(c.n),
                })),
            unassigned: counts
                .filter((c) => c.workflow_id === null)
                .reduce((n, c) => n + Number(c.n), 0),
        };
    },
};
