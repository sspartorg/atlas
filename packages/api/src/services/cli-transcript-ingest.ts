import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from '../db/kysely-client.js';
import {
    parseClaudePtyUsage,
    parseClaudeSubagentUsage,
    type ClaudeSubagentUsage,
} from './pty-transcript-usage.js';
import {
    parseCopilotEventsUsage,
    extractCopilotSubagentInvocations,
    type CopilotSubagentInvocation,
} from './copilot-events-usage.js';
import { CLI_DIALECT, type AgentCli, type CliDialect } from '@atlas/shared';

// Terminal v2 — copy a closed CLI session's on-disk JSONL transcript into
// the DB so the history page can render it later, even if the CLI later
// purges its own state directory.
//
// File layout (confirmed by inspecting live state dirs on Windows):
//   claude  : ~/.claude/projects/<encoded-cwd>/<claude_session_id>.jsonl
//             encoding: drop drive colon, replace every `\` / `/` with `-`.
//             e.g. `C:\Users\X\Projects\atlas` becomes `C-Users-X-Projects-atlas`.
//   copilot : ~/.copilot/session-state/<claude_session_id>/events.jsonl
//             The directory is named after `claude_session_id` (the uuid
//             Atlas passes via `--session-id`, which copilot honors and
//             uses for its own state dir). `events.jsonl` is written
//             LAZILY -- only after the user actually interacts with the
//             session, so a quick-exit session leaves no file on disk
//             (resolver returns null content, treated like ENOENT).
//             The original code looked up the dir under `row.id` (the
//             Atlas PK) which is a SEPARATE uuid from the one passed to
//             the CLI; that's why the path never resolved.
//
// Both writes are awaited at the close-side of the route handler so the
// transcript_jsonl column is populated before worktree_path is nulled.
// Lazy-on-demand from the GET endpoint covers the rare case where the
// close-time ingest failed; once cached the GET returns the snapshot.

const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

// The on-disk transcript FORMAT, i.e. the CLI dialect — not the `cli` column.
// Ollama sessions run the Claude binary, so they write Claude's JSONL into
// `~/.claude/projects` and are ingested as `claude` here.
export type CliKind = CliDialect;

export interface TranscriptResult {
    jsonl_content: string | null;
    ingested_at: string | null;
    source: CliKind;
}

/**
 * Pure string transform — Claude's filename rule for a project directory.
 * Replaces EVERY character that is not [a-zA-Z0-9-] with `-`. This was
 * discovered empirically: the previous "drop `:`, replace `\` / `/`" rule
 * was a guess that broke on any path containing `.` (e.g. user names like
 * `sspart`) or `_` (e.g. atlas's worktree dir `atlas__terminal__
 * <short>` which becomes `atlas--terminal--<short>` on disk). Claude
 * collapses none of the resulting dashes, so `C:\Users\X` becomes
 * `C--Users-X` (NOT `C-Users-X`).
 */
export function encodeClaudeProjectDir(absPath: string): string {
    return absPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

interface ResolvedPath {
    path: string | null;
    skipReason?: string;
}

function resolveTranscriptPath(row: {
    cli: CliKind;
    id: string;
    claude_session_id: string | null;
    worktree_path: string | null;
}): ResolvedPath {
    if (!row.claude_session_id) {
        return { path: null, skipReason: 'no claude_session_id on row' };
    }
    if (row.cli === 'claude') {
        if (!row.worktree_path) {
            return { path: null, skipReason: 'no worktree_path on row' };
        }
        const encoded = encodeClaudeProjectDir(row.worktree_path);
        return {
            path: path.join(homedir(), '.claude', 'projects', encoded, `${row.claude_session_id}.jsonl`),
        };
    }
    // copilot — dir name is `claude_session_id` (uuid Atlas passed via
    // `--session-id`, which copilot honors). The original bug here was
    // using `row.id` (Atlas's PK) which is a separate uuid. Worktree
    // path is not needed for copilot's layout. Note: copilot writes
    // `events.jsonl` lazily — only after the user interacts with the
    // session, so a quick-exit session leaves no file on disk (ENOENT
    // path below preserves whatever's already in `transcript_jsonl`).
    return {
        path: path.join(homedir(), '.copilot', 'session-state', row.claude_session_id, 'events.jsonl'),
    };
}

/** Caller-supplied overrides for `ingestTranscript`. */
export interface IngestOverrides {
    /**
     * Worktree path to use for Claude file resolution. The Stop and
     * errored-spawn route handlers null `cli_sessions.worktree_path` before
     * the cleanup runs, so if ingest reads the row AFTER the UPDATE it can no
     * longer compute the `~/.claude/projects/<encoded>/<sid>.jsonl` path.
     * Callers in that ordering pass the pre-UPDATE worktree path here.
     */
    worktreePath?: string | null;
}

/**
 * Slurp the CLI's on-disk transcript and write it into the row's
 * `transcript_jsonl` column. Returns the persisted content.
 *
 * - Returns null content (not throw) when the file is missing — the CLI
 *   may have purged it before we got to it.
 * - Caps at 10 MB; oversized transcripts are skipped with a logged warn.
 * - Idempotent — every call overwrites whatever was there.
 */
export async function ingestTranscript(
    sessionId: string,
    overrides?: IngestOverrides,
): Promise<TranscriptResult | null> {
    const row = await db
        .selectFrom('cli_sessions')
        .select([
            'id',
            'cli',
            'claude_session_id',
            'worktree_path',
            'model',
            'transcript_jsonl',
            'transcript_ingested_at',
        ])
        .where('id', '=', sessionId)
        .executeTakeFirst();

    if (!row) return null;

    const rawCli: AgentCli = (row.cli as AgentCli | undefined) ?? 'claude';
    const cli: CliKind = CLI_DIALECT[rawCli] ?? 'claude';
    const resolvedWorktreePath =
        overrides?.worktreePath !== undefined
            ? overrides.worktreePath
            : (row.worktree_path ?? null);
    const resolved = resolveTranscriptPath({
        cli,
        id: String(row.id),
        claude_session_id: row.claude_session_id ?? null,
        worktree_path: resolvedWorktreePath,
    });

    if (!resolved.path) {
        // No file path can be derived — just return whatever's already in the
        // DB without overwriting. Common for paused/active sessions that haven't
        // been written yet, or rows that never carried a session id.
        return {
            jsonl_content: row.transcript_jsonl ?? null,
            ingested_at: (row.transcript_ingested_at as string | null) ?? null,
            source: cli,
        };
    }

    let content: string | null = null;
    try {
        const stat = await fs.stat(resolved.path);
        if (stat.size > MAX_TRANSCRIPT_BYTES) {
            // Oversized — don't load. Preserve any prior DB content as-is.
            return {
                jsonl_content: row.transcript_jsonl ?? null,
                ingested_at: (row.transcript_ingested_at as string | null) ?? null,
                source: cli,
            };
        }
        content = await fs.readFile(resolved.path, 'utf8');
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
            // EACCES / EISDIR / read errors get a single log line, no throw —
            // the UI shows "transcript unavailable" rather than crashing.
            // (Logging via console here because the service has no fastify
            // logger; callers can wrap if they want to attach context.)
            // eslint-disable-next-line no-console
            console.warn(
                `[cli-transcript-ingest] read failed for session ${sessionId}: ${(err as Error).message}`,
            );
        }
        // File missing OR unreadable → return whatever's currently in the DB.
        return {
            jsonl_content: row.transcript_jsonl ?? null,
            ingested_at: (row.transcript_ingested_at as string | null) ?? null,
            source: cli,
        };
    }

    const nowIso = new Date().toISOString();

    // Token + cost capture for both CLIs. Each uses a different source:
    //
    //   - Claude PTY: sum per-event `usage` blocks across assistant
    //     messages, dedup by `message.id` (Claude Code writes each
    //     message twice — stream-start + stream-end — see
    //     `pty-transcript-usage.ts`), multiply by Anthropic pricing
    //     table.
    //   - Copilot PTY: read the final `session.shutdown` event's
    //     `totalNanoAiu` + `tokenDetails`. Cost is
    //     `(nano_aiu / 1e9) * $0.04` — same formula the user's
    //     `~/.copilot/status.py` recipe uses against copilot's own
    //     state DB. See `copilot-events-usage.ts`.
    //
    // Both return null when the JSONL doesn't carry the expected
    // shape (session still live, CLI crashed before emitting, file
    // truncated). Null → the UPDATE skips the cost columns, leaving
    // them at their prior value (usually null).
    // cli_sessions.model is NOT NULL in the schema (migration 012); the `?? ''`
    // fallback exists only because the inline cast widens the type, not
    // because a real row can lack a model.
    /* v8 ignore next */
    const fallbackModel = (row as { model?: string | null }).model ?? '';
    const parsedUsage = !content
        ? null
        : cli === 'claude'
        ? parseClaudePtyUsage(content, fallbackModel)
        : parseCopilotEventsUsage(content);
    // Ollama sessions are free. The token counts are real (Claude's JSONL
    // carries them regardless of backend), but `parseClaudePtyUsage` prices
    // them against Anthropic's table — and for an Ollama model id
    // `lookupClaudePrices` returns null, which reads as "cost unknown" rather
    // than "cost nothing". Pin it to 0 so the session reports Free.
    const usage =
        parsedUsage && rawCli === 'ollama' ? { ...parsedUsage, total_cost_usd: 0 } : parsedUsage;

    await db
        .updateTable('cli_sessions')
        .set({
            transcript_jsonl: content,
            transcript_ingested_at: nowIso,
            ...(usage
                ? {
                      total_cost_usd: usage.total_cost_usd,
                      input_tokens: usage.input_tokens,
                      output_tokens: usage.output_tokens,
                      cache_creation_tokens: usage.cache_creation_tokens,
                      cache_read_tokens: usage.cache_read_tokens,
                  }
                : {}),
        })
        .where('id', '=', sessionId)
        .execute();

    // Subagent breakdown (Terminal v4). Forward-only — the caller runs
    // this at session-close time, so historic rows keep their empty
    // breakdown. Failures here NEVER surface to the ingest caller
    // because they'd block transcript persistence; log + continue.
    try {
        await ingestSubagents({
            cli,
            sessionId,
            fallbackModel,
            claudeParentTranscriptPath: cli === 'claude' ? resolved.path : null,
            copilotJsonl: cli === 'copilot' ? content : null,
        });
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
            `[cli-transcript-ingest] subagent ingest failed for ${sessionId}: ${(err as Error).message}`,
        );
    }

    return { jsonl_content: content, ingested_at: nowIso, source: cli };
}

interface SubagentIngestArgs {
    cli: CliKind;
    sessionId: string;
    fallbackModel: string;
    /** For Claude: the parent `<sid>.jsonl` path; we derive `<sid>/subagents/` from it. */
    claudeParentTranscriptPath: string | null;
    /** For Copilot: the events.jsonl content we already read. */
    copilotJsonl: string | null;
}

async function ingestSubagents(args: SubagentIngestArgs): Promise<void> {
    if (args.cli === 'claude') {
        if (!args.claudeParentTranscriptPath) return;
        // Parent transcript lives at `<encoded>/<sid>.jsonl` — the
        // per-subagent JSONLs live at `<encoded>/<sid>/subagents/`.
        // Strip the `.jsonl` suffix from the parent path to get the
        // session-specific dir.
        const parentSessionDir = args.claudeParentTranscriptPath.replace(/\.jsonl$/, '');
        const rows = await parseClaudeSubagentUsage(parentSessionDir, args.fallbackModel);
        if (rows.length === 0) return;
        await writeClaudeSubagentRows(args.sessionId, rows);
        return;
    }
    // Copilot
    if (!args.copilotJsonl) return;
    const invocations = extractCopilotSubagentInvocations(args.copilotJsonl);
    if (invocations.length === 0) return;
    await writeCopilotSubagentRows(args.sessionId, invocations);
}

async function writeClaudeSubagentRows(
    cliSessionId: string,
    rows: ClaudeSubagentUsage[],
): Promise<void> {
    const values = rows.map((r) => ({
        id: randomUUID(),
        cli_session_id: cliSessionId,
        source: 'claude_jsonl' as const,
        subagent_key: r.subagentKey,
        agent_type: r.agentType,
        description: r.description,
        spawn_depth: r.spawnDepth,
        input_tokens: r.tokens.input_tokens,
        output_tokens: r.tokens.output_tokens,
        cache_creation_tokens: r.tokens.cache_creation_tokens,
        cache_read_tokens: r.tokens.cache_read_tokens,
        cost_usd: r.tokens.total_cost_usd,
        is_estimate: false,
        started_at: r.startedAt,
        ended_at: r.endedAt,
    }));
    // Re-runs against the same session (retry, lazy GET fallback) must
    // NOT trip the UNIQUE (cli_session_id, subagent_key) index — we
    // want the latest numbers to win.
    await db
        .insertInto('cli_session_subagents')
        .values(values)
        .onConflict((oc) =>
            oc.columns(['cli_session_id', 'subagent_key']).doUpdateSet({
                agent_type: (eb) => eb.ref('excluded.agent_type'),
                description: (eb) => eb.ref('excluded.description'),
                spawn_depth: (eb) => eb.ref('excluded.spawn_depth'),
                input_tokens: (eb) => eb.ref('excluded.input_tokens'),
                output_tokens: (eb) => eb.ref('excluded.output_tokens'),
                cache_creation_tokens: (eb) => eb.ref('excluded.cache_creation_tokens'),
                cache_read_tokens: (eb) => eb.ref('excluded.cache_read_tokens'),
                cost_usd: (eb) => eb.ref('excluded.cost_usd'),
                started_at: (eb) => eb.ref('excluded.started_at'),
                ended_at: (eb) => eb.ref('excluded.ended_at'),
            }),
        )
        .execute();
}

async function writeCopilotSubagentRows(
    cliSessionId: string,
    invocations: CopilotSubagentInvocation[],
): Promise<void> {
    const values = invocations.map((inv) => ({
        id: randomUUID(),
        cli_session_id: cliSessionId,
        source: 'copilot_list' as const,
        subagent_key: inv.agentName,
        agent_type: inv.agentDisplayName,
        // Copilot's on-disk format does not expose a description prompt;
        // surface the tool list instead so the UI has something useful.
        description: inv.tools.length > 0 ? `Tools: ${inv.tools.join(', ')}` : null,
        spawn_depth: null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        cost_usd: null,
        is_estimate: true,
        started_at: inv.firstSelectedAt,
        ended_at: inv.lastSelectedAt,
    }));
    await db
        .insertInto('cli_session_subagents')
        .values(values)
        .onConflict((oc) =>
            oc.columns(['cli_session_id', 'subagent_key']).doUpdateSet({
                agent_type: (eb) => eb.ref('excluded.agent_type'),
                description: (eb) => eb.ref('excluded.description'),
                started_at: (eb) => eb.ref('excluded.started_at'),
                ended_at: (eb) => eb.ref('excluded.ended_at'),
            }),
        )
        .execute();
}
