import { db } from '../db/kysely-client.js';
import { eventsLog } from './events-log.js';
import type { IssueType } from '@atlas/shared';

// One-shot history cleanup for a single item. Hard-deletes every AGENT-
// authored `comments` row and every `issue_events` row on the item whose
// `created_at` is strictly less than the supplied cutoff. Owner-authored
// comments (`author='owner'`) are PRESERVED — they carry Owner intent
// and must not be destroyed by an MCP-driven prune.
//
// Both deletes plus an audit `history_pruned` event run in one
// transaction so a partial failure never leaves the tables inconsistent
// and the audit row is always paired with the deletions it records.
// The audit row's own `created_at` is set to NOW() at commit time so it
// is later than every deleted row and therefore not itself pruned.
//
// Intended caller: agents pruning their own historical noise via the
// MCP `update_item` action `remove_history`. Not exposed to any Owner-
// facing UI — the Web app has per-row soft-delete for comments only and
// no delete for `issue_events`.

export const historyPruneService = {
    async pruneBefore(
        itemId: string,
        itemType: IssueType,
        beforeTime: string,
        actorAgentId: string | null,
    ): Promise<{ comments_deleted: number; events_deleted: number; owner_comments_preserved: number }> {
        return db.transaction().execute(async (trx) => {
            // Count Owner-authored comments that would fall inside the
            // cutoff window BUT are being preserved, so the audit event
            // records the mitigation and Owners can verify their content
            // wasn't touched.
            const preservedRow = await trx
                .selectFrom('comments')
                .select((eb) => eb.fn.countAll<string>().as('count'))
                .where('item_id', '=', itemId)
                .where('created_at', '<', beforeTime)
                .where('author', '=', 'owner')
                .executeTakeFirst();
            const ownerCommentsPreserved = Number(preservedRow?.count ?? 0);

            const commentRows = await trx
                .deleteFrom('comments')
                .where('item_id', '=', itemId)
                .where('created_at', '<', beforeTime)
                .where('author', '!=', 'owner')
                .returning('id')
                .execute();
            const eventRows = await trx
                .deleteFrom('issue_events')
                .where('item_id', '=', itemId)
                .where('created_at', '<', beforeTime)
                .returning('id')
                .execute();

            // Audit row inside the same transaction so it's never
            // orphaned from the deletions it records. Uses eventsLog
            // via the trx to share the connection.
            await eventsLog.record(
                {
                    item_id: itemId,
                    item_type: itemType,
                    event_type: 'history_pruned',
                    actor_agent_id: actorAgentId,
                    field: null,
                    from_value: beforeTime,
                    to_value: String(commentRows.length + eventRows.length),
                    detail:
                        ownerCommentsPreserved > 0
                            ? `${ownerCommentsPreserved} owner comment(s) preserved`
                            : null,
                },
                trx,
            );

            return {
                comments_deleted: commentRows.length,
                events_deleted: eventRows.length,
                owner_comments_preserved: ownerCommentsPreserved,
            };
        });
    },
};
