import type { Knex } from 'knex';

// A fixture belongs to the agent, not to a project.
//
// ADR 0023 shipped `agent_tests.project_id NOT NULL`, and its own consequences
// section drew the conclusion: a catalog bundle has no project, so a shipped
// fixture "cannot be a row at install time" and had to arrive as a template the
// Owner adopts by hand. The result is the thing the Owner actually sees — every
// agent page reads "No tests yet", on a fleet where 8 of 24 agents ship a
// fixture and nobody has clicked Add. Eight templates and zero tests look
// identical to no testing at all, and are not far off it.
//
// So the fixture becomes agent-scoped at rest and binds to a project when it
// runs (`POST /run` body, else the fixture's own `project_id`, else a 400).
// Nothing is guessed: a fixture materialises a REAL item that takes a real
// `ATL-nnn` from the project counter, and picking the project for the Owner
// would spend money in the wrong one.
//
// The two extra columns are what make auto-adoption honest rather than
// clever:
//
//   `source_test_id` — the `tests.json` entry this row came from. Adoption
//   runs at install, on every boot and on upgrade, so it needs a key to be
//   idempotent against. Null means the Owner wrote this fixture themselves.
//
//   `source_hash`    — the bundle's body at adoption time. Re-hashing the row
//   says whether the Owner has edited it since, which is the same
//   `marketplace_upgradable_hash` posture agents already use: an untouched
//   fixture upgrades with the bundle, an edited one is frozen and says so.
//   A boolean would be a claim; a hash is evidence.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE agent_tests ALTER COLUMN project_id DROP NOT NULL`);
    await knex.raw(`
        ALTER TABLE agent_tests
            ADD COLUMN IF NOT EXISTS source_test_id text,
            ADD COLUMN IF NOT EXISTS source_hash text
    `);
    // One adopted copy per shipped fixture per agent. Partial, so the Owner can
    // write as many of their own as they like.
    await knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS agent_tests_source_idx
            ON agent_tests (agent_id, source_test_id)
            WHERE source_test_id IS NOT NULL
    `);

    // Each run records the configuration it ran against, which is what makes
    // "this suite passed, but not on the prompt you are running now" answerable
    // without a second table. `agent_runs` already snapshots cli/model/effort/
    // prompt_version per dispatch; this is the join key for the newest one.
    await knex.raw(`
        CREATE INDEX IF NOT EXISTS agent_test_runs_agent_run_idx
            ON agent_test_runs (agent_run_id) WHERE agent_run_id IS NOT NULL
    `);
}

export async function down(knex: Knex): Promise<void> {
    // Agent-scoped fixtures have no home in the old shape: `project_id NOT
    // NULL` is exactly what this migration removed, so rows created under it
    // cannot survive the reversal. Stated plainly rather than silently binding
    // them to an arbitrary project.
    await knex.raw(`DELETE FROM agent_tests WHERE project_id IS NULL`);
    await knex.raw(`DROP INDEX IF EXISTS agent_test_runs_agent_run_idx`);
    await knex.raw(`DROP INDEX IF EXISTS agent_tests_source_idx`);
    await knex.raw(`
        ALTER TABLE agent_tests
            DROP COLUMN IF EXISTS source_test_id,
            DROP COLUMN IF EXISTS source_hash
    `);
    await knex.raw(`ALTER TABLE agent_tests ALTER COLUMN project_id SET NOT NULL`);
}
