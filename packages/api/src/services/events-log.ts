import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/kysely-client.js';
import type { DB } from '../db/types.js';
import type {
    IActivityItem,
    IComment,
    IIssueEvent,
    IssueEventField,
    IssueEventType,
    IssueType,
} from '@atlas/shared';

// Executor param on `eventsLog.record`: pass the ambient `db` (default) for
// standalone writes, or a `trx` from `db.transaction()` when the caller
// needs the events-log write to roll back with sibling writes on failure.
// Fixes the "insert item + record event" orphan class of bugs — see
// commentsService.create / issues.ts:171 status transitions / spawnAgentRun.
export type EventsLogExecutor = Kysely<DB> | Transaction<DB>;

// `'unblocked'` predates the IssueEventType union and stays as an inline
// extension because the activity rendering treats it as informational
// (depends-on chain unblocked) rather than a primary item event. Every other
// event_type now lives in the shared union.
interface RecordInput {
    item_id: string;
    item_type?: IssueType | undefined;
    event_type: IssueEventType | 'unblocked';
    actor_agent_id?: string | null | undefined;
    field?: IssueEventField | undefined;
    from_value?: string | null | undefined;
    to_value?: string | null | undefined;
    detail?: string | null | undefined;
}

// Hoisted from `issues.ts` so every entity service can share one
// implementation. `allowedFields` is the per-call gate: each service passes
// the subset of LoggableField names that are valid for its entity type.
// Anything in `data` that's not in `allowedFields` is silently skipped
// (the caller is the source of truth for what its update accepts).
type LoggableField = Exclude<IssueEventField, null | 'status' | 'assignee' | 'link'>;

// Mapping from data-side column names to the canonical IssueEventField. Most
// fields match 1:1; a few (reporter) use DB column names that differ from
// the event field they emit.
const DATA_KEY_TO_FIELD: Partial<Record<string, LoggableField>> = {
    title: 'title',
    description: 'description',
    spec_md: 'spec_md',
    pr_url: 'pr_url',
    points: 'points',
    acceptance_criteria: 'acceptance_criteria',
    priority: 'priority',
    steps_to_reproduce: 'steps_to_reproduce',
    expected: 'expected',
    actual: 'actual',
    frequency: 'frequency',
    failure_scope: 'failure_scope',
    reporter_agent_id: 'reporter',
};

async function logFieldUpdatesImpl(
    issueType: IssueType,
    issueId: string,
    before: Record<string, unknown>,
    data: Record<string, unknown>,
    allowedFields: LoggableField[],
): Promise<void> {
    const allowed = new Set<LoggableField>(allowedFields);
    for (const k of Object.keys(data)) {
        if (data[k] === undefined) continue;
        const mapped = DATA_KEY_TO_FIELD[k];
        if (!mapped) continue;
        if (!allowed.has(mapped)) continue;
        const beforeKey = k in before ? k : (mapped as string);
        const fromVal = before[beforeKey];
        if (fromVal === data[k]) continue;
        await eventsLog.record({
            item_id: issueId,
            item_type: issueType,
            event_type: 'field_updated',
            field: mapped,
            from_value: fromVal == null ? null : String(fromVal),
            to_value: data[k] == null ? null : String(data[k]),
        });
    }
}

function truncate(value: string | null | undefined, max = 280): string | null {
    if (value == null) return null;
    if (value.length <= max) return value;
    return value.slice(0, max - 1) + '…';
}

async function lookupItemType(itemId: string): Promise<IssueType | undefined> {
    const row = await db
        .selectFrom('items')
        .select('type')
        .where('id', '=', itemId)
        .executeTakeFirst();
    return row?.type;
}

function asIssueEvent(row: {
    id: number;
    item_id: string;
    event_type: string;
    actor_agent_id: string | null;
    field: string | null;
    from_value: string | null;
    to_value: string | null;
    detail: string | null;
    created_at: string;
}, issue_type: IssueType): IIssueEvent {
    return {
        id: row.id,
        issue_type,
        issue_id: row.item_id,
        event_type: row.event_type as IssueEventType,
        actor_agent_id: row.actor_agent_id,
        field: row.field as IssueEventField,
        from_value: row.from_value,
        to_value: row.to_value,
        detail: row.detail,
        created_at: row.created_at,
    };
}

function asComment(row: {
    id: number;
    author: 'owner' | 'agent';
    agent_id: string | null;
    item_id: string;
    body: string;
    edited_at: string | null;
    created_at: string;
}, issue_type: IssueType): IComment {
    return {
        id: row.id,
        author: row.author,
        agent_id: row.agent_id,
        issue_type,
        issue_id: row.item_id,
        body: row.body,
        edited_at: row.edited_at,
        created_at: row.created_at,
    };
}

// B04 — record a `dispatch_blocked` event when the pre-dispatch depends_on
// gate inside spawnAgentRun refuses to spawn. `actor_agent_id` carries the
// agent that was meant to run; `detail` is the comma-separated blocker list
// so the activity tab can show "Dispatch blocked — waiting on ATL-12
// (in_progress), ATL-15 (in_review)" without re-querying item_links.
async function logDispatchBlockedImpl(
    itemId: string,
    agentId: string,
    blockers: Array<{ id: string; status: string }>,
): Promise<void> {
    const detail = blockers.map((b) => `${b.id} (${b.status})`).join(', ');
    await eventsLog.record({
        item_id: itemId,
        event_type: 'dispatch_blocked',
        actor_agent_id: agentId,
        detail,
    });
}

export const eventsLog = {
    logFieldUpdates: logFieldUpdatesImpl,
    logDispatchBlocked: logDispatchBlockedImpl,
    async record(input: RecordInput, executor: EventsLogExecutor = db): Promise<IIssueEvent> {
        const row = await executor
            .insertInto('issue_events')
            .values({
                item_id: input.item_id,
                event_type: input.event_type as IIssueEvent['event_type'],
                actor_agent_id: input.actor_agent_id ?? null,
                field: input.field ?? null,
                from_value: truncate(input.from_value),
                to_value: truncate(input.to_value),
                detail: truncate(input.detail),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        const type = input.item_type ?? (await lookupItemType(input.item_id)) ?? 'story';
        return asIssueEvent(row as never, type);
    },

    async list(itemId: string, issueType?: IssueType): Promise<IIssueEvent[]> {
        const rows = await db
            .selectFrom('issue_events')
            .selectAll()
            .where('item_id', '=', itemId)
            .orderBy('created_at', 'asc')
            .orderBy('id', 'asc')
            .execute();
        const type = issueType ?? (await lookupItemType(itemId)) ?? 'story';
        return rows.map((r) => asIssueEvent(r as never, type));
    },

    async activity(itemId: string, issueType?: IssueType): Promise<IActivityItem[]> {
        const type = issueType ?? (await lookupItemType(itemId)) ?? 'story';
        const [events, comments] = await Promise.all([
            db
                .selectFrom('issue_events')
                .selectAll()
                .where('item_id', '=', itemId)
                .orderBy('created_at', 'asc')
                .orderBy('id', 'asc')
                .execute(),
            db
                .selectFrom('comments')
                .selectAll()
                .where('item_id', '=', itemId)
                // P11 — soft-deleted comments are excluded from the
                // activity feed, matching `commentsService.list`. The
                // original `comment_added` event row stays in
                // `issue_events`, so the audit trail records that the
                // comment existed without rendering its body.
                .where('deleted_at', 'is', null)
                .orderBy('created_at', 'asc')
                .orderBy('id', 'asc')
                .execute(),
        ]);
        const merged: IActivityItem[] = [
            ...events.map((e) => ({ kind: 'event' as const, data: asIssueEvent(e as never, type) })),
            ...comments.map((c) => ({
                kind: 'comment' as const,
                data: asComment(c as never, type),
            })),
        ];
        merged.sort((a, b) => {
            const ta = a.data.created_at;
            const tb = b.data.created_at;
            if (ta === tb) return a.data.id - b.data.id;
            return ta < tb ? -1 : 1;
        });
        return merged;
    },
};
