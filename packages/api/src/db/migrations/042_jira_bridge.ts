import type { Knex } from 'knex';

// Jira bridge (ADR 0016). `jira_config` is a singleton: one Jira site, one
// JQL, one target project. `jira_issues` is the per-issue sync state; the
// Jira key is the primary key so an issue is imported once, ever. item_id is
// SET NULL (not CASCADE) so a Task the Owner deletes is never re-imported.
//
// The comment-id arrays are what stop the echo loop: seen = Jira comments
// already reflected in Atlas, posted = Jira comments the bridge wrote (never
// imported, never shown in the Task description), imported = Atlas comments
// that came from Jira (never posted back).

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE TABLE public.jira_config (
            id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            enabled boolean NOT NULL DEFAULT false,
            site_url text,
            email text,
            api_token_encrypted text,
            jql text,
            project_id text REFERENCES public.projects(id) ON DELETE SET NULL,
            poll_interval_minutes integer NOT NULL DEFAULT 60 CHECK (poll_interval_minutes >= 5),
            extra_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
            label_workflows jsonb NOT NULL DEFAULT '[]'::jsonb,
            last_sync_at timestamp with time zone,
            last_sync_ok boolean,
            last_sync_message text,
            updated_at timestamp with time zone NOT NULL DEFAULT now()
        );
        INSERT INTO public.jira_config (id) VALUES (1);

        CREATE TABLE public.jira_issues (
            jira_key text PRIMARY KEY,
            item_id text UNIQUE REFERENCES public.items(id) ON DELETE SET NULL,
            jira_id text NOT NULL,
            url text NOT NULL,
            raw jsonb NOT NULL,
            jira_updated_at timestamp with time zone,
            seen_comment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            posted_comment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            imported_comment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            pushed_comment_id bigint NOT NULL DEFAULT 0,
            pushed_status text,
            done_synced_at timestamp with time zone,
            created_at timestamp with time zone NOT NULL DEFAULT now()
        );

        ALTER TABLE public.item_external_links
            DROP CONSTRAINT item_external_links_link_kind_check,
            ADD CONSTRAINT item_external_links_link_kind_check
                CHECK (link_kind IN ('pull_request', 'jira_issue'));
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DELETE FROM public.item_external_links WHERE link_kind = 'jira_issue';
        ALTER TABLE public.item_external_links
            DROP CONSTRAINT item_external_links_link_kind_check,
            ADD CONSTRAINT item_external_links_link_kind_check
                CHECK (link_kind IN ('pull_request'));
        DROP TABLE IF EXISTS public.jira_issues;
        DROP TABLE IF EXISTS public.jira_config;
    `);
}
