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
    /** The checker agent for a gate node, or `pre-push`. The scorecard groups on it. */
    script_id: string;
    /**
     * ADR 0024 — what Atlas actually ran. Absent when nothing ran (a skip, or a
     * repo with no verify command). Also the memo a fixer loop-back re-runs.
     */
    command?: string | null;
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
                command: input.command ?? null,
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

/** One gate verdict as the run timeline shows it. */
export interface RunGateResultRow {
    id: string;
    node_id: string | null;
    repo_id: string | null;
    repo_name: string | null;
    script_id: string;
    /** The command Atlas ran. Null on rows from before migration 020. */
    command: string | null;
    verdict: GateVerdict;
    exit_code: number | null;
    output_tail: string | null;
    created_at: string;
}

/**
 * Every gate verdict for a run, oldest first.
 *
 * Written since migration 011 and read, until now, by nothing but the eval
 * scorer — so the Owner could not see why a gate passed without querying
 * Postgres. That is how `gate-visual` reported a pass on the one golden-set
 * fixture built to exercise it: the row said `skipped - no UI files changed`
 * and nothing surfaced the row.
 */
export async function listGateResultsForRun(runId: string): Promise<RunGateResultRow[]> {
    const rows = await db
        .selectFrom('run_gate_results as g')
        .leftJoin('project_repos as r', 'r.id', 'g.repo_id')
        .select([
            'g.id',
            'g.node_id',
            'g.repo_id',
            'r.name as repo_name',
            'g.script_id',
            'g.command',
            'g.verdict',
            'g.exit_code',
            'g.output_tail',
            'g.created_at',
        ])
        .where('g.workflow_run_id', '=', runId)
        .orderBy('g.created_at', 'asc')
        .execute();
    return rows.map((r) => ({
        id: r.id,
        node_id: r.node_id ?? null,
        repo_id: r.repo_id ?? null,
        repo_name: r.repo_name ?? null,
        script_id: r.script_id,
        command: r.command ?? null,
        verdict: r.verdict as GateVerdict,
        exit_code: r.exit_code ?? null,
        output_tail: r.output_tail ?? null,
        // pg hands back a Date for timestamptz; the API speaks ISO strings.
        created_at: new Date(r.created_at as unknown as string).toISOString(),
    }));
}
