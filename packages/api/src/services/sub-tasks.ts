import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import type { ISubTask, IssuePriority, IssueStatus } from '@atlas/shared';
import { isValidTransition } from '@atlas/shared';
import { createItem, deleteItem, getItemOfType, patchItem, rowToSubTask } from './items.js';
import { eventsLog } from './events-log.js';

type CreateSubTaskInput = {
    task_id: string;
    title: string;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
};

// ── Sub-tasks ──────────────────────────────────────────────────────────────
export const subTasksService = {
    async list(taskId: string): Promise<ISubTask[]> {
        const rows = await db
            .selectFrom('items')
            .selectAll()
            .where('type', '=', 'sub_task')
            .where('parent_id', '=', taskId)
            .orderBy('sort_order', 'asc')
            .orderBy('created_at', 'asc')
            .execute();
        return rows.map((r) => rowToSubTask(r as never));
    },

    async listAll(): Promise<ISubTask[]> {
        const rows = await db
            .selectFrom('items')
            .selectAll()
            .where('type', '=', 'sub_task')
            .orderBy('created_at', 'desc')
            .execute();
        return rows.map((r) => rowToSubTask(r as never));
    },

    async get(id: string): Promise<ISubTask | undefined> {
        const row = await getItemOfType(id, 'sub_task');
        return row ? rowToSubTask(row) : undefined;
    },

    async create(data: CreateSubTaskInput, actorAgentId: string | null = null): Promise<ISubTask> {
        const assigneeId = data.assignee_agent_id ?? null;
        const row = await createItem({
            project_id: '',
            type: 'sub_task',
            parent_id: data.task_id,
            title: data.title,
            description: data.description ?? '',
            acceptance_criteria: data.acceptance_criteria ?? '',
            priority: data.priority ?? 'normal',
            status: data.status ?? 'draft',
            assignee_agent_id: assigneeId,
            reporter_agent_id: data.reporter_agent_id ?? null,
            labels: data.labels ?? [],
        });
        const task = rowToSubTask(row);
        await eventsLog.record({
            item_id: task.id,
            item_type: 'sub_task',
            event_type: 'created',
            actor_agent_id: actorAgentId ?? data.reporter_agent_id ?? null,
            to_value: data.title,
        });
        broadcastSSE({ type: 'counts_changed' });
        return task;
    },

    async update(
        id: string,
        data: {
            title?: string | undefined;
            description?: string | undefined;
            acceptance_criteria?: string | undefined;
            priority?: IssuePriority | undefined;
            labels?: string[] | undefined;
        },
        actorAgentId: string | null = null,
    ): Promise<ISubTask> {
        const before = await this.get(id);
        if (!before) throw new Error('Sub-task not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
        if (keys.length === 0) return before;
        await patchItem(id, data);
        await eventsLog.logFieldUpdates('sub_task', id, before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, [
            'title',
            'description',
            'acceptance_criteria',
            'priority',
        ], actorAgentId);
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: IssueStatus,
        override = false,
        requestedBy: string | null = null,
    ): Promise<ISubTask> {
        const task = await this.get(id);
        if (!task) throw new Error('Sub-task not found');
        if (!override && !isValidTransition('sub_task', task.status, newStatus)) {
            throw new Error(`Invalid transition: ${task.status} → ${newStatus}`);
        }
        // Wrap status flip + optional started_at stamp + activity event in one
        // transaction so a failure between them doesn't strand the item in a
        // half-transitioned state (previously: item flipped to in_progress
        // with started_at set but no activity row → broken audit trail;
        // status change without started_at → started_at never backfills).
        await db.transaction().execute(async (trx) => {
            if (newStatus === 'in_progress' && !task.started_at) {
                await patchItem(id, { status: newStatus }, trx);
                await trx
                    .updateTable('items')
                    .set({ started_at: new Date().toISOString() })
                    .where('id', '=', id)
                    .execute();
            } else {
                await patchItem(id, { status: newStatus }, trx);
            }
            await eventsLog.record(
                {
                    item_id: id,
                    item_type: 'sub_task',
                    event_type: 'status_changed',
                    actor_agent_id: requestedBy,
                    field: 'status',
                    from_value: task.status,
                    to_value: newStatus,
                    detail: override ? 'override' : null,
                },
                trx,
            );
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'sub_task', issueId: id });
        return (await this.get(id))!;
    },

    async assign(
        id: string,
        agentId: string | null,
        requestedBy: string | null = null,
    ): Promise<ISubTask> {
        const before = await this.get(id);
        if (!before) throw new Error('Sub-task not found');
        await patchItem(id, { assignee_agent_id: agentId });
        await eventsLog.record({
            item_id: id,
            item_type: 'sub_task',
            event_type: 'assigned',
            actor_agent_id: requestedBy,
            field: 'assignee',
            from_value: before.assignee_agent_id,
            to_value: agentId,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'sub_task', issueId: id });
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await eventsLog.record({
            item_id: id,
            item_type: 'sub_task',
            event_type: 'deleted',
        });
        await deleteItem(id);
        broadcastSSE({ type: 'counts_changed' });
    },
};
