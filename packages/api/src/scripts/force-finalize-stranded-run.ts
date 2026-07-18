import { db, closeDb } from '../db/kysely-client.js';
import { completeRun, detectCliResultLine } from '../services/agent-runner.js';
import type { IssueType } from '@atlas/shared';

// 2026-06-02 — One-shot admin recovery for runs stranded by the Windows
// zombie-grandchild pipe-handle issue (root-caused 2026-06-02 on the
// architect run for MON-2, agent_runs.id = 65d10c9e-...). Pairs with the
// in-runner grace-timer + tree-kill defenses added in the same commit:
// this script covers runs that crossed the API restart boundary, where
// the in-memory grace timer no longer exists.
//
// Stranded shape:
//   - agent_runs.status = 'in_progress'
//   - agent_runs.completed_at IS NULL
//   - agent_runs.output_text contains a `{"type":"result","subtype":"success"|"error",...}`
//     NDJSON line (the CLI authored its terminal envelope; only the
//     OS-level close never reached Node)
//
// Action:
//   - Parse the last result envelope out of output_text
//   - Hand `output_text` to `completeRun()` (or the symmetric errorRun
//     path), which writes status=completed, completed_at, token / cost
//     columns, increments the round counter, reads performer_outcome /
//     review_outcome, and applies the downstream handoff (architect →
//     architect-reviewer in the MON-2 case)
//
// This script does NOT touch on-disk worktree state (push + cleanup are
// the orchestrator's responsibility and happen in `finalizeAfterCli` on
// fresh runs). For a stranded run where the worktree push never
// happened, the next dispatched agent on the same item provisions a
// fresh worktree via `ensureWorktree` Path 1, which pulls --ff-only —
// so any unpushed commits sit on the local branch until the next agent
// pushes them or the Owner pushes them manually. Trade-off accepted: a
// post-mortem push is a no-op in the architect→reviewer chain (the
// reviewer reads `items.spec_md`, not the file from origin), and
// adding worktree push to a one-shot recovery script duplicates the
// runner's push path. If we hit this trade-off enough times, lift
// `pushAndCleanupWorktree` into a shared helper both call.
//
// Idempotency: calling completeRun on an already-completed run is a
// no-op for the agent_runs row (the SET ... WHERE id = matches but
// status is already 'completed') and a noisy double-handoff for
// downstream services. So the script bails early if status is not
// 'in_progress'.
//
// Usage:
//   pnpm -F @atlas/api exec tsx src/scripts/force-finalize-stranded-run.ts <RUN_ID>

interface IRunRow {
    id: string;
    agent_id: string;
    item_id: string | null;
    status: string;
    output_text: string | null;
    completed_at: string | null;
}

interface IItemTypeRow {
    type: string | null;
}

export async function forceFinalizeRun(runId: string): Promise<{
    outcome: 'finalized' | 'already_terminal' | 'not_found' | 'no_result_line' | 'no_output';
    detail: string;
}> {
    const row = (await db
        .selectFrom('agent_runs')
        .select([
            'id',
            'agent_id',
            'item_id',
            'status',
            'output_text',
            'completed_at',
        ])
        .where('id', '=', runId)
        .executeTakeFirst()) as IRunRow | undefined;

    if (!row) {
        return { outcome: 'not_found', detail: `agent_runs id=${runId} does not exist` };
    }

    if (row.status !== 'in_progress') {
        return {
            outcome: 'already_terminal',
            detail: `run ${runId} status=${row.status}; refusing to re-finalize`,
        };
    }

    if (!row.output_text || !row.output_text.trim()) {
        return {
            outcome: 'no_output',
            detail: `run ${runId} has empty output_text; nothing to parse for a result envelope`,
        };
    }

    // Walk the output backwards to find the last `{"type":"result"}`
    // NDJSON line. Backwards because output_text is large (MON-2's was
    // 540 KB) and the result envelope is always the final non-stderr
    // line; we don't want to JSON-parse hundreds of tool_use lines.
    const lines = row.output_text.split(/\r?\n/);
    let resultLine: ReturnType<typeof detectCliResultLine> = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = lines[i];
        if (!candidate) continue;
        const parsed = detectCliResultLine(candidate);
        if (parsed) {
            resultLine = parsed;
            break;
        }
    }

    if (!resultLine) {
        return {
            outcome: 'no_result_line',
            detail: `run ${runId}: no '{"type":"result"}' line found in ${row.output_text.length} chars of output; CLI may have crashed before emitting the terminal envelope`,
        };
    }

    // Look up the item's type so we can pass the correct IssueType to
    // completeRun (it routes on type for the handoff path). For
    // freedom-mode runs (item_id null), pass null.
    let issueType: IssueType | null = null;
    if (row.item_id) {
        const item = (await db
            .selectFrom('items')
            .select(['type'])
            .where('id', '=', row.item_id)
            .executeTakeFirst()) as IItemTypeRow | undefined;
        if (item?.type) {
            issueType = item.type as IssueType;
        }
    }

    // completeRun handles the rest: cost extraction, status=completed,
    // round increment, performer_outcome / review_outcome routing, and
    // the on-pass handoff (which is the missing piece for MON-2: it
    // moves the assignee from agent-architect → agent-architect-reviewer
    // and posts the chain-of-events trail).
    await completeRun(runId, row.agent_id, issueType, row.item_id, row.output_text);

    return {
        outcome: 'finalized',
        detail: `run ${runId}: finalized via completeRun (result.subtype=${resultLine.subtype}, agent=${row.agent_id}, item=${row.item_id ?? 'null'}, type=${issueType ?? 'null'})`,
    };
}

async function main(): Promise<void> {
    const runId = process.argv[2];
    if (!runId) {
        console.error('usage: force-finalize-stranded-run <RUN_ID>');
        process.exit(2);
    }

    try {
        const result = await forceFinalizeRun(runId);
        console.log(`[${result.outcome}] ${result.detail}`);
        process.exit(result.outcome === 'not_found' ? 1 : 0);
    } finally {
        await closeDb();
    }
}

const invokedAsScript =
    typeof process !== 'undefined' &&
    process.argv[1] != null &&
    process.argv[1].endsWith('force-finalize-stranded-run.ts');

if (invokedAsScript) {
    void main();
}
