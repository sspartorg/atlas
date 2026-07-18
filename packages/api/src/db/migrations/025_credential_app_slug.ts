import type { Knex } from 'knex';

// Add `app_slug` to `credentials` so `buildGitConfig` can compose
// `git config user.name = <slug>[bot]` and
// `git config user.email = <app_id>+<slug>[bot]@users.noreply.github.com`
// for `github_app` credentials. Without a stable slug the auth token lets
// the bot push, but commits are still attributed to whoever's git config
// happens to be in effect at commit time (usually the developer).
//
// The value is populated three ways, in order of preference:
//   1. On create, from `slug` in `app-config.json` inside the bot folder.
//   2. On the next mint/refresh for any row where it's still null, via
//      `GET /app` (see `refreshCredential` in `github-app-tokens.ts`).
//   3. Manually — the operator can UPDATE the row in the DB if needed.
//
// PAT rows leave the column null; the field is only meaningful for
// `kind = 'github_app'`.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.credentials
            ADD COLUMN IF NOT EXISTS app_slug text;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.credentials
            DROP COLUMN IF EXISTS app_slug;
    `);
}
