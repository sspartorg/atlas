import type { Knex } from 'knex';

// Audit 2026-06-09 — perf indexes (B1).
//
// Adds indexes on five FK columns the baseline left unindexed. Each
// supports a known query path:
//
//   - `comments.agent_id`        — "comments authored by this agent"
//     (analytics surface; agent-activity views).
//   - `issue_events.actor_agent_id` — agent activity timeline; the
//     reverse direction of `idx_issue_events_item`.
//   - `notifications.agent_id`   — notifications attributed to an
//     agent; future "notifications by agent" filter.
//   - `items.reporter_agent_id`  — analytics ("items reported by");
//     agent-handoff inference reads `reporter_agent_id`.
//   - `projects.credential_id`   — "all projects sharing this
//     credential" (credential delete cascade preview + Settings →
//     Credentials Remove button safety check).
//
// All five tables are small enough today that a btree on a 16-byte
// UUID is cheap. The risk is essentially zero on insert load
// (single-row INSERTs); the win is sequential-scan removal on the
// reverse-direction reads.
//
// Deliberately NOT included this round (composites only pay back at
// scale; single-column indexes + filter cover today's query plans):
//   - `agent_runs (agent_id, status)` composite.
//   - `agent_runs (project_id, status)` composite.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE INDEX IF NOT EXISTS idx_comments_agent
            ON public.comments USING btree (agent_id);

        CREATE INDEX IF NOT EXISTS idx_issue_events_actor_agent
            ON public.issue_events USING btree (actor_agent_id)
            WHERE actor_agent_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_notifications_agent
            ON public.notifications USING btree (agent_id)
            WHERE agent_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_items_reporter_agent
            ON public.items USING btree (reporter_agent_id)
            WHERE reporter_agent_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_projects_credential
            ON public.projects USING btree (credential_id)
            WHERE credential_id IS NOT NULL;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP INDEX IF EXISTS public.idx_comments_agent;
        DROP INDEX IF EXISTS public.idx_issue_events_actor_agent;
        DROP INDEX IF EXISTS public.idx_notifications_agent;
        DROP INDEX IF EXISTS public.idx_items_reporter_agent;
        DROP INDEX IF EXISTS public.idx_projects_credential;
    `);
}
