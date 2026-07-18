import { db } from '../db/kysely-client.js';
import { spawnAgentRun } from './agent-runner.js';
import { DependenciesNotReadyError, type DependencyBlocker } from './dependency-guard.js';
import type { IAgent, IssueStatus, IssueType, RunStatus } from '@atlas/shared';

export function shouldAutoDispatch(args: {
    item: { status: IssueStatus; assignee_agent_id: string | null };
    agent: IAgent;
    hasLiveRun: boolean;
}): boolean {
    if (args.item.status !== 'ready') return false;
    if (!args.item.assignee_agent_id) return false;
    if (args.agent.status !== 'active') return false;
    if (args.hasLiveRun) return false;
    return true;
}

type DispatchSkipReason =
    | 'item_not_found'
    | 'no_assignee'
    | 'agent_not_found'
    | 'agent_inactive'
    | 'not_ready'
    | 'live_run_exists'
    | 'deps_blocked';

export type DispatchResult =
    | { dispatched: true; runId: string }
    | { dispatched: false; reason: Exclude<DispatchSkipReason, 'deps_blocked'> }
    | { dispatched: false; reason: 'deps_blocked'; blockers: DependencyBlocker[] };

const LIVE_RUN_STATUSES: RunStatus[] = ['queued', 'in_progress'];

export interface LiveRunBlocker {
    runId: string;
    agentId: string;
}

// Returns the active (queued or in_progress) run on this item, regardless of
// which agent owns it — or null if the item has no live run. Used as the
// orchestrator-side gate that prevents a successor agent (manual or
// automated dispatch) from starting while a predecessor on the same item
// is still finalising (push + worktree cleanup).
//
// Orchestrator-only by design: `agent_runs.status` is mutated exclusively
// by `agent-runner.ts` (`completeRun` / `errorRun`); no MCP tool surface
// lets an AI agent change it.
export async function findLiveRunOnItem(itemId: string): Promise<LiveRunBlocker | null> {
    const row = await db
        .selectFrom('agent_runs')
        .select(['id', 'agent_id'])
        .where('item_id', '=', itemId)
        .where('status', 'in', LIVE_RUN_STATUSES)
        .executeTakeFirst();
    if (!row) return null;
    return { runId: row.id as string, agentId: row.agent_id as string };
}

export async function maybeAutoDispatch(itemId: string): Promise<DispatchResult> {
    const item = await db
        .selectFrom('items')
        .select(['id', 'type', 'status', 'assignee_agent_id'])
        .where('id', '=', itemId)
        .executeTakeFirst();
    if (!item) return { dispatched: false, reason: 'item_not_found' };
    if (item.status !== 'ready') return { dispatched: false, reason: 'not_ready' };
    if (!item.assignee_agent_id) return { dispatched: false, reason: 'no_assignee' };

    const agent = (await db
        .selectFrom('agents')
        .selectAll()
        .where('id', '=', item.assignee_agent_id)
        .executeTakeFirst()) as unknown as IAgent | undefined;
    if (!agent) return { dispatched: false, reason: 'agent_not_found' };
    if (agent.status !== 'active') return { dispatched: false, reason: 'agent_inactive' };

    // Item-level lock: ANY active run on this item blocks dispatch, even if
    // it's a different agent (e.g. predecessor still finalising push +
    // cleanup). Previously this check was scoped per (item, agent), which
    // let successor agents start during predecessor cleanup → race on the
    // shared worktree dir. See MON-3 forensic in plan file.
    const blocker = await findLiveRunOnItem(itemId);
    if (blocker) return { dispatched: false, reason: 'live_run_exists' };

    // B04 — the depends_on gate inside spawnAgentRun throws
    // DependenciesNotReadyError when any blocker is non-`done`. Catch it here
    // and surface as a typed skip reason so the scheduler tick can log + move
    // on without bubbling the error.
    try {
        const runId = await spawnAgentRun({
            agentId: item.assignee_agent_id,
            issueType: item.type as IssueType,
            issueId: itemId,
        });
        return { dispatched: true, runId };
    } catch (err) {
        if (err instanceof DependenciesNotReadyError) {
            return { dispatched: false, reason: 'deps_blocked', blockers: err.blockers };
        }
        throw err;
    }
}
