import type { Knex } from 'knex';

// Catalog v1 baseline — clamp installed agents that sit above the new catalog.
//
// The shipped catalog carried development history into the release: agents were
// at v2/v3/v4 and `agent-code-reviewer` at v6. Every `manifest.json` is reset to
// version 1 in the same change, so a first-ever seed now reads "v1" the way a
// first release should.
//
// That reset is a DOWNGRADE for any database that already ran the old seed,
// and `seed.ts` upserts `marketplace_agents.version` unconditionally — there is
// no compare-and-bump. An agent installed at v6 therefore keeps
// `marketplace_pulled_version = 6` while the catalog drops to 1, and the gate
// in `services/marketplace.ts` is:
//
//     upgrade_available: installed_version < catalogVersion
//
// `6 < 1` is false, so the agent goes quiet. Worse, it STAYS quiet through the
// next five genuine bumps, because `6 < 2 … 6 < 6` are all false too. Nothing
// in the codebase detects or warns about a downgrade — upgrades would simply
// stop arriving, which is the dangerous shape of failure.
//
// So pull every catalog-linked pointer back to the new baseline. On a fresh
// install this matches zero rows and costs nothing; on an existing one it is
// the difference between working upgrades and silent deafness.
//
// Scoped to `marketplace_source_id IS NOT NULL` on purpose: a NULL source is
// the established "not installed from the catalog" sentinel (bundle imports set
// it deliberately, see `marketplace.ts` importBundle), and those rows must keep
// their null pointer rather than be dragged to 1.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `UPDATE agents
            SET marketplace_pulled_version = 1
          WHERE marketplace_source_id IS NOT NULL
            AND marketplace_pulled_version > 1`
    );
}

export async function down(): Promise<void> {
    // Deliberate no-op. The per-agent versions this clamped (3, 4, 6, …) are not
    // recoverable from the row itself, and leaving a pointer at 1 is harmless:
    // it under-reports rather than over-reports, so the worst case is one
    // redundant "upgrade available" that re-applies identical content.
}
