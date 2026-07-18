import type { IssueStatus, IssueType, SubTaskStatus } from '../types/index.js';

// Unified 6-status machine for every issue type (epic / story / bug / sub_bug
// / sub_task). The state machine returns recommended next statuses for
// buttons, agent auto-advancement, and bot automation. The owner can also
// manually override to any status via a dropdown on the detail page (handled
// at the route layer via ?override=1) — that path bypasses this machine.
//
// Forward path:   draft → ready → in_progress → in_review → done
// Reverse paths:  in_review → in_progress (revision), waiting_for_info → ready (re-queue)
// Escape hatch:   any non-terminal → waiting_for_info
// Handoff hop:    in_progress → ready (performer finishes → reviewer's queue;
//                 the seeded `agent_handoff_rules.status` for every
//                 performer→reviewer pair is `ready`, so the agent's MCP
//                 self-route call needs the machine to allow it).

const FORWARD: Record<IssueStatus, IssueStatus[]> = {
    draft: ['ready'],
    ready: ['in_progress'],
    in_progress: ['in_review', 'ready'],
    waiting_for_info: ['ready', 'in_progress'],
    in_review: ['done', 'in_progress'],
    done: [],
};

export function getValidNextStatuses(
    issueType: 'sub_task',
    currentStatus: SubTaskStatus
): SubTaskStatus[];
export function getValidNextStatuses(
    issueType: Exclude<IssueType, 'sub_task'>,
    currentStatus: IssueStatus
): IssueStatus[];
export function getValidNextStatuses(
    _issueType: IssueType,
    currentStatus: IssueStatus | SubTaskStatus
): IssueStatus[] {
    const cs = currentStatus as IssueStatus;
    // The `?? []` is a runtime guard for unknown status strings (e.g. a DB
    // row that drifted from the enum); TS guarantees the lookup is defined.
    /* v8 ignore next */
    const next = [...(FORWARD[cs] ?? [])];
    // Escape hatch: any non-terminal, non-waiting status can flip to waiting_for_info.
    if (cs !== 'done' && cs !== 'waiting_for_info') {
        next.push('waiting_for_info');
    }
    return next.filter((s, i, a) => a.indexOf(s) === i);
}

export function isValidTransition(
    issueType: IssueType,
    from: IssueStatus | SubTaskStatus,
    to: IssueStatus | SubTaskStatus
): boolean {
    const valid = getValidNextStatuses(
        issueType as Exclude<IssueType, 'sub_task'>,
        from as IssueStatus
    );
    return valid.includes(to as IssueStatus);
}

export function getStatusLabel(status: IssueStatus | SubTaskStatus): string {
    const labels: Record<IssueStatus, string> = {
        draft: 'Draft',
        ready: 'Ready',
        in_progress: 'In Progress',
        waiting_for_info: 'Waiting for Info',
        in_review: 'In Review',
        done: 'Done',
    };
    // Same defensive fallback as getValidNextStatuses — TS guarantees the
    // lookup hits; the `?? status` only fires on out-of-enum strings.
    /* v8 ignore next */
    return labels[status as IssueStatus] ?? status;
}

// Map case-insensitive enum form OR human-label form back to the canonical
// IssueStatus enum. Used at the API boundary (transitionItemStatus route +
// MCP tool plumbing) so the LLM can pass either `"ready"` (enum) or
// `"Ready"` (label, matching what users see in the UI) and the server
// stores the canonical lowercase enum.
//
// Why: LLMs apply semantic priors over literal instructions; when handoff.md
// says `status: "ready"` and the LLM "knows" the situation is closer to
// "in review", it picks `in_review`. Rendering handoff.md with the human
// label ("Ready") matches the surrounding UI vocabulary and reduces the
// override-pressure. The normalizer makes the system tolerant of EITHER
// form so the API contract stays the same whether the agent passes
// `"Ready"` or `"ready"`.
//
// Returns null on unknown input — callers should emit a 400 with the
// unrecognised value so an Owner-facing error is clear.
const STATUS_LABEL_TO_ENUM: Record<string, IssueStatus> = {
    draft: 'draft',
    ready: 'ready',
    'in progress': 'in_progress',
    'in_progress': 'in_progress',
    'in progress ': 'in_progress',
    'waiting for info': 'waiting_for_info',
    'waiting_for_info': 'waiting_for_info',
    'in review': 'in_review',
    'in_review': 'in_review',
    done: 'done',
};

export function normalizeStatusInput(input: string): IssueStatus | null {
    if (typeof input !== 'string') return null;
    const key = input.trim().toLowerCase();
    if (key.length === 0) return null;
    return STATUS_LABEL_TO_ENUM[key] ?? null;
}

export function isTerminalStatus(
    _issueType: IssueType,
    status: IssueStatus | SubTaskStatus
): boolean {
    return status === 'done';
}
