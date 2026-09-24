import type { Knex } from 'knex';

// Backfill the verdicts migration 013 should have corrected.
//
// 013 added `skipped` to the allowed verdicts and taught the gate runner to
// record it. It did not touch the rows already in the table, and there were 82
// of them whose `output_tail` began `<id>: skipped - …` while `verdict` said
// `pass`.
//
// That is not a cosmetic inconsistency. It is exactly the lie the whole change
// exists to stop, and it was visible in the product the moment the run timeline
// shipped: a golden-set run showed `gate-coverage` in green as **passed**, with
// `skipped - no coverage script declared` printed directly underneath it. An
// Owner reading that page would conclude coverage had been checked.
//
// The match is deliberately the same shape the runner uses (`SKIPPED_RE` in
// `verification-gate.ts`): the first line, the script's own `: skipped` marker.
// A row that does not follow the convention keeps the verdict it has, because
// guessing at a project's custom output would be inventing evidence rather than
// correcting it.

/**
 * The first-line marker every shipped guardrail script prints for a no-op,
 * matching `SKIPPED_RE` in `verification-gate.ts`. Exported so the test
 * exercises this pattern rather than a copy of it that could drift.
 */
export const SKIPPED_MATCH = String.raw`^[^\n]*:[[:space:]]*skipped`;

export async function up(knex: Knex): Promise<void> {
    await knex.raw(
        `UPDATE run_gate_results
            SET verdict = 'skipped'
          WHERE verdict = 'pass'
            AND output_tail ~* ?`,
        [SKIPPED_MATCH],
    );
}

export async function down(knex: Knex): Promise<void> {
    // These rows were `pass` before 013 existed, so putting them back is the
    // honest reversal even though it restores the misleading value.
    await knex.raw(
        `UPDATE run_gate_results
            SET verdict = 'pass'
          WHERE verdict = 'skipped'
            AND output_tail ~* ?`,
        [SKIPPED_MATCH],
    );
}
