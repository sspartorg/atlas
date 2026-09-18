import { existsSync } from 'node:fs';
import { db } from '../db/kysely-client.js';
import { itemLinks } from './item-links.js';
import { externalLinks } from './external-links.js';
import { eventsLog } from './events-log.js';
import { rowToSubTask, rowToTask } from './items.js';
import type {
    ITask,
    ITaskFullResponse,
    IProject,
    ISubTaskFullResponse,
    IAgent,
    IIssueLinkRow,
    IssueStatus,
} from '@atlas/shared';

async function getAgentsAll(): Promise<IAgent[]> {
    const rows = await db.selectFrom('agents').selectAll().execute();
    return rows as unknown as IAgent[];
}

async function getTaskById(id: string): Promise<ITask | null> {
    const row = await db
        .selectFrom('items')
        .selectAll()
        .where('id', '=', id)
        .where('type', '=', 'task')
        .executeTakeFirst();
    return row ? rowToTask(row as never) : null;
}

/**
 * A workflow run keeps its worktree on `workflow_runs`, not on the Task, so
 * the Task shows its latest run's checkout while that folder exists — during
 * the run, and after it when delivery kept it ("keep local", a failed push).
 */
async function withRunWorktree(task: ITask): Promise<ITask> {
    if (task.worktree_path) return task;
    const run = await db
        .selectFrom('workflow_runs')
        .select('worktree_path')
        .where('item_id', '=', task.id)
        .where('parent_workflow_run_id', 'is', null)
        .where('worktree_path', 'is not', null)
        .orderBy('started_at', 'desc')
        .executeTakeFirst();
    return run?.worktree_path && existsSync(run.worktree_path) ? { ...task, worktree_path: run.worktree_path } : task;
}

async function getProjectById(id: string | null | undefined): Promise<IProject | null> {
    // FK trigger guarantees project_id resolves; `!id` is a defensive guard.
    /* v8 ignore next */
    if (!id) return null;
    const row = await db
        .selectFrom('projects')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
    // FK trigger guarantees the project row exists when called from issueFullService.
    /* v8 ignore next */
    if (!row) return null;
    return {
        ...(row as unknown as Omit<IProject, 'last_activity_at'>),
        last_activity_at: row.updated_at,
    } as IProject;
}

async function relatedLinks(itemId: string): Promise<IIssueLinkRow[]> {
    const rows = await itemLinks.list(itemId);
    return rows.map(
        (r): IIssueLinkRow => ({
            id: r.id,
            type: r.type,
            item_id: r.item_id,
            short_id: r.short_id,
            title: r.title,
            status: r.status as IssueStatus,
            relation_type: r.relation_type,
            direction: r.direction,
            created_at: r.created_at,
        }),
    );
}

export const issueFullService = {
    async task(id: string): Promise<ITaskFullResponse | null> {
        const saved = await getTaskById(id);
        if (!saved) return null;
        const task = await withRunWorktree(saved);
        const [project, subTaskRows, links, ext_links, activity, agents] = await Promise.all([
            getProjectById(task.project_id),
            db
                .selectFrom('items')
                .selectAll()
                .where('type', '=', 'sub_task')
                .where('parent_id', '=', id)
                // The order its Sub-tasks steps run them in.
                .orderBy('sort_order', 'asc')
                .orderBy('created_at', 'asc')
                .execute(),
            relatedLinks(id),
            externalLinks.list(id),
            eventsLog.activity(id, 'task'),
            getAgentsAll(),
        ]);
        return {
            task,
            project,
            sub_tasks: subTaskRows.map((r) => rowToSubTask(r as never)),
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
        };
    },

    async subTask(id: string): Promise<ISubTaskFullResponse | null> {
        const row = await db
            .selectFrom('items')
            .selectAll()
            .where('id', '=', id)
            .where('type', '=', 'sub_task')
            .executeTakeFirst();
        if (!row) return null;
        const sub_task = rowToSubTask(row as never);
        const [task, project, links, ext_links, activity, agents] = await Promise.all([
            getTaskById(sub_task.task_id),
            getProjectById(row.project_id),
            relatedLinks(id),
            externalLinks.list(id),
            eventsLog.activity(id, 'sub_task'),
            getAgentsAll(),
        ]);
        return {
            sub_task,
            task,
            project,
            related_links: links,
            external_links: ext_links,
            activity,
            agents,
        };
    },
};
