import type { Knex } from 'knex';

// A test stops being a coin flip somebody looked at once.
//
// An agent is stochastic. Phase 1 of ADR 0023 ran a test once and printed
// `passed` or `failed`, so a test that passes three times in five reported
// whichever of the two the Owner happened to press the button on — and
// `agent_test_runs` had no way to express "mostly". That is the single biggest
// thing standing between the Tests tab and meaning anything, and it is what
// watsonx Orchestrate's `n_runs` parameter exists for too.
//
// **Columns on the run, not a batch table.** A batch has no state a row does
// not already carry and would be derivable by `GROUP BY` the whole time; it
// would need its own lifecycle, its own terminal-status logic and its own
// cleanup, for data with none of those. The aggregate is computed on read, so
// it cannot go stale when one sample is re-judged.
//
// `label` is a free-text tag from the run request ("before-prompt-diet"). Two
// tags — this and `agent_tests.suite` later — are what answer "compare before
// and after" without a versions table.
//
// The judge columns land here rather than in their own migration because they
// are per-sample facts about the same row, and because `judge_cost_usd` has to
// be kept apart from `cost_usd` from the start: an expensive judge must never
// be able to fail a `max_cost_usd` expectation that is about the AGENT.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE agent_test_runs
            ADD COLUMN IF NOT EXISTS batch_id      text,
            ADD COLUMN IF NOT EXISTS sample_index  integer NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS label         text,
            ADD COLUMN IF NOT EXISTS judge_verdict text,
            ADD COLUMN IF NOT EXISTS judge_reason  text,
            ADD COLUMN IF NOT EXISTS judge_cost_usd numeric(12, 6)
    `);

    // Every run that already exists becomes a batch of one, so nothing
    // downstream needs a special case for "before sampling shipped".
    await knex.raw(`UPDATE agent_test_runs SET batch_id = id WHERE batch_id IS NULL`);
    await knex.raw(`ALTER TABLE agent_test_runs ALTER COLUMN batch_id SET NOT NULL`);

    await knex.raw(`
        ALTER TABLE agent_test_runs
            ADD CONSTRAINT agent_test_runs_judge_verdict_check
            CHECK (judge_verdict IS NULL OR judge_verdict = ANY (ARRAY['pass', 'fail', 'abstained']))
    `);
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS agent_test_runs_batch_idx ON agent_test_runs (batch_id, sample_index)`,
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP INDEX IF EXISTS agent_test_runs_batch_idx`);
    await knex.raw(`ALTER TABLE agent_test_runs DROP CONSTRAINT IF EXISTS agent_test_runs_judge_verdict_check`);
    await knex.raw(`
        ALTER TABLE agent_test_runs
            DROP COLUMN IF EXISTS batch_id,
            DROP COLUMN IF EXISTS sample_index,
            DROP COLUMN IF EXISTS label,
            DROP COLUMN IF EXISTS judge_verdict,
            DROP COLUMN IF EXISTS judge_reason,
            DROP COLUMN IF EXISTS judge_cost_usd
    `);
}
