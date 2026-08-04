import { randomUUID } from 'crypto';

// Thrown when the unique partial index on
// `agent_runs(item_id) WHERE status IN ('queued','in_progress')`
// (migration 003) rejects a new insert because another agent's run is
// already live on the same item. Routes catch this and map to HTTP 409.
// The in-app `findLiveRunOnItem` check (agent-dispatcher.ts) is the
// first line of defence; this is the race-free DB-level fallback.
export class LiveRunOnItemError extends Error {
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
import { eventsLog } from './events-log.js';
import {
    externalLinks,
    parseGithubPrUrl,
    fetchGithubPrTitle,
} from './external-links.js';
import { agentMemoryService } from './agent-memory.js';
import { verifyRunCommits } from './commit-verifier.js';
// credentialsService — previously used here to hand-build the per-run
// http.extraheader config. Now replaced by `buildGitAuth` from
// `./git-credentials.js`, which returns the temp config path AND the
// plaintext token so both `git` and `gh` inside the spawned CLI
// authenticate as the App identity. The import is retired to keep
// this file's surface minimal.
import {
    ensureWorktree,
    buildWorktreePreamble,
    pushWorktree,
    openPullRequest,
    cleanupWorktreeAfterPush,
    WorktreeProvisioningError,
} from './worktree-orchestrator.js';
import { runProjectSetup } from './project-setup-runner.js';
import {
    assertDepsAllDoneForDispatch,
} from './dependency-guard.js';
import {
    applyOnFailHandoff,
    applyOnPassHandoff,
    resolveHandoffAssignee,
} from './agent-handoff.js';
import { incrementRound, resetRoundsForItem } from './agent-rounds.js';
import { decideRunRouting } from './agent-runner-outcome-routing.js';
import {
    agentRoutedDuringRun,
    otherActorReassignedDuringRun,
} from './agent-self-routing.js';
import { parseRunOutcome } from './run-outcome-parser.js';
import {
    buildCompletionCommentBody,
    buildOrchestratorRunCompletedBody,
} from './agent-runner-completion-comment.js';
import { commentsService } from './comments.js';
import { normalizeModelForCli, resolveSpawn } from './cli-model-naming.js';
import { ollamaEnv } from './ollama-env.js';
import { gitInvokeEnv } from './git-env.js';
import { buildGitAuth, cleanupGitConfig } from './git-credentials.js';
import { agentIdToSlug } from './commands-assembler.js';
import { assemblePreamble } from './preamble-assembler.js';
import {
    getStatusLabel,
    CLI_DIALECT,
    type AgentCli,
    type ApiErrorKind,
    type IAgent,
    type IRunOutcome,
    type IssueType,
    type ExternalNotificationEventKey,
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

async function getSettings(): Promise<{ constitution_md: string | null; workspace_path: string | null }> {
    const row = await db
        .selectFrom('settings')
        .select(['constitution_md', 'workspace_path'])
        .where('id', '=', 1)
        .executeTakeFirst();
    return row ?? { constitution_md: null, workspace_path: null };
}

// Lightweight helpers used by the handoff path. Each does one column read
// so the reviewer-completion branch can reason about whether the run
// already routed the item via Atlas MCP (mid-run reassignment guard) or
// what status to record in the events log.
async function getItemAssignee(itemId: string): Promise<string | null> {
    const row = await db
        .selectFrom('items')
        .select(['assignee_agent_id'])
        .where('id', '=', itemId)
        .executeTakeFirst();
    return (row?.assignee_agent_id as string | null) ?? null;
}

// Used by the notification path after handoff routing applies. Returns the
// item's current `status` (raw enum) PLUS a display-friendly `statusLabel`
// ('Waiting for Info' instead of 'waiting_for_info') and assignee label
// (agent name, or `'Owner'` when the item is unassigned). The raw enum
// stays available for `deriveNotifKind`'s state check; the labels are
// what land in external + in-app notifications. Generic: the caller
// never branches on agent identity — the message it produces is
// derived purely from observed final state.
async function fetchItemFinalState(itemId: string): Promise<{
    status: string;
    statusLabel: string;
    assigneeId: string | null;
    assigneeLabel: string;
}> {
    const row = await db
        .selectFrom('items')
        .leftJoin('agents', 'agents.id', 'items.assignee_agent_id')
        .select([
            'items.status',
            'items.assignee_agent_id',
            'agents.name as assignee_name',
        ])
        .where('items.id', '=', itemId)
        .executeTakeFirst();
    const status = (row?.status as string | null) ?? 'unknown';
    // `getStatusLabel` is `IssueStatus | SubTaskStatus`-typed; cast through
    // `string` to allow the fallback `'unknown'` path. The helper itself
    // falls through to the raw string for any unknown enum value.
    const statusLabel = getStatusLabel(status as never);
    const assigneeId = (row?.assignee_agent_id as string | null) ?? null;
    const assigneeLabel =
        assigneeId === null
            ? 'Owner'
            : ((row?.assignee_name as string | null) ?? assigneeId);
    return { status, statusLabel, assigneeId, assigneeLabel };
}

function deriveNotifKind(
    finalAssigneeId: string | null,
    finalStatus: string,
): 'needs_you' | 'update' {
    return finalAssigneeId === null || finalStatus === 'waiting_for_info'
        ? 'needs_you'
        : 'update';
}

// Map an item's final status (post-handoff) to the per-event external-notification
// key. Only `waiting_for_info` and `in_review` have user-facing toggles; every
// other status (in_progress, done, draft, ready) means the in-app notification
// stands alone and the external channel stays silent — the Owner asked us to
// stop pinging on `Done` and to remove the AI-Readiness PR-opened pseudo-event.
// `undefined` here is the signal to the caller "skip the external send entirely;
// the in-app row is enough."
export function deriveItemEventKey(finalStatus: string): ExternalNotificationEventKey | undefined {
    if (finalStatus === 'waiting_for_info') return 'item.status_changed:waiting_for_info';
    if (finalStatus === 'in_review') return 'item.status_changed:in_review';
    return undefined;
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

// 2026-06-01 (Plan E) — orchestrator reclaimed ownership of push +
// `gh pr create`. The post-run hook in `child.on('close')` calls
// `pushWorktree` unconditionally (success OR failure) and then
// `openPullRequest` when the agent row has `raises_pr = true` AND the
// CLI exited cleanly. The boot-time orphan reaper in `main.ts` still
// invokes `pushWorktree` as a rescue path for runs that died before
// the hook fired.

// Agent-agnostic by design — agents persist their own deliverables via
// Atlas MCP tools (architect → `updateItem({ spec_md })`, coder → `pr_url`).
// If an agent fails to persist, its prompt MUST exit `asked_question` with
// a clear error; the orchestrator does NOT backfill or retry on the agent's
// behalf. Silent backfill hides broken prompts; loud failures surface them.

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
    // mid-run) falls back to Claude — preserves the legacy behaviour.
    const agent = await getAgent(agentId);
    const cli: AgentCli = agent?.cli ?? 'claude';
    const cost = parseCostFromOutput(output, cli);
    // Workstream #6 — if the Owner clicked Stop while this run was
    // mid-flight, the row has already been flipped to `cancelled` by
    // `POST /api/run/:id/stop`. Don't overwrite that with `completed`,
    // and don't apply the on-pass handoff below — the Owner asked us
    // to halt; advancing the chain would defeat the kill switch.
    // Persist the output + cost (those bytes were earned regardless)
    // but leave the terminal status alone.
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

    if (wasCancelled) {
        // Owner-cancelled: skip handoff + round bump + completion SSE.
        // The post-run hook (push + worktree cleanup) still ran in the
        // outer `spawnCli` close-handler, so committed work is
        // preserved and the worktree is gone.
        broadcastSSE({
            type: 'run_completed',
            agentId,
            runId,
            status: 'cancelled',
        });
        return;
    }

    // Freedom-mode run (no item) — broadcast completion, then emit a
    // notification so the Owner knows the run finished. Previously this
    // path returned silently and the Owner had no signal that e.g. an
    // AI-Readiness or project-scope run had completed. The in-app row
    // is always created (matches the "in-app always published" rule);
    // the external-notification side is gated by the new
    // `agent.run_finished_no_item` toggle + quiet hours.
    if (!issueId || !issueType) {
        broadcastSSE({
            type: 'run_completed',
            agentId,
            runId,
            status: 'completed',
        });
        const noItemMessage = `Agent "${agent?.name ?? agentId}" finished a freedom-mode run successfully.`;
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
        return;
    }

    // A04 — every CLI invocation that reaches this point counts as one
    // round against (item, agent). The increment fires AFTER the CLI
    // completes so a failed-to-spawn run doesn't count (errorRun does
    // the same bump on the crash path). Post-handoff-realignment
    // (2026-05-31) the routing decisions no longer cap-check rounds —
    // the revision loop moved into the reviewer agent's prompt — but
    // the per-(item, agent) count is still useful for analytics + the
    // queue UI, so the bump stays.
    await incrementRound(issueId, agentId);

    // Task 12 — single, role-agnostic routing path.
    //
    // Every agent (performer, reviewer, autonomous — no distinction in
    // code anymore) ends its CLI output with a fenced `atlas-outcome`
    // block. The orchestrator parses it, persists the four `outcome_*`
    // columns on agent_runs, and routes based on the parsed kind +
    // any required `agent_checklists` rows.
    const outcome = parseRunOutcome(output);
    await persistRunOutcome(runId, outcome);

    // Load the agent's required checklist (any agent — reviewer or
    // performer — that has rows gets verified). `agent_checklists.id`
    // is a bigint column → pg returns it as a STRING; `Number()` coerces
    // back to JS number so the Set<number> comparison in the decision
    // function works. Without this the on-pass branch never matches and
    // every item lands with the Owner via on-fail.
    const requiredChecklistRows = await db
        .selectFrom('agent_checklists')
        .select(['id', 'label'])
        .where('agent_id', '=', agentId)
        .where('required', '=', true)
        .orderBy('sort_order', 'asc')
        .execute();
    const requiredChecklist = requiredChecklistRows.map((r) => ({
        id: Number(r.id),
        label: r.label as string,
    }));

    const decision = decideRunRouting({ outcome, requiredChecklist });

    // 2026-06-12 — orchestrator self-routing guard. If the agent already
    // updated the item's assignee or status via MCP during the run
    // (`mcp__atlas__update_item` with `action: 'assign'` or
    // `action: 'change_status'`), trust its decision and skip the post-run
    // override entirely. Without
    // this, the `park_waiting_for_info` branch below would stomp on the
    // agent's self-assignment whenever the agent omitted a fenced
    // `atlas-outcome` block (i.e. every Path-A migrated agent).
    //
    // Detection uses `issue_events`, which is written by the same API
    // routes both the UI and MCP `assignItem`/`transitionItemStatus`
    // tools hit. `addCommentToItem` writes `comment_added` events, not
    // `assigned`/`status_changed`, so comment-only runs still fall
    // through to the existing safety net.
    const runStartRow = await db
        .selectFrom('agent_runs')
        .select(['started_at'])
        .where('id', '=', runId)
        .executeTakeFirst();
    const runStartedAt =
        (runStartRow?.started_at as string | null | undefined) ?? new Date().toISOString();
    const agentRouted = await agentRoutedDuringRun({
        agentId,
        itemId: issueId,
        sinceRunStartedAt: runStartedAt,
    });

    // Mid-run third-party-intervention guard shared across every non-
    // self-routed branch (park_waiting_for_info / apply_on_fail /
    // apply_on_pass). Owner via UI writes `assigned` with
    // actor_agent_id=null; another agent via MCP writes it with a
    // different agent id — either counts as intervention. The deleted
    // top-level `currentAssignee !== agentId` early-return covered ALL
    // three branches before cedcd43; the fix restored the guard only in
    // apply_on_pass, silently regressing park + on_fail to clobber
    // mid-run reassignments. See 2026-07-03 audit round 2, agent-runner
    // .ts:696 / :720.
    const reassignedByOther =
        !agentRouted &&
        (await otherActorReassignedDuringRun({
            itemId: issueId,
            sinceRunStartedAt: runStartedAt,
            excludeAgentId: agentId,
        }));

    if (agentRouted) {
        // Self-routing path — the agent's own `issue_events` rows are the
        // audit trail; no orchestrator-side write needed. Logged to the
        // API process stdout for debugging; the run's output_text already
        // captured the MCP calls that produced the routing decision.
        //
        // NOTE: `resetRoundsForItem` fires here on every self-routed run,
        // including status-only MCP transitions where the assignee didn't
        // change. This is a behavior shift from the pre-cedcd43 early-
        // return block, which never touched round counters on the self-
        // routed path. Preserved as-is because rounds are per-(item,agent)
        // and an agent that self-routes has effectively completed the
        // work-cycle it was counting toward. If round-storm bugs surface
        // on status-only self-transitions, gate this on the actual
        // `assigned` event rather than any self-routing detection.
        console.log(
            `[orchestrator] run ${runId} (${agentId} on ${issueId}): self-routing detected — agent updated assignee/status via MCP; skipping post-run override`,
        );
        broadcastSSE({ type: 'counts_changed', issueType, issueId });
        await resetRoundsForItem(issueId);
    } else if (reassignedByOther) {
        // Third-party (Owner or another agent) reassigned during the run.
        // Respect the intervention on ALL decision branches — record an
        // audit event and skip park / on-fail / on-pass writes so we
        // don't overwrite the manual routing.
        const currentAssignee = await getItemAssignee(issueId);
        await eventsLog.record({
            item_id: issueId,
            item_type: issueType,
            event_type: 'assigned',
            actor_agent_id: agentId,
            field: 'assignee',
            from_value: agentId,
            to_value: currentAssignee,
            detail: `assignee changed by another actor during run; ${decision.kind} skipped`,
        });
        broadcastSSE({ type: 'counts_changed', issueType, issueId });
    } else if (decision.kind === 'park_waiting_for_info') {
        const itemNow = await db
            .selectFrom('items')
            .select(['status'])
            .where('id', '=', issueId)
            .executeTakeFirst();
        const fromStatus = (itemNow?.status as string | null) ?? 'in_progress';
        await db
            .updateTable('items')
            .set({ status: 'waiting_for_info', assignee_agent_id: null })
            .where('id', '=', issueId)
            .execute();
        await eventsLog.record({
            item_id: issueId,
            item_type: issueType,
            event_type: 'status_changed',
            actor_agent_id: agentId,
            field: 'status',
            from_value: fromStatus,
            to_value: 'waiting_for_info',
            detail: decision.detail ?? 'agent_did_not_signal_outcome',
        });
        broadcastSSE({ type: 'counts_changed', issueType, issueId });
        await resetRoundsForItem(issueId);
    } else if (decision.kind === 'apply_on_fail') {
        await applyOnFailHandoff({
            agentId,
            currentItemId: issueId,
            itemType: issueType,
            detail: (decision.detail ?? 'rejected').slice(0, 200),
        });
        broadcastSSE({ type: 'counts_changed', issueType, issueId });
        await resetRoundsForItem(issueId);
    } else {
        // apply_on_pass — no third-party intervention (the shared guard
        // above already handled that case). The data-driven handoff is
        // safe to apply now.
        const plan = await applyOnPassHandoff({
            agentId,
            currentItemId: issueId,
            itemType: issueType,
        });
        for (const a of plan) {
            if (a.assigneeAgentId === null) {
                await resetRoundsForItem(a.itemId);
            }
        }
    }

    // 2026-06-08 — Single Run-link pin from the orchestrator. The
    // agent's own structured `What I did / verified / Open questions`
    // comment (posted via `mcp__atlas__update_item({ action: 'add_comment' })` from the
    // prompt) is the authoritative comment on the item. The orchestrator
    // only drops a tiny static pin so the Owner can jump straight to the
    // run-detail page from the comment thread. Same body shape as the
    // self-routed branch above (lines 575-594) — one model for both.
    //
    // Before this collapse the runner posted up to two extra comments
    // per run: an "auto-summary" repost of `outcome.summary` (when the
    // last MCP-posted comment was too short to clear the substantive
    // gate) plus a templated `**Agent** completed work on this <type>`
    // line that re-summarised what the agent already said. Both were
    // noise once every SDLC agent migrated to structured MCP comments.
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
            }),
        });
    } catch {
        /* run-info pin is best-effort */
    }

    broadcastSSE({
        type: 'run_completed',
        agentId,
        runId,
        issueType,
        issueId,
        status: 'completed',
    });

    // Generic completion notification — collapses the legacy four-way
    // outcome.kind branching into a single message derived from observed
    // final state (item status + assignee after handoff routing
    // applied). The agent's outcome block — fenced or absent (per
    // handoff.md's MCP-self-route convention) — no longer steers the
    // notification text. `needs_you` fires when the item lands on Owner
    // or waiting_for_info; everything else is routine progress.
    const finalState = await fetchItemFinalState(issueId);
    const message = `Agent "${agent?.name ?? agentId}" completed on ${issueType} ${issueId}. Status: "${finalState.statusLabel}". Assignee: "${finalState.assigneeLabel}".`;
    const eventType = 'agent_completed';
    const notifKind = deriveNotifKind(finalState.assigneeId, finalState.status);
    const notificationId = await createAgentNotification({
        eventType,
        message,
        issueType,
        issueId,
        agentId,
        kind: notifKind,
    });

    // Map by final item status — only waiting_for_info / in_review have
    // per-event toggles; other final statuses (Done, in_progress, etc.)
    // get the in-app row above but no external-notification ping.
    const itemEventKey = deriveItemEventKey(finalState.status);
    if (itemEventKey) {
        try {
            await sendExternalForNotification(notificationId, message, itemEventKey);
        } catch {
            /* External notification optional. */
        }
    }

    // Theme 08 — post-run memory hook. Increments the per-agent
    // cadence counter (errors carry more signal); fires a regen when
    // cadence trips or the Owner posted a `[lesson:]` marker on the
    // item. Wrapped in try/catch — a memory failure must NOT fail the
    // run itself.
    try {
        await agentMemoryService.maybeRegenerateAfterRun(agentId, runId, 'completed');
    } catch {
        /* memory hook is best-effort */
    }

    // Theme 11 — commit-discipline verifier. Skip freedom runs (no
    // item to anchor the audit to). Best-effort; never fails the run.
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
    // parse the kind out of `output_text` and render a typed banner. When
    // no classification is supplied (the common "untagged crash" case), the
    // marker is omitted and the legacy `[ERROR] …` prefix stands alone.
    const marker = classification ? `${formatErrorMarker(classification)} ` : '';
    const errOutput = `[ERROR] ${marker}${errorMsg}`;
    const errAgent = await getAgent(agentId);
    const errCli: AgentCli = errAgent?.cli ?? 'claude';
    const errCost = parseCostFromOutput(errorMsg, errCli);
    // Workstream #6 — preserve `cancelled` status the same way
    // `completeRun` does. The Owner clicked Stop; the natural crash
    // path that follows the SIGTERM/SIGKILL should not flip the row
    // back to `error`. Persist the output + cost; keep status.
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
        broadcastSSE({
            type: 'run_completed',
            agentId,
            runId,
            status: 'cancelled',
        });
        return;
    }

    // Freedom-mode run (no item) — broadcast, then emit a `needs_you`
    // notification so the Owner sees the crash. Same gating model as
    // the success branch above (in-app always; external notification
    // via `agent.run_finished_no_item` + quiet hours).
    if (!issueId || !issueType) {
        broadcastSSE({
            type: 'run_error',
            agentId,
            runId,
            status: 'error',
            errorDetail: errorMsg,
            ...(classification?.kind ? { errorKind: classification.kind } : {}),
            ...(classification?.details !== undefined
                ? { errorDetails: classification.details }
                : {}),
        });
        const noItemErrAgent = await getAgent(agentId);
        const noItemErrMessage = `Agent "${noItemErrAgent?.name ?? agentId}" errored on a freedom-mode run. Error: ${errorMsg}`;
        const noItemErrNotificationId = await createAgentNotification({
            eventType: 'agent_error_no_item',
            message: noItemErrMessage,
            issueType: null,
            issueId: null,
            agentId,
            kind: 'needs_you',
        });
        try {
            await sendExternalForNotification(
                noItemErrNotificationId,
                noItemErrMessage,
                'agent.run_finished_no_item',
            );
        } catch {
            /* External notification optional. */
        }
        return;
    }

    // A04 — every CLI invocation counts as one round, including the
    // ones that crashed. The Owner pays for the failed turn; restart of
    // the workflow is via reassignment. Mirrors the universal bump in
    // completeRun above.
    await incrementRound(issueId, agentId);

    // If the run was advancing an item (ready → in_progress at spawn time),
    // an error leaves it stranded with no live run. Send it to waiting_for_info
    // so it surfaces in the Queue's "waiting on you" section and the Owner can
    // requeue or fix it.
    //
    // Widened from `in_progress` only to `in_progress` OR `in_review`: an
    // Owner mid-run can manually transition the item (e.g. reacting to an
    // aspirational "Spec ready" comment from a still-running agent). If the
    // agent then crashes, the item is in `in_review` with no live run — the
    // same orphaned shape as `in_progress`-without-a-run. MON-2 (2026-05-31)
    // landed there because the prior narrower guard skipped recovery once
    // the manual transition fired. Recovery should reach both states.
    // `ready` is intentionally excluded (a fresh ready item legitimately
    // has no live run yet).
    const currentItem = await db
        .selectFrom('items')
        .select('status')
        .where('id', '=', issueId)
        .executeTakeFirst();
    if (currentItem?.status === 'in_progress' || currentItem?.status === 'in_review') {
        const fromStatus = currentItem.status;
        await db
            .updateTable('items')
            .set({ status: 'waiting_for_info' })
            .where('id', '=', issueId)
            .execute();
        // Activity-log: the agent surfaced a failure to the Owner.
        await eventsLog.record({
            item_id: issueId,
            item_type: issueType,
            event_type: 'status_changed',
            actor_agent_id: agentId,
            field: 'status',
            from_value: fromStatus,
            to_value: 'waiting_for_info',
            detail: errorMsg.slice(0, 200),
        });
        broadcastSSE({ type: 'counts_changed', issueType, issueId });
    }

    // 2026-06-01 (Plan E) — error-path push lives in the close-handler
    // hook (which runs before this `errorRun` call), so committed work
    // lands on origin even on a non-zero exit. If the runner itself
    // crashed before the hook fired, the boot-time orphan reaper in
    // `main.ts` is the safety net.

    // Orchestrator on-fail handoff. Consult `agent_handoff_rules` for
    // the `on-fail` row and reassign the item per the rule. Migration
    // 048 made every SDLC on-fail row route to Owner with
    // `waiting_for_info`, matching the status set above; we read both
    // assignee and status from the rule so a future override is just a
    // data change (and so we don't double-write the status block above
    // — the rule's status is consistent with what the upstream branch
    // already set).
    const failHandoff = await resolveHandoffAssignee(agentId, 'on-fail');
    if (failHandoff) {
        await db
            .updateTable('items')
            .set({
                assignee_agent_id: failHandoff.assigneeId,
                status: failHandoff.status as 'ready' | 'in_review' | 'in_progress' | 'done' | 'waiting_for_info' | 'draft',
            })
            .where('id', '=', issueId)
            .execute();
    }

    const agent = await getAgent(agentId);

    // Error path also leaves one comment per run, so the activity feed
    // stays uniform whether the run succeeded or crashed. The crash
    // path skips outcome parsing since the agent didn't get to emit
    // the `atlas-outcome` block. Best-effort: a comment failure never
    // compounds the run failure.
    try {
        await commentsService.create({
            author: 'agent',
            agent_id: agentId,
            issue_type: issueType,
            issue_id: issueId,
            body: buildCompletionCommentBody({
                agentId,
                agentName: agent?.name ?? agentId,
                runId,
                issueType,
                errorMsg,
            }),
        });
    } catch {
        /* auto-comment is best-effort */
    }

    broadcastSSE({
        type: 'run_error',
        agentId,
        runId,
        issueType,
        issueId,
        status: 'error',
        ...(classification?.kind ? { errorKind: classification.kind } : {}),
        ...(classification?.details !== undefined
            ? { errorDetails: classification.details }
            : {}),
    });

    // Include the item's current status + assignee when the item id is
    // known, so the Owner can see at-a-glance whether the failed run
    // left the chain stalled or still routable. issueId can be null for
    // freedom-mode runs.
    const errorState = issueId ? await fetchItemFinalState(issueId) : null;
    const stateSuffix = errorState
        ? ` Status: "${errorState.statusLabel}". Assignee: "${errorState.assigneeLabel}".`
        : '';
    const message = `Agent "${agent?.name ?? agentId}" errored on ${issueType} ${issueId}.${stateSuffix} Error: ${errorMsg}`;
    const notificationId = await createAgentNotification({
        eventType: 'agent_error',
        message,
        issueType,
        issueId,
        agentId,
        kind: 'needs_you',
    });

    try {
        await sendExternalForNotification(notificationId, message, 'agent.failed');
    } catch {
        /* non-fatal */
    }

    // Theme 08 — post-run memory hook (error path). Bumps the counter
    // by 2 (errors carry more signal). Wrapped so a memory failure
    // doesn't compound the run failure.
    try {
        await agentMemoryService.maybeRegenerateAfterRun(agentId, runId, 'error');
    } catch {
        /* memory hook is best-effort */
    }

    // Theme 11 — commit-discipline verifier (error path). Same skip
    // rules as completeRun; best-effort wrap.
    if (issueId && issueType) {
        try {
            await runCommitVerifier(runId, agentId, issueType, issueId);
        } catch {
            /* verifier is best-effort */
        }
    }
}

// Theme 11 — looks up the run + item to resolve cwd + started_at,
// then delegates to the verifier service. Kept inline so the hook
// at both call sites is one line.
async function runCommitVerifier(
    runId: string,
    agentId: string,
    issueType: IssueType,
    issueId: string,
): Promise<void> {
    const run = await db
        .selectFrom('agent_runs')
        .select(['started_at'])
        .where('id', '=', runId)
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
    const cwd = (itemRow?.project_git_path as string | null) || workspacePath;
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
        'Reviewing epic and project requirements...',
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
            const simulatedOutput = `[SIMULATED — set ATLAS_AI_ENABLED=true to use real CLI]\n\nPrompt length: ${prompt.length} chars\n\nThis is a placeholder response that would be generated by the assigned agent CLI.`;
            void completeRun(runId, agentId, issueType, issueId, simulatedOutput);
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
    /** Plan E — orchestrator post-run hook context. Populated when the
     *  worktree orchestrator provisioned a branch for this run; null on
     *  freedom-mode and bare-clone runs. Carried separately from
     *  `gitConfigPath` because the post-run hooks build their own
     *  short-lived config (the spawn's may have been unlinked by the
     *  time push fires). */
    worktreeBranch?: string | null;
    worktreePath?: string | null;
    /** Owner's "remote is source of truth" lifecycle — the main repo
     *  path used as cwd for `git worktree remove` / `git branch -D`
     *  after a successful push. Null on freedom-mode + bare-clone runs;
     *  cleanup is skipped when null. */
    projectGitPath?: string | null;
    projectCredentialId?: string | null;
    projectDefaultBranch?: string | null;
    /** Workstream #3 — project identity for the per-project git mutex
     *  guarding `pushWorktree` / `openPullRequest` / cleanup. Null on
     *  freedom-mode + bare-clone runs (those paths skip the orchestrator
     *  post-run hook entirely). */
    projectId?: string | null;
    itemTitle?: string | null;
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
        worktreeBranch,
        worktreePath,
        projectGitPath,
        projectCredentialId,
        projectDefaultBranch,
        projectId,
        itemTitle,
        artefactTmpRoot,
        copilotUserAgentPath,
    } = opts;
    // Ollama runs the Claude Code binary — it differs only in the env overlay
    // applied to `childEnv` below. Branch on the dialect, never on `agent.cli`.
    const dialect = CLI_DIALECT[agent.cli];
    const bin = dialect === 'claude' ? 'claude' : 'copilot';

    // Claude Code CLI: --print = non-interactive, prompt on stdin. The spawned
    // CLI inherits Owner's full user-level MCP config (Atlas + Playwright +
    // any claude.ai-OAuth'd integrations like Atlassian) from ~/.claude.json.
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
    const copilotTrigger = `Execute the atlas-${slug} agent — read .atlas/constitution.md, .atlas/handoff.md, .atlas/current-task.md, and the relevant template, then complete the work.`;

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
    const childEnv: NodeJS.ProcessEnv = {
        ...gitInvokeEnv(gitConfigPath ?? null, ghToken ?? null),
        // MUST come after the gitInvokeEnv spread (which spreads process.env),
        // or an ANTHROPIC_API_KEY in the Owner's shell wins and this
        // nominally-free local run bills Anthropic instead. No-op unless
        // agent.cli === 'ollama'.
        ...ollamaEnv(agent.cli, model),
    };

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

        // Plan E — orchestrator-owned post-run repo ops. Push always
        // fires (success OR failure) so committed work never strands on
        // disk; PR creation gates on (raises_pr && code === 0 && pushed).
        // Both are best-effort: failures append to `output_text` but do
        // not flip the run's terminal status. Skipped for freedom-mode
        // and bare-clone runs (no worktreeBranch).
        if (worktreePath && worktreeBranch) {
            // Owner's two-file proposal — delete the run artefact
            // Phase 1.5b — legacy .atlas-run/ artefact cleanup has
            // been retired (the directory is no longer written). The
            // phase-1 `.atlas/` tree is excluded from git via
            // `.git/info/exclude`, so nothing reaches origin even
            // without an explicit rm. The worktree's `.atlas/` does
            // not need to be cleaned between runs because the
            // regenerator wipes it at the start of every run.
            // Plan #7 — `push` is populated only when the agent has
            // `push_code = true`. When push_code is false (PO Writer,
            // read-only reviewers), we skip the push entirely AND
            // still want cleanup to fire — so we model the no-push
            // case as `{ pushed: false, alreadyUpToDate: true }` which
            // the cleanup gate below already treats as a happy path.
            let push: {
                pushed: boolean;
                alreadyUpToDate: boolean;
                error?: string;
            } = { pushed: false, alreadyUpToDate: true };
            try {
                if (agent.push_code === true) {
                    emit(
                        `[orchestrator] push: auth=${projectCredentialId ? 'extraheader' : 'NONE'} branch=${worktreeBranch}`,
                    );
                    push = await pushWorktree(
                        worktreePath,
                        worktreeBranch,
                        projectCredentialId ?? null,
                        projectId as string,
                    );
                    if (push.pushed) {
                        emit(`[orchestrator] push: pushed ${worktreeBranch}`);
                    } else if (push.alreadyUpToDate) {
                        emit(`[orchestrator] push: up-to-date ${worktreeBranch}`);
                    } else {
                        emit(`[orchestrator] push: FAILED ${worktreeBranch}: ${push.error ?? 'unknown'}`);
                    }
                } else {
                    emit(
                        `[orchestrator] push: skipped (push_code=false) branch=${worktreeBranch}`,
                    );
                }

                if (agent.raises_pr && code === 0 && projectId) {
                    const base = projectDefaultBranch && projectDefaultBranch.trim()
                        ? projectDefaultBranch
                        : 'main';
                    // Title + body shapes diverge: item-attached PRs reference
                    // the issueId (Closes-link works); project-scope PRs use
                    // the project name + agent name since there's no item.
                    let prTitle: string;
                    let prBody: string;
                    if (issueId) {
                        const titleShort = (itemTitle ?? '').trim().slice(0, 80) || issueId;
                        prTitle = `[${issueId}] ${titleShort}`;
                        prBody = [
                            `Automated PR opened by orchestrator for ${issueId}.`,
                            '',
                            `- Closes #${issueId}`,
                            `- Reviewer: ${agent.name} (${agent.id})`,
                            `- Run: \`${runId}\``,
                        ].join('\n');
                    } else {
                        const projName = await db
                            .selectFrom('projects')
                            .select('name')
                            .where('id', '=', projectId)
                            .executeTakeFirst();
                        const projectName = (projName?.name as string | null) ?? projectId;
                        prTitle = `[${agent.name}] ${projectName}`;
                        prBody = [
                            `Automated PR opened by orchestrator for ${agent.name} run.`,
                            '',
                            `- Project: ${projectName}`,
                            `- Agent: ${agent.name} (${agent.id})`,
                            `- Run: \`${runId}\``,
                        ].join('\n');
                    }
                    const pr = await openPullRequest({
                        worktreePath,
                        branch: worktreeBranch,
                        base,
                        title: prTitle,
                        body: prBody,
                        credentialId: projectCredentialId ?? null,
                        projectId,
                    });
                    if (pr.opened && pr.url) {
                        emit(`[orchestrator] pr: opened ${pr.url}`);
                    } else if (pr.alreadyExists && pr.url) {
                        emit(`[orchestrator] pr: already exists ${pr.url}`);
                    } else if (pr.alreadyExists) {
                        emit(`[orchestrator] pr: already exists (url lookup failed: ${pr.error ?? 'unknown'})`);
                    } else {
                        emit(`[orchestrator] pr: FAILED: ${pr.error ?? 'unknown'}`);
                    }
                    // Persist the PR URL as an item_external_links row so
                    // each successive PR on the same item accumulates rather
                    // than overwriting the prior URL (the old code path
                    // wrote `items.pr_url` which held a single scalar).
                    // Project-scope PRs have no item to bind to.
                    if (pr.url && issueId) {
                        try {
                            const parsed = parseGithubPrUrl(pr.url);
                            const title = await fetchGithubPrTitle(pr.url).catch(() => null);
                            await externalLinks.create({
                                itemId: issueId,
                                url: pr.url,
                                linkKind: 'pull_request',
                                title,
                                externalRef: parsed?.number ?? null,
                                createdByRunId: runId,
                            });
                        } catch (urlErr) {
                            emit(`[orchestrator] pr: persist external link failed: ${(urlErr as Error).message}`);
                        }
                    }
                }

                // Owner's "remote is source of truth" lifecycle —
                // when push succeeded, delete the local worktree
                // folder and local branch ref so the next run on
                // this item re-provisions from origin. Gated on
                // push.pushed || push.alreadyUpToDate; a failed
                // push leaves everything in place for manual
                // recovery. Runs AFTER the PR block because
                // `gh pr create` uses worktreePath as cwd.
                if ((push.pushed || push.alreadyUpToDate) && projectId && projectGitPath) {
                    const cleanup = await cleanupWorktreeAfterPush({
                        // Null for project-scope runs — Step 3 (items.worktree_path
                        // null-out) is skipped; the local worktree remove + branch
                        // delete + fetch --prune all still fire.
                        itemId: issueId ?? null,
                        projectId,
                        projectGitPath,
                        worktreePath,
                        branch: worktreeBranch,
                        // GCM-safety: Step 4 (`git fetch origin --prune`) is a
                        // network call; without the project credential it would
                        // fall through to GCM on Windows. Mirror the credential
                        // already passed to `openPullRequest` above.
                        credentialId: projectCredentialId ?? null,
                    });
                    emit(
                        `[orchestrator] cleanup: wt=${cleanup.worktreeRemoved} br=${cleanup.branchDeleted} db=${cleanup.dbCleared}`,
                    );
                    for (const w of cleanup.warnings) {
                        emit(`[orchestrator] cleanup warn: ${w}`);
                    }
                }
            } catch (hookErr) {
                emit(`[orchestrator] post-run hook crashed: ${(hookErr as Error).message}`);
            }
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
     * Theme 09b — project-scope runs (e.g., the AI-Readiness Agent).
     * When set with no `issueId`, the run lifecycle is "project-scope":
     * agent_runs row carries project_id, cwd = project.git_path, the
     * prompt-builder renders a project preamble instead of item /
     * freedom-mode shapes, and `git push` auth flows via a per-run
     * GIT_CONFIG_GLOBAL temp file populated with `http.extraheader`
     * Basic from the project's stored PAT credential.
     */
    projectId?: string | null;
    /**
     * When set, the caller has already INSERTed the `agent_runs` row
     * (status='queued', prompt=null) and is responsible for surfacing
     * the unique-index race as 409. `spawnAgentRun` reuses this runId
     * for the rest of the lifecycle and UPDATEs the prompt_snapshot
     * once it's built (rather than INSERTing a second row).
     *
     * Used by `POST /api/run` so the HTTP 202 returns in ~50 ms
     * (before worktree provisioning) — see `routes/run.ts`. The slow
     * worktree + constitution + prompt-build work still happens, just
     * off the request thread.
     */
    existingRunId?: string;
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
    } = opts;
    const agent = await getAgent(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // B04 — pre-dispatch depends_on gate. Item-attached runs only; freedom-mode
    // and project-scope runs have no item and thus no item_links to consult.
    // Throws DependenciesNotReadyError + records a `dispatch_blocked` activity
    // event if any depends_on target of `issueId` is non-`done`. Catchers:
    // routes/run.ts → 409; agent-dispatcher.maybeAutoDispatch → reason
    // 'deps_blocked'. Reviewer-leg + performer-retry helpers below check
    // again defensively for the rare case where an Owner relinked mid-cycle.
    if (issueId) {
        await assertDepsAllDoneForDispatch(issueId, agentId);
    }

    const settings = await getSettings();
    const workspacePath = settings.workspace_path ?? process.cwd();

    // The CLI must execute INSIDE the project's cloned repo so it can read/edit
    // real source. Three cwd resolution paths:
    //   - project-scope (Theme 09b): cwd = project.git_path
    //   - item-attached: cwd = project.git_path via item -> project lookup,
    //     then narrowed to the per-item worktree by `ensureWorktree` below
    //     (T2). The agent's prompt gets a "worktree is pre-provisioned"
    //     preamble so it doesn't try to re-create or pull on its own.
    //   - freedom-mode: cwd = workspace
    let cwd = workspacePath;
    let projectGitPath: string | null = null;
    let projectCredentialId: string | null = null;
    let projectDefaultBranch: string | null = null;
    let itemTitle: string | null = null;
    // T2 — populated when an item-attached run successfully provisions a
    // worktree. spawnCli reads `cwd` directly; we keep the resolved
    // branch + freshlyCreated flags alongside so the prompt preamble has
    // the right context. `worktreePath` is the on-disk path (`= cwd` once
    // the worktree is provisioned) — captured separately so the post-run
    // hook can still locate it after `cwd` is overwritten by a follow-on
    // code path.
    let worktreeBranch: string | null = null;
    let worktreePath: string | null = null;
    let worktreeFreshlyCreated = false;
    // Hoisted so the worktree-provisioning block below can use it both as
    // the branch's short-id source and as an error-context string. The
    // agent_runs row insert below reuses this same value.
    // If the caller (e.g. `POST /api/run`) already INSERTed the row
    // synchronously to keep the HTTP response under the slow-request
    // threshold, reuse that runId and UPDATE the row's prompt_snapshot
    // once it's built. Otherwise fall back to the legacy path: generate
    // here and INSERT below.
    const runId = existingRunId ?? randomUUID();

    // Project info resolution. Two entry points populate the same vars:
    //   - projectId only → fetch from `projects` directly
    //   - issueId → join through `items` to find the project, also pull the
    //     item's worktree_branch / worktree_path / title for downstream use
    // `effectiveProjectId` is the resolved project id used by the unified
    // worktree block — equal to opts.projectId when project-scope, or the
    // item's project_id when item-attached.
    let effectiveProjectId: string | null = projectId;
    let itemWorktreeBranch: string | null = null;
    let itemWorktreePath: string | null = null;
    if (projectId) {
        const proj = await db
            .selectFrom('projects')
            .select(['git_path', 'credential_id', 'default_branch'])
            .where('id', '=', projectId)
            .executeTakeFirst();
        if (!proj) throw new Error(`Project ${projectId} not found`);
        projectGitPath = proj.git_path as string;
        projectCredentialId = (proj.credential_id as string | null) ?? null;
        projectDefaultBranch = (proj.default_branch as string | null) ?? null;
        cwd = projectGitPath || workspacePath;
    } else if (issueId) {
        const itemRow = await db
            .selectFrom('items as i')
            .leftJoin('projects as p', 'p.id', 'i.project_id')
            .select([
                'p.id as project_id',
                'p.git_path as project_git_path',
                'p.credential_id as project_credential_id',
                'p.default_branch as project_default_branch',
                'i.title as item_title',
                'i.worktree_branch as worktree_branch',
                'i.worktree_path as worktree_path',
            ])
            .where('i.id', '=', issueId)
            .executeTakeFirst();
        cwd = (itemRow?.project_git_path as string | null) || workspacePath;
        effectiveProjectId = (itemRow?.project_id as string | null) ?? null;
        projectGitPath = (itemRow?.project_git_path as string | null) ?? null;
        projectCredentialId = (itemRow?.project_credential_id as string | null) ?? null;
        projectDefaultBranch = (itemRow?.project_default_branch as string | null) ?? null;
        itemTitle = (itemRow?.item_title as string | null) ?? null;
        itemWorktreeBranch = (itemRow?.worktree_branch as string | null) ?? null;
        itemWorktreePath = (itemRow?.worktree_path as string | null) ?? null;

        // Defensive: if an item-attached agent on a git-backed project is
        // missing worktree_branch, generate `atlas/<role_id>/<itemId>`
        // and persist it. New epics get this at create time (epics.ts);
        // stories get it from PO Writer's createStory MCP call. This
        // fallback covers any legacy or edge-case item that escaped both.
        if (
            !itemWorktreeBranch &&
            agent.requires_worktree === true &&
            effectiveProjectId &&
            projectGitPath &&
            agent.role_id
        ) {
            const generated = `atlas/${agent.role_id}/${issueId}`;
            await db
                .updateTable('items')
                .set({ worktree_branch: generated })
                .where('id', '=', issueId)
                .where('worktree_branch', 'is', null)
                .execute();
            itemWorktreeBranch = generated;
        }
    }

    // Unified worktree provisioning. `requires_worktree` is the single
    // switch: item-attached uses item.worktree_branch (resolved above);
    // project-scope (no item) generates atlas/<kind|role|'run'>/<short-runId>
    // so cleanup, push, and PR creation all fire through the same downstream
    // code paths.
    if (agent.requires_worktree === true && effectiveProjectId && projectGitPath) {
        let resolvedBranch: string;
        let itemForEnsure: { id: string; worktree_branch: string | null; worktree_path: string | null } | null;

        if (issueId) {
            if (!itemWorktreeBranch) {
                throw new Error(
                    `Agent ${agent.id} has requires_worktree=true but neither role_id ` +
                    `nor item.worktree_branch is set for item ${issueId}.`,
                );
            }
            resolvedBranch = itemWorktreeBranch;
            itemForEnsure = {
                id: issueId,
                worktree_branch: itemWorktreeBranch,
                worktree_path: itemWorktreePath,
            };
        } else {
            // Project-scope — generate a scratch branch keyed off the run id
            // so re-runs never collide on `atlas/ai-readiness` and the
            // cleanup path can delete the branch without fear of orphaning
            // a real human's WIP.
            const prefix = agent.kind_slug || agent.role_id || 'run';
            const shortRunId = runId.slice(0, 8);
            resolvedBranch = `atlas/${prefix}/${shortRunId}`;
            itemForEnsure = null;
        }

        try {
            const result = await ensureWorktree({
                item: itemForEnsure,
                // exactOptionalPropertyTypes: only set `branch` when item is null.
                ...(itemForEnsure ? {} : { branch: resolvedBranch }),
                project: {
                    id: effectiveProjectId,
                    git_path: projectGitPath,
                    credential_id: projectCredentialId,
                    default_branch: projectDefaultBranch,
                },
                // Plan #7 — only push upstream when the agent commits code.
                // Read-only reviewers have push_code=false; their scratch
                // worktrees stay local-only and cleanup deletes the branch.
                pushUpstream: agent.push_code === true,
            });
            cwd = result.path;
            worktreeBranch = result.branch;
            worktreePath = result.path;
            worktreeFreshlyCreated = result.freshlyCreated;
        } catch (err) {
            const wtErr = err as Error & { code?: string };
            throw new Error(
                `Worktree provisioning failed for ${issueId ?? `run ${runId}`}: ` +
                    `${wtErr.message}` +
                    (err instanceof WorktreeProvisioningError && wtErr.code
                        ? ` (code: ${wtErr.code})`
                        : ''),
            );
        }
    }

    // 2026-06-12 — Unified working directory. Every run now executes
    // inside a real on-disk directory with `.atlas/*` scaffolding:
    //
    //  - `requires_worktree=true` → real git worktree provisioned above
    //    (`worktreePath`). Used for any agent that commits / pushes /
    //    needs branch isolation.
    //  - `requires_worktree=false` → ephemeral temp dir under
    //    `<tmpdir>/atlas-run-<runId>-*/`. Same `.atlas/*` files get
    //    written here. Cleaned up via `artefactTmpRoot` on run finalize.
    //
    // This kills the legacy "freedom mode = inline `-p` prompt with the
    // constitution baked in" code path. Shell scripts, slash commands,
    // and the Windows 32K CreateProcess limit are now handled uniformly
    // regardless of whether the agent uses a worktree.
    //
    // Handoff scaffolding (`.atlas/handoff.md` + `.atlas/current-task.md`)
    // is conditional on `requires_item = true` — scout-style agents
    // (ai-news, market-research, etc.) don't operate on items so they
    // get the constitution + templates only.
    let workdirPath: string;
    let artefactTmpRoot: string | null = null;
    if (worktreePath) {
        workdirPath = worktreePath;
    } else {
        artefactTmpRoot = mkdtempSync(join(tmpdir(), `atlas-run-${runId}-`));
        workdirPath = artefactTmpRoot;
        cwd = workdirPath;
    }

    // All worktree-context staging — constitution, templates, slash-command
    // bodies for every agent, the per-run item snapshot, and the routing
    // handoff — goes through the shared `stageCliWorktree` helper that the
    // terminal-session create route also calls. Differences between the
    // two flows are carved out by flags:
    //   - `includeHandoff` writes `.atlas/handoff.md` (agent-only routing
    //     contract; terminal sessions skip it).
    //   - `activeRunCopilotAgent` writes the per-run user-level Copilot
    //     agent file at `~/.copilot/agents/atlas-<runId>.md` so the CLI
    //     can resolve `--agent atlas-<runId>` (only Copilot agent runs).
    // writeCurrentTask failures used to be `console.warn`-and-continue
    // here; that swallowed real bugs (e.g. a deleted item id reaching
    // dispatch). The shared helper now throws — callers can decide.
    const stageResult = await stageCliWorktree({
        worktreePath: workdirPath,
        projectId: effectiveProjectId,
        ...(agent.requires_item === true && issueType && issueId
            ? { item: { type: issueType, id: issueId } }
            : {}),
        ...(agent.cli === 'copilot' ? { activeRunCopilotAgent: { runId, agentId } } : {}),
        ...(agent.requires_item === true ? { includeHandoff: { agentId } } : {}),
    });
    const constitutionMd = stageResult.constitutionMarkdown;
    const copilotUserAgentPath: string | null = stageResult.copilotUserAgentPath ?? null;

    // Theme 09b — build the per-run git auth (http.extraheader Basic +
    // [credential] helper = disabler + [user] bot identity for github_app
    // creds) when a project credential is in play. The path lives in
    // tmpdir; spawnCli inherits GIT_CONFIG_GLOBAL pointing at it AND
    // GH_TOKEN pointing at the plaintext token so both `git commit` and
    // `gh pr create` inside the agent's CLI process authenticate as the
    // bot identity. Cleaned up on child exit.
    //
    // NOTE: buildGitAuth is the ONLY correct way to construct this file;
    // hand-rolled inline configs miss the `[user]` block that attributes
    // commits to `<slug>[bot]` (see history — the previous inline
    // writeFileSync-based path caused `git commit` to fall through to
    // the developer's `~/.gitconfig` for user.name/email).
    let gitConfigPath: string | null = null;
    let ghToken: string | null = null;
    // Migration 025 — capture the human-attribution fields for prompt
    // injection below. Agents get an explicit `--trailer "Co-Authored-By:
    // <name> <email>"` instruction so their `git commit` invocations
    // (which use `-c core.hooksPath=.husky/_` and therefore bypass the
    // prepare-commit-msg hook that GIT_CONFIG_GLOBAL would otherwise
    // wire) still credit the human.
    let humanName: string | null = null;
    let humanEmail: string | null = null;
    // Bug fix (2026-07-03): the guard was `if (projectId && projectCredentialId)`,
    // but `projectId` (from opts) is only populated for project-scope runs. For
    // item-attached runs like MON-2 the caller doesn't set it, so `projectId`
    // was null and `buildGitAuth` never fired — meaning the agent's `git commit`
    // fell through to the developer's `~/.gitconfig` and PRs were authored as
    // the user, not the bot. Use `effectiveProjectId` (populated for both
    // project-scope AND item-attached runs) plus `projectCredentialId`
    // (populated whenever the project has a credential wired).
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
            // Best-effort — if credential lookup fails, the agent will
            // hit a 403 on push and report it in the run output.
            broadcastSSE({
                type: 'agent_output',
                output: `[ai-readiness] warning: could not prepare git auth: ${(err as Error).message}`,
            });
        }
    }

    // Plan E + run-artefact split (Owner proposal 2026-06-01) — render
    // the work half of the prompt without the constitution. The
    // constitution is written to its own file alongside `WORK.md`; the
    // CLI receives a tiny pointer prompt asking the agent to Read both.
    // This sidesteps Windows' 32,767-char CreateProcess command-line
    // limit (the full assembled prompt is 30–33 KB).
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
    // T2 — when the orchestrator provisioned a worktree above, prepend a
    // short preamble telling the agent the worktree is already on the
    // right branch and pulled. Without this the model continues to follow
    // the prompt-level `git worktree add …` instructions and either
    // double-creates or stalls on credential helpers.
    //
    // 2026-06-12 — for `requires_item=true` agents we also prepend the
    // centralized "read .atlas/*.md" preamble so the audit snapshot
    // (`agent_runs.prompt_snapshot`) reflects the same body the agent
    // saw via its slash command. The agent reads the slash command
    // body (from `.claude/commands/atlas-<slug>.md` /
    // `.github/prompts/atlas-<slug>.prompt.md`) which already carries
    // the preamble via `commands-assembler`; this duplication is just
    // for the audit trail.
    const itemHandoffPreamble = agent.requires_item === true
        ? `${assemblePreamble(agentId)}\n\n`
        : '';
    const workMd =
        worktreeBranch !== null
            ? `${itemHandoffPreamble}${buildWorktreePreamble({
                  branch: worktreeBranch,
                  path: cwd,
                  freshlyCreated: worktreeFreshlyCreated,
              })}\n${workBody}`
            : `${itemHandoffPreamble}${workBody}`;
    // Keep `prompt_snapshot` byte-for-byte equivalent to the old
    // assembled-prompt shape so audit / re-render tooling (`/api/run/:id`,
    // prompt-history diffing) doesn't see a phantom rewrite. The
    // constitution lives at the top, `---` separator, then the work body
    // — matches `buildPrompt`'s `sections.join('\n\n---\n\n')`.
    const fullPrompt = constitutionMd.trim()
        ? `${constitutionMd.trim()}\n\n---\n\n${workMd}`
        : workMd;
    const now = new Date().toISOString();

    // Two write paths:
    //   - `existingRunId`-driven (HTTP /api/run): caller INSERTed the
    //     row already with prompt=null; we now UPDATE with the freshly
    //     built prompt. The unique-index race was caught at INSERT in
    //     the caller's path.
    //   - Legacy (auto-dispatcher etc.): INSERT here, catch the unique
    //     index race ourselves.
    if (existingRunId) {
        await db
            .updateTable('agent_runs')
            .set({ prompt_snapshot: fullPrompt })
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
                })
                .execute();
        } catch (err) {
            // Race-free fallback for the item-level run lock. The unique
            // partial index `agent_runs_one_live_per_item` (migration 003)
            // rejects a second live row for the same item. The dispatcher's
            // `findLiveRunOnItem` check catches most cases pre-insert; this
            // catches the race between check + insert.
            const code = (err as { code?: string }).code;
            if (code === '23505' && issueId) {
                throw new LiveRunOnItemError(issueId);
            }
            throw err;
        }
    }

    // Advance the item itself so the queue and detail pages reflect that work
    // is in flight. Only fire on `ready` so manually-triggered runs on other
    // statuses (draft/in_review/done) don't get nudged forward unexpectedly.
    // Skipped entirely for freedom-mode runs (no item).
    //
    // Wrap the flip + activity-log in one transaction so a failure between
    // them doesn't strand the item at `in_progress` with no audit-trail
    // entry. Also add `WHERE status = 'ready'` to the UPDATE so a
    // concurrent Owner-driven transition (e.g. back to `draft`) between
    // the SELECT and the UPDATE causes a no-op UPDATE — we detect via
    // returned rows and skip the activity log accordingly.
    if (issueId && issueType) {
        const currentItem = await db
            .selectFrom('items')
            .select('status')
            .where('id', '=', issueId)
            .executeTakeFirst();
        if (currentItem?.status === 'ready') {
            const flipped = await db.transaction().execute(async (trx) => {
                const updated = await trx
                    .updateTable('items')
                    .set({ status: 'in_progress' })
                    .where('id', '=', issueId)
                    .where('status', '=', 'ready')
                    .returning('id')
                    .executeTakeFirst();
                if (!updated) return false;
                // Activity-log: the agent (not the Owner) picked the item up.
                //
                // `detail: 'orchestrator_run_start'` marker: this event was
                // written by the orchestrator at dispatch time, NOT by the
                // agent's MCP calls. `agentRoutedDuringRun` filters this
                // out so it isn't mistaken for the agent self-routing via
                // MCP. Without the marker, every autonomous run
                // (`assignee = agent` at ready → in_progress) tripped a
                // false-positive on self-routing and the runner skipped
                // its post-run status transition, leaving the item stuck
                // in `in_progress` after the agent finished (bug: JDA-1).
                await eventsLog.record(
                    {
                        item_id: issueId,
                        item_type: issueType,
                        event_type: 'status_changed',
                        actor_agent_id: agentId,
                        field: 'status',
                        from_value: 'ready',
                        to_value: 'in_progress',
                        detail: 'orchestrator_run_start',
                    },
                    trx,
                );
                return true;
            });
            if (flipped) {
                broadcastSSE({ type: 'counts_changed', issueType, issueId });
            }
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
            await db
                .updateTable('agent_runs')
                .set({ status: 'in_progress' })
                .where('id', '=', runId)
                .execute();
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
                // 2026-06-10 — Per-project setup script. Runs after
                // worktree staging + status flip to `in_progress` but
                // BEFORE `spawnCli`. The user-authored .sh / .ps1
                // body is substituted with `${variable.KEY}` values
                // from environment_secrets + project_env_vars
                // (project wins on collision). On any failure the run
                // is finalized with `status='setup_failed'` and the
                // CLI is never spawned. Skipped for freedom-mode runs
                // (no worktree) and runs without a project context.
                if (effectiveProjectId && worktreePath) {
                    const setupResult = await runProjectSetup({
                        projectId: effectiveProjectId,
                        worktreePath,
                        runId,
                    });
                    if (!setupResult.ok) {
                        // Race-aware: if the Owner stopped the run mid-
                        // setup, respect their `cancelled` status.
                        const current = await db
                            .selectFrom('agent_runs')
                            .select('status')
                            .where('id', '=', runId)
                            .executeTakeFirst();
                        if (
                            (current?.status as string | undefined) !== 'cancelled'
                        ) {
                            const setupNow = new Date().toISOString();
                            await db
                                .updateTable('agent_runs')
                                .set({
                                    status: 'setup_failed',
                                    setup_output_text: setupResult.output,
                                    completed_at: setupNow,
                                })
                                .where('id', '=', runId)
                                .execute();
                            // Roll back item `in_progress → ready` so
                            // the Owner can fix the script / secret and
                            // re-dispatch immediately. Mirrors the gate
                            // at run-spawn that promoted `ready` →
                            // `in_progress` in the first place.
                            if (issueId && issueType) {
                                const itemRow = await db
                                    .selectFrom('items')
                                    .select('status')
                                    .where('id', '=', issueId)
                                    .executeTakeFirst();
                                if (itemRow?.status === 'in_progress') {
                                    await db
                                        .updateTable('items')
                                        .set({ status: 'ready' })
                                        .where('id', '=', issueId)
                                        .execute();
                                    await eventsLog.record({
                                        item_id: issueId,
                                        item_type: issueType,
                                        event_type: 'status_changed',
                                        actor_agent_id: agentId,
                                        field: 'status',
                                        from_value: 'in_progress',
                                        to_value: 'ready',
                                        detail: `setup failed: ${setupResult.kind}`,
                                    });
                                    broadcastSSE({
                                        type: 'counts_changed',
                                        issueType,
                                        issueId,
                                    });
                                }
                            }
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
                        return;
                    }
                }
                // 2026-06-09 — /commands framework Phase 4. The CLI no
                // longer receives the giant `fullPrompt` envelope; it
                // gets the slash command directly. `fullPrompt` is
                // still built above and persisted as
                // `agent_runs.prompt_snapshot` for the audit trail
                // (the on-disk `.atlas/*` artefacts are what the
                // agent actually consumed at runtime).
                //
                // 2026-06-12 — `artefactTmpRoot` is now hoisted out of
                // this callback (see the workdir-unification block
                // above). It points at the `.atlas/*`-scaffolded
                // temp dir for non-worktree runs, or null when a real
                // worktree owns the cleanup. spawnCli's finalize hook
                // still rms it on exit; same shape as before.
                spawnCli({
                    agent,
                    runId,
                    issueType,
                    issueId,
                    prompt: fullPrompt,
                    cwd,
                    gitConfigPath,
                    ghToken,
                    worktreeBranch,
                    worktreePath,
                    projectGitPath,
                    projectCredentialId,
                    projectDefaultBranch,
                    // Plan E + unified worktrees — pass the resolved project_id
                    // (from item lookup for issueId-attached runs, or opts for
                    // project-scope). The post-run hook needs it for push,
                    // openPullRequest, and cleanupWorktreeAfterPush.
                    projectId: effectiveProjectId,
                    itemTitle,
                    artefactTmpRoot,
                    copilotUserAgentPath,
                });
            } else {
                simulateRun(runId, agentId, issueType, issueId, fullPrompt);
            }
        })();
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

