import type { Knex } from 'knex';

// Add optional human-attribution fields to `credentials` so github_app
// credentials can co-author commits + assign PRs to the human developer
// who drove the automation (matches the isw-CDM-Next/cdmnext-claude-bot
// playbook: bot is the primary commit author, human is credited via
// `Co-Authored-By:` trailer + PR `--assignee` + `Requested-By:` prefix
// in the PR body).
//
// All three are nullable — PAT credentials never use them, and a
// github_app credential without them falls back to bot-only attribution
// (the previous behaviour introduced in migrations 023/024).

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.credentials
            ADD COLUMN IF NOT EXISTS human_name text,
            ADD COLUMN IF NOT EXISTS human_email text,
            ADD COLUMN IF NOT EXISTS human_gh_login text;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.credentials
            DROP COLUMN IF EXISTS human_gh_login,
            DROP COLUMN IF EXISTS human_email,
            DROP COLUMN IF EXISTS human_name;
    `);
}
