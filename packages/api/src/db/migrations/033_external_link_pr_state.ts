import type { Knex } from 'knex';

// PR merge awareness — cache the last observed GitHub state of each
// pull_request external link so the UI can tell "PR open" from "PR merged"
// without a GitHub round-trip per render.
//
// `pr_state` is NULL until the first successful lookup (or forever for a
// project without a credential). `pr_state_checked_at` is stamped on every
// attempt, successful or not, so the read path's 5-minute staleness check
// throttles a failing lookup instead of retrying it on every list.
//
// CHECK, not an enum type — same reasoning as link_kind in 020.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.item_external_links
            ADD COLUMN pr_state text
                CONSTRAINT item_external_links_pr_state_check
                CHECK (pr_state IN ('open', 'merged', 'closed')),
            ADD COLUMN pr_state_checked_at timestamptz;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        ALTER TABLE public.item_external_links
            DROP COLUMN IF EXISTS pr_state_checked_at,
            DROP COLUMN IF EXISTS pr_state;
    `);
}
