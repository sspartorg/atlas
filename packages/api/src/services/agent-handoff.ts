import { db } from '../db/kysely-client.js';
import { eventsLog } from './events-log.js';
import type { IssueType } from '@atlas/shared';

export type HandoffKind = 'on-pass' | 'on-fail';

type ItemStatus =
    | 'ready'
    | 'in_review'
    | 'in_progress'
    | 'done'
    | 'waiting_for_info'
    | 'draft';

export interface HandoffOutcome {
    /**
     * The next assignee for the item. `null` means the item should land in
     * the Owner's queue (the seed encodes this as the literal sentinel
     * `target_agent_id = 'owner'`).
     */
    assigneeId: string | null;
    /**
     * The status the run row sets on the item alongside the reassignment.
     * Pulled from the same `agent_handoff_rules` row.
     */
    status: string;
}

// Look up `agent_handoff_rules` for the given agent + kind. Returns null when
// no rule is configured (callers should leave the assignee alone in that
// case — silently picking a default would surprise the user).
//
// 2026-05-31 — Post-handoff-realign, every SDLC agent has exactly ONE
// rule per kind. The fan-out resolver + `[QA]` title partitioning that
// supported PO Reviewer's two on-pass rules was deleted in the same
// pass; PO Reviewer's child dispatch is now driven from its prompt via
// Atlas MCP. See migration 048 and `seed.ts:HANDOFF_RULE_SEEDS` for
// the current shape.
export async function resolveHandoffAssignee(
    agentId: string,
    kind: HandoffKind,
): Promise<HandoffOutcome | null> {
    const row = await db
        .selectFrom('agent_handoff_rules')
        .select(['target_agent_id', 'status'])
        .where('agent_id', '=', agentId)
        .where('kind', '=', kind)
        .executeTakeFirst();
    if (!row) return null;
    const target = row.target_agent_id;
    return {
        assigneeId: target === 'owner' ? null : target,
        status: row.status as string,
    };
}

/**
 * One concrete `(itemId → assigneeAgentId)` assignment, derived from the
 * matching handoff rule. Returned by `applyOnPassHandoff` so callers can
 * audit / log the action without re-reading the DB.
 */
export interface HandoffAssignment {
    /** The item that received the new assignee. Always the run's own item. */
    itemId: string;
    /** The new assignee. `null` = Owner's queue. */
    assigneeAgentId: string | null;
    /** The raw target_agent_id from the rule (preserves the `'owner'`
     *  sentinel so callers can distinguish it from a null assignee). */
    rawTargetAgentId: string;
}

/**
 * Apply on-pass handoff for the run's own item.
 *
 * Reads the single `(agent_id, on-pass)` rule, reassigns the item to its
 * target, returns the recorded plan. If no rule is configured, returns an
 * empty array and leaves the item alone (the caller can decide whether to
 * warn or proceed).
 *
 * Workstream #2 (2026-06-02) — also emits `issue_events` rows for the
 * transitions so the activity feed shows the data-driven handoff. The
 * `'owner'` rule sentinel is converted to `null` before reaching
 * `issue_events.to_value`; the UI's `'assigned'` renderer handles the
 * null → "Owner" mapping.
 *
 * Mid-run reassignment guard lives in the runner: the agent's prompt may
 * already have reassigned the item via Atlas MCP (the revision loop, or
 * PO Reviewer dispatching epic children). The runner checks the current
 * assignee BEFORE invoking this function — if the item is no longer
 * assigned to the run's agent, the runner skips this call entirely.
 */
export async function applyOnPassHandoff(opts: {
    agentId: string;
    currentItemId: string;
    itemType: IssueType;
}): Promise<HandoffAssignment[]> {
    return applyHandoff({ ...opts, kind: 'on-pass' });
}

/**
 * Apply on-fail handoff for the run's own item. Symmetric with
 * `applyOnPassHandoff`: reads the `(agent_id, on-fail)` rule, updates
 * `items`, emits the same two `issue_events` rows when the values change.
 *
 * Empty plan + no DB writes when no rule matches.
 */
export async function applyOnFailHandoff(opts: {
    agentId: string;
    currentItemId: string;
    itemType: IssueType;
    detail?: string;
}): Promise<HandoffAssignment[]> {
    return applyHandoff({ ...opts, kind: 'on-fail' });
}

async function applyHandoff(opts: {
    agentId: string;
    currentItemId: string;
    itemType: IssueType;
    kind: HandoffKind;
    detail?: string;
}): Promise<HandoffAssignment[]> {
    const outcome = await resolveHandoffAssignee(opts.agentId, opts.kind);
    if (!outcome) return [];

    // Read current state BEFORE the update so the event rows carry the
    // pre-update `from_value`s. One round-trip; harmless even if no event
    // ends up being emitted (early-exit on no-change happens below).
    const before = await db
        .selectFrom('items')
        .select(['status', 'assignee_agent_id'])
        .where('id', '=', opts.currentItemId)
        .executeTakeFirst();
    const fromStatus = (before?.status as string | null) ?? null;
    const fromAssignee = (before?.assignee_agent_id as string | null) ?? null;

    // 2026-05-31 — Both `assignee_agent_id` AND `status` come from the
    // rule. The handoff is authoritative for the item's next state; the
    // status machine governs Owner-initiated UI transitions, not these
    // system-driven hops. Performer → reviewer rules set status `ready`
    // (so the reviewer can pick up); terminal reviewer rules set status
    // `in_review` (so the Owner sees it on the in-review board).
    await db
        .updateTable('items')
        .set({
            assignee_agent_id: outcome.assigneeId,
            status: outcome.status as ItemStatus,
        })
        .where('id', '=', opts.currentItemId)
        .execute();

    // Workstream #2 — emit one event per actually-changed field. The
    // `'owner'` sentinel from `agent_handoff_rules.target_agent_id` is
    // already resolved to `null` by `resolveHandoffAssignee`; we pass
    // that null straight through to `issue_events.to_value`.
    if (fromStatus !== outcome.status) {
        await eventsLog.record({
            item_id: opts.currentItemId,
            item_type: opts.itemType,
            event_type: 'status_changed',
            actor_agent_id: opts.agentId,
            field: 'status',
            from_value: fromStatus,
            to_value: outcome.status,
            detail: opts.detail ?? null,
        });
    }
    if (fromAssignee !== outcome.assigneeId) {
        await eventsLog.record({
            item_id: opts.currentItemId,
            item_type: opts.itemType,
            event_type: 'assigned',
            actor_agent_id: opts.agentId,
            field: 'assignee',
            from_value: fromAssignee,
            to_value: outcome.assigneeId,
            detail: opts.detail ?? null,
        });
    }

    return [
        {
            itemId: opts.currentItemId,
            assigneeAgentId: outcome.assigneeId,
            rawTargetAgentId: outcome.assigneeId ?? 'owner',
        },
    ];
}
