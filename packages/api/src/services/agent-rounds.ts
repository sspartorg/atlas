import { sql } from 'kysely';
import { db } from '../db/kysely-client.js';
import { eventsLog } from './events-log.js';
import { broadcastSSE } from '../routes/events.js';
import type { IssueType } from '@atlas/shared';

// Per-(item, agent) round counter. Under A04 every CLI invocation
// against (item_id, agent.id) counts as one round — performer leg,
// reviewer leg, or re-spawned performer retry all bump by 1. The
// `performer_agent_id` column name is historical (from Theme 06's
// paired-agent model); under the two-persona model it stores the
// agent's own id, since the same agent owns both personas.
//
// `agent-runner.completeRun` and `errorRun` call `incrementRound`
// AFTER the CLI completes (so a failed-to-spawn run never counts);
// the returned count is the AFTER-this-CLI value the routing
// decisions cap-check against `agents.max_rounds`.

export async function incrementRound(
    itemId: string,
    performerAgentId: string,
): Promise<number> {
    // UPSERT on (item_id, performer_agent_id) so the first bounce inserts
    // a count=1 row and subsequent bounces increment in place. UNIQUE
    // constraint on the pair (added by migration 008) makes the conflict
    // path deterministic.
    const row = await db
        .insertInto('agent_round_counts')
        .values({
            item_id: itemId,
            performer_agent_id: performerAgentId,
            count: 1,
        })
        .onConflict((oc) =>
            oc.columns(['item_id', 'performer_agent_id']).doUpdateSet({
                count: sql<number>`agent_round_counts.count + 1`,
                last_incremented_at: sql<string>`now()`,
            }),
        )
        .returning('count')
        .executeTakeFirstOrThrow();
    return row.count as unknown as number;
}

export async function getRound(
    itemId: string,
    performerAgentId: string,
): Promise<number> {
    const row = await db
        .selectFrom('agent_round_counts')
        .select('count')
        .where('item_id', '=', itemId)
        .where('performer_agent_id', '=', performerAgentId)
        .executeTakeFirst();
    return row ? Number(row.count) : 0;
}

// Called on chain completion (QA reviewer's on-pass to Owner) so the
// counters table doesn't grow unbounded. The CASCADE on the FK already
// cleans up on item delete; this is the success-path cleanup.
export async function resetRoundsForItem(itemId: string): Promise<void> {
    await db
        .deleteFrom('agent_round_counts')
        .where('item_id', '=', itemId)
        .execute();
}

export interface ResetRoundsForIssueResult {
    itemId: string;
    itemType: IssueType;
    assigneeAgentId: string | null;
    previousCount: number;
}

/**
 * Owner-facing escape hatch invoked by the "Reset rounds" popover on the
 * detail rail. Wraps `resetRoundsForItem` with:
 *   - the count-before snapshot (so the activity log records what was
 *     wiped — handy when the Owner is debugging cap escalations);
 *   - an `IIssueEvent` of type `rounds_reset` keyed on the item;
 *   - an SSE broadcast so the rail re-renders on every connected client.
 *
 * `actor_agent_id` is left null (meaning Owner) and `to_value` carries
 * the current assignee's id so the frontend can name them in the
 * activity-log rendering.
 *
 * Throws when the item id doesn't resolve so the route can 404 cleanly.
 */
export async function resetRoundsForIssue(
    itemId: string,
): Promise<ResetRoundsForIssueResult> {
    const item = await db
        .selectFrom('items')
        .select(['id', 'type', 'assignee_agent_id'])
        .where('id', '=', itemId)
        .executeTakeFirst();
    if (!item) throw new Error('Item not found');

    const before = item.assignee_agent_id
        ? await getRound(itemId, item.assignee_agent_id)
        : 0;

    await resetRoundsForItem(itemId);

    await eventsLog.record({
        item_id: itemId,
        item_type: item.type as IssueType,
        event_type: 'rounds_reset',
        actor_agent_id: null,
        from_value: String(before),
        to_value: item.assignee_agent_id,
    });

    broadcastSSE({
        type: 'counts_changed',
        issueType: item.type as IssueType,
        issueId: itemId,
    });

    return {
        itemId,
        itemType: item.type as IssueType,
        assigneeAgentId: item.assignee_agent_id,
        previousCount: before,
    };
}
