import type { IRunOutcome } from '@atlas/shared';

// ADR 0024 — what a gate step does with what its checker said.
//
// The sibling of `agent-runner-outcome-routing.ts`, and pure for the same
// reason: no DB, no SSE, no subprocess. The engine runs the command and parks
// the run; this file only decides which of those two happens, so the decision
// can be tested without a worktree.
//
// The bias is ADR 0020's, restated one level up. A gate's job is to produce
// EVIDENCE. A checker that answered nothing usable produced none, and absence
// of evidence parks with the Owner — it is never read as "nothing to check
// here". The one answer that closes the gate quietly is an explicit
// `applies: false`, which the checker must justify in its summary and which is
// recorded as `skipped`, not as a pass (migration 013).

export type GateCheckDecision =
    /** Run this command in each repo and route on its exit code. */
    | { kind: 'run'; command: string }
    /** The concern does not exist in this project. Records `skipped`, takes the pass edge. */
    | { kind: 'skip'; why: string }
    /** Nothing usable came back. Park with the Owner; never a pass, never a fail. */
    | { kind: 'park'; why: string };

export function decideCheckCommand(outcome: IRunOutcome | null): GateCheckDecision {
    // No parseable block at all. The same case `decideRunRouting` parks on, for
    // the same reason: a silent agent must never advance the chain.
    if (!outcome) return { kind: 'park', why: 'the checker did not report an outcome' };

    // A checker with a question has one for the Owner — it could not tell what
    // this project's check should be, which is exactly when a human is cheaper
    // than a guess.
    if (outcome.kind === 'asked_question') {
        return { kind: 'park', why: outcome.reason?.trim() || 'the checker asked a question' };
    }
    if (outcome.kind === 'rejected') {
        return { kind: 'park', why: outcome.reason?.trim() || 'the checker could not determine the check' };
    }

    if (outcome.applies === false) {
        return { kind: 'skip', why: outcome.summary?.trim() || 'the checker says this does not apply here' };
    }
    // Absent is not false. A checker that forgot the key told us nothing.
    if (outcome.applies !== true) {
        return { kind: 'park', why: 'the checker did not say whether this check applies here' };
    }

    const command = outcome.command?.trim();
    if (!command) {
        return { kind: 'park', why: 'the checker said the check applies but named no command to prove it' };
    }
    return { kind: 'run', command };
}
