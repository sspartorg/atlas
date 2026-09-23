// What each workflow is working on and has lined up (ADR 0015). Read-only;
// dispatch itself lives in `workflow-engine.ts` (`tickWorkflowDispatch`).

import type { IWorkflowQueue } from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { rowToTask } from './items.js';
import { asRunSummary, workflowsService } from './workflows.js';

const LIVE = ['running', 'waiting_for_owner'] as const;

export const workflowQueueService = {
    async get(projectId?: string): Promise<IWorkflowQueue> {
        // Sub-task workflows only run inside a Task's run, so they never queue.
        const workflows = (await workflowsService.list(projectId)).filter((w) => w.input_kind !== 'sub_task');
        const ids = workflows.map((w) => w.id);

        let ready = db
            .selectFrom('items as i')
            .selectAll('i')
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
                            .where('wr.status', 'in', LIVE),
                    ),
                ),
            )
            // Dispatch order (`oldestReadyItem`).
            .orderBy('i.updated_at', 'asc');
        if (projectId) ready = ready.where('i.project_id', '=', projectId);

        const [runRows, taskRows] = await Promise.all([
            ids.length === 0
                ? []
                : db
                      .selectFrom('workflow_runs as wr')
                      .leftJoin('items as i', 'i.id', 'wr.item_id')
                      .selectAll('wr')
                      .select('i.title as item_title')
                      .where('wr.workflow_id', 'in', ids)
                      .where('wr.parent_workflow_run_id', 'is', null)
                      .where('wr.status', 'in', LIVE)
                      .orderBy('wr.started_at', 'asc')
                      .execute(),
            ready.execute(),
        ]);
        const runs = runRows.map((r) => asRunSummary(r as never));
        const tasks = taskRows.map((r) => rowToTask(r as never));

        const entries = workflows.map((workflow) => ({
            workflow,
            running: runs.filter((r) => r.workflow_id === workflow.id && r.status === 'running'),
            waiting: runs.filter((r) => r.workflow_id === workflow.id && r.status === 'waiting_for_owner'),
            queued: tasks.filter((t) => t.workflow_id === workflow.id && t.status === 'ready'),
        }));
        return {
            // A project-run (`none`) workflow never has Tasks queued; it shows
            // only while one of its runs is live, so the page lists everything
            // Atlas is doing right now.
            workflows: entries.filter((e) => e.workflow.input_kind === 'item' || e.running.length + e.waiting.length > 0),
            unassigned: tasks.filter((t) => t.workflow_id === null),
        };
    },
};
