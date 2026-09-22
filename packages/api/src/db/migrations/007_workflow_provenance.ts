import type { Knex } from 'knex';

// Workflow provenance — give workflows the back-link agents have always had.
//
// `agents` carries `marketplace_source_id` + `marketplace_pulled_version`
// (001_baseline.sql:248-249, plus an index on the source id), and that pair is
// what makes the whole upgrade story work: `services/marketplace.ts` gates
// `upgrade_available` on `installed_version < catalogVersion`, and
// `acceptUpgrade` advances the pointer.
//
// `workflows` had no equivalent — not one column. A workflow created from a
// marketplace template was a detached copy the moment it was written:
// `createFromTemplate` passes ten fields to `create()` and drops the template
// id on the floor. So when an upstream template improved there was no way to
// find out, let alone pull it. The same held for published entries.
//
// `published_workflows` gets a `version` too. Republishing currently overwrites
// the stored bundle in place with no history at all, so a consumer who used an
// entry yesterday has no way to tell it changed today. A monotonic counter the
// publisher bumps is the smallest thing that makes "this entry moved" visible;
// it is deliberately not a content hash, because the catalog already learned
// that lesson — a hash that moves on cosmetic edits produces upgrade banners
// with nothing to apply (see the note on `syncMarketplaceCatalog` in seed.ts).
//
// Both workflow columns are nullable on purpose. NULL is the established
// "not from a marketplace source" sentinel on the agents side, and hand-built
// workflows must keep it: they are not stale, they simply have no upstream.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE workflows ADD COLUMN IF NOT EXISTS marketplace_source_id text`);
    await knex.raw(
        `ALTER TABLE workflows ADD COLUMN IF NOT EXISTS marketplace_pulled_version integer`
    );
    // Mirrors idx_agents_marketplace_source_id. Every import resolves
    // "do I already have this template?" through this column now that it no
    // longer matches on workflow NAME, so it is a lookup key, not a label.
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_workflows_marketplace_source_id
             ON workflows (marketplace_source_id)`
    );
    await knex.raw(
        `ALTER TABLE published_workflows ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP INDEX IF EXISTS idx_workflows_marketplace_source_id`);
    await knex.raw(`ALTER TABLE workflows DROP COLUMN IF EXISTS marketplace_source_id`);
    await knex.raw(`ALTER TABLE workflows DROP COLUMN IF EXISTS marketplace_pulled_version`);
    await knex.raw(`ALTER TABLE published_workflows DROP COLUMN IF EXISTS version`);
}
