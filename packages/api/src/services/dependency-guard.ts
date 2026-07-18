import { db } from '../db/kysely-client.js';
import { itemLinks } from './item-links.js';
import { eventsLog } from './events-log.js';
import type { IssueStatus } from '@atlas/shared';

export type DependencyBlocker = { id: string; title: string; status: IssueStatus };

/**
 * B04 — thrown by the pre-dispatch gate inside `agent-runner.spawnAgentRun`
 * (and the reviewer-leg / performer-retry helpers) when the item still has
 * non-`done` `depends_on` targets. Carries the blocker list so callers can
 * surface it (HTTP 409 body, dispatcher reason payload, activity event).
 *
 * The gate fires unconditionally — any non-done dep blocks, including a dep
 * sitting in `in_review`. This is the hard-gate semantic the Owner asked for:
 * a dep that isn't truly finished must not let a downstream run start.
 */
export class DependenciesNotReadyError extends Error {
    readonly blockers: DependencyBlocker[];

    constructor(blockers: DependencyBlocker[]) {
        const labels = blockers.map((b) => `${b.id} (${b.status})`).join(', ');
        super(`Dependencies not ready: ${labels}`);
        this.name = 'DependenciesNotReadyError';
        this.blockers = blockers;
    }
}

/**
 * B04 — pre-dispatch gate. Throws `DependenciesNotReadyError` if `itemId` has
 * any non-`done` `depends_on` target, and records a `dispatch_blocked` event
 * on the item so the activity feed shows the blocked attempt. Caller passes
 * `agentId` so the event names the agent that was supposed to run.
 *
 * Returns silently when the item has zero open blockers — that's the green-
 * light path; the caller proceeds with the spawn.
 */
export async function assertDepsAllDoneForDispatch(
    itemId: string,
    agentId: string,
): Promise<void> {
    const blockers = await itemLinks.openBlockers(itemId);
    if (blockers.length === 0) return;
    // Record the blocked attempt BEFORE throwing so the event lands even if
    // the caller swallows the throw silently (e.g. internal retry paths).
    await eventsLog.logDispatchBlocked(itemId, agentId, blockers);
    throw new DependenciesNotReadyError(blockers);
}

/**
 * Throw if `itemId` has any open `depends_on` blockers that prevent it from
 * leaving `draft`/`ready`. The status machine forbids a transition out of
 * those states until every blocker has reached `done`.
 *
 * Returns silently when the item has no open blockers OR when the target
 * status itself is `waiting_for_info` (escalations and info-requests are
 * allowed even when blocked).
 *
 * Post-B04 this is a secondary safety net — the pre-dispatch gate
 * (`assertDepsAllDoneForDispatch`) refuses the spawn upstream, so a run
 * that reaches this guard should already have clean deps. Kept in place to
 * catch any future direct-status-mutation paths that bypass the runner.
 */
export async function assertNoOpenBlockers(itemId: string, targetStatus: IssueStatus): Promise<void> {
    // Allow escalations while blocked.
    if (targetStatus === 'waiting_for_info') return;
    // Only enforce on transitions that start work.
    if (targetStatus !== 'in_progress' && targetStatus !== 'in_review') return;

    const blockers = await itemLinks.openBlockers(itemId);
    if (blockers.length === 0) return;

    const labels = blockers.map((b) => `${b.id} (${b.status})`).join(', ');
    const err = new Error(`Blocked by ${labels}`) as Error & { code?: string; blockers?: typeof blockers };
    err.code = 'blocked';
    err.blockers = blockers;
    throw err;
}

/**
 * Called after an item's status changes to `done`. For every item that has
 * a `depends_on` edge pointing at the freshly-done item, if it now has zero
 * remaining open blockers, emit an `unblocked` issue_event so the UI/activity
 * feed shows the moment it became actionable.
 *
 * Returns the list of newly-unblocked item ids so callers can broadcast SSE.
 */
export async function notifyDependentsUnblocked(itemId: string): Promise<string[]> {
    const dependents = await itemLinks.dependents(itemId);
    const unblocked: string[] = [];

    for (const depId of dependents) {
        const remaining = await itemLinks.openBlockers(depId);
        if (remaining.length === 0) {
            await db
                .insertInto('issue_events')
                .values({
                    item_id: depId,
                    event_type: 'unblocked',
                    detail: `Last blocker resolved: ${itemId}`,
                })
                .execute();
            unblocked.push(depId);
        }
    }

    return unblocked;
}
