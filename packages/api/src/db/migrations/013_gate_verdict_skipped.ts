import type { Knex } from 'knex';

// `skipped` joins the gate verdicts.
//
// Migration 011 recorded four: pass, fail, unavailable, needs_review. A script
// that exits 0 having done nothing — no coverage script declared, no browser
// installed, no UI files touched — was stored as `pass`, identical to a check
// that ran and was satisfied.
//
// That cost something real. On ATL-110 a red suite reached the end of a run
// behind four `pass` rows, two of which were skips; an LLM reviewer caught it,
// not the gate chain. And `gate-visual` reported a pass on the one golden-set
// fixture built to exercise it. In both cases the row said "skipped" in its
// output tail and `verdict` said `pass`, so nothing that queried the verdict
// could tell verified from not-checked.
//
// `skipped` still takes the pass edge — it is not a failure, per ADR 0020.
// It is only honest about what happened.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`ALTER TABLE run_gate_results DROP CONSTRAINT IF EXISTS run_gate_results_verdict_check`);
    await knex.raw(`
        ALTER TABLE run_gate_results
            ADD CONSTRAINT run_gate_results_verdict_check
            CHECK (verdict = ANY (ARRAY['pass', 'fail', 'skipped', 'unavailable', 'needs_review']))
    `);
}

export async function down(knex: Knex): Promise<void> {
    // Rows written as `skipped` have no home in the old four-value constraint,
    // and they were `pass` before this migration existed. Put them back rather
    // than letting the constraint fail to re-apply.
    await knex.raw(`UPDATE run_gate_results SET verdict = 'pass' WHERE verdict = 'skipped'`);
    await knex.raw(`ALTER TABLE run_gate_results DROP CONSTRAINT IF EXISTS run_gate_results_verdict_check`);
    await knex.raw(`
        ALTER TABLE run_gate_results
            ADD CONSTRAINT run_gate_results_verdict_check
            CHECK (verdict = ANY (ARRAY['pass', 'fail', 'unavailable', 'needs_review']))
    `);
}
