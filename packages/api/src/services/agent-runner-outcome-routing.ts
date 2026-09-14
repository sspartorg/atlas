import type { IRunOutcome } from '@atlas/shared';

// Task 12 — single decision function for every agent run completion.
// Replaces both `decidePerformerCompletionRouting` and the reviewer-only
// routing branches the runner used to carry. Inputs come from the
// parser (`parseRunOutcome`) and the load of the agent's required
// `agent_checklists` rows; output drives the runner's choice between
// applying the on-pass handoff, applying the on-fail handoff, or
// parking the item with the Owner.
//
// Pure function. No DB, no SSE, no side effects.

type RoutingKind = 'apply_on_pass' | 'apply_on_fail' | 'park_waiting_for_info';

export interface RoutingDecision {
    kind: RoutingKind;
    /** Short reason fragment recorded as the issue_events.detail. */
    detail?: string;
}

interface RequiredChecklistRow {
    id: number;
    label: string;
}

export interface DecideRunRoutingInput {
    /**
     * The parsed `atlas-outcome` block from the agent's CLI output.
     * `null` when no parseable block was found — treated as a silent
     * agent that never advances the chain (item parks with the Owner).
     */
    outcome: IRunOutcome | null;
    /**
     * Rows from `agent_checklists` for this agent where `required = true`.
     * Empty array (autonomous agents, reviewers without per-item checks)
     * skips checklist verification entirely.
     */
    requiredChecklist: RequiredChecklistRow[];
}

/**
 * Decide how the orchestrator should route the item after the agent's
 * CLI exits.
 *
 *   outcome=null                       → park (`agent_did_not_signal_outcome`)
 *   outcome.kind=`asked_question`      → park (`agent_asked_question`)
 *   outcome.kind=`rejected`            → on-fail (reason becomes the detail)
 *   outcome.kind=`done` + no checklist → on-pass
 *   outcome.kind=`done` + checklist OK → on-pass
 *   outcome.kind=`done` + checklist FAIL → on-fail (`checklist_failed: …`)
 */
export function decideRunRouting(input: DecideRunRoutingInput): RoutingDecision {
    const outcome = input.outcome;
    if (outcome === null) {
        return { kind: 'park_waiting_for_info', detail: 'agent_did_not_signal_outcome' };
    }
    if (outcome.kind === 'asked_question') {
        const base = 'agent_asked_question';
        const detail = outcome.reason
            ? `${base}: ${truncate(outcome.reason, 200)}`
            : base;
        return { kind: 'park_waiting_for_info', detail };
    }
    if (outcome.kind === 'rejected') {
        const base = 'rejected';
        const detail = outcome.reason
            ? `${base}: ${truncate(outcome.reason, 200)}`
            : base;
        return { kind: 'apply_on_fail', detail };
    }
    // outcome.kind === 'done'
    if (input.requiredChecklist.length === 0) {
        return { kind: 'apply_on_pass' };
    }
    const passedIds = new Set<number>();
    if (outcome.checklist) {
        for (const item of outcome.checklist) {
            if (item.passed) passedIds.add(item.id);
        }
    }
    const failedLabels: string[] = [];
    for (const row of input.requiredChecklist) {
        if (!passedIds.has(row.id)) failedLabels.push(row.label);
    }
    if (failedLabels.length === 0) {
        return { kind: 'apply_on_pass' };
    }
    return {
        kind: 'apply_on_fail',
        detail: `checklist_failed: ${truncate(failedLabels.join(', '), 200)}`,
    };
}

export interface ShouldOpenPullRequestInput {
    /** Item status read right after the CLI exits; null for project-scope runs. */
    itemStatus: string | null;
    outcome: IRunOutcome | null;
}

/**
 * PR creation runs before post-run routing, so a zero exit code alone
 * can't tell an approval from a rejection: reviewers reject by parking
 * the item via MCP and still exit 0. Open a PR only when the run
 * actually moved the work forward.
 */
export function shouldOpenPullRequest(input: ShouldOpenPullRequestInput): boolean {
    if (input.itemStatus === null) return true;
    if (input.itemStatus === 'waiting_for_info') return false;
    if (input.outcome) return input.outcome.kind === 'done';
    // No outcome block: the agent routed via MCP if the item left in_progress;
    // otherwise decideRunRouting will park it.
    return input.itemStatus !== 'in_progress';
}

function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max);
}
