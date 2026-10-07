import type { Knex } from 'knex';

// Team config sync: one install publishes its projects' configuration to a git
// repo, the others pull it in. `team_config` is the singleton connection (like
// `jira_config`); `team_managed` marks the rows that belong to the repo, so a
// pull overwrites those and never touches what the Owner made locally.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE public.team_config (
            id integer DEFAULT 1 NOT NULL PRIMARY KEY CHECK (id = 1),
            role text DEFAULT 'off' NOT NULL CHECK (role IN ('off', 'publisher', 'subscriber')),
            repo_url text,
            credential_id text REFERENCES public.credentials(id) ON DELETE SET NULL,
            branch text DEFAULT 'main' NOT NULL,
            interval_minutes integer DEFAULT 60 NOT NULL CHECK (interval_minutes >= 5),
            last_sync_at timestamp with time zone,
            last_sync_ok boolean,
            last_sync_message text,
            last_commit text,
            updated_at timestamp with time zone DEFAULT now() NOT NULL
        )
    `);
    for (const t of ['projects', 'agents', 'workflows']) {
        await knex.raw(`ALTER TABLE public.${t} ADD COLUMN team_managed boolean DEFAULT false NOT NULL`);
    }
}

export async function down(knex: Knex): Promise<void> {
    for (const t of ['projects', 'agents', 'workflows']) {
        await knex.raw(`ALTER TABLE public.${t} DROP COLUMN IF EXISTS team_managed`);
    }
    await knex.raw('DROP TABLE IF EXISTS public.team_config');
}
