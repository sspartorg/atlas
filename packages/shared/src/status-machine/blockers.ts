import type { IssueStatus } from '../types/index.js';

/**
 * Pure check for whether an item can start (move to in_progress / in_review)
 * given the statuses of its `depends_on` blockers. No DB access — the caller
 * pre-loads the blocker statuses.
 *
 * Rules:
 *   - `waiting_for_info` is always allowed (escalations during a block are fine).
 *   - `in_progress` / `in_review` are blocked if any blocker isn't `done`.
 *   - Every other transition is the existing status machine's responsibility.
 *
 * Returns `{ ok: true }` when the transition is allowed by dependency rules,
 * or `{ ok: false, blockers: [...] }` with the list of non-done blockers that
 * are preventing it. UI consumers should mention the blocker ids in the
 * tooltip/error so the Owner knows what to unblock.
 */
export interface BlockerInfo {
    id: string;
    status: IssueStatus;
}

export type DependencyCheck =
    | { ok: true }
    | { ok: false; blockers: BlockerInfo[] };

export function assertCanStart(
    targetStatus: IssueStatus,
    blockers: BlockerInfo[],
): DependencyCheck {
    if (targetStatus === 'waiting_for_info') return { ok: true };
    if (targetStatus !== 'in_progress' && targetStatus !== 'in_review') return { ok: true };
    const open = blockers.filter((b) => b.status !== 'done');
    if (open.length === 0) return { ok: true };
    return { ok: false, blockers: open };
}

// ---------------------------------------------------------------------------
// P16 — Parent cannot close until all children are closed.
//
// Mirror of the `assertCanStart` pattern but for the parent_id walk. Pure
// function: caller pre-loads the children (epic → stories+bugs, story →
// sub_tasks+sub_bugs) and passes in their statuses. We return the list of
// children that aren't `done` so the API layer can surface the offending
// IDs in a 422 body and the UI can list them in a toast.
//
// The rule only fires when the target status is `done`. Every other
// transition is the existing status machine's responsibility.
// ---------------------------------------------------------------------------

export interface ChildInfo {
    id: string;
    status: IssueStatus;
}

export type ChildrenDoneCheck =
    | { ok: true }
    | { ok: false; openChildren: ChildInfo[] };

/**
 * Typed error thrown by `assertChildrenDone()` when one or more children
 * of a parent item aren't `done`. The API route layer catches it and maps
 * to HTTP 422 with `{ kind: 'conflict', details: { open_children: [...] } }`.
 *
 * `parentId` is included so consumers (logs, tests) can identify which
 * parent the violation belongs to without threading it through separately.
 */
export class ChildrenNotDoneError extends Error {
    readonly parentId: string;
    readonly openChildren: ChildInfo[];

    constructor(parentId: string, openChildren: ChildInfo[]) {
        const ids = openChildren.map((c) => c.id).join(', ');
        super(`Cannot close ${parentId}: ${openChildren.length} open child(ren): ${ids}`);
        this.name = 'ChildrenNotDoneError';
        this.parentId = parentId;
        this.openChildren = openChildren;
    }
}

/**
 * Pure variant — returns `{ ok, openChildren }` without throwing.
 * Use this when you want to branch on the result; use the throwing
 * `assertChildrenDone()` in route handlers so a `try/catch` produces
 * the 422 envelope.
 */
export function checkChildrenDone(
    targetStatus: IssueStatus,
    children: ChildInfo[],
): ChildrenDoneCheck {
    if (targetStatus !== 'done') return { ok: true };
    const open = children.filter((c) => c.status !== 'done');
    if (open.length === 0) return { ok: true };
    return { ok: false, openChildren: open };
}

/**
 * Throwing variant. Mirrors the existing route-layer use of typed errors
 * (e.g. `requireMcpToken` throws on auth fail). Callers wrap with a
 * try/catch and emit `{ kind: 'conflict', details: { open_children } }`.
 *
 * No-op when the target status isn't `done`, so route handlers can call
 * this unconditionally on every status PATCH without branching.
 */
export function assertChildrenDone(
    parentId: string,
    targetStatus: IssueStatus,
    children: ChildInfo[],
): void {
    const res = checkChildrenDone(targetStatus, children);
    if (!res.ok) throw new ChildrenNotDoneError(parentId, res.openChildren);
}
