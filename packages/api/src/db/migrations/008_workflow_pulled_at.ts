import type { Knex } from 'knex';

// `workflows.marketplace_pulled_at` — when this workflow last took its upstream.
//
// Upgrading a workflow means replacing its graph with the source's, so the same
// rule that governs agent upgrades has to govern these: never throw away work
// the Owner did. Agents can answer "has the Owner edited this?" from
// `agent_prompt_versions.edited_by`; workflows have no such history.
//
// `updated_at` alone is not enough. There is a `workflows_set_updated_at`
// trigger, so it does move on every edit — but it also moves when the UPGRADE
// itself writes, which would make every upgraded workflow look Owner-edited
// from then on and freeze it permanently. That is exactly the trap a
// `prompt_version === 1` check falls into on the agent side.
//
// So record when the upstream was last taken. "Untouched since pull" is then
// `updated_at <= marketplace_pulled_at`, which stays correct across any number
// of upgrades because the upgrade sets both in the same statement.
//
// Nullable, like the other two provenance columns: a hand-built workflow has no
// upstream and no pull to date.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `ALTER TABLE workflows ADD COLUMN IF NOT EXISTS marketplace_pulled_at timestamp with time zone`
    );
    // Rows that already carry provenance were created by an import before this
    // column existed and have not been edited since, so their creation IS their
    // pull. Without this they would all read as "edited" and never upgrade.
    await knex.raw(
        `UPDATE workflows
            SET marketplace_pulled_at = updated_at
          WHERE marketplace_source_id IS NOT NULL
            AND marketplace_pulled_at IS NULL`
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE workflows DROP COLUMN IF EXISTS marketplace_pulled_at`);
}
