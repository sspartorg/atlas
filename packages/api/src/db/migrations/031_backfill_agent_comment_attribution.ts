import type { Knex } from 'knex';

// Data repair — agent comments and activity events written without an
// author.
//
// The MCP `update_item({action:'add_comment'})` path resolves the calling
// agent from `ATLAS_AGENT_ID`, which nothing in the repo ever sets: the MCP
// is hosted in-process on one shared loopback port for every agent
// (`plugins/mcp-host.ts` hardcodes `boundAgentId: ''`). The only other
// source was an OPTIONAL tool argument the model frequently omitted, and
// `CreateCommentSchema` defaulted it to null without complaint. The result:
//
//   * `comments.agent_id IS NULL` renders as the literal string "Agent" in
//     the activity feed (ActivityCard.tsx).
//   * `issue_events.actor_agent_id IS NULL` is read as "the Owner did this",
//     so agent actions were attributed to the human.
//
// `commentsService.create` now resolves the author from the item's live run
// at write time. This migration repairs rows written before that fix.
//
// Attribution rule: a row is only repaired when EXACTLY ONE distinct agent
// had a run open on that item at the row's `created_at`
// (`started_at <= created_at <= COALESCE(completed_at, now())`). Ambiguous
// and unmatched rows are deliberately left NULL — a wrong name in an audit
// trail is worse than a missing one.
//
// Irreversible by design: `down()` cannot tell a backfilled value from one
// the runner wrote correctly, so it is a no-op rather than a re-null that
// would destroy good data.

const BACKFILL_COMMENTS = `
    WITH candidate AS (
        SELECT c.id,
               MIN(r.agent_id)            AS agent_id,
               COUNT(DISTINCT r.agent_id) AS agent_count
          FROM comments c
          JOIN agent_runs r
            ON r.item_id = c.item_id
           AND r.started_at <= c.created_at
           AND COALESCE(r.completed_at, now()) >= c.created_at
         WHERE c.author = 'agent'
           AND c.agent_id IS NULL
         GROUP BY c.id
    )
    UPDATE comments c
       SET agent_id = candidate.agent_id
      FROM candidate
     WHERE c.id = candidate.id
       AND candidate.agent_count = 1
`;

const BACKFILL_EVENTS = `
    WITH candidate AS (
        SELECT e.id,
               MIN(r.agent_id)            AS agent_id,
               COUNT(DISTINCT r.agent_id) AS agent_count
          FROM issue_events e
          JOIN agent_runs r
            ON r.item_id = e.item_id
           AND r.started_at <= e.created_at
           AND COALESCE(r.completed_at, now()) >= e.created_at
         WHERE e.event_type = 'comment_added'
           AND e.actor_agent_id IS NULL
         GROUP BY e.id
    )
    UPDATE issue_events e
       SET actor_agent_id = candidate.agent_id
      FROM candidate
     WHERE e.id = candidate.id
       AND candidate.agent_count = 1
`;

export async function up(knex: Knex): Promise<void> {
    await knex.raw(BACKFILL_COMMENTS);
    await knex.raw(BACKFILL_EVENTS);
}

export async function down(): Promise<void> {
    // No-op. See the header: a backfilled agent_id is indistinguishable
    // from one written correctly, so rolling back would null out valid
    // attribution alongside the repair.
}
