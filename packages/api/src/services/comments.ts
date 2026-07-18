import { db } from '../db/kysely-client.js';
import type { IComment, IssueType } from '@atlas/shared';
import { eventsLog } from './events-log.js';

async function lookupItemType(itemId: string): Promise<IssueType | undefined> {
    const row = await db
        .selectFrom('items')
        .select('type')
        .where('id', '=', itemId)
        .executeTakeFirst();
    // FK constraint guarantees item exists when called from create/update/softDelete;
    // the `?.` null arm (→ undefined) is an unreachable defensive fallback.
    /* v8 ignore next */
    return row?.type;
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

export const commentsService = {
    async list(issueType: IssueType, issueId: string): Promise<IComment[]> {
        // P11 — soft-deleted comments stay on disk (audit trail) but are
        // hidden from every live reader. `deleted_at IS NULL` is the
        // canonical visibility filter, mirrored in `eventsLog.activity`.
        const rows = await db
            .selectFrom('comments')
            .selectAll()
            .where('item_id', '=', issueId)
            .where('deleted_at', 'is', null)
            .orderBy('created_at', 'asc')
            .orderBy('id', 'asc')
            .execute();
        return rows.map((r) => asComment(r as never, issueType));
    },

    async create(data: {
        author: 'owner' | 'agent';
        agent_id?: string | null;
        issue_type: IssueType;
        issue_id: string;
        body: string;
    }): Promise<IComment> {
        // FK constraint ensures the item exists, and lookupItemType's own
        // `row?.type` fallback is unreachable (see its /* v8 ignore */
        // above) — so the `?? 'story'` here can only fire if a caller omits
        // issue_type AND the FK-guaranteed item lookup still yields
        // undefined, which cannot happen. Kept as a defensive default.
        /* v8 ignore next */
        const type = data.issue_type ?? (await lookupItemType(data.issue_id)) ?? 'story';
        // Wrap both writes in one transaction so a failure between the
        // INSERT and the activity-feed event doesn't leave an orphan
        // comment — the caller sees a 500 and NO comment/event rows,
        // rather than a visible comment that never appeared in the
        // activity stream.
        const inserted = await db.transaction().execute(async (trx) => {
            const row = await trx
                .insertInto('comments')
                .values({
                    author: data.author,
                    agent_id: data.agent_id ?? null,
                    item_id: data.issue_id,
                    body: data.body,
                })
                .returningAll()
                .executeTakeFirstOrThrow();
            // Log to the issue_events stream so the activity feed shows "X
            // added a comment" alongside status/assignee changes. The body
            // is stored in `detail` (truncated by eventsLog.record to 280
            // chars) so the activity-row preview reads like the
            // conversation, just shorter. actor_agent_id mirrors the
            // comment author: agent_id when an agent posted, null when the
            // owner did.
            await eventsLog.record(
                {
                    item_id: data.issue_id,
                    item_type: type,
                    event_type: 'comment_added',
                    actor_agent_id: data.agent_id ?? null,
                    detail: data.body,
                },
                trx,
            );
            return row;
        });
        return asComment(inserted as never, type);
    },

    async update(id: number, body: string): Promise<IComment | null> {
        // Each edit overwrites the body and stamps edited_at. The activity
        // feed already has the original "added a comment" event; we do NOT
        // log an "edited" event because the timestamp + pill on the comment
        // itself is the audit signal. (Adding a separate event would
        // multiply rows for every typo correction.)
        const updated = await db
            .updateTable('comments')
            .set({ body, edited_at: new Date().toISOString() })
            .where('id', '=', id)
            .where('deleted_at', 'is', null)
            .returningAll()
            .executeTakeFirst();
        if (!updated) return null;
        // FK constraint ensures item still exists; the `?? 'story'` arm is an unreachable defensive fallback.
        /* v8 ignore next */
        const type = (await lookupItemType(updated.item_id)) ?? 'story';
        return asComment(updated as never, type);
    },

    // P11 — soft-delete. Returns the row metadata for callers that want to
    // confirm what was deleted (id, item_id, author, agent_id, issue_type)
    // without re-reading the body. Already-deleted rows are treated as
    // not-found so a repeated DELETE returns 404 instead of silently
    // succeeding.
    async softDelete(id: number): Promise<{
        id: number;
        item_id: string;
        author: 'owner' | 'agent';
        agent_id: string | null;
        issue_type: IssueType;
    } | null> {
        const deleted = await db
            .updateTable('comments')
            .set({ deleted_at: new Date().toISOString() })
            .where('id', '=', id)
            .where('deleted_at', 'is', null)
            .returningAll()
            .executeTakeFirst();
        if (!deleted) return null;
        // FK constraint ensures item still exists; the `?? 'story'` arm is an unreachable defensive fallback.
        /* v8 ignore next */
        const type = (await lookupItemType(deleted.item_id)) ?? 'story';
        return {
            id: deleted.id,
            item_id: deleted.item_id,
            author: deleted.author,
            agent_id: deleted.agent_id,
            issue_type: type,
        };
    },

    // Read the raw row regardless of deleted_at — needed by the DELETE
    // route so it can verify the author + return 404 for already-deleted
    // rows separately from authorize-fails.
    async getRaw(id: number): Promise<{
        id: number;
        author: 'owner' | 'agent';
        agent_id: string | null;
        item_id: string;
        deleted_at: string | null;
    } | null> {
        const row = await db
            .selectFrom('comments')
            .select(['id', 'author', 'agent_id', 'item_id', 'deleted_at'])
            .where('id', '=', id)
            .executeTakeFirst();
        return row ?? null;
    },
};
