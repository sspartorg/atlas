import type { Knex } from 'knex';

// `workflow_runs.pr_urls` — every pull request a run opened, not just the first.
//
// ADR 0017/0018 made one Task span several repos, and `deliver`
// (`services/workflow-engine.ts`) opens one PR per repo it changed. It then
// recorded `opened[0].url` and dropped the rest: `result.prUrl =
// opened[0]?.url ?? null`. The full set survived only in `item_external_links`,
// which is keyed by item and carries no workflow-run reference, so the Workflow
// Runs table could not recover it — a two-repo run linked one PR and silently
// omitted the other (campaign finding F-018).
//
// `pr_url` stays exactly as it was. Agents read it (the Automation reviewer
// checks the dev PR is merged) and `items.pr_url` mirrors it, so narrowing it
// to "the first PR" keeps every existing consumer correct. `pr_urls` is the
// complete ordered list, first entry equal to `pr_url` whenever one exists.
//
// jsonb rather than text[]: it matches `items.repo_ids` and `items.labels`,
// which already store string lists this way, and Kysely maps it without a
// dialect-specific array codec.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS pr_urls jsonb NOT NULL DEFAULT '[]'::jsonb`
    );
    // Backfill so historical rows are self-consistent rather than claiming a
    // run opened no PRs when `pr_url` says otherwise.
    await knex.raw(
        `UPDATE workflow_runs SET pr_urls = jsonb_build_array(pr_url) WHERE pr_url IS NOT NULL AND pr_urls = '[]'::jsonb`
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE workflow_runs DROP COLUMN IF EXISTS pr_urls`);
}
