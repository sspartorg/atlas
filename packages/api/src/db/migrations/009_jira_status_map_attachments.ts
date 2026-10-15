import type { Knex } from 'knex';

// Jira bridge v2.
// - projects.jira_status_map: per project, which Jira status names mean each
//   Atlas status ({ draft: [...], ready: [...], ... }). Null = unmapped, and
//   the bridge behaves as before (Jira status ignored).
// - jira_attachments: files downloaded from a linked Jira issue, served from
//   Atlas and staged for agents. Keyed by Jira's attachment id so each file is
//   fetched once.

export async function up(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS jira_status_map jsonb');
    await knex.raw(`
        CREATE TABLE IF NOT EXISTS public.jira_attachments (
            id text PRIMARY KEY,
            jira_key text NOT NULL,
            item_id text REFERENCES public.items(id) ON DELETE CASCADE,
            filename text NOT NULL,
            mime_type text NOT NULL DEFAULT 'application/octet-stream',
            size bigint NOT NULL DEFAULT 0,
            path text,
            skipped_reason text,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    `);
    await knex.raw('CREATE INDEX IF NOT EXISTS jira_attachments_item_idx ON public.jira_attachments (item_id)');
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('DROP TABLE IF EXISTS public.jira_attachments');
    await knex.raw('ALTER TABLE public.projects DROP COLUMN IF EXISTS jira_status_map');
}
