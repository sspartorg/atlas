import { randomUUID } from 'node:crypto';
import { db } from '../db/kysely-client.js';
import type { GateVerdict } from '../db/types.js';

// Migration 011 — persist what a deterministic gate decided.
//
// ADR 0020 moved the test-suite verdict from the agent's self-report to Atlas's
// own exit code, but the answer was never stored: `deliver()` turns a failure
// into prose in `workflow_runs.park_reason` and a pass into a line in the
// delivery log. Neither is queryable, so the single most honest quality signal
// in the system — "a machine check went red AFTER an agent reported done" —
// could not be measured.
//
// Recording is best-effort by design. A gate verdict is evidence about the run,
// not part of it; failing to write the audit row must never turn a green gate
// into a parked run. The caller therefore gets `void` and never an exception.

export interface RecordGateResultInput {
    workflow_run_id: string;
    /** Null for the pre-push verification gate, which belongs to the run, not a node. */
    node_id?: string | null;
    /** Null for a workspace-wide script with no single repo to name. */
    repo_id?: string | null;
    script_id: string;
    verdict: GateVerdict;
    exit_code?: number | null;
    /** Already clipped and secret-redacted by the caller. */
    output_tail?: string | null;
}

export async function recordGateResult(input: RecordGateResultInput): Promise<void> {
    try {
        await db
            .insertInto('run_gate_results')
            .values({
                id: randomUUID(),
                workflow_run_id: input.workflow_run_id,
                node_id: input.node_id ?? null,
                repo_id: input.repo_id ?? null,
                script_id: input.script_id,
                verdict: input.verdict,
                exit_code: input.exit_code ?? null,
                output_tail: input.output_tail ?? null,
            })
            .execute();
    } catch (err) {
        // Deliberately swallowed — see the header. Logged so a systematically
        // broken audit trail is still visible in the API log.
        console.warn(`[run-gate-results] could not record ${input.script_id}:`, err);
    }
}
