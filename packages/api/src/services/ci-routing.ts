import type { ExternalCiState, IExternalCiCheck } from '@atlas/shared';

// Follow through after the PR (migration 023): what the CI on a PR says, and
// what Atlas does about a red one.
//
// Pure for the same reason as `gate-check-routing.ts`: no DB, no fetch, no
// engine. `external-links.ts` reads GitHub and `ci-follow-through.ts` writes
// the comment / notification / run; this file only decides, so every branch
// is testable without a network or a worktree.

/** The slice of a GitHub check run this reads. */
export interface GithubCheckRun {
    name?: unknown;
    status?: unknown;
    conclusion?: unknown;
    output?: { title?: unknown; summary?: unknown } | null;
}

/** The slice of a legacy commit status this reads. */
export interface GithubCommitStatus {
    context?: unknown;
    state?: unknown;
    description?: unknown;
}

export interface CiResult {
    state: ExternalCiState | null;
    failing: IExternalCiCheck[];
}

const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required']);
const DETAIL_MAX = 200;

function text(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t.slice(0, DETAIL_MAX) : null;
}

/**
 * Check runs and legacy statuses are two APIs for one question, and a repo can
 * use either or both — so both are read and folded together. Any failure wins
 * over anything pending (a red check will not turn green by waiting), pending
 * wins over success, and nothing at all is `null`: a repo without CI must not
 * look like a passing one.
 *
 * The combined-status endpoint's own top-level `state` is deliberately
 * ignored: GitHub reports `pending` for a commit with zero statuses, which
 * would paint every Actions-only repo as forever pending.
 */
export function combineCi(checkRuns: GithubCheckRun[], statuses: GithubCommitStatus[]): CiResult {
    const failing: IExternalCiCheck[] = [];
    let pending = false;
    let seen = 0;
    for (const run of checkRuns) {
        seen++;
        if (run.status !== 'completed') {
            pending = true;
            continue;
        }
        if (typeof run.conclusion === 'string' && FAILED_CONCLUSIONS.has(run.conclusion)) {
            failing.push({
                name: text(run.name) ?? 'check',
                detail: text(run.output?.title) ?? text(run.output?.summary),
            });
        }
    }
    for (const s of statuses) {
        seen++;
        if (s.state === 'failure' || s.state === 'error') {
            failing.push({ name: text(s.context) ?? 'status', detail: text(s.description) });
        } else if (s.state === 'pending') {
            pending = true;
        }
    }
    if (failing.length > 0) return { state: 'failure', failing };
    if (pending) return { state: 'pending', failing };
    return { state: seen > 0 ? 'success' : null, failing };
}

/** The Task-level cap on automatic CI fix runs; past it Atlas only tells the Owner. */
export const MAX_CI_FIX_ATTEMPTS = 2;

export interface CiActionInput {
    itemType: string;
    itemStatus: string;
    ciState: ExternalCiState | null;
    headSha: string | null;
    /** The head commit Atlas already acted on for this PR. */
    handledSha: string | null;
    /** Automatic fix runs already started across the Task's PRs. */
    attempts: number;
    liveRun: boolean;
    /** The Task's last completed top-level run's workflow, if any. */
    lastWorkflowId: string | null;
    /** Whether that workflow's current graph has a Sub-tasks step. */
    hasSubtasksStep: boolean;
}

export type CiAction =
    /** Nothing new to say. */
    | { kind: 'none' }
    /** Comment + notify only; `why` is why no fix run starts. */
    | { kind: 'notify'; why: string }
    /** Comment + notify, add a "Fix failing CI" sub-task and continue from the Sub-tasks step. */
    | { kind: 'fix_subtask'; workflowId: string }
    /** Comment + notify, and restart the workflow on the same branch. */
    | { kind: 'restart'; workflowId: string };

export function decideCiAction(i: CiActionInput): CiAction {
    // Only a Task waiting on the Owner's review is "after the PR". A Task in
    // progress is being worked; a done one is closed; a sub-task has no PR of
    // its own (ADR 0015).
    if (i.itemType !== 'task' || i.itemStatus !== 'in_review') return { kind: 'none' };
    if (i.ciState !== 'failure' || !i.headSha) return { kind: 'none' };
    // Once per commit. A new push gets a new sha and is judged afresh.
    if (i.handledSha === i.headSha) return { kind: 'none' };

    if (i.liveRun) return { kind: 'notify', why: 'a workflow run is already working this Task' };
    if (i.attempts >= MAX_CI_FIX_ATTEMPTS) {
        return { kind: 'notify', why: `Atlas already tried ${MAX_CI_FIX_ATTEMPTS} automatic fixes` };
    }
    if (!i.lastWorkflowId) return { kind: 'notify', why: 'no completed workflow run to continue' };
    return i.hasSubtasksStep
        ? { kind: 'fix_subtask', workflowId: i.lastWorkflowId }
        : { kind: 'restart', workflowId: i.lastWorkflowId };
}
