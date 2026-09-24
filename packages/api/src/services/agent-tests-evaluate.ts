import type { IRunOutcome } from '@atlas/shared';

import { decideRunRouting, type RequiredChecklistRow } from './agent-runner-outcome-routing.js';

// What a test asserts about a finished agent run (ADR 0023).
//
// Nothing here is new machinery. Every routed agent ends with an
// `atlas-outcome` block, and `decideRunRouting` — the same pure function the
// workflow engine routes on — already turns that block plus the agent's
// required checklist into a verdict. A test asserts against that, so a test and
// the engine can never disagree about what an agent did.
//
// Kept separate from the service that reads the database so the judgement is
// testable without one.

export interface AgentTestExpectations {
    /**
     * What the agent should have concluded.
     *
     * `asked_question` is a first-class expectation, not a fallback. An agent
     * that asks rather than inventing a feature from an unanswerable Task has
     * succeeded — that is the whole point of the `ambiguous-must-escalate`
     * fixture — and a framework that can only assert success cannot say so.
     */
    outcome_kind?: IRunOutcome['kind'] | undefined;
    /** Every `required` checklist row reported passed. */
    required_checklist_all_passed?: boolean | undefined;
    /** Case-insensitive substrings the summary must contain. */
    summary_contains?: string[] | undefined;
    /** Case-insensitive substrings the summary must NOT contain. */
    summary_omits?: string[] | undefined;
    max_cost_usd?: number | undefined;
    max_duration_s?: number | undefined;
}

export interface AgentTestObservation {
    /** Null when the agent produced no parseable outcome block. */
    outcome: IRunOutcome | null;
    requiredChecklist: RequiredChecklistRow[];
    cost_usd: number | null;
    duration_s: number | null;
    /** False when the dispatch itself failed — a crash, a timeout, a bad CLI. */
    ran: boolean;
}

export interface AgentTestEvaluation {
    verdict: 'passed' | 'failed' | 'errored';
    failures: string[];
}

function has(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

export function evaluateAgentTest(
    expectations: AgentTestExpectations,
    obs: AgentTestObservation,
): AgentTestEvaluation {
    // A dispatch that never ran is not a failing agent — it is a broken test
    // environment, and reporting it as `failed` would blame the agent for a
    // missing CLI binary. Same distinction ADR 0020 draws for a gate that
    // could not run.
    if (!obs.ran) {
        return { verdict: 'errored', failures: ['the agent run did not complete'] };
    }

    const failures: string[] = [];

    if (expectations.outcome_kind) {
        const actual = obs.outcome?.kind ?? 'none';
        if (actual !== expectations.outcome_kind) {
            failures.push(`expected outcome \`${expectations.outcome_kind}\`, got \`${actual}\``);
        }
    }

    if (expectations.required_checklist_all_passed) {
        // Replayed rather than re-derived: `decideRunRouting` is what the
        // engine itself uses, and an empty required checklist makes `done` an
        // automatic pass there (finding F-012). A test asserting the checklist
        // on an agent that has none would otherwise pass vacuously, so say so.
        if (obs.requiredChecklist.length === 0) {
            failures.push('required_checklist_all_passed is set but this agent has no required checklist rows');
        } else {
            const decision = decideRunRouting({
                outcome: obs.outcome,
                requiredChecklist: obs.requiredChecklist,
            });
            // `apply_on_fail` covers two different things: the agent rejected
            // the work, and the agent said `done` but left a required row
            // unticked. Only the second is a checklist failure, and the engine
            // labels it — so match the label rather than the kind, or a test
            // expecting `rejected` would report a phantom checklist failure.
            if (decision.detail?.startsWith('checklist_failed:')) {
                failures.push(`a required checklist row was not passed (${decision.detail})`);
            }
        }
    }

    const summary = obs.outcome?.summary ?? '';
    for (const needle of expectations.summary_contains ?? []) {
        if (!has(summary, needle)) failures.push(`summary does not mention "${needle}"`);
    }
    for (const needle of expectations.summary_omits ?? []) {
        if (has(summary, needle)) failures.push(`summary mentions "${needle}" and should not`);
    }

    if (expectations.max_cost_usd != null && obs.cost_usd != null && obs.cost_usd > expectations.max_cost_usd) {
        failures.push(`cost $${obs.cost_usd.toFixed(4)} exceeded the $${expectations.max_cost_usd} ceiling`);
    }
    if (
        expectations.max_duration_s != null &&
        obs.duration_s != null &&
        obs.duration_s > expectations.max_duration_s
    ) {
        failures.push(`took ${obs.duration_s}s, over the ${expectations.max_duration_s}s ceiling`);
    }

    return { verdict: failures.length === 0 ? 'passed' : 'failed', failures };
}
