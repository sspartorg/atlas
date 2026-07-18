import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import {
    agentRoutedDuringRun,
    otherActorReassignedDuringRun,
} from './agent-self-routing.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject, insertAgent, insertItem } from '../../tests/_items.js';
import { db } from '../db/kysely-client.js';

// Three time anchors used across the tests. T_RUN_START is the run's
// `started_at`; events strictly BEFORE this must not match the
// "since" filter, events AT/AFTER must.
const T_BEFORE = '2026-06-12T00:00:00.000Z';
const T_RUN_START = '2026-06-12T00:01:00.000Z';
const T_AFTER = '2026-06-12T00:02:00.000Z';

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1');
});

afterAll(async () => {
    await closeTestDb();
});

async function seedAgent(id: string): Promise<void> {
    await insertAgent({ id });
}

async function seedItem(id: string, assignee: string | null = null): Promise<string> {
    return insertItem({
        id,
        type: 'epic',
        project_id: 'p1',
        title: 'Test',
        ...(assignee !== null ? { assignee_agent_id: assignee } : {}),
    });
}

async function recordEvent(input: {
    itemId: string;
    actorAgentId: string | null;
    eventType: 'assigned' | 'status_changed' | 'comment_added';
    createdAt: string;
    detail?: string;
    fromValue?: string;
    toValue?: string;
    field?: string;
}): Promise<void> {
    await db
        .insertInto('issue_events')
        .values({
            item_id: input.itemId,
            event_type: input.eventType,
            actor_agent_id: input.actorAgentId,
            created_at: input.createdAt,
            ...(input.detail !== undefined ? { detail: input.detail } : {}),
            ...(input.fromValue !== undefined ? { from_value: input.fromValue } : {}),
            ...(input.toValue !== undefined ? { to_value: input.toValue } : {}),
            ...(input.field !== undefined ? { field: input.field } : {}),
        })
        .execute();
}

describe('agentRoutedDuringRun', () => {
    it('returns false when no events exist', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(false);
    });

    it('returns true when an "assigned" event from the agent fired during the run', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1', 'agent-x');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-x',
            eventType: 'assigned',
            createdAt: T_AFTER,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(true);
    });

    it('returns true when a "status_changed" event from the agent fired during the run', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1', 'agent-x');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-x',
            eventType: 'status_changed',
            createdAt: T_AFTER,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(true);
    });

    it('returns true when self-assignment fires (assignee_agent_id matches running agent)', async () => {
        // Mirrors the cer-weekly-automation case: the agent assigns the
        // item to itself via MCP `assignItem`. `issue_events` carries a
        // row with `actor_agent_id === agentId`. The orchestrator must
        // still see this as a routing decision and skip its override.
        await seedAgent('cer-weekly-automation');
        const itemId = await seedItem('JDA-1', 'cer-weekly-automation');
        await recordEvent({
            itemId,
            actorAgentId: 'cer-weekly-automation',
            eventType: 'assigned',
            createdAt: T_AFTER,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'cer-weekly-automation',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(true);
    });

    it('returns false when only a "comment_added" event fired (comments are not routing)', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1', 'agent-x');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-x',
            eventType: 'comment_added',
            createdAt: T_AFTER,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(false);
    });

    it('returns false when the matching event fired BEFORE the run started', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1', 'agent-x');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-x',
            eventType: 'assigned',
            createdAt: T_BEFORE,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(false);
    });

    it('returns false when the event is from a different agent on the same item', async () => {
        await seedAgent('agent-x');
        await seedAgent('agent-y');
        const itemId = await seedItem('ATL-1');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-y',
            eventType: 'assigned',
            createdAt: T_AFTER,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(false);
    });

    it('returns false when the event is from the agent on a different item', async () => {
        await seedAgent('agent-x');
        const itemA = await seedItem('ATL-1');
        const itemB = await seedItem('ATL-2');
        await recordEvent({
            itemId: itemA,
            actorAgentId: 'agent-x',
            eventType: 'assigned',
            createdAt: T_AFTER,
        });

        const result = await agentRoutedDuringRun({
            agentId: 'agent-x',
            itemId: itemB,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(false);
    });

    // JDA-1 root cause. The orchestrator writes the run-start
    // ready → in_progress transition with `actor_agent_id = agentId` for
    // activity-log display, but the change was authored by the
    // orchestrator at dispatch, not by the agent's MCP calls. Marked
    // with `detail = 'orchestrator_run_start'` and MUST be filtered out.
    // Without this exclusion, every autonomous run tripped a
    // false-positive on self-routing and the orchestrator skipped its
    // post-run status transition — leaving the item stuck in
    // `in_progress` after the agent finished.
    it('regression (JDA-1): filters out the orchestrator run-start marker even when actor matches', async () => {
        await seedAgent('cer-weekly-automation');
        const itemId = await seedItem('JDA-1', 'cer-weekly-automation');
        await recordEvent({
            itemId,
            actorAgentId: 'cer-weekly-automation',
            eventType: 'status_changed',
            createdAt: T_AFTER,
            field: 'status',
            fromValue: 'ready',
            toValue: 'in_progress',
            detail: 'orchestrator_run_start',
        });

        const result = await agentRoutedDuringRun({
            agentId: 'cer-weekly-automation',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        // The marker excludes this row. No other events → false → the
        // orchestrator will apply its post-run status transition
        // (e.g. park_waiting_for_info if outcome parse failed).
        expect(result).toBe(false);
    });

    it('still returns true when a genuine MCP status_changed fires alongside the run-start marker', async () => {
        // Sanity: if the agent DOES use MCP to change status mid-run,
        // that event (no marker) still counts even if the orchestrator's
        // run-start marker row is present on the same item.
        await seedAgent('cer-weekly-automation');
        const itemId = await seedItem('JDA-1', 'cer-weekly-automation');
        await recordEvent({
            itemId,
            actorAgentId: 'cer-weekly-automation',
            eventType: 'status_changed',
            createdAt: T_AFTER,
            field: 'status',
            fromValue: 'ready',
            toValue: 'in_progress',
            detail: 'orchestrator_run_start',
        });
        await recordEvent({
            itemId,
            actorAgentId: 'cer-weekly-automation',
            eventType: 'status_changed',
            createdAt: T_AFTER,
            field: 'status',
            fromValue: 'in_progress',
            toValue: 'done',
            // no detail — this is a genuine MCP-driven transition
        });

        const result = await agentRoutedDuringRun({
            agentId: 'cer-weekly-automation',
            itemId,
            sinceRunStartedAt: T_RUN_START,
        });

        expect(result).toBe(true);
    });
});

describe('otherActorReassignedDuringRun', () => {
    // Every non-self-routed branch of `completeRun` gates on this. It
    // returns true iff someone OTHER than the running agent performed
    // an `assigned` OR `status_changed` event during the run — Owner
    // via UI (null actor) or another agent via MCP. Autonomous agents
    // that were never assigned to the item must see `false` here so
    // the handoff still applies (regression fix for JDA-1). The 2026-
    // 07-03 round-2-follow-up widened the filter from assigned-only to
    // include status_changed so a mid-run manual status transition
    // also blocks the orchestrator's post-run override.

    it('returns false when no assigned events exist', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(false);
    });

    it('returns true when the Owner (null actor) reassigned during the run', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1', 'agent-x');
        await recordEvent({
            itemId,
            actorAgentId: null,
            eventType: 'assigned',
            createdAt: T_AFTER,
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(true);
    });

    it('returns true when a different agent reassigned during the run', async () => {
        await seedAgent('agent-x');
        await seedAgent('agent-y');
        const itemId = await seedItem('ATL-1');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-y',
            eventType: 'assigned',
            createdAt: T_AFTER,
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(true);
    });

    it('returns false when only THIS agent reassigned (self-routing case is handled elsewhere)', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-x',
            eventType: 'assigned',
            createdAt: T_AFTER,
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(false);
    });

    it('returns false when the reassignment fired BEFORE the run started', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');
        await recordEvent({
            itemId,
            actorAgentId: null,
            eventType: 'assigned',
            createdAt: T_BEFORE,
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(false);
    });

    it('returns true when the Owner (null actor) did a status-only transition during the run (2026-07-03 round-2 follow-up)', async () => {
        // Widened detection: an Owner-initiated status change with no
        // reassignment (e.g., flipping the item to `in_review` via the
        // UI) writes a `status_changed` row with actor_agent_id=null.
        // Before the follow-up, only `assigned` events counted, so this
        // Owner intervention was silently overwritten by the on-pass
        // handoff. Now the function treats it as an intervention too.
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');
        await recordEvent({
            itemId,
            actorAgentId: null,
            eventType: 'status_changed',
            createdAt: T_AFTER,
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(true);
    });

    it('excludes the orchestrator dispatch marker (orchestrator_run_start) — status_changed by the running agent with that detail is ignored', async () => {
        // At dispatch, the orchestrator writes a ready→in_progress
        // status_changed row tagged with actor_agent_id=<the running
        // agent> and detail='orchestrator_run_start'. Without an
        // explicit exclusion this would false-positive the widened
        // detector (actor != excludeAgentId is false for this row, but
        // if the exclude test itself missed a case…) — belt-and-braces
        // the filter.
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');
        // Simulate the dispatch row: another agent (agent-y) triggering
        // work AND the orchestrator's own marker fires under a run for
        // agent-x. The marker row must NOT count as intervention against
        // agent-x's on-pass handoff.
        await seedAgent('agent-y');
        await recordEvent({
            itemId,
            actorAgentId: 'agent-y',
            eventType: 'status_changed',
            createdAt: T_AFTER,
            detail: 'orchestrator_run_start',
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(false);
    });

    it('returns false for comment_added events (comments alone do not block on-pass)', async () => {
        await seedAgent('agent-x');
        const itemId = await seedItem('ATL-1');
        await recordEvent({
            itemId,
            actorAgentId: null,
            eventType: 'comment_added',
            createdAt: T_AFTER,
        });
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'agent-x',
        });
        expect(result).toBe(false);
    });

    it('regression: autonomous agent scenario — never assigned to item, no events → false, handoff applies', async () => {
        // JDA-1 reproducer. `cer-weekly-automation` runs on an item it
        // was never assigned to; no `assigned` event fires during the
        // run. Before the fix, the on-pass branch's
        // `currentAssignee !== agentId` sniff wrongly returned true
        // (null !== 'cer-weekly-automation') and skipped the handoff,
        // leaving the item stuck in `in_progress`. This helper must
        // return false so the on-pass handoff runs as configured.
        await seedAgent('cer-weekly-automation');
        const itemId = await seedItem('JDA-1', null);
        const result = await otherActorReassignedDuringRun({
            itemId,
            sinceRunStartedAt: T_RUN_START,
            excludeAgentId: 'cer-weekly-automation',
        });
        expect(result).toBe(false);
    });
});
