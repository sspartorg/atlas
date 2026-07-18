import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import type {
    ISubTask,
    ISubBug,
    IBug,
    IssuePriority,
    IssueStatus,
    SubTaskStatus,
    BugFrequency,
    BugFailureScope,
} from '@atlas/shared';
import { isValidTransition } from '@atlas/shared';
import {
    createItem,
    deleteItem,
    getItemOfType,
    patchItem,
    rowToBug,
    rowToSubBug,
    rowToSubTask,
} from './items.js';
import { eventsLog } from './events-log.js';

type CreateSubTaskInput = {
    story_id: string;
    title: string;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: SubTaskStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
};

type BugFieldInputs = {
    acceptance_criteria?: string | undefined;
    steps_to_reproduce?: string | undefined;
    expected?: string | undefined;
    actual?: string | undefined;
    frequency?: BugFrequency | undefined;
    failure_scope?: BugFailureScope | undefined;
};

type CreateSubBugInput = BugFieldInputs & {
    story_id: string;
    title: string;
    description?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
};

type CreateBugInput = BugFieldInputs & {
    epic_id: string;
    title: string;
    description?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
};

function bugFieldDefaults(input: BugFieldInputs) {
    return {
        acceptance_criteria: input.acceptance_criteria ?? '',
        steps_to_reproduce: input.steps_to_reproduce ?? '',
        expected: input.expected ?? '',
        actual: input.actual ?? '',
        frequency: input.frequency ?? ('sometimes' as const),
        failure_scope: input.failure_scope ?? ('cosmetic' as const),
    };
}

// ── Sub-tasks ──────────────────────────────────────────────────────────────
export const subTasksService = {
    async list(storyId: string): Promise<ISubTask[]> {
        const rows = await db
            .selectFrom('items')
            .selectAll()
            .where('type', '=', 'sub_task')
            .where('parent_id', '=', storyId)
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

    async create(data: CreateSubTaskInput): Promise<ISubTask> {
        const assigneeId = data.assignee_agent_id ?? null;
        const row = await createItem({
            project_id: '',
            type: 'sub_task',
            parent_id: data.story_id,
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
            actor_agent_id: data.reporter_agent_id ?? null,
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
        },
    ): Promise<ISubTask> {
        const before = await this.get(id);
        if (!before) throw new Error('Sub-task not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
        if (keys.length === 0) return before;
        await patchItem(id, data);
        await eventsLog.logFieldUpdates('sub_task', id, before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, [
            'title',
            'description',
            'spec_md',
            'pr_url',
            'points',
            'acceptance_criteria',
            'priority',
        ]);
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: SubTaskStatus,
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

// ── Sub-bugs ───────────────────────────────────────────────────────────────
export const subBugsService = {
    async list(storyId: string): Promise<ISubBug[]> {
        const rows = await db
            .selectFrom('items')
            .selectAll()
            .where('type', '=', 'sub_bug')
            .where('parent_id', '=', storyId)
            .orderBy('created_at', 'asc')
            .execute();
        return rows.map((r) => rowToSubBug(r as never));
    },

    async listAll(): Promise<ISubBug[]> {
        const rows = await db
            .selectFrom('items')
            .selectAll()
            .where('type', '=', 'sub_bug')
            .orderBy('created_at', 'desc')
            .execute();
        return rows.map((r) => rowToSubBug(r as never));
    },

    async get(id: string): Promise<ISubBug | undefined> {
        const row = await getItemOfType(id, 'sub_bug');
        return row ? rowToSubBug(row) : undefined;
    },

    async create(data: CreateSubBugInput): Promise<ISubBug> {
        const assigneeId = data.assignee_agent_id ?? null;
        const row = await createItem({
            project_id: '',
            type: 'sub_bug',
            parent_id: data.story_id,
            title: data.title,
            description: data.description ?? '',
            ...bugFieldDefaults(data),
            priority: data.priority ?? 'normal',
            status: data.status ?? 'draft',
            assignee_agent_id: assigneeId,
            reporter_agent_id: data.reporter_agent_id ?? null,
            labels: data.labels ?? [],
        });
        // detected_at + occurrence_count/total defaults
        await db
            .updateTable('items')
            .set({
                detected_at: new Date().toISOString(),
                occurrence_count: 1,
                occurrence_total: 1,
            })
            .where('id', '=', row.id)
            .execute();
        const fresh = await getItemOfType(row.id, 'sub_bug');
        const bug = rowToSubBug(fresh!);
        await eventsLog.record({
            item_id: bug.id,
            item_type: 'sub_bug',
            event_type: 'created',
            actor_agent_id: data.reporter_agent_id ?? null,
            to_value: data.title,
        });
        broadcastSSE({ type: 'counts_changed' });
        return bug;
    },

    async update(
        id: string,
        data: {
            title?: string | undefined;
            description?: string | undefined;
            acceptance_criteria?: string | undefined;
            steps_to_reproduce?: string | undefined;
            expected?: string | undefined;
            actual?: string | undefined;
            frequency?: BugFrequency | undefined;
            failure_scope?: BugFailureScope | undefined;
            priority?: IssuePriority | undefined;
        },
    ): Promise<ISubBug> {
        const before = await this.get(id);
        if (!before) throw new Error('Sub-bug not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
        if (keys.length === 0) return before;
        await patchItem(id, data);
        await eventsLog.logFieldUpdates('sub_bug', id, before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, [
            'title',
            'description',
            'acceptance_criteria',
            'priority',
            'steps_to_reproduce',
            'expected',
            'actual',
            'frequency',
            'failure_scope',
        ]);
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: IssueStatus,
        override = false,
        requestedBy: string | null = null,
    ): Promise<ISubBug> {
        const bug = await this.get(id);
        if (!bug) throw new Error('Sub-bug not found');
        if (!override && !isValidTransition('sub_bug', bug.status, newStatus)) {
            throw new Error(`Invalid transition: ${bug.status} → ${newStatus}`);
        }
        // Status flip + activity event wrapped in one transaction — see the
        // sub-task transition above for the failure mode this prevents.
        await db.transaction().execute(async (trx) => {
            await patchItem(id, { status: newStatus }, trx);
            await eventsLog.record(
                {
                    item_id: id,
                    item_type: 'sub_bug',
                    event_type: 'status_changed',
                    actor_agent_id: requestedBy,
                    field: 'status',
                    from_value: bug.status,
                    to_value: newStatus,
                    detail: override ? 'override' : null,
                },
                trx,
            );
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'sub_bug', issueId: id });
        return (await this.get(id))!;
    },

    async assign(
        id: string,
        agentId: string | null,
        requestedBy: string | null = null,
    ): Promise<ISubBug> {
        const before = await this.get(id);
        if (!before) throw new Error('Sub-bug not found');
        await patchItem(id, { assignee_agent_id: agentId });
        await eventsLog.record({
            item_id: id,
            item_type: 'sub_bug',
            event_type: 'assigned',
            actor_agent_id: requestedBy,
            field: 'assignee',
            from_value: before.assignee_agent_id,
            to_value: agentId,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'sub_bug', issueId: id });
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await eventsLog.record({
            item_id: id,
            item_type: 'sub_bug',
            event_type: 'deleted',
        });
        await deleteItem(id);
        broadcastSSE({ type: 'counts_changed' });
    },
};

// ── Bugs (top-level, peer of Story) ────────────────────────────────────────
interface BugsListOpts {
    epicId?: string | undefined;
    projectId?: string | undefined;
}

export const bugsService = {
    async list(opts: BugsListOpts = {}): Promise<IBug[]> {
        let q = db.selectFrom('items').selectAll().where('type', '=', 'bug');
        if (opts.epicId) q = q.where('parent_id', '=', opts.epicId);
        if (opts.projectId) q = q.where('project_id', '=', opts.projectId);
        const rows = await q.orderBy('updated_at', 'desc').execute();
        return rows.map((r) => rowToBug(r as never));
    },

    async get(id: string): Promise<IBug | undefined> {
        const row = await getItemOfType(id, 'bug');
        return row ? rowToBug(row) : undefined;
    },

    async create(data: CreateBugInput): Promise<IBug> {
        const assigneeId = data.assignee_agent_id ?? null;
        const row = await createItem({
            project_id: '',
            type: 'bug',
            parent_id: data.epic_id,
            title: data.title,
            description: data.description ?? '',
            ...bugFieldDefaults(data),
            priority: data.priority ?? 'normal',
            status: data.status ?? 'draft',
            assignee_agent_id: assigneeId,
            reporter_agent_id: data.reporter_agent_id ?? null,
            labels: data.labels ?? [],
        });
        await db
            .updateTable('items')
            .set({
                detected_at: new Date().toISOString(),
                occurrence_count: 1,
                occurrence_total: 1,
            })
            .where('id', '=', row.id)
            .execute();
        const fresh = await getItemOfType(row.id, 'bug');
        const bug = rowToBug(fresh!);
        await eventsLog.record({
            item_id: bug.id,
            item_type: 'bug',
            event_type: 'created',
            actor_agent_id: data.reporter_agent_id ?? null,
            to_value: data.title,
        });
        broadcastSSE({ type: 'counts_changed' });
        return bug;
    },

    async update(
        id: string,
        data: {
            title?: string | undefined;
            description?: string | undefined;
            acceptance_criteria?: string | undefined;
            steps_to_reproduce?: string | undefined;
            expected?: string | undefined;
            actual?: string | undefined;
            frequency?: BugFrequency | undefined;
            failure_scope?: BugFailureScope | undefined;
            priority?: IssuePriority | undefined;
        },
    ): Promise<IBug> {
        const before = await this.get(id);
        if (!before) throw new Error('Bug not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
        if (keys.length === 0) return before;
        await patchItem(id, data);
        await eventsLog.logFieldUpdates('bug', id, before as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>, [
            'title',
            'description',
            'acceptance_criteria',
            'priority',
            'steps_to_reproduce',
            'expected',
            'actual',
            'frequency',
            'failure_scope',
        ]);
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: IssueStatus,
        override = false,
        requestedBy: string | null = null,
    ): Promise<IBug> {
        const bug = await this.get(id);
        if (!bug) throw new Error('Bug not found');
        if (!override && !isValidTransition('bug', bug.status, newStatus)) {
            throw new Error(`Invalid transition: ${bug.status} → ${newStatus}`);
        }
        // Status flip + activity event wrapped in one transaction — see the
        // sub-task transition for the failure mode.
        await db.transaction().execute(async (trx) => {
            await patchItem(id, { status: newStatus }, trx);
            await eventsLog.record(
                {
                    item_id: id,
                    item_type: 'bug',
                    event_type: 'status_changed',
                    actor_agent_id: requestedBy,
                    field: 'status',
                    from_value: bug.status,
                    to_value: newStatus,
                    detail: override ? 'override' : null,
                },
                trx,
            );
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'bug', issueId: id });
        return (await this.get(id))!;
    },

    async assign(
        id: string,
        agentId: string | null,
        requestedBy: string | null = null,
    ): Promise<IBug> {
        const before = await this.get(id);
        if (!before) throw new Error('Bug not found');
        await patchItem(id, { assignee_agent_id: agentId });
        await eventsLog.record({
            item_id: id,
            item_type: 'bug',
            event_type: 'assigned',
            actor_agent_id: requestedBy,
            field: 'assignee',
            from_value: before.assignee_agent_id,
            to_value: agentId,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'bug', issueId: id });
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await eventsLog.record({
            item_id: id,
            item_type: 'bug',
            event_type: 'deleted',
        });
        await deleteItem(id);
        broadcastSSE({ type: 'counts_changed' });
    },
};
