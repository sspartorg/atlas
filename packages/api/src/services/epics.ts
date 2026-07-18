import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import type { IEpic, IEpicListItem, IssuePriority, IssueStatus } from '@atlas/shared';
import { isValidTransition } from '@atlas/shared';
import {
    createItem,
    deleteItem,
    getItemOfType,
    patchItem,
    rowToEpic,
} from './items.js';
import { eventsLog } from './events-log.js';

interface CreateInput {
    project_id: string;
    title: string;
    description?: string;
    priority?: IssuePriority;
    reporter_agent_id?: string | null;
    assignee_agent_id?: string | null;
    labels?: string[];
}

interface UpdateInput {
    title?: string | undefined;
    description?: string | undefined;
    priority?: IssuePriority | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
}

async function storyCounts(epicIds: string[]): Promise<Map<string, number>> {
    if (epicIds.length === 0) return new Map();
    const rows = await db
        .selectFrom('items')
        .select(({ fn }) => ['parent_id', fn.countAll<string>().as('n')])
        .where('type', '=', 'story')
        .where('parent_id', 'in', epicIds)
        .groupBy('parent_id')
        .execute();
    const out = new Map<string, number>();
    for (const r of rows) {
        if (r.parent_id) out.set(r.parent_id, Number(r.n));
    }
    return out;
}

export const epicsService = {
    // `includeArchived` defaults to false: hides epics closed (status=done)
    // more than 7 days ago. Set true to bypass the filter (archived view).
    async list(projectId?: string, includeArchived = false): Promise<IEpicListItem[]> {
        let q = db.selectFrom('items').selectAll().where('type', '=', 'epic');
        if (projectId) q = q.where('project_id', '=', projectId);
        if (!includeArchived) {
            q = q.where(
                sql<boolean>`(status <> 'done' OR updated_at >= NOW() - INTERVAL '7 days')`,
            );
        }
        const rows = await q.orderBy('created_at', 'desc').execute();
        const epics = rows.map((r) => rowToEpic(r as never));
        const counts = await storyCounts(epics.map((e) => e.id));
        return epics.map((e) => ({ ...e, story_count: counts.get(e.id) ?? 0 }));
    },

    async get(id: string): Promise<IEpic | undefined> {
        const row = await getItemOfType(id, 'epic');
        return row ? rowToEpic(row) : undefined;
    },

    async create(data: CreateInput): Promise<IEpic> {
        const assigneeId = data.assignee_agent_id ?? null;
        const row = await createItem({
            project_id: data.project_id,
            type: 'epic',
            title: data.title,
            description: data.description ?? '',
            priority: data.priority ?? 'normal',
            reporter_agent_id: data.reporter_agent_id ?? null,
            assignee_agent_id: assigneeId,
            labels: data.labels ?? [],
        });
        // Plan #7 — every epic gets a `worktree_branch` at creation
        // time so PO Writer (and any future epic-scope agent) has a
        // real worktree provisioned on first dispatch. Shape matches
        // WORKTREE_BRANCH_RE: `atlas/<role>/<id>`; PO Writer's
        // role_id is 'po'. The branch is never pushed (PO Writer has
        // push_code = false); it lives locally during the run and
        // gets cleaned up at run-end like every other worktree.
        const worktreeBranch = `atlas/po/${row.id as string}`;
        await db
            .updateTable('items')
            .set({ worktree_branch: worktreeBranch })
            .where('id', '=', row.id as string)
            .where('worktree_branch', 'is', null)
            .execute();
        const epic = rowToEpic({ ...row, worktree_branch: worktreeBranch });
        await eventsLog.record({
            item_id: epic.id,
            item_type: 'epic',
            event_type: 'created',
            actor_agent_id: data.reporter_agent_id ?? null,
            to_value: data.title,
        });
        broadcastSSE({ type: 'counts_changed' });
        return epic;
    },

    async update(id: string, data: UpdateInput): Promise<IEpic> {
        const before = await this.get(id);
        if (!before) throw new Error('Epic not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof UpdateInput] !== undefined);
        if (keys.length === 0) return before;
        await patchItem(id, data);
        await eventsLog.logFieldUpdates(
            'epic',
            id,
            before as unknown as Record<string, unknown>,
            data as unknown as Record<string, unknown>,
            ['title', 'description', 'priority', 'reporter'],
        );
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: IssueStatus,
        override = false,
        requestedBy: string | null = null,
    ): Promise<IEpic> {
        const epic = await this.get(id);
        if (!epic) throw new Error('Epic not found');
        if (!override && !isValidTransition('epic', epic.status, newStatus)) {
            throw new Error(`Invalid transition: ${epic.status} → ${newStatus}`);
        }
        await patchItem(id, { status: newStatus });
        await eventsLog.record({
            item_id: id,
            item_type: 'epic',
            event_type: 'status_changed',
            actor_agent_id: requestedBy,
            field: 'status',
            from_value: epic.status,
            to_value: newStatus,
            detail: override ? 'override' : null,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'epic', issueId: id });
        return (await this.get(id))!;
    },

    async assign(
        id: string,
        agentId: string | null,
        requestedBy: string | null = null,
    ): Promise<IEpic> {
        const before = await this.get(id);
        if (!before) throw new Error('Epic not found');
        await patchItem(id, { assignee_agent_id: agentId });
        await eventsLog.record({
            item_id: id,
            item_type: 'epic',
            event_type: 'assigned',
            actor_agent_id: requestedBy,
            field: 'assignee',
            from_value: before.assignee_agent_id,
            to_value: agentId,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'epic', issueId: id });
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await eventsLog.record({
            item_id: id,
            item_type: 'epic',
            event_type: 'deleted',
        });
        await deleteItem(id);
        broadcastSSE({ type: 'counts_changed' });
    },

    async count(): Promise<number> {
        const r = await db
            .selectFrom('items')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('type', '=', 'epic')
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },

    async awaitingPickupCount(): Promise<number> {
        const r = await db
            .selectFrom('items')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('type', '=', 'epic')
            .where('status', '=', 'ready')
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },
};
