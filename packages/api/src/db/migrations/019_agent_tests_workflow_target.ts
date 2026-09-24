import type { Knex } from 'knex';

// Workflow evals in the product (ADR 0023 phase 3, ATL-173).
//
// `evals/` measures the whole delivery chain — 12 fixtures, 257 dispatches,
// $129.30, 327 minutes on the v4 set — and every part of it is a CLI, a
// manifest path printed to a terminal, and a markdown file in a gitignored
// directory. Comparing two runs means opening two files side by side.
//
// **One primitive, not two.** ADR 0023 is explicit: "a fixture = an input item
// + a repo + expectations. Run it through one agent → qualification. Run it
// through a workflow → end-to-end eval. Same table, same expectations, same
// verdict." What actually differs is one branch in `run()` and four
// expectation keys. What is identical: the expectations jsonb, the verdict
// enum, the failures array, cost and duration, batching and sampling, the
// judge, and the entire tab UI. A sibling table would duplicate two tables,
// six service methods, six routes and the React tree to avoid one `if`.
//
// **No `target_kind` discriminator.** A third column alongside two nullable
// FKs is a third source of truth that can disagree with the other two. The
// CHECK makes "which one is null" the discriminator, and it cannot lie.
//
// `suite` is a tag, not an entity. Grouping is `GROUP BY`, and comparing two
// fleet versions is two reads filtered by `agent_test_runs.label`. A suite
// table earns itself when suite runs need their own lifecycle, not before.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE agent_tests ALTER COLUMN agent_id DROP NOT NULL`);
    await knex.raw(`
        ALTER TABLE agent_tests
            ADD COLUMN IF NOT EXISTS workflow_id text REFERENCES workflows(id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS suite text
    `);
    // Every existing row names an agent and no workflow, so this validates
    // without a backfill.
    await knex.raw(`
        ALTER TABLE agent_tests
            ADD CONSTRAINT agent_tests_one_target_check
            CHECK ((agent_id IS NOT NULL) <> (workflow_id IS NOT NULL))
    `);
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS agent_tests_workflow_idx ON agent_tests (workflow_id, created_at DESC)`,
    );
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS agent_tests_suite_idx ON agent_tests (suite) WHERE suite IS NOT NULL`,
    );

    // A workflow eval is judged on its whole run, not on one dispatch.
    await knex.raw(`
        ALTER TABLE agent_test_runs
            ADD COLUMN IF NOT EXISTS workflow_run_id text REFERENCES workflow_runs(id) ON DELETE SET NULL
    `);
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS agent_test_runs_workflow_run_idx
             ON agent_test_runs (workflow_run_id) WHERE workflow_run_id IS NOT NULL`,
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP INDEX IF EXISTS agent_test_runs_workflow_run_idx`);
    await knex.raw(`ALTER TABLE agent_test_runs DROP COLUMN IF EXISTS workflow_run_id`);
    await knex.raw(`DROP INDEX IF EXISTS agent_tests_suite_idx`);
    await knex.raw(`DROP INDEX IF EXISTS agent_tests_workflow_idx`);
    await knex.raw(`ALTER TABLE agent_tests DROP CONSTRAINT IF EXISTS agent_tests_one_target_check`);
    await knex.raw(`ALTER TABLE agent_tests DROP COLUMN IF EXISTS workflow_id, DROP COLUMN IF EXISTS suite`);
    await knex.raw(`ALTER TABLE agent_tests ALTER COLUMN agent_id SET NOT NULL`);
}
