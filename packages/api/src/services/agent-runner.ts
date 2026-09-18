import { randomUUID } from 'crypto';

// Thrown when the unique partial index on
// `agent_runs(item_id) WHERE status IN ('queued','in_progress')`
// (migration 003) rejects a new insert because another agent's run is
// already live on the same item. Routes catch this and map to HTTP 409.
// The in-app `findLiveRunOnItem` check (agent-dispatcher.ts) is the
// first line of defence; this is the race-free DB-level fallback.
class LiveRunOnItemError extends Error {
    constructor(public readonly itemId: string) {
        super(`Item ${itemId} already has an active run.`);
        this.name = 'LiveRunOnItemError';
    }
}
import { spawn as nodeSpawn, execFile as nodeExecFile } from 'child_process';
import { promisify } from 'node:util';
import { unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { buildPrompt } from './prompt-builder.js';
import { stageCliWorktree } from './worktree-stage.js';
import { sendExternalForNotification } from './external-notifications.js';
import { notificationsService } from './notifications.js';
import { agentMemoryService } from './agent-memory.js';
import { verifyRunCommits } from './commit-verifier.js';
import { buildWorktreePreamble } from './worktree-orchestrator.js';
import { runProjectSetup } from './project-setup-runner.js';
import { parseRunOutcome } from './run-outcome-parser.js';
import {
    buildCompletionCommentBody,
    buildOrchestratorRunCompletedBody,
} from './agent-runner-completion-comment.js';
import { commentsService } from './comments.js';
import { normalizeModelForCli, resolveSpawn } from './cli-model-naming.js';
import { ollamaEnv } from './ollama-env.js';
import { gitInvokeEnv } from './git-env.js';
import { ATLAS_MCP_URL } from '../plugins/mcp-host.js';
import { apiPort } from '../config.js';
import { buildGitAuth, cleanupGitConfig } from './git-credentials.js';
import { agentIdToSlug } from './commands-assembler.js';
import { assemblePreamble } from './preamble-assembler.js';
import {
    CLI_DIALECT,
    type AgentCli,
    type ApiErrorKind,
    type IAgent,
    type IRunOutcome,
    type IssueType,
} from '@atlas/shared';

// W4 — Run-error classification. The runner spawns CLIs asynchronously
// after the HTTP request has already returned 202, so we can't surface
// these via the typed-throw pipeline; instead we tag the persisted run
// row's `output_text` with a parseable marker AND augment the run_error
// SSE event with the kind + details. The web run-detail page reads the
// marker to render an <ApiErrorAlert> banner over the raw log.
interface RunErrorClassification {
    kind: ApiErrorKind;
    details?: unknown;
}

function classifyRunError(err: NodeJS.ErrnoException, bin: string): RunErrorClassification {
    if (err.code === 'ENOENT') {
        return { kind: 'cli_not_installed', details: { binary: bin } };
    }
    return { kind: 'internal_error' };
}

function formatErrorMarker(c: RunErrorClassification): string {
    const payload = c.details === undefined ? '' : `:${JSON.stringify(c.details)}`;
    return `[error-kind:${c.kind}${payload}]`;
}

// Live output registry — mirrors each active spawnCli's accumulator so REST
// GET /api/run/:id can return the freshest bytes without waiting for the
// next 10s DB flush. Populated when spawnCli starts a child, deleted on
// close/error. Read by routes/run.ts.
export const runOutputRegistry = new Map<string, string>();

// Workstream #6 (2026-06-02) — live child-process registry keyed by
// runId so the stop-a-run endpoint can find the right subprocess to
// kill. Populated immediately after `nodeSpawn(...)` in `spawnCli`,
// deleted from inside the `exit` and `error` handlers so the registry
// always reflects "live children with finalize still pending". Used by
// `cancelRun(runId)` below; not intended for other consumers.
const runChildren = new Map<string, ReturnType<typeof nodeSpawn>>();

// 2026-06-09 — /commands framework Phase 4. Per-run path to the active
// agent's body at the USER-LEVEL Copilot agents directory
// (`~/.copilot/agents/atlas-<runId>.md`). Copilot CLI's `--agent`
// flag has no worktree-local lookup (verified via Phase 0 spike on
// 2026-06-09), so the runner writes the agent body at user level with
// a UUID-unique filename per run, then unlinks it on
// `finalizeAfterCli` + `child.on('error')`. Empty when the spawn
// target is Claude (worktree-local `.claude/commands/atlas-<slug>.md`
// is sufficient).
const runCopilotAgentFiles = new Map<string, string>();

// parseClaudeCostFromOutput lives in `./claude-cost-parser.ts` — used here
// for autonomous-run cost extraction from `claude -p --output-format
// stream-json`. Re-exported for the back-compat `parse-cost.test.ts` import.
import { parseClaudeCostFromOutput, type CostFields } from './claude-cost-parser.js';
export { parseClaudeCostFromOutput };

// Copilot CLI's `--output-format json` does NOT expose either an AI
// credit total or input-token count — only `usage.premiumRequests`
// (count of model API calls). To match the dollar amount shown in
// Copilot's text-mode summary ("AI Credits 7.99") we estimate AI
// credits from `premiumRequests * CREDITS_PER_PREMIUM_REQUEST[model]`,
// then convert to USD at the Owner-confirmed rate of $0.01 per credit
// (2026-06-01). The multiplier table is seeded from observed text-mode
// runs — the smoke-test ping on `claude-sonnet-4.6` consumed 7.99
// credits per 1 premium request, so ~8 is the right starting point.
// Unknown models fall back to 1 (lower bound; will under-report cost).
// Tune this table when the user reports a model's text-mode credit
// total diverging from `premiumRequests * multiplier`.
const COPILOT_USD_PER_CREDIT = 0.01;
// Workstream #6 (2026-06-02) — the per-model `premiumRequests × multiplier`
// credit estimate was removed. When the stderr `AI Credits` line is absent,
// credits stays null and the UI hides the cost row entirely (matches Claude's
// behavior on runs without a `result` event). Better to show nothing than a
// "$0.01 ~ from 1 premium request" string that misrepresents short runs.

// parseClaudeCostFromOutput lives in ./claude-cost-parser.ts (see the
// import + re-export block above).

// Copilot CLI emits a human-readable stderr summary at the end of every
// non-trivial run, captured into `output_text` via the `[stderr]`
// prefix. The summary has up to three lines we care about:
//
//   [stderr] Changes    +223 -37
//   [stderr] AI Credits 119 (9m 5s)
//   [stderr] Tokens     ↑ 2.4m (2.3m cached) • ↓ 17.3k (2.4k reasoning)
//
// These are authoritative for cost (AI Credits is the real billed
// count, NOT a multiplier of `usage.premiumRequests`) and for the full
// token breakdown the JSONL stream doesn't expose (input tokens, cache
// reads, reasoning tokens). The summary may be absent on very short
// runs — we fall back to the JSONL `premiumRequests * multiplier`
// estimate for credits, and leave token fields null.
const COPILOT_CREDITS_RE = /\bAI Credits\s+([\d.]+)/i;
// Captures `↑ <input> (<cached> cached) • ↓ <output> (<reasoning> reasoning)`.
// All four token slots use Copilot's short-form notation (1.5k, 2.4m).
// `cached` and `reasoning` groups are optional — they only appear when
// the values are non-zero.
// The `(X cached)` group also accepts `(X cached, Y written)` — Copilot
// CLI added the `written` breakdown around 2026-06; the `(?:,[^)]*)?`
// non-capturing tail swallows it (and any future extra fields inside
// the same parens) without affecting the captured cached number.
const COPILOT_TOKENS_RE = /↑\s*([\d.]+[kKmM]?)(?:\s*\(([\d.]+[kKmM]?)\s*cached(?:,[^)]*)?\))?\s*•\s*↓\s*([\d.]+[kKmM]?)(?:\s*\(([\d.]+[kKmM]?)\s*reasoning\))?/;

function parseShortFormCount(s: string | undefined): number | null {
    if (!s) return null;
    const m = s.match(/^([\d.]+)([kKmM]?)$/);
    if (!m || !m[1]) return null;
    const base = Number(m[1]);
    if (!Number.isFinite(base)) return null;
    const unit = (m[2] ?? '').toLowerCase();
    const multiplier = unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1;
    return Math.round(base * multiplier);
}

// Parses Copilot CLI's `--output-format json` NDJSON plus the stderr
// summary. Source-of-truth order:
//   1. **AI Credits line** in stderr (authoritative credit count) — use
//      `credits * $0.01` for USD.
//   2. **`result.usage.premiumRequests`** in JSONL (count of API calls) —
//      multiply by the per-model factor as a fallback estimate when
//      stderr didn't surface the AI Credits line (short runs, dry-runs).
//   3. **`assistant.message.data.outputTokens`** (per turn) — accumulate
//      for the total output-token display.
// Returns null when no `result` event is present (CLI crash, simulated
// run, partial output).
export function parseCopilotCostFromOutput(output: string): CostFields | null {
    let outputTokensJsonl: number | null = null;
    let sawResult = false;
    let stderrCredits: number | null = null;
    // Token breakdown extracted from the `Tokens ↑ X (Y cached) • ↓ Z
    // (W reasoning)` stderr line. When present these override the JSONL
    // `assistant.message.outputTokens` sum because they include
    // reasoning tokens and the full input/cache breakdown the JSONL
    // doesn't expose.
    let stderrInputTotal: number | null = null;
    let stderrCacheRead: number | null = null;
    let stderrOutput: number | null = null;

    for (const raw of output.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('[stderr]')) {
            const cm = line.match(COPILOT_CREDITS_RE);
            if (cm && cm[1]) {
                const parsed = Number(cm[1]);
                if (Number.isFinite(parsed)) stderrCredits = parsed;
            }
            const tm = line.match(COPILOT_TOKENS_RE);
            if (tm) {
                stderrInputTotal = parseShortFormCount(tm[1]);
                stderrCacheRead = parseShortFormCount(tm[2]);
                stderrOutput = parseShortFormCount(tm[3]);
                // tm[4] is the reasoning-token count; not stored (yet) — it's
                // a subset of the output total Copilot already reports.
            }
            continue;
        }
        if (!line.startsWith('{')) continue;
        try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            const type = obj['type'];
            if (type === 'assistant.message') {
                const data = obj['data'] as Record<string, unknown> | undefined;
                const t = typeof data?.['outputTokens'] === 'number' ? (data['outputTokens'] as number) : null;
                if (t !== null) outputTokensJsonl = (outputTokensJsonl ?? 0) + t;
            } else if (type === 'result') {
                sawResult = true;
            }
        } catch {
            /* skip malformed line */
        }
    }
    if (!sawResult && stderrCredits === null) return null;

    // Credit / cost — populated ONLY when the stderr authoritative
    // `AI Credits N` line landed. Short runs that exit before the stats
    // summary prints get null for both, and the UI hides the cost row
    // entirely (same shape as a Claude run that didn't emit a `result`).
    const credits: number | null = stderrCredits;
    const totalCostUsd =
        credits !== null ? Number((credits * COPILOT_USD_PER_CREDIT).toFixed(4)) : null;

    // Token calculation — prefer the stderr summary (which exposes the
    // full input/cache/output breakdown). Fall back to the JSONL
    // `assistant.message.outputTokens` sum when the summary is absent.
    let inputTokens: number | null = null;
    let cacheReadTokens: number | null = null;
    let outputTokens: number | null = outputTokensJsonl;
    if (stderrOutput !== null || stderrInputTotal !== null) {
        // The `↑ X` total is uncached + cached input combined; the AI
        // Usage card's `Context` row already adds those columns, so we
        // store the breakdown the same way Claude does: `input_tokens`
        // holds NEW (uncached) input; `cache_read_tokens` holds cached
        // input. When `cached` isn't present, treat the whole ↑ value as
        // new input.
        if (stderrInputTotal !== null) {
            inputTokens = stderrCacheRead !== null
                ? Math.max(0, stderrInputTotal - stderrCacheRead)
                : stderrInputTotal;
            cacheReadTokens = stderrCacheRead;
        }
        if (stderrOutput !== null) outputTokens = stderrOutput;
    }

    return {
        total_cost_usd: totalCostUsd,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_tokens: null, // Copilot's billing has no cache-creation concept.
        cache_read_tokens: cacheReadTokens,
        credits,
    };
}

// Dispatcher — picks the right parser based on the CLI that produced
// the output. Falls back to `null` for unknown CLIs (treated like a
// simulated run).
//
// Ollama runs are free. They emit Claude stream-json, so the token counts are
// real and worth keeping, but `total_cost_usd` in that payload is whatever the
// CLI computed from Anthropic's price table against a model it never billed —
// meaningless here. Zero it out so Analytics shows Ollama at $0 rather than a
// phantom charge.
export function parseCostFromOutput(
    output: string,
    cli: AgentCli,
): CostFields | null {
    if (cli === 'ollama') {
        const parsed = parseClaudeCostFromOutput(output);
        return parsed ? { ...parsed, total_cost_usd: 0 } : parsed;
    }
    return CLI_DIALECT[cli] === 'claude'
        ? parseClaudeCostFromOutput(output)
        : parseCopilotCostFromOutput(output);
}

// 2026-06-02 — Deep fallback for run finalization. Primary trigger is
// `child.on('exit')` (fires on OS process death regardless of stdio
// state — see the bottom of `spawnCli`). This detector arms a 15s
// grace timer if the CLI prints its `{"type":"result"}` stream-json
// line but `exit` somehow never fires (rare; the only known cause is
// a CLI bug hanging the process itself).
//
// Both Claude (`--output-format stream-json`) and Copilot
// (`--output-format json`) emit exactly one `{"type":"result",...}`
// NDJSON line as their authoritative completion signal. Originally
// this was meant to work around Windows zombie-grandchild pipe
// inheritance (MON-2 architect run 65d10c9e-..., 2026-06-01: zombie
// `specify init` chains held stdio pipes open and blocked
// `child.on('close')` indefinitely). Switching the primary trigger
// from `close` to `exit` made stdio inheritance irrelevant; this
// detector remains as the deep-fallback for CLI-internal hangs.
//
// Grace window: 15s. Long enough for a healthy CLI to drain its
// remaining tool_result lines + close MCP servers; short enough that a
// stranded run is recovered well within the SDLC's chain timing budget.
const CLI_RESULT_EXIT_GRACE_MS = 15_000;

const execFile = promisify(nodeExecFile);

// Walks the descendant process tree and force-kills every PID. On
// Windows: `taskkill /T /F /PID <pid>` does both walk + kill in one
// call. On POSIX: `process.kill(-pid)` requires the spawn to have
// started a new process group (`detached: true`) which the runner does
// NOT do today — fall back to a plain SIGTERM/SIGKILL on the child
// itself; POSIX rarely hits the zombie-pipe issue anyway. Best-effort
// + non-throwing; the caller proceeds with finalize whether kill
// succeeds or not.
async function killProcessTree(pid: number | null): Promise<void> {
    if (pid === null || pid === undefined) return;
    try {
        if (process.platform === 'win32') {
            await execFile('taskkill', ['/T', '/F', '/PID', String(pid)], {
                timeout: 10_000,
            });
        } else {
            // POSIX. Try SIGTERM first; SIGKILL after a brief grace.
            try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
            await new Promise((r) => setTimeout(r, 2_000));
            try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
        }
    } catch {
        // Already dead, no such PID, or taskkill couldn't access — any
        // of these means we're closer to (or already at) the desired
        // state. Swallow and let the caller continue.
    }
}

// Workstream #6 — best-effort subprocess kill keyed by runId. Called
// from the `POST /api/run/:id/stop` route after the DB row has already
// flipped to `status = 'cancelled'`. Returns `{cancelled: false,
// pidKilled: null}` for runs that aren't live (queued-but-not-spawned,
// or already exited and removed from the registry) — the caller trusts
// the DB write as the source of truth either way.
export async function cancelRun(
    runId: string,
): Promise<{ cancelled: boolean; pidKilled: number | null }> {
    const child = runChildren.get(runId);
    if (!child) return { cancelled: false, pidKilled: null };
    const pid = child.pid ?? null;
    await killProcessTree(pid);
    // The `exit` handler clears the registry entry — leave it alone here
    // so we don't race the natural cleanup path.
    return { cancelled: true, pidKilled: pid };
}

//
// Returns `{ subtype: 'success' | 'error' }` if the line is a result
// envelope, else null. Cheap pre-check (`includes('"type":"result"')`)
// before JSON.parse so per-line cost on the hot stdout path stays
// negligible.
export function detectCliResultLine(line: string):
    | { subtype: 'success' | 'error' }
    | null {
    if (!line || !line.includes('"type":"result"')) return null;
    let obj: unknown;
    try {
        obj = JSON.parse(line);
    } catch {
        return null;
    }
    if (!obj || typeof obj !== 'object') return null;
    const r = obj as { type?: unknown; subtype?: unknown; exitCode?: unknown };
    if (r.type !== 'result') return null;
    if (r.subtype === 'success' || r.subtype === 'error') {
        return { subtype: r.subtype };
    }
    // Copilot path: `exitCode: 0` → success, anything else → error.
    if (typeof r.exitCode === 'number') {
        return { subtype: r.exitCode === 0 ? 'success' : 'error' };
    }
    return null;
}

async function getAgent(agentId: string): Promise<IAgent | undefined> {
    const row = await db
        .selectFrom('agents')
        .selectAll()
        .where('id', '=', agentId)
        .executeTakeFirst();
    return row as unknown as IAgent | undefined;
}

// ADR 0014 — every terminal exit of a run reports to the workflow engine,
// which decides the next step. Runs outside a workflow (project scaffold,
// ad-hoc test runs) make it a no-op. Dynamic import breaks the
// runner → engine → runner cycle.
async function notifyStep(runId: string): Promise<void> {
    try {
        const { onStepFinished } = await import('./workflow-engine.js');
        await onStepFinished(runId);
    } catch (err) {
        console.warn(
            `[agent-runner] workflow step report failed for ${runId}: ${(err as Error).message}`,
        );
    }
}

async function isWorkflowStep(runId: string): Promise<boolean> {
    const row = await db
        .selectFrom('agent_runs')
        .select('workflow_run_id')
        .where('id', '=', runId)
        .executeTakeFirst();
    return Boolean(row?.workflow_run_id);
}

async function createAgentNotification(opts: {
    eventType: string;
    message: string;
    issueType: IssueType | null;
    issueId: string | null;
    agentId: string;
    kind: 'needs_you' | 'update';
}): Promise<number> {
    const row = await notificationsService.create({
        event_type: opts.eventType,
        message: opts.message,
        issue_type: opts.issueType,
        issue_id: opts.issueId,
        agent_id: opts.agentId,
        kind: opts.kind,
    });
    return row.id;
}

// Agent-agnostic by design — agents persist their own deliverables via
// Atlas MCP tools (architect → `updateItem({ spec_md })`). If an agent fails
// to persist, its prompt MUST exit `asked_question` with a clear error; the
// orchestrator does NOT backfill or retry on the agent's behalf.

export async function completeRun(
    runId: string,
    agentId: string,
    issueType: IssueType | null,
    issueId: string | null,
    output: string,
): Promise<void> {
    const now = new Date().toISOString();
    // Look up the agent's CLI so the cost parser picks the right NDJSON
    // shape (Claude stream-json vs Copilot json). Missing agent (deleted
    // mid-run) falls back to Claude.
    const agent = await getAgent(agentId);
    const cli: AgentCli = agent?.cli ?? 'claude';
    const cost = parseCostFromOutput(output, cli);
    // If the Owner clicked Stop mid-flight the row is already `cancelled`.
    // Keep that status; the output + cost were earned regardless.
    const currentRow = await db
        .selectFrom('agent_runs')
        .select('status')
        .where('id', '=', runId)
        .executeTakeFirst();
    const wasCancelled = (currentRow?.status as string | undefined) === 'cancelled';
    await db
        .updateTable('agent_runs')
        .set({
            ...(wasCancelled
                ? { output_text: output, ...(cost ?? {}) }
                : {
                      status: 'completed',
                      output_text: output,
                      completed_at: now,
                      ...(cost ?? {}),
                  }),
        })
        .where('id', '=', runId)
        .execute();

    // Persisted for every run shape: the workflow engine routes on these
    // columns, including project-level runs that have no item.
    const outcome = parseRunOutcome(output);
    await persistRunOutcome(runId, outcome);

    if (wasCancelled) {
        broadcastSSE({ type: 'run_completed', agentId, runId, status: 'cancelled' });
        await notifyStep(runId);
        return;
    }

    broadcastSSE({
        type: 'run_completed',
        agentId,
        runId,
        ...(issueType ? { issueType } : {}),
        ...(issueId ? { issueId } : {}),
        status: 'completed',
    });

    const inWorkflow = await isWorkflowStep(runId);
    if (issueId && issueType) {
        // The agent's outcome (result, reason, summary) plus a run link. The
        // next workflow step reads this thread, so a rejection reason reaches
        // the step that has to fix it.
        try {
            await commentsService.create({
                author: 'agent',
                agent_id: agentId,
                issue_type: issueType,
                issue_id: issueId,
                body: buildOrchestratorRunCompletedBody({
                    agentId,
                    agentName: agent?.name ?? agentId,
                    runId,
                    issueType,
                    outcome,
                }),
            });
        } catch {
            /* run-info pin is best-effort */
        }
    } else if (!inWorkflow) {
        // Workflow steps notify at park / End; a standalone run has no one
        // else to tell the Owner it finished.
        const noItemMessage = `Agent "${agent?.name ?? agentId}" finished a run.`;
        const noItemNotificationId = await createAgentNotification({
            eventType: 'agent_completed_no_item',
            message: noItemMessage,
            issueType: null,
            issueId: null,
            agentId,
            kind: 'update',
        });
        try {
            await sendExternalForNotification(
                noItemNotificationId,
                noItemMessage,
                'agent.run_finished_no_item',
            );
        } catch {
            /* External notification optional. */
        }
    }

    await notifyStep(runId);

    // Theme 08 — post-run memory hook. Best-effort; a memory failure must
    // NOT fail the run itself.
    try {
        await agentMemoryService.maybeRegenerateAfterRun(agentId, runId, 'completed');
    } catch {
        /* memory hook is best-effort */
    }

    // Theme 11 — commit-discipline verifier. Best-effort.
    if (issueId && issueType) {
        try {
            await runCommitVerifier(runId, agentId, issueType, issueId);
        } catch {
            /* verifier is best-effort */
        }
    }
}

async function errorRun(
    runId: string,
    agentId: string,
    issueType: IssueType | null,
    issueId: string | null,
    errorMsg: string,
    classification?: RunErrorClassification,
): Promise<void> {
    const now = new Date().toISOString();
    // W4 — prepend the classification marker so the run-detail page can
    // parse the kind out of `output_text` and render a typed banner.
    const marker = classification ? `${formatErrorMarker(classification)} ` : '';
    const errOutput = `[ERROR] ${marker}${errorMsg}`;
    const errAgent = await getAgent(agentId);
    const errCli: AgentCli = errAgent?.cli ?? 'claude';
    const errCost = parseCostFromOutput(errorMsg, errCli);
    // Preserve `cancelled` the same way completeRun does: the crash that
    // follows SIGTERM must not flip the row back to `error`.
    const errCurrentRow = await db
        .selectFrom('agent_runs')
        .select('status')
        .where('id', '=', runId)
        .executeTakeFirst();
    const errWasCancelled = (errCurrentRow?.status as string | undefined) === 'cancelled';
    await db
        .updateTable('agent_runs')
        .set({
            ...(errWasCancelled
                ? { output_text: errOutput, ...(errCost ?? {}) }
                : {
                      status: 'error',
                      output_text: errOutput,
                      completed_at: now,
                      ...(errCost ?? {}),
                  }),
        })
        .where('id', '=', runId)
        .execute();

    if (errWasCancelled) {
        broadcastSSE({ type: 'run_completed', agentId, runId, status: 'cancelled' });
        await notifyStep(runId);
        return;
    }

    broadcastSSE({
        type: 'run_error',
        agentId,
        runId,
        ...(issueType ? { issueType } : {}),
        ...(issueId ? { issueId } : {}),
        status: 'error',
        errorDetail: errorMsg,
        ...(classification?.kind ? { errorKind: classification.kind } : {}),
        ...(classification?.details !== undefined ? { errorDetails: classification.details } : {}),
    });

    const inWorkflow = await isWorkflowStep(runId);
    if (issueId && issueType) {
        // One comment per run keeps the activity feed uniform whether the
        // run succeeded or crashed. Best-effort.
        try {
            await commentsService.create({
                author: 'agent',
                agent_id: agentId,
                issue_type: issueType,
                issue_id: issueId,
                body: buildCompletionCommentBody({
                    agentId,
                    agentName: errAgent?.name ?? agentId,
                    runId,
                    issueType,
                    errorMsg,
                }),
            });
        } catch {
            /* auto-comment is best-effort */
        }
    }
    if (!inWorkflow) {
        const message = `Agent "${errAgent?.name ?? agentId}" errored${issueId ? ` on ${issueType} ${issueId}` : ''}. Error: ${errorMsg}`;
        const notificationId = await createAgentNotification({
            eventType: issueId ? 'agent_error' : 'agent_error_no_item',
            message,
            issueType,
            issueId,
            agentId,
            kind: 'needs_you',
        });
        try {
            await sendExternalForNotification(
                notificationId,
                message,
                issueId ? 'agent.failed' : 'agent.run_finished_no_item',
            );
        } catch {
            /* non-fatal */
        }
    }

    await notifyStep(runId);

    try {
        await agentMemoryService.maybeRegenerateAfterRun(agentId, runId, 'error');
    } catch {
        /* memory hook is best-effort */
    }

    if (issueId && issueType) {
        try {
            await runCommitVerifier(runId, agentId, issueType, issueId);
        } catch {
            /* verifier is best-effort */
        }
    }
}

// Theme 11 — resolves cwd + started_at, then delegates to the verifier.
// A workflow step's commits live in the run's worktree, not the project
// checkout, so prefer that path when there is one.
async function runCommitVerifier(
    runId: string,
    agentId: string,
    issueType: IssueType,
    issueId: string,
): Promise<void> {
    const run = await db
        .selectFrom('agent_runs as r')
        .leftJoin('workflow_runs as w', 'w.id', 'r.workflow_run_id')
        .select(['r.started_at', 'w.worktree_path'])
        .where('r.id', '=', runId)
        .executeTakeFirst();
    if (!run?.started_at) return;
    const settings = await db
        .selectFrom('settings')
        .select(['workspace_path'])
        .where('id', '=', 1)
        .executeTakeFirst();
    const workspacePath = (settings?.workspace_path as string | null) || process.cwd();
    const itemRow = await db
        .selectFrom('items as i')
        .leftJoin('projects as p', 'p.id', 'i.project_id')
        .select(['p.git_path as project_git_path'])
        .where('i.id', '=', issueId)
        .executeTakeFirst();
    const cwd =
        (run.worktree_path as string | null) ||
        (itemRow?.project_git_path as string | null) ||
        workspacePath;
    await verifyRunCommits({
        runId,
        agentId,
        itemId: issueId,
        cwd,
        runStartedAtIso: run.started_at,
        itemType: issueType,
    });
}

function simulateRun(
    runId: string,
    agentId: string,
    issueType: IssueType | null,
    issueId: string | null,
    prompt: string,
): void {
    const lines = [
        'Analyzing the issue context...',
        'Reviewing the task and project requirements...',
        'Drafting structured output...',
        'Applying quality checks...',
        'Finalizing response...',
    ];

    let i = 0;
    const tick = (): void => {
        if (i < lines.length) {
            const line = lines[i];
            if (line) {
                broadcastSSE({ type: 'agent_output', agentId, runId, output: line });
            }
            i++;
            setTimeout(tick, 600);
        } else {
            // The outcome block — passing every checklist row, or strict mode
            // would turn `done` into a fail — lets AI-disabled environments
            // (e2e, demos) walk a workflow end to end.
            void (async () => {
                const rows = await db
                    .selectFrom('agent_checklists')
                    .select('id')
                    .where('agent_id', '=', agentId)
                    .execute();
                const checklist = rows.length
                    ? `\nchecklist:\n${rows.map((r) => `  - id: ${Number(r.id)}\n    passed: true`).join('\n')}`
                    : '';
                const simulatedOutput = `[SIMULATED — set ATLAS_AI_ENABLED=true to use real CLI]\n\nPrompt length: ${prompt.length} chars\n\nThis is a placeholder response that would be generated by the assigned agent CLI.\n\n\`\`\`atlas-outcome\noutcome: done\nsummary: Simulated run.${checklist}\n\`\`\``;
                await completeRun(runId, agentId, issueType, issueId, simulatedOutput);
            })();
        }
    };

    setTimeout(tick, 400);
}

interface SpawnCliOptions {
    agent: IAgent;
    runId: string;
    issueType: IssueType | null;
    issueId: string | null;
    prompt: string;
    cwd: string;
    /** Theme 09b — per-run temporary git config path. When set, the
     *  spawn inherits `GIT_CONFIG_GLOBAL=<path>` so the agent's git
     *  shell-out picks up `http.extraheader` auth for `git push` PLUS
     *  the `[user]` block that attributes `git commit` to the App's
     *  bot identity (built via `buildGitAuth`). */
    gitConfigPath?: string | null;
    /** Same-run plaintext token, exposed to the child as `GH_TOKEN` /
     *  `GITHUB_TOKEN` so `gh pr create` inside the CLI authenticates
     *  as the App instead of falling back to the developer's local
     *  `gh auth login` in `~/.config/gh/hosts.yml`. */
    ghToken?: string | null;
    /** Plan #7 — when the run has no worktree, the artefact files
     *  (MANDATE_CONSTITUTION.md + WORK.md) live in this throwaway
     *  os.tmpdir() subdirectory. Recursively removed by the exit /
     *  error handlers next to the existing gitConfigPath unlink. Null
     *  when the artefacts live inside a worktree (cleanup is the
     *  worktree's responsibility). */
    artefactTmpRoot?: string | null;
    /** 2026-06-09 — /commands framework Phase 4. When the spawn target
     *  is Copilot CLI, `assembleCommands` writes the active agent's
     *  body to `~/.copilot/agents/atlas-<runId>.md` (user-level — the
     *  only location Copilot CLI's `--agent` flag reads). Stashed here
     *  so `finalizeAfterCli` + `child.on('error')` can unlink it.
     *  Null when the spawn target is Claude (worktree-local
     *  `.claude/commands/` is enough) or when there's no worktree. */
    copilotUserAgentPath?: string | null;
}

/**
 * Claude-dialect flags that cut an agent run off from the Owner's personal
 * Claude Code config. Without them the child inherits ~/.claude hooks and
 * plugins (the Owner's SessionStart hooks ran inside agent runs), the user
 * CLAUDE.md, and whatever MCP servers ~/.claude.json declares. `project,local`
 * keeps the worktree's `.claude/commands/atlas-*` slash commands loading; the
 * strict MCP config declares only the Atlas HTTP server, which needs no auth
 * header. `--mcp-config` is variadic, so the prompt must stay on stdin.
 */
export function claudeIsolationArgs(itemAttached: boolean): string[] {
    // Runs without an item (ai-news, market-research, regulations,
    // jira-to-epic scouts) depend on Owner-scoped MCP servers — the Playwright
    // plugin and claude.ai connectors — that a strict Atlas-only config would
    // strip.
    if (!itemAttached) return [];
    return [
        '--setting-sources', 'project,local',
        '--strict-mcp-config',
        '--mcp-config', JSON.stringify({ mcpServers: { atlas: { type: 'http', url: ATLAS_MCP_URL } } }),
    ];
}

/**
 * Child env for every agent run. `ATLAS_API_URL` lets `.atlas/scripts`
 * validators query the API directly. The ollama overlay MUST come after the
 * `gitInvokeEnv` spread (which spreads process.env), or an
 * ANTHROPIC_API_KEY in the Owner's shell wins and this nominally-free local
 * run bills Anthropic instead.
 */
export function agentRunEnv(
    cli: AgentCli,
    model: string,
    gitConfigPath: string | null,
    ghToken: string | null,
): NodeJS.ProcessEnv {
    return {
        ...gitInvokeEnv(gitConfigPath, ghToken),
        ATLAS_API_URL: `http://127.0.0.1:${apiPort()}`,
        ...ollamaEnv(cli, model),
    };
}

function spawnCli(opts: SpawnCliOptions): void {
    const {
        agent,
        runId,
        issueType,
        issueId,
        prompt,
        cwd,
        gitConfigPath,
        ghToken,
        artefactTmpRoot,
        copilotUserAgentPath,
    } = opts;
    // Ollama runs the Claude Code binary — it differs only in the env overlay
    // applied to `childEnv` below. Branch on the dialect, never on `agent.cli`.
    const dialect = CLI_DIALECT[agent.cli];
    const bin = dialect === 'claude' ? 'claude' : 'copilot';

    // Claude Code CLI: --print = non-interactive, prompt on stdin. Since
    // 2026-09-14 `claudeIsolationArgs` limits item-driven (SDLC) runs to
    // project/local settings and the Atlas MCP server only; freedom-mode scouts
    // keep the Owner's config because their playwright / claude.ai Atlassian
    // prefixes below come from Owner-scoped servers.
    // To silence --print-mode permission prompts on MCP tool calls — without
    // an interactive UI to answer them, an un-allowlisted call either denies
    // or hangs and worker models then overgeneralise to "I don't have
    // permission for any tool" — we pass --allowedTools with an explicit
    // list of MCP server prefixes the agent fleet uses (atlas, playwright,
    // claude.ai Atlassian). Claude Code's permission pattern syntax doesn't
    // support an `mcp__*` wildcard; each server must be named. Extend this
    // list when a new agent needs a new server. The constitution's "Forbidden
    // Atlas MCP tool calls" clause in prompt-builder.ts stays as the prompt-
    // level safety net for destructive control-plane mutations (createAgent
    // / updateAgent / deleteAgent etc.) regardless of the wildcard.
    //
    // --verbose --output-format stream-json: prints one NDJSON event per turn
    // (system/init, assistant text+tool_use, tool_result, final result with
    // cost+duration) instead of just the final assistant text. Required pair
    // — `--print --output-format stream-json` without `--verbose` errors out.
    // We parse each line back into a readable transcript below so the Owner
    // sees "what the CLI did" (tool calls, file edits, results) in the run
    // log, not just the wrap-up paragraph.
    //
    // GitHub Copilot CLI (`copilot` binary, installed via
    // `npm i -g @github/copilot`): --allow-all-tools is required for
    // non-interactive runs; --add-dir whitelists the repo path. The prompt
    // arrives via `-p <text>` argv, but `<text>` is now a short shim
    // pointing at the staged prompt file (see prompt staging block below);
    // Copilot reads the file via its built-in tools.
    const model = normalizeModelForCli(agent.model, agent.cli);
    // Task 6 — reasoning-effort knob forwarded to the CLI. Both
    // `claude --effort` and `copilot --reasoning-effort` accept the same
    // six values (verified live via `copilot --help` and
    // code.claude.com/docs/en/cli-reference). `--effort` is the long
    // form on both, so we use it uniformly.
    const effort = agent.effort ?? 'medium';

    // 2026-06-09 — /commands framework. The orchestrator pre-stages
    // every artifact the agent needs (constitution / handoff /
    // current-task / templates / scripts / agent body) before spawning,
    // and the CLI invocation is exactly and only the slash command.
    // No prompt envelope, no Read-and-execute trigger. See plan:
    // `.../glittery-quail.md` and memory `feedback_speckit_pure_slash_invocation`.
    //
    //   Claude  : `claude --print [flags] /atlas-<slug>` — slug carries
    //             the positional `[prompt]` argv slot. Phase 0 spike
    //             confirmed Claude's slash-command resolver expands the
    //             positional in `--print` mode against
    //             `<cwd>/.claude/commands/atlas-<slug>.md`. The `-p`
    //             short-form of `--print` does NOT work with a positional
    //             value (it greedily consumes it as the print mode's
    //             value); use `--print` explicitly.
    //
    //   Copilot : `copilot -p "execute the atlas-<slug> agent" --agent
    //             atlas-<runId>`. Copilot CLI has no slash-command
    //             resolver in non-interactive `-p` mode (it would
    //             interpret `/X` as a filesystem path); custom agents
    //             via `--agent` is the equivalent. The agent body lives
    //             at `~/.copilot/agents/atlas-<runId>.md` — user-level
    //             because Copilot CLI has no worktree-local lookup.
    //             Per-run UUID name prevents collision across worktrees.
    //
    // The `prompt` parameter passed in by `spawnAgentRun` is the giant
    // envelope that used to be sent over the wire — we still build it
    // for `agent_runs.prompt_snapshot` (audit trail) but the CLI never
    // sees it; it reads `.atlas/current-task.md` + constitution.md +
    // handoff.md + the slash-command body instead.
    void prompt;
    const slug = agentIdToSlug(agent.id);
    const slashCommand = `/atlas-${slug}`;
    const copilotTrigger = `Execute the atlas-${slug} agent — read .atlas/constitution.md, .atlas/current-task.md, .atlas/outcome.md, and the relevant template, then complete the work.`;

    // `--effort` is omitted on the Ollama dialect. Ollama's docs scope thinking
    // controls to "compatible models" only, and most local models have no
    // thinking mode at all — a rejected flag fails the whole run, which is a
    // far worse trade than losing the knob. Claude proper keeps it.
    const effortArgs = agent.cli === 'ollama' ? [] : ['--effort', effort];

    const args = dialect === 'claude'
        ? [
              // Claude Code CLI — non-interactive single-shot. The slash
              // command sits at the end as the positional `[prompt]`
              // argv slot; Claude's resolver expands it against
              // `.claude/commands/atlas-<slug>.md` (written per run by
              // `assembleCommands`).
              //
              // --verbose --output-format stream-json: prints one NDJSON
              // event per turn (system/init, assistant text+tool_use,
              // tool_result, final result with cost+duration) instead of
              // just the final assistant text. Required pair —
              // `--print --output-format stream-json` without `--verbose`
              // errors out.
              //
              // P1 — extend the allowlist with Claude's built-in file +
              // shell tools so SDLC agents downstream of PO Writer
              // (Architect, Coder, Automation) can drive git worktrees,
              // run `specify`/`gh`, and edit spec/test files directly
              // instead of going through MCP. PO Writer and QA Writer
              // don't strictly need Bash/file tools but inheriting them
              // is harmless — the prompt-level guardrails still scope
              // what each agent actually does.
              //
              // Hard-block sub-agent dispatch + off-charter network tools.
              // `Task` is Claude Code's sub-agent tool; its runs would not
              // be itemized in the Atlas run row, so cost and logs would
              // vanish into this run's summary. `WebFetch`/`WebSearch` are
              // off-charter for SDLC agents and add silent token cost. The
              // constitution's "One run = one model session" clause is the
              // soft block; this flag is the hard block.
              // NB: do NOT append `slashCommand` as a positional argv
              // here. `--allowedTools` and `--disallowedTools` are
              // declared `<tools...>` (variadic) in `claude --help`, so
              // Commander.js would greedily absorb anything after them
              // as additional tool names — the positional `[prompt]`
              // slot ends up empty and Claude errors with "Input must
              // be provided either through stdin or as a prompt
              // argument". Phase 4b regression observed on PO Writer
              // run 5beea850-..., 2026-06-09. The slash command is now
              // written to stdin below (unambiguous — no flag can
              // consume stdin).
              '--print',
              '--verbose',
              ...claudeIsolationArgs(issueId !== null),
              '--model', model,
              ...effortArgs,
              '--output-format', 'stream-json',
              '--allowedTools', 'mcp__atlas,mcp__playwright,mcp__claude_ai_Atlassian,Bash,Read,Write,Edit,Glob,Grep',
              '--disallowedTools', 'Task,WebFetch,WebSearch',
          ]
        : [
              // GitHub Copilot CLI — non-interactive single-shot. Phase
              // 0 spike (2026-06-09) confirmed:
              //   - `copilot -p "/X"` does NOT resolve a slash command;
              //     `/X` is interpreted as an absolute filesystem path.
              //   - `copilot -p "<text>" --agent X` DOES resolve the
              //     agent X from `~/.copilot/agents/X.md` (user-level
              //     ONLY — no worktree-local lookup).
              // So Copilot's invocation is: `-p "<trigger>"` carrying a
              // short imperative (the model sees it as the user
              // message), plus `--agent atlas-<runId>` selecting the
              // active agent body. `assembleCommands` has already
              // written `~/.copilot/agents/atlas-<runId>.md` per run
              // (UUID-unique to prevent collision across worktrees).
              // The body itself references `.atlas/{constitution,
              // handoff, current-task,...}` for the actual workflow.
              //
              // Text output, NOT `--output-format json`. JSON mode
              // (probed 2026-06-01) under-reports premium-request usage,
              // which broke credit accounting in the runs UI. The default
              // text mode emits a human-readable trailer to stderr —
              // `Changes +X -Y` / `AI Credits N (Ns)` /
              // `Tokens ↑ X (Y cached) • ↓ Z (W reasoning)` — and
              // `parseCopilotCostFromOutput` already extracts credits +
              // token counts from those lines via regex (see lines
              // 166–296 in this file). Switching back to JSON mode means
              // re-introducing the credit-accounting bug.
              //
              // `--autopilot` (2026-06-01, per
              // docs.github.com/en/copilot/concepts/agents/copilot-cli/autopilot)
              // is required for the CLI to continue across multiple model
              // turns autonomously. Without it the CLI does ONE turn and
              // exits — even a research task that needs to "browse a docs
              // page via Playwright MCP then summarise" can't complete in
              // one turn, which is why the observed run had
              // `premiumRequests: 1` and zero code changes. The
              // `--max-autopilot-continues` cap prevents runaway loops in
              // the (rare) case where the agent can't decide it's done.
              // 30 is roughly the headroom a real multi-file Coder task
              // needs (each turn ≈ 1 LLM call ≈ 1 premium request);
              // adjust if Owner reports tasks hitting the cap.
              '-p', copilotTrigger,
              '--agent', `atlas-${runId}`,
              '--model', model,
              ...effortArgs,
              '--allow-all-tools',
              '--autopilot',
              '--max-autopilot-continues', '30',
              '--add-dir', cwd,
              '--no-color',
          ];

    // Theme 09b — inject GIT_CONFIG_GLOBAL when the run is project-
    // scope and the project has a credential. The agent's git
    // shell-out then transparently authenticates against the remote
    // without us having to inject `-c http.extraheader=...` per
    // invocation (which we can't — the agent runs git via Bash, we
    // don't control its arg list).
    //
    // `gitInvokeEnv` is the same helper every orchestrator git/gh
    // shell-out uses — sharing it here means the spawned agent's own
    // git shell-outs (status/diff/commit, ideally never push/fetch)
    // inherit the exact same GCM-silencing env shape. Drift between
    // the spawn env and the orchestrator's would re-open the same
    // class of leak we just closed.
    const childEnv = agentRunEnv(agent.cli, model, gitConfigPath ?? null, ghToken ?? null);

    let child: ReturnType<typeof nodeSpawn>;
    try {
        // Resolve the `.cmd` shim to `node <entry>.js` on Windows so we
        // bypass `cmd.exe`'s ~8191-char command-line limit (Plan E's
        // constitution + Coder v3 prompt blows past it as `-p` argv).
        // On non-Windows this is a no-op; on Windows it raises the
        // ceiling to CreateProcess's 32,767 chars.
        const resolved = resolveSpawn(bin, args);
        child = nodeSpawn(resolved.command, resolved.args, {
            cwd,
            env: childEnv,
            shell: resolved.useShell,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (err) {
        // W4 — sync spawn rarely throws ENOENT (the async 'error' event is
        // the usual path on Linux/macOS); on Windows with `shell: true` it
        // can throw a CreateProcess EPERM/ENOENT. Either way, classify so
        // the UI can render the kind-aware banner.
        if (copilotUserAgentPath) {
            try { unlinkSync(copilotUserAgentPath); } catch { /* already gone */ }
        }
        const classification = classifyRunError(err as NodeJS.ErrnoException, bin);
        void errorRun(
            runId,
            agent.id,
            issueType,
            issueId,
            `Failed to spawn ${bin}: ${(err as Error).message}`,
            classification,
        );
        return;
    }

    // Workstream #6 — register the live child so the stop-a-run
    // endpoint can find it by runId. Deleted from inside the `exit`
    // and `error` handlers so the registry always tracks "live
    // children with finalize still pending".
    runChildren.set(runId, child);

    // 2026-06-09 — register the user-level Copilot agent file (if any)
    // so the finalize handlers can unlink it. Claude runs never set
    // this — their slash-command bodies live worktree-local under
    // `.claude/commands/` and are cleaned by the next assembleCommands
    // wipe-rewrite.
    if (copilotUserAgentPath) {
        runCopilotAgentFiles.set(runId, copilotUserAgentPath);
    }

    let output = '';
    let stdoutBuf = '';
    runOutputRegistry.set(runId, '');

    function emit(line: string): void {
        if (!line) return;
        output += line + '\n';
        runOutputRegistry.set(runId, output);
        broadcastSSE({ type: 'agent_output', agentId: agent.id, runId, output: line });
    }

    // Periodic flush — bounds data loss on API crash to ≤10s. Best-effort;
    // a transient DB hiccup must not crash the run. The final, authoritative
    // write still happens via completeRun / errorRun on child exit.
    const flushInterval = setInterval(() => {
        void (async () => {
            try {
                await db
                    .updateTable('agent_runs')
                    .set({ output_text: output })
                    .where('id', '=', runId)
                    .execute();
            } catch (err) {
                console.warn(
                    `[agent-runner] periodic flush failed for ${runId}: ${(err as Error).message}`,
                );
            }
        })();
    }, 10_000);

    // Lines are persisted verbatim. Claude's --output-format=stream-json
    // produces one JSON object per line (NDJSON); the web run-detail viewer
    // parses each line and renders a per-event collapsible JSON block so the
    // Owner can analyze the raw Claude stream when tuning prompts. We do NOT
    // pre-format here — the value of stream-json is that nothing is lost.
    // 2026-06-02 — Run-finalization state. The primary trigger is the
    // OS-level `exit` event (fires on process death, not blocked by zombie
    // grandchildren holding stdio pipes); the deep fallback is a 15s
    // grace timer armed when the CLI prints its stream-json result line,
    // which kicks in only if `exit` ALSO never fires (e.g. CLI process
    // itself hangs). `finalizeStarted` is the idempotency guard so the
    // two paths can't double-fire. `graceTimer` is cleared when exit
    // wins so the happy path doesn't carry a dangling timer.
    let finalizeStarted = false;
    let graceTimer: NodeJS.Timeout | null = null;

    async function finalizeAfterCli(
        code: number | null,
        reason: 'exit' | 'result_timeout',
    ): Promise<void> {
        if (finalizeStarted) return;
        finalizeStarted = true;
        if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }

        clearInterval(flushInterval);
        runOutputRegistry.delete(runId);
        // Flush any trailing partial line (a final event with no newline).
        if (stdoutBuf.trim()) {
            emit(stdoutBuf);
            stdoutBuf = '';
        }
        // Theme 09b — cleanup the temp git config now that the agent
        // has exited. Best-effort; tmpdir gets cleaned up eventually
        // even if we miss. Migration 025: buildGitAuth now writes into
        // a temp DIR (config + optional prepare-commit-msg hook), so we
        // route through cleanupGitConfig which does a recursive
        // sanity-checked rmSync — a bare `unlinkSync` here would leave
        // the hook + dir orphaned in tmpdir.
        if (gitConfigPath) cleanupGitConfig(gitConfigPath);
        // 2026-06-09 — cleanup the user-level Copilot agent file (see
        // `runCopilotAgentFiles` declaration). Best-effort — gone is
        // fine if a prior cleanup already removed it.
        const stagedCopilotAgent = runCopilotAgentFiles.get(runId);
        if (stagedCopilotAgent) {
            try { unlinkSync(stagedCopilotAgent); } catch { /* already gone */ }
            runCopilotAgentFiles.delete(runId);
        }
        // Plan #7 — cleanup the per-run artefact tmpdir for runs that
        // didn't have a worktree (worktree-backed runs leave artefacts
        // inside the worktree; the worktree's own cleanup removes
        // them). Best-effort.
        if (artefactTmpRoot) {
            try {
                rmSync(artefactTmpRoot, { recursive: true, force: true });
            } catch {
                /* tmpdir gets reaped eventually */
            }
        }

        if (reason === 'result_timeout') {
            // Deep-fallback path: CLI emitted its result line, never
            // exited, and the OS-level `exit` event also never fired
            // within the grace window. Walk + kill the process tree so
            // any leftover subshells / MCP servers don't accumulate
            // across runs. Best-effort — even if the kill fails, we
            // still proceed with finalize because the CLI's
            // authoritative result envelope is already in `output`.
            emit(
                `[runner] CLI result line seen but process did not exit within ${CLI_RESULT_EXIT_GRACE_MS}ms — killing tree to unblock finalize`,
            );
            await killProcessTree(child.pid ?? null);
        }

        if (code === 0) {
            await completeRun(runId, agent.id, issueType, issueId, output);
        } else {
            await errorRun(
                runId,
                agent.id,
                issueType,
                issueId,
                `CLI exited with code ${code ?? 'unknown'}\n\n${output}`,
            );
        }
    }

    // `stdio: ['pipe', 'pipe', 'pipe']` above guarantees both streams
    // are non-null; the type narrowing requires explicit assertion.
    child.stdout!.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        let idx: number;
        // Stream-json events can split across chunk boundaries — only consume
        // up to the last newline; keep the partial tail for the next chunk.
        while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, idx).replace(/\r$/, '');
            stdoutBuf = stdoutBuf.slice(idx + 1);
            if (!line.trim()) continue;
            emit(line);
            // 2026-06-02 — Deep-fallback arming. The Claude / Copilot
            // CLI emits exactly one `{"type":"result"}` line as its
            // authoritative completion signal. The primary finalize
            // trigger is `child.on('exit')` (immune to zombie
            // grandchildren holding stdio); this grace timer only fires
            // if `exit` also fails to fire within the window — e.g. a
            // CLI bug that hangs the process itself. When it fires it
            // taskkills the descendant tree and routes through the same
            // finalize path. Only arms once per run.
            if (graceTimer === null && !finalizeStarted) {
                const result = detectCliResultLine(line);
                if (result) {
                    const synthCode = result.subtype === 'success' ? 0 : 1;
                    emit(
                        `[runner] CLI emitted result line (subtype=${result.subtype}); arming ${CLI_RESULT_EXIT_GRACE_MS}ms exit grace timer`,
                    );
                    graceTimer = setTimeout(() => {
                        void finalizeAfterCli(synthCode, 'result_timeout').catch((err) => {
                            console.error(
                                `[agent-runner] forced finalize crashed for ${runId}: ${(err as Error).message}`,
                            );
                        });
                    }, CLI_RESULT_EXIT_GRACE_MS);
                }
            }
        }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const line of text.split(/\r?\n/)) {
            if (line.trim()) {
                // Persist stderr to output_text too — PowerShell/spawn errors,
                // MCP warnings, and CLI startup failures used to broadcast over
                // SSE but never landed in the run record, leaving completed
                // error runs with empty logs. Prefixed so the frontend parser
                // (which tries JSON.parse on each line) renders these as plain
                // text instead of attempting JSON parse on a shell error.
                emit(`[stderr] ${line}`);
            }
        }
    });

    // Primary finalization trigger: `exit` fires when the OS process
    // dies, regardless of whether descendants (Bash, MCP server, etc.)
    // still hold the inherited stdio pipes. The older `close` event
    // would have stalled here until those descendants released the
    // pipes — exactly the failure mode that stranded MON-2 on
    // 2026-06-01. The result-line grace timer above is the deep
    // fallback if `exit` itself somehow doesn't fire.
    child.on('exit', (code) => {
        runChildren.delete(runId);
        void finalizeAfterCli(code, 'exit').catch((err) => {
            console.error(
                `[agent-runner] exit-driven finalize crashed for ${runId}: ${(err as Error).message}`,
            );
        });
    });

    child.on('error', (err) => {
        runChildren.delete(runId);
        clearInterval(flushInterval);
        runOutputRegistry.delete(runId);
        // Same reasoning as the exit-handler above — migration 025 turned
        // gitConfigPath into a file inside a temp dir, so recursive
        // cleanup is required.
        if (gitConfigPath) cleanupGitConfig(gitConfigPath);
        const stagedCopilotAgentOnError = runCopilotAgentFiles.get(runId);
        if (stagedCopilotAgentOnError) {
            try { unlinkSync(stagedCopilotAgentOnError); } catch { /* already gone */ }
            runCopilotAgentFiles.delete(runId);
        }
        if (artefactTmpRoot) {
            try {
                rmSync(artefactTmpRoot, { recursive: true, force: true });
            } catch {
                /* best-effort */
            }
        }
        // W4 — child 'error' fires on ENOENT (CLI binary not on PATH) and
        // other spawn-level failures. classifyRunError reads err.code to
        // attach the typed kind + details.binary so the UI can show the
        // "<bin> CLI isn't on your PATH" alert.
        const classification = classifyRunError(err as NodeJS.ErrnoException, bin);
        void errorRun(runId, agent.id, issueType, issueId, err.message, classification);
    });

    try {
        // 2026-06-09 — Phase 4b hotfix. Claude receives the slash
        // command via stdin (not as a positional argv) because the
        // `--allowedTools`/`--disallowedTools` variadic flags would
        // otherwise swallow it. Stdin is unambiguous — no flag can
        // consume it. Copilot's prompt continues to ride `-p` argv
        // (the `-p <text>` flag is single-value, not variadic) plus
        // `--agent` for the body lookup; nothing to write on stdin.
        if (dialect === 'claude') {
            child.stdin?.write(slashCommand);
        }
        child.stdin?.end();
    } catch (err) {
        void errorRun(
            runId,
            agent.id,
            issueType,
            issueId,
            `failed to write/close child stdin: ${(err as Error).message}`,
        );
    }
}

export interface SpawnAgentRunOptions {
    agentId: string;
    issueType?: IssueType | null;
    issueId?: string | null;
    /**
     * Project-level runs (no item): the project whose guardrails and
     * credential the run uses.
     */
    projectId?: string | null;
    /**
     * When set, the caller has already INSERTed the `agent_runs` row
     * (status='queued', prompt=null) and is responsible for surfacing
     * the unique-index race as 409. `spawnAgentRun` reuses this runId
     * and UPDATEs the prompt_snapshot once it's built.
     */
    existingRunId?: string;
    /**
     * ADR 0014 — the workflow step this run executes. The engine owns the
     * worktree (provisioned once per workflow run), item status and routing;
     * the runner only stages, spawns and reports back.
     */
    workflowRun?: {
        id: string;
        nodeId: string;
        worktreePath: string | null;
        branch: string | null;
        /** Project setup already ran for this workflow run. */
        skipSetup: boolean;
    } | null;
}

export async function spawnAgentRun(
    opts: SpawnAgentRunOptions,
): Promise<string> {
    const {
        agentId,
        issueType = null,
        issueId = null,
        projectId = null,
        existingRunId,
        workflowRun = null,
    } = opts;
    const agent = await getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const runId = existingRunId ?? randomUUID();

    // The project supplies guardrails (constitution) and git credentials:
    // explicit for project-level runs, via the item otherwise.
    let effectiveProjectId: string | null = projectId;
    let projectCredentialId: string | null = null;
    if (projectId) {
        const proj = await db
            .selectFrom('projects')
            .select(['credential_id'])
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (!proj) throw new Error(`Project ${projectId} not found`);
        projectCredentialId = (proj.credential_id as string | null) ?? null;
    } else if (issueId) {
        const itemRow = await db
            .selectFrom('items as i')
            .leftJoin('projects as p', 'p.id', 'i.project_id')
            .select(['p.id as project_id', 'p.credential_id as project_credential_id'])
            .where('i.id', '=', issueId)
            .executeTakeFirst();
        effectiveProjectId = (itemRow?.project_id as string | null) ?? null;
        projectCredentialId = (itemRow?.project_credential_id as string | null) ?? null;
    }

    // Only a workflow run provisions a worktree (once, shared by every step).
    // Any other run executes in a throwaway dir with the same `.atlas/*`
    // scaffolding, removed on finalize via `artefactTmpRoot`.
    const worktreePath = workflowRun?.worktreePath ?? null;
    const worktreeBranch = worktreePath ? (workflowRun?.branch ?? null) : null;
    let cwd: string;
    let artefactTmpRoot: string | null = null;
    if (worktreePath) {
        cwd = worktreePath;
    } else {
        artefactTmpRoot = mkdtempSync(join(tmpdir(), `atlas-run-${runId}-`));
        cwd = artefactTmpRoot;
    }

    // Shared with terminal sessions: constitution, templates, slash-command
    // bodies, the item snapshot, and — agent runs only — the outcome contract
    // + self-memory the CLI actually reads (the built prompt below is an
    // audit snapshot; the CLI never sees it).
    const stageResult = await stageCliWorktree({
        worktreePath: cwd,
        projectId: effectiveProjectId,
        ...(issueType && issueId ? { item: { type: issueType, id: issueId } } : {}),
        ...(agent.cli === 'copilot' ? { activeRunCopilotAgent: { runId, agentId } } : {}),
        includeOutcome: { agentId },
    });
    const constitutionMd = stageResult.constitutionMarkdown;
    const copilotUserAgentPath: string | null = stageResult.copilotUserAgentPath ?? null;

    // Per-run git auth (http.extraheader + bot identity) so `git commit`
    // inside the CLI is attributed to the App, not the developer's
    // ~/.gitconfig. buildGitAuth is the ONLY correct way to build this file.
    let gitConfigPath: string | null = null;
    let ghToken: string | null = null;
    let humanName: string | null = null;
    let humanEmail: string | null = null;
    if (effectiveProjectId && projectCredentialId) {
        try {
            const auth = await buildGitAuth(projectCredentialId);
            if (auth) {
                gitConfigPath = auth.configPath;
                ghToken = auth.token;
                humanName = auth.humanName;
                humanEmail = auth.humanEmail;
            }
        } catch (err) {
            // Best-effort — without auth the agent's commits fall back to
            // the local identity and the End push reports the failure.
            broadcastSSE({
                type: 'agent_output',
                output: `[agent-runner] warning: could not prepare git auth: ${(err as Error).message}`,
            });
        }
    }

    const workBody = await buildPrompt({
        agent,
        issueType,
        issueId,
        projectId,
        constitutionMd,
        omitConstitution: true,
        humanName,
        humanEmail,
    });
    // Mirrors the slash-command body (commands-assembler prepends the same
    // preamble) so `prompt_snapshot` reflects what the agent was told.
    const preamble = `${assemblePreamble(agentId)}\n\n`;
    const workMd =
        worktreeBranch !== null
            ? `${preamble}${buildWorktreePreamble({
                  branch: worktreeBranch,
                  path: cwd,
                  freshlyCreated: false,
              })}\n${workBody}`
            : `${preamble}${workBody}`;
    // constitution, `---`, then the work body — matches buildPrompt's
    // `sections.join('\n\n---\n\n')` so audit tooling sees one shape.
    const fullPrompt = constitutionMd.trim()
        ? `${constitutionMd.trim()}\n\n---\n\n${workMd}`
        : workMd;
    const now = new Date().toISOString();

    // ADR 0014 — the config this run actually spawned with. Agents are
    // editable, so reading agents.* later would misattribute cost and
    // outcomes when comparing models across runs.
    const runConfig = {
        cli: agent.cli,
        model: agent.model,
        effort: agent.effort,
        prompt_version: agent.prompt_version,
        workflow_run_id: workflowRun?.id ?? null,
        node_id: workflowRun?.nodeId ?? null,
    };
    // Two write paths:
    //   - `existingRunId` (HTTP /api/run): caller INSERTed the row with
    //     prompt=null; UPDATE it now.
    //   - otherwise INSERT here and catch the unique-index race ourselves.
    if (existingRunId) {
        await db
            .updateTable('agent_runs')
            .set({ prompt_snapshot: fullPrompt, ...runConfig })
            .where('id', '=', runId)
            .execute();
    } else {
        try {
            await db
                .insertInto('agent_runs')
                .values({
                    id: runId,
                    agent_id: agentId,
                    item_id: issueId,
                    project_id: projectId,
                    status: 'queued',
                    prompt_snapshot: fullPrompt,
                    started_at: now,
                    ...runConfig,
                })
                .execute();
        } catch (err) {
            // The partial unique index `agent_runs_one_live_per_item`
            // (migration 003) rejects a second live row for the same item.
            const code = (err as { code?: string }).code;
            if (code === '23505' && issueId) {
                throw new LiveRunOnItemError(issueId);
            }
            throw err;
        }
    }

    broadcastSSE({
        type: 'run_queued',
        agentId,
        runId,
        ...(issueType ? { issueType } : {}),
        ...(issueId ? { issueId } : {}),
    });
    broadcastSSE({
        type: 'agent_status',
        agentId,
        runId,
        ...(issueType ? { issueType } : {}),
        ...(issueId ? { issueId } : {}),
        status: 'queued',
    });

    setTimeout(() => {
        void (async () => {
            // Promote only a run that is STILL queued. In 200 ms the row may
            // have left the live set (cancelled, swept, item deleted) and a
            // replacement may hold the item's slot; an unconditional flip
            // tripped `agent_runs_one_live_per_item`.
            const promoted = await db
                .updateTable('agent_runs')
                .set({ status: 'in_progress' })
                .where('id', '=', runId)
                .where('status', '=', 'queued')
                .executeTakeFirst();
            /* v8 ignore next */
            if (Number(promoted.numUpdatedRows ?? 0) === 0) return;
            broadcastSSE({
                type: 'agent_status',
                agentId,
                runId,
                ...(issueType ? { issueType } : {}),
                ...(issueId ? { issueId } : {}),
                status: 'in_progress',
            });

            const aiEnabled = process.env['ATLAS_AI_ENABLED'] === 'true';
            if (aiEnabled) {
                // Per-project setup script, once per workflow run: every
                // later step shares the already-set-up worktree. On failure
                // the run is `setup_failed`, the CLI never spawns, and the
                // engine parks the workflow run with the Owner.
                if (effectiveProjectId && worktreePath && !workflowRun?.skipSetup) {
                    const setupResult = await runProjectSetup({
                        projectId: effectiveProjectId,
                        worktreePath,
                        runId,
                    });
                    if (!setupResult.ok) {
                        const current = await db
                            .selectFrom('agent_runs')
                            .select('status')
                            .where('id', '=', runId)
                            .executeTakeFirst();
                        if ((current?.status as string | undefined) !== 'cancelled') {
                            await db
                                .updateTable('agent_runs')
                                .set({
                                    status: 'setup_failed',
                                    setup_output_text: setupResult.output,
                                    completed_at: new Date().toISOString(),
                                })
                                .where('id', '=', runId)
                                .execute();
                            broadcastSSE({
                                type: 'run_setup_failed',
                                agentId,
                                runId,
                                ...(issueType ? { issueType } : {}),
                                ...(issueId ? { issueId } : {}),
                                setupFailedKind: setupResult.kind,
                                ...(setupResult.exitCode !== undefined
                                    ? { exitCode: setupResult.exitCode }
                                    : {}),
                            });
                        }
                        await notifyStep(runId);
                        return;
                    }
                }
                spawnCli({
                    agent,
                    runId,
                    issueType,
                    issueId,
                    prompt: fullPrompt,
                    cwd,
                    gitConfigPath,
                    ghToken,
                    artefactTmpRoot,
                    copilotUserAgentPath,
                });
            } else {
                simulateRun(runId, agentId, issueType, issueId, fullPrompt);
            }
        })().catch((err: unknown) => {
            // Anything thrown between promotion and spawn would otherwise be
            // an unhandled rejection with the run stuck at in_progress.
            void errorRun(
                runId,
                agentId,
                issueType,
                issueId,
                err instanceof Error ? err.message : String(err),
            ).catch(() => {
                /* last resort: the original error is already on the log */
            });
        });
    }, 200);

    return runId;
}

// T1 — read the run's outcome columns. After the CLI exits, exactly
// one of these will be non-NULL on the row (or both NULL if the agent
// forgot to call either MCP tool, which `completeRun` treats as an
// error):
// Task 12 — persist a parsed `atlas-outcome` block into the unified
// `outcome_*` columns. NULL outcome leaves all four columns at NULL
// (the row's default), which the runner treats as "agent did not
// signal" and the UI surfaces as such.
async function persistRunOutcome(runId: string, outcome: IRunOutcome | null): Promise<void> {
    if (outcome === null) return;
    await db
        .updateTable('agent_runs')
        .set({
            outcome_kind: outcome.kind,
            ...(outcome.summary !== undefined ? { outcome_summary: outcome.summary } : {}),
            ...(outcome.reason !== undefined ? { outcome_reason: outcome.reason } : {}),
            ...(outcome.checklist !== undefined
                ? { outcome_checklist: JSON.stringify(outcome.checklist) }
                : {}),
        })
        .where('id', '=', runId)
        .execute();
}

