import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import type { IStory, IssuePriority, IssueStatus } from '@atlas/shared';
import { isValidTransition } from '@atlas/shared';
import {
    createItem,
    deleteItem,
    getItemOfType,
    patchItem,
    rowToStory,
} from './items.js';
import { eventsLog } from './events-log.js';

type CreateStoryInput = {
    epic_id: string;
    title: string;
    description?: string | undefined;
    acceptance_criteria?: string | undefined;
    priority?: IssuePriority | undefined;
    status?: IssueStatus | undefined;
    assignee_agent_id?: string | null | undefined;
    reporter_agent_id?: string | null | undefined;
    labels?: string[] | undefined;
};

interface ListOpts {
    epicId?: string | undefined;
    projectId?: string | undefined;
}

export const storiesService = {
    async list(opts: ListOpts = {}): Promise<IStory[]> {
        let q = db.selectFrom('items').selectAll().where('type', '=', 'story');
        if (opts.epicId) q = q.where('parent_id', '=', opts.epicId);
        if (opts.projectId) q = q.where('project_id', '=', opts.projectId);
        const rows = await q.orderBy('updated_at', 'desc').execute();
        return rows.map((r) => rowToStory(r as never));
    },

    async get(id: string): Promise<IStory | undefined> {
        const row = await getItemOfType(id, 'story');
        return row ? rowToStory(row) : undefined;
    },

    async create(data: CreateStoryInput): Promise<IStory> {
        const assigneeId = data.assignee_agent_id ?? null;
        const row = await createItem({
            project_id: '', // resolved from parent inside createItem
            type: 'story',
            parent_id: data.epic_id,
            title: data.title,
            description: data.description ?? '',
            acceptance_criteria: data.acceptance_criteria ?? '',
            priority: data.priority ?? 'normal',
            status: data.status ?? 'draft',
            assignee_agent_id: assigneeId,
            reporter_agent_id: data.reporter_agent_id ?? null,
            labels: data.labels ?? [],
        });
        const story = rowToStory(row);
        await eventsLog.record({
            item_id: story.id,
            item_type: 'story',
            event_type: 'created',
            actor_agent_id: data.reporter_agent_id ?? null,
            to_value: data.title,
        });
        broadcastSSE({ type: 'counts_changed' });
        return story;
    },

    async update(
        id: string,
        data: {
            title?: string | undefined;
            description?: string | undefined;
            spec_md?: string | null | undefined;
            pr_url?: string | null | undefined;
            points?: number | undefined;
            acceptance_criteria?: string | undefined;
            priority?: IssuePriority | undefined;
            // T2 — see UpdateStorySchema in @atlas/shared.
            worktree_branch?: string | null | undefined;
        },
    ): Promise<IStory> {
        const before = await this.get(id);
        if (!before) throw new Error('Story not found');
        const keys = Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined);
        if (keys.length === 0) return before;
        await patchItem(id, data);
        // T2 — `worktree_branch` is intentionally omitted from the
        // logField allow-list. The activity log's `IssueEventField`
        // union (in @atlas/shared) doesn't carry the field, and the
        // value is operational metadata (the orchestrator's input)
        // rather than user-visible content. Owner overrides still
        // round-trip via the existing `patchItem` write.
        await eventsLog.logFieldUpdates(
            'story',
            id,
            before as unknown as Record<string, unknown>,
            data as unknown as Record<string, unknown>,
            ['title', 'description', 'spec_md', 'pr_url', 'points', 'acceptance_criteria', 'priority'],
        );
        return (await this.get(id))!;
    },

    async transition(
        id: string,
        newStatus: IssueStatus,
        override = false,
        requestedBy: string | null = null,
    ): Promise<IStory> {
        const story = await this.get(id);
        if (!story) throw new Error('Story not found');
        if (!override && !isValidTransition('story', story.status, newStatus)) {
            throw new Error(`Invalid transition: ${story.status} → ${newStatus}`);
        }
        await patchItem(id, { status: newStatus });
        await eventsLog.record({
            item_id: id,
            item_type: 'story',
            event_type: 'status_changed',
            actor_agent_id: requestedBy,
            field: 'status',
            from_value: story.status,
            to_value: newStatus,
            detail: override ? 'override' : null,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'story', issueId: id });
        return (await this.get(id))!;
    },

    async assign(
        id: string,
        agentId: string | null,
        requestedBy: string | null = null,
    ): Promise<IStory> {
        const before = await this.get(id);
        if (!before) throw new Error('Story not found');
        await patchItem(id, { assignee_agent_id: agentId });
        await eventsLog.record({
            item_id: id,
            item_type: 'story',
            event_type: 'assigned',
            actor_agent_id: requestedBy,
            field: 'assignee',
            from_value: before.assignee_agent_id,
            to_value: agentId,
        });
        broadcastSSE({ type: 'counts_changed', issueType: 'story', issueId: id });
        return (await this.get(id))!;
    },

    async delete(id: string): Promise<void> {
        await eventsLog.record({
            item_id: id,
            item_type: 'story',
            event_type: 'deleted',
        });
        await deleteItem(id);
        broadcastSSE({ type: 'counts_changed' });
    },

    async countInProgress(): Promise<number> {
        const r = await db
            .selectFrom('items')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('type', '=', 'story')
            .where('status', 'in', ['in_progress', 'in_review'])
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },

    async countDoneThisWeek(): Promise<number> {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const r = await db
            .selectFrom('items')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('type', '=', 'story')
            .where('status', '=', 'done')
            .where('updated_at', '>=', sevenDaysAgo)
            .executeTakeFirst();
        return Number(r?.n ?? 0);
    },
};
