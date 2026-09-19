import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import type { ITask, ITaskListItem, IssuePriority, IssueStatus } from '@atlas/shared';
import { isValidTransition } from '@atlas/shared';
import {
    createItem,
    deleteItem,
    getItemOfType,
    patchItem,
    rowToTask,
} from './items.js';
import { eventsLog } from './events-log.js';
import { projectReposService } from './project-repos.js';
import { ApiError } from '../utils/errors.js';

interface CreateInput {
    project_id: string;
    title: string;
    description?: string;
    acceptance_criteria?: string;
    priority?: IssuePriority;
    reporter_agent_id?: string | null;
    assignee_agent_id?: string | null;
    labels?: string[];
    repo_ids?: string[];
}

interface UpdateInput {
    title?: string | undefined;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    priority?: IssuePriority | undefined;
    reporter_agent_id?: string | null | undefined;
    spec_md?: string | null | undefined;
    pr_url?: string | null | undefined;
    worktree_branch?: string | null | undefined;
    labels?: string[] | undefined;
    repo_ids?: string[] | undefined;
}

async function subTaskCounts(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const rows = await db
        .selectFrom('items')
        .select(({ fn }) => ['parent_id', fn.countAll<string>().as('n')])
        .where('type', '=', 'sub_task')
        .where('parent_id', 'in', taskIds)
        .groupBy('parent_id')
        .execute();
    const out = new Map<string, number>();
    for (const r of rows) {
        if (r.parent_id) out.set(r.parent_id, Number(r.n));
    }
    return out;
}

export const tasksService = {
    // `includeArchived` defaults to false: hides tasks closed (status=done)
    // more than 7 days ago. Set true to bypass the filter (archived view).
    async list(projectId?: string, includeArchived = false): Promise<ITaskListItem[]> {
        let q = db.selectFrom('items').selectAll().where('type', '=', 'task');
        if (projectId) q = q.where('project_id', '=', projectId);
        if (!includeArchived) {
            q = q.where(
                sql<boolean>`(status <> 'done' OR updated_at >= NOW() - INTERVAL '7 days')`,
            );
        }
        const rows = await q.orderBy('created_at', 'desc').execute();
        const tasks = rows.map((r) => rowToTask(r as never));
        const counts = await subTaskCounts(tasks.map((t) => t.id));
        return tasks.map((t) => ({ ...t, sub_task_count: counts.get(t.id) ?? 0 }));
    },

    async get(id: string): Promise<ITask | undefined> {
        const row = await getItemOfType(id, 'task');
        return row ? rowToTask(row) : undefined;
    },

    async create(data: CreateInput, actorAgentId: string | null = null): Promise<ITask> {
        const repoIds = await projectReposService.validateIds(data.project_id, data.repo_ids ?? []);
        const row = await createItem({
            project_id: data.project_id,
            type: 'task',
            title: data.title,
            description: data.description ?? '',
            acceptance_criteria: data.acceptance_criteria ?? '',
            priority: data.priority ?? 'normal',
            reporter_agent_id: data.reporter_agent_id ?? null,
            assignee_agent_id: data.assignee_agent_id ?? null,
            labels: data.labels ?? [],
            repo_ids: repoIds,
        });
        const task = rowToTask(row);
        await eventsLog.record({
            item_id: task.id,
            item_type: 'task',
            event_type: 'created',
            actor_agent_id: actorAgentId ?? data.reporter_agent_id ?? null,
            to_value: data.title,
        });
        broadcastSSE({ type: 'counts_changed' });
        return task;
    },

    async update(id: string, data: UpdateInput, actorAgentId: string | null = null): Promise<ITask> {
        const before = await this.get(id);
        if (!before) throw new Error('Task not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof UpdateInput] !== undefined);
        if (keys.length === 0) return before;
        if (data.repo_ids !== undefined) {
            // The run's workspace was built for the repos it started with (ADR 0017).
            const live = await db
                .selectFrom('workflow_runs')
                .select('id')
                .where('item_id', '=', id)
                .where('status', 'in', ['running', 'waiting_for_owner'])
                .executeTakeFirst();
            if (live) {
                throw new ApiError('conflict', 'Stop the workflow run on this Task before changing its repos', 409);
            }
            data = { ...data, repo_ids: await projectReposService.validateIds(before.project_id, data.repo_ids) };
        }
        await patchItem(id, data);
        // `worktree_branch` isn't logged: it's operational metadata, not
        // user-visible content, and IssueEventField doesn't carry it.
        await eventsLog.logFieldUpdates(
            'task',
            id,
            before as unknown as Record<string, unknown>,
            data as unknown as Record<string, unknown>,
            ['title', 'description', 'acceptance_criteria', 'spec_md', 'pr_url', 'priority', 'reporter'],
            actorAgentId,
        );
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: IssueStatus,
        override = false,
        requestedBy: string | null = null,
        detail: string | null = null,
    ): Promise<ITask> {
        const task = await this.get(id);
        if (!task) throw new Error('Task not found');
        if (!override && !isValidTransition('task', task.status, newStatus)) {
            throw new Error(`Invalid transition: ${task.status} → ${newStatus}`);
        }
        await patchItem(id, { status: newStatus });
        await eventsLog.record({
            item_id: id,
            item_type: 'task',
            event_type: 'status_changed',
            actor_agent_id: requestedBy,
            field: 'status',
            from_value: task.status,
            to_value: newStatus,
            detail: detail ?? (override ? 'override' : null),
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'task', issueId: id });
        return (await this.get(id))!;
    },

    async assign(
        id: string,
        agentId: string | null,
        requestedBy: string | null = null,
    ): Promise<ITask> {
        const before = await this.get(id);
        if (!before) throw new Error('Task not found');
        await patchItem(id, { assignee_agent_id: agentId });
        await eventsLog.record({
            item_id: id,
            item_type: 'task',
            event_type: 'assigned',
            actor_agent_id: requestedBy,
            field: 'assignee',
            from_value: before.assignee_agent_id,
            to_value: agentId,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'task', issueId: id });
        return (await this.get(id))!;
    },

    /**
     * Closes the Task's sub-tasks that are in review — the Owner verified
     * the branch they share. Returns how many it closed.
     */
    async closeReviewedSubtasks(id: string, detail: string, requestedBy: string | null = null): Promise<number> {
        const reviewed = await db
            .updateTable('items')
            .set({ status: 'done' })
            .where('parent_id', '=', id)
            .where('type', '=', 'sub_task')
            .where('status', '=', 'in_review')
            .returning(['id'])
            .execute();
        for (const { id: subId } of reviewed) {
            await eventsLog.record({
                item_id: subId,
                item_type: 'sub_task',
                event_type: 'status_changed',
                actor_agent_id: requestedBy,
                field: 'status',
                from_value: 'in_review',
                to_value: 'done',
                detail,
            });
            broadcastSSE({ type: 'counts_changed', issueType: 'sub_task', issueId: subId });
        }
        return reviewed.length;
    },

    /**
     * Sets the order a Task's Sub-tasks steps run its sub-tasks in. `ids`
     * must be exactly the Task's sub-tasks.
     */
    async reorderSubtasks(id: string, ids: string[]): Promise<void> {
        const current = await db.selectFrom('items').select('id').where('parent_id', '=', id).where('type', '=', 'sub_task').execute();
        const known = new Set(current.map((r) => r.id));
        if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((sid) => !known.has(sid))) {
            throw new Error("List every one of the Task's sub-tasks exactly once");
        }
        await db.transaction().execute(async (trx) => {
            for (const [i, subId] of ids.entries()) {
                await trx.updateTable('items').set({ sort_order: i }).where('id', '=', subId).execute();
            }
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'task', issueId: id });
    },

    async delete(id: string): Promise<void> {
        await eventsLog.record({
            item_id: id,
            item_type: 'task',
            event_type: 'deleted',
        });
        await deleteItem(id);
        broadcastSSE({ type: 'counts_changed' });
    },

    async count(): Promise<number> {
        const r = await db
            .selectFrom('items')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('type', '=', 'task')
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },

    async awaitingPickupCount(): Promise<number> {
        const r = await db
            .selectFrom('items')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('type', '=', 'task')
            .where('status', '=', 'ready')
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },
};
