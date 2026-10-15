import type { Knex } from 'knex';

// The title and description the Jira bridge last wrote into each linked Task.
// A refresh compares the Task against these: if the Owner edited a field in
// Atlas, it differs, and the bridge leaves that field alone instead of
// overwriting it with Jira's text. Null for rows linked before this column;
// the bridge rebuilds the old text from `raw` for those.

export async function up(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.jira_issues ADD COLUMN IF NOT EXISTS synced_title text');
    await knex.raw('ALTER TABLE public.jira_issues ADD COLUMN IF NOT EXISTS synced_description text');
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw('ALTER TABLE public.jira_issues DROP COLUMN IF EXISTS synced_title');
    await knex.raw('ALTER TABLE public.jira_issues DROP COLUMN IF EXISTS synced_description');
}
