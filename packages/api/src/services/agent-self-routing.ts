// Self-routing detector — answers the question "did the agent's MCP
// calls during this run already route the item, so the orchestrator
// should NOT override?"
//
// Returns true iff `issue_events` carries any `assigned` or
// `status_changed` event whose `actor_agent_id` equals the running
// agent and which fired on this item at or after the run's
// `started_at`. The MCP `assignItem` and `transitionItemStatus` tool
// calls hit the same API routes the UI uses, which already write these
// event rows via `eventsLog.record` — so no new instrumentation is
// needed inside the MCP layer.
//
// `addCommentToItem` writes `comment_added`, not `assigned` /
// `status_changed`, so a comment-only run still falls through to the
// orchestrator's existing safety net (which would park it with the
// Owner under `waiting_for_info`). Comments alone don't count as
// routing.
//
// One class of events is EXCLUDED: the orchestrator's own run-start
// ready → in_progress transition. That row is written with the running
// agent as `actor_agent_id` for activity-log display purposes, but it
// was authored by the orchestrator at dispatch, NOT by the agent via
// MCP. Filtered out by the `detail = 'orchestrator_run_start'` marker
// on the row so this helper only counts genuine MCP-driven routing.
//
// Lives in its own module so unit tests can exercise it directly —
// agent-runner.ts is excluded from coverage (it's a subprocess-driver
// wrapper). Same split pattern as `agent-runner-outcome-routing.ts`.

import { db } from '../db/kysely-client.js';

export interface AgentRoutedDuringRunInput {
    agentId: string;
    itemId: string;
    /** ISO timestamp — the run's `agent_runs.started_at`. */
    sinceRunStartedAt: string;
}

const ORCHESTRATOR_RUN_START_MARKER = 'orchestrator_run_start';

export async function agentRoutedDuringRun(
    input: AgentRoutedDuringRunInput,
): Promise<boolean> {
    const row = await db
        .selectFrom('issue_events')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('item_id', '=', input.itemId)
        .where('actor_agent_id', '=', input.agentId)
        .where('event_type', 'in', ['assigned', 'status_changed'])
        .where('created_at', '>=', input.sinceRunStartedAt)
        // Exclude the orchestrator's own ready → in_progress transition
        // written at dispatch. See module doc.
        .where((eb) =>
            eb.or([
                eb('detail', 'is', null),
                eb('detail', '!=', ORCHESTRATOR_RUN_START_MARKER),
            ]),
        )
        .executeTakeFirst();
    // PG COUNT(*) always returns one row; `executeTakeFirst()` is never undefined.
    // The `?.n ?? 0` null arms are unreachable from production code.
    /* v8 ignore next */
    return Number(row?.n ?? 0) > 0;
}

// Mid-run intervention probe used by the non-self-routed branches. Returns
// true iff the item was modified during the run by someone OTHER than this
// agent — either a reassignment or an out-of-band status transition. The
// orchestrator uses this to decide whether to skip its own post-run writes;
// if someone else intervened, respect the intervention.
//
// Distinct from `agentRoutedDuringRun` above:
// - `agentRoutedDuringRun` fires when THIS agent used MCP mid-run.
// - `otherActorReassignedDuringRun` fires when SOMEONE ELSE touched the item.
//
// For autonomous / cron-triggered agents that were never assigned to the
// item in the first place, no third-party event fires during the run, so
// this returns false and the on-pass handoff applies as configured.
//
// 2026-07-03 audit round 2 follow-up: the previous version only checked
// for `assigned` events. An Owner using the UI to transition status
// (e.g. flipping the item to `in_review` without changing the assignee)
// writes a `status_changed` row with actor_agent_id=null and no `assigned`
// event, so the on-pass handoff would still fire and clobber the Owner's
// manual `in_review` transition. Now checks BOTH event types, and
// excludes the orchestrator's own `orchestrator_run_start` marker so a
// dispatch-time status_changed doesn't false-positive.
export async function otherActorReassignedDuringRun(input: {
    itemId: string;
    sinceRunStartedAt: string;
    excludeAgentId: string;
}): Promise<boolean> {
    const row = await db
        .selectFrom('issue_events')
        .select(({ fn }) => fn.countAll<string>().as('n'))
        .where('item_id', '=', input.itemId)
        .where('event_type', 'in', ['assigned', 'status_changed'])
        .where('created_at', '>=', input.sinceRunStartedAt)
        .where((eb) =>
            eb.or([
                eb('actor_agent_id', 'is', null),
                eb('actor_agent_id', '!=', input.excludeAgentId),
            ]),
        )
        // Exclude the orchestrator's own ready → in_progress dispatch
        // row (actor_agent_id is set to the running agent for
        // activity-log display, but the detail marker distinguishes it
        // from real MCP-driven writes). Necessary now that we widened
        // the event_type filter to include status_changed.
        .where((eb) =>
            eb.or([
                eb('detail', 'is', null),
                eb('detail', '!=', ORCHESTRATOR_RUN_START_MARKER),
            ]),
        )
        .executeTakeFirst();
    /* v8 ignore next */
    return Number(row?.n ?? 0) > 0;
}
