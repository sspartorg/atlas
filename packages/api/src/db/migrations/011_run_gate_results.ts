import type { Knex } from 'knex';

// `run_gate_results` — one row per deterministic gate execution.
//
// ADR 0020 made Atlas run the verification gate itself instead of believing the
// agent's `atlas-outcome` checklist, which is what let campaign finding F-012
// happen: two PRs shipped with red suites while every reviewer reported green.
// But the verdict it produces has never been stored. `runVerificationGate`
// returns `pass | fail | unavailable`, `deliver()` turns a failure into prose in
// `workflow_runs.park_reason`, and the evidence stops there.
//
// Two things need it as a row rather than a sentence:
//
//   1. **The agent scorecard.** The one honest quality signal in the system is
//      "a machine check went red AFTER an agent reported done". Reconstructing
//      that from `park_reason` text is not something you can build a metric on.
//   2. **Gate steps** (the `gate` node type). A gate node routes on an exit code
//      and has no `agent_runs` row to record itself in, so without this table a
//      green gate would leave no trace that it ran at all.
//
// `node_id` is nullable on purpose: the pre-push verification gate runs inside
// `deliver()` and belongs to the run, not to any node. `repo_id` is nullable for
// the same shape reason — ADR 0017 runs the gate per repo, but a workspace-wide
// script has no single repo to name.
//
// `output_tail` holds the same 4000-char tail `verification-gate.ts` already
// clips and redacts; the full output stays in the run log, not here.

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        CREATE TABLE IF NOT EXISTS run_gate_results (
            id text PRIMARY KEY,
            workflow_run_id text NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
            node_id text,
            repo_id text,
            script_id text NOT NULL,
            verdict text NOT NULL,
            exit_code integer,
            output_tail text,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT run_gate_results_verdict_check
                CHECK (verdict = ANY (ARRAY['pass', 'fail', 'unavailable', 'needs_review']))
        )
    `);
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_run_gate_results_run
             ON run_gate_results (workflow_run_id, created_at)`
    );
    // The scorecard's hot query is "every gate verdict for this script across
    // runs", which reads by script and time, not by run.
    await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_run_gate_results_script
             ON run_gate_results (script_id, created_at)`
    );
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`DROP TABLE IF EXISTS run_gate_results`);
}
