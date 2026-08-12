// 2026-06-22 - Terminal v1; multi-CLI extended in v2.
//
// PTY-backed CLI session host. Owns one in-memory Map keyed by
// cli_sessions.id; each entry holds the live IPty (or null while paused),
// a headless xterm mirror of the live screen (serialized into a clean
// snapshot for browser attach/reconnect replay), and the set of attached
// WebSocket subscribers.
//
// Why a mirror instead of a byte ring buffer: replaying a byte-window of
// history can start mid-escape-sequence or mid-UTF-8 codepoint (rendering
// literal "zombie" characters at the top of the terminal), forwards live
// DSR cursor queries that the browser's xterm auto-answers back into the
// PTY stdin, and reflects whatever geometry the PTY had when the bytes
// were emitted. A serialized snapshot has none of those failure modes.
//
// Two CLIs are supported. Both expose `--session-id <uuid>` (start) and
// `--resume <uuid>` (rejoin), so Pause/Resume + on-PTY-exit `paused` work
// the same way for both. They differ only in the rest of the argv:
//   - claude  — `claude --session-id <uuid> --model <m> --allowedTools ...`
//   - copilot — `copilot --session-id <uuid> --model <m> --allow-all-tools`
//
// Why a single in-memory map: the orchestrator runs in one Node process
// (mcp-host + API share a host); cross-process resume would need
// pg_advisory_lock + a dedicated detach/attach protocol which is out of
// scope for v1. If the API restarts, all `active` sessions are reaped
// back to `paused` by `failOrphanedCliSessionsOnBoot`.
//
// Public API:
//   - startSession({ session, ... })   -> spawn PTY for a fresh session
//   - resumeSession({ session, ... })  -> spawn PTY with --resume <id> (claude only)
//   - attachWebSocket(sessionId, ws)   -> replay screen snapshot + live forward
//   - pauseSession(sessionId)          -> kill PTY, drop subs, status=paused
//   - killSessionPty(sessionId)        -> kill PTY only (used by Stop flow
//                                         BEFORE git operations run)
//   - isSessionLive(sessionId)         -> in-memory liveness check
//
// Things this module deliberately does NOT do:
//   - DB row creation / status transitions other than total updates +
//     errored-on-spawn-failure. The route handler owns the lifecycle.
//   - Git operations. The route handler calls worktree-orchestrator.
//   - Permission overlays. PTY-mode Claude prints its native y/n prompt
//     in the terminal stream; xterm.js renders it; the user types into
//     the same xterm pane.

import { spawn as ptySpawn, type IPty } from 'node-pty';
import { appendFileSync, mkdirSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/kysely-client.js';
import { broadcastSSE } from '../routes/events.js';
import { notificationsService } from './notifications.js';
import { sendExternalForNotification } from './external-notifications.js';
import { gitInvokeEnv } from './git-env.js';
import { ollamaEnv } from './ollama-env.js';
import { cleanupGitConfig } from './git-credentials.js';
import { CLI_DIALECT, TERMINAL_COLS, TERMINAL_ROWS, type AgentCli } from '@atlas/shared';
import { createScreenState } from './terminal-screen-state.js';
import type { TerminalScreenState, WindowsPtyHostInfo } from './terminal-screen-state.js';

// Terminal geometry is PINNED to TERMINAL_COLS x TERMINAL_ROWS (shared
// constant) for the whole PTY lifetime. There is deliberately NO resize
// path anywhere in this file: every pty.resize() made ConPTY repaint its
// whole buffer with reflow semantics that never exactly matched xterm's,
// and any transient width mismatch between the PTY and a viewer strands
// unerased cells ("zombie characters"). With one PTY and N viewers, a
// dynamic geometry can never be mismatch-free — so it is static. Browser
// panes scale their FONT to fit, never the grid (TerminalXterm.tsx).

/**
 * Which Windows PTY backend node-pty will use, from the same gate node-pty
 * applies internally (windowsPtyAgent: ConPTY iff build >= 18309; an
 * unparseable release is treated as build 0 → winpty). Undefined off
 * Windows. Every xterm that renders this PTY's bytes — the server-side
 * mirror AND the browser pane — must be told, because ConPTY repaints the
 * screen from its own buffer after a resize and assumes the terminal
 * neither reflowed nor pulled rows back out of scrollback. An xterm left
 * in its default (Unix) resize behavior drifts out of row alignment with
 * ConPTY's model, and every later diff repaint lands offset — leaving the
 * stale "zombie" cells that pile up in scrollback.
 */
export function windowsPtyInfoFor(
    platform: NodeJS.Platform,
    osRelease: string,
): WindowsPtyHostInfo | undefined {
    if (platform !== 'win32') return undefined;
    const build = Number.parseInt(osRelease.split('.')[2] ?? '', 10);
    if (!Number.isInteger(build)) return { backend: 'winpty' };
    return { backend: build >= 18309 ? 'conpty' : 'winpty', buildNumber: build };
}

const PTY_HOST_WINDOWS = windowsPtyInfoFor(process.platform, release());
// First frame of every attach, sent as a WS TEXT frame so the client can
// tell control from PTY bytes (terminal data is always binary). Sent on
// every platform so the protocol has one shape; the client only acts on
// the windowsPty field.
const PTY_INFO_FRAME = JSON.stringify({
    cmd: 'ptyInfo',
    ...(PTY_HOST_WINDOWS ? { windowsPty: PTY_HOST_WINDOWS } : {}),
});
// How often the idle detector polls each session's lastActivityAt. Cheap
// (one timestamp compare per session per tick); 5 s keeps detection latency
// within one tick of the configured threshold.
const IDLE_CHECK_INTERVAL_MS = 5_000;
// Default threshold if the settings row hasn't been loaded yet (boot race
// guard). Matches the DB default in migration 015.
const IDLE_THRESHOLD_DEFAULT_MS = 300_000;
// Allowed tools mirror agent-runner.ts plus a deliberate addition: the
// Atlas MCP server is the whole point of in-app sessions (so the user
// can talk Claude through dispatching agents). Task / WebFetch / WebSearch
// stay disallowed to match the agent-runner stance -- the user can ask
// Claude to call them explicitly and we'll add them in v2 if needed.
const DEFAULT_ALLOWED_TOOLS = [
    'mcp__atlas',
    'mcp__playwright',
    'mcp__claude_ai_Atlassian',
    'Bash',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
].join(',');
const DEFAULT_DISALLOWED_TOOLS = ['Task', 'WebFetch', 'WebSearch'].join(',');

export interface WebSocketLike {
    send(data: string | Buffer | Uint8Array): void;
    close(): void;
    on(event: 'message', listener: (data: Buffer) => void): void;
    on(event: 'close', listener: () => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
}

// `ollama` rides the claude dialect — same binary, same argv, different base
// URL via `ollamaEnv`. Only `copilot` diverges (no --resume, --allow-all-tools).
type CliKind = AgentCli;

interface SessionEntry {
    sessionId: string;
    /** Which CLI binary this PTY is running. Branches argv shape + onExit behaviour. */
    cli: CliKind;
    pty: IPty | null;
    /** Headless xterm mirror of the live screen, serialized on WS attach.
     *  Created alongside the PTY; null after the PTY exits. */
    screen: TerminalScreenState | null;
    subscribers: Set<WebSocketLike>;
    /** Subscribers whose attach snapshot hasn't been sent yet. Live
     *  broadcasts skip them — bytes still ahead of their flush marker
     *  arrive inside the snapshot instead, never twice. */
    pendingSnapshot: Set<WebSocketLike>;
    /** Pending typed bytes that arrived while the auto-prompt timer was still
     *  in flight. Flushed verbatim to the PTY after the auto-prompt's CR. */
    pendingInputQueue: string[];
    /** True while the 1.5 s settle delay before initial_prompt is auto-typed
     *  is still pending. WS message handler queues user keystrokes in this
     *  window so they don't interleave with the auto-write. */
    autoPromptPending: boolean;
    /** Unix ms of the most recent PTY output OR user keystroke, or null if
     *  the session has produced no PTY bytes yet. The idle detector compares
     *  this against `settings.terminal_idle_notify_seconds`. */
    lastActivityAt: number | null;
    /** Unix ms of the most recent idle notification, or null if we haven't
     *  fired for the current idle period. Reset to null on next activity so
     *  subsequent idle stretches can re-notify. */
    idleNotifiedAt: number | null;
    /** Polling handle for the idle detector. setInterval(IDLE_CHECK_INTERVAL_MS). */
    idleCheckTimer: NodeJS.Timeout | null;
    /** Per-session tmp file holding `http.extraheader = AUTHORIZATION: basic
     *  <b64>` for the project credential. Set by the route via buildGitAuth;
     *  exposed to the PTY via `GIT_CONFIG_GLOBAL`. Cleared on pauseSession /
     *  killSessionPty so the tmp file gets unlinked; rebuilt fresh on resume. */
    gitConfigPath: string | null;
    /** Same-session plaintext token, exported into the PTY env as
     *  `GH_TOKEN` / `GITHUB_TOKEN` so `gh` (used e.g. in `gh pr create`)
     *  authenticates as the same identity `git push` does. */
    ghToken: string | null;
}

const SESSIONS = new Map<string, SessionEntry>();

export interface StartSessionInput {
    sessionId: string;
    cli: CliKind;
    worktreePath: string;
    /** UUID Atlas mints and passes via `--session-id`. Required for both CLIs. */
    cliSessionId: string;
    model: string;
    /** Optional first prompt -- written to the PTY after a settle delay. */
    initialPrompt?: string | undefined;
    /** Optional tmp file path produced by `buildGitAuth(project.credential_id)`.
     *  Merged into the PTY spawn env as `GIT_CONFIG_GLOBAL` so `git push` from
     *  inside the session inherits the project's credential. Null when the
     *  project has no credential wired. */
    gitConfigPath?: string | null | undefined;
    /** Optional plaintext token from the same buildGitAuth call. Exposed
     *  as `GH_TOKEN` / `GITHUB_TOKEN` in the PTY env so `gh` commands
     *  the user types inside the terminal authenticate as the bot too. */
    ghToken?: string | null | undefined;
}

export interface ResumeSessionInput {
    sessionId: string;
    cli: CliKind;
    worktreePath: string;
    /** UUID originally minted on start, passed back via `--resume`. */
    cliSessionId: string;
    model: string;
    /** Same purpose as on StartSessionInput. Computed fresh on every resume
     *  because the previous tmp file was unlinked on pause / API restart. */
    gitConfigPath?: string | null | undefined;
    /** Same purpose as on StartSessionInput. Re-minted every resume. */
    ghToken?: string | null | undefined;
}

export class CliSessionSpawnError extends Error {
    public readonly kind: 'pty_failed' | 'binary_missing' | 'already_running';
    constructor(kind: 'pty_failed' | 'binary_missing' | 'already_running', message: string) {
        super(message);
        this.name = 'CliSessionSpawnError';
        this.kind = kind;
    }
}

function resolveCliBinary(cli: CliKind): string {
    // Honor explicit overrides so the smoke test + tests can swap in a
    // mock binary. Default uses the PATH-resolved CLI shim. On Windows
    // `where` and the bare name both resolve to `claude.cmd`/`copilot.cmd`
    // when invoked by node-pty.spawn; we don't have to pin the .cmd
    // suffix here because node-pty's ConPTY layer handles the cmd
    // resolution via cmd.exe.
    //
    // `ollama` deliberately resolves to the SAME binary (and the same
    // ATLAS_CLAUDE_BINARY override) as `claude` — it *is* Claude Code, just
    // pointed at a different base URL by `ollamaEnv`. That also means the e2e
    // fake-claude fixture covers Ollama sessions with no extra plumbing.
    if (CLI_DIALECT[cli] === 'copilot') return process.env['ATLAS_COPILOT_BINARY'] ?? 'copilot';
    return process.env['ATLAS_CLAUDE_BINARY'] ?? 'claude';
}

/**
 * Windows PTY spawn shim for npm@7-format `.cmd` wrappers.
 *
 * The GitHub Copilot CLI (1.0.64+) ships as `copilot.cmd` using the modern
 * npm@7+ shell-trick format:
 *     endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" ...
 *
 * That format requires cmd.exe's parser to execute it correctly. node-pty's
 * ConPTY layer CreateProcessW's the bare `copilot` (and Windows resolves the
 * `.cmd` extension via PATHEXT) — but the resulting process fails with
 * "Cannot create process, error code: 2" (ERROR_FILE_NOT_FOUND) because the
 * `endLocal & goto ...` construct isn't a valid CreateProcess invocation.
 *
 * The classic `claude.cmd` ships in the legacy npm format that ends with a
 * direct `claude.exe` invocation, so CreateProcess can follow it.
 *
 * Fix: when we get a bare-name (no path separator) `.cmd`-style invocation
 * on Windows, wrap it in `cmd.exe /c <name> <args...>`. cmd.exe parses the
 * shell-trick correctly and the PTY hosts cmd.exe → copilot → node → loader.
 *
 * Skips wrapping when the override path is absolute and ends in `.exe` (the
 * binary is a real PE that doesn't need cmd.exe) or when the override looks
 * like the fake-copilot fixture (`.js` / `.cmd` absolute paths) — those
 * resolve fine via their own .cmd shim.
 *
 * Cross-platform: on non-Windows this is a no-op (just returns the original
 * binary + args). Claude on Windows currently uses the legacy format so we
 * leave it on the direct-spawn path; if Anthropic ever ships an npm@7 .cmd
 * the same wrapping is safe to extend.
 */
function spawnSpecForWindows(binary: string, args: string[]): { binary: string; args: string[] } {
    // Platform-conditional: this whole module only runs on the Windows API
    // host in every deployed and CI environment, so process.platform is
    // always 'win32' when this file executes. The non-Windows early return
    // is a portability guard for a hypothetical future Linux/macOS host, not
    // a branch reachable from any test running on this codebase's platform.
    /* v8 ignore next */
    if (process.platform !== 'win32') return { binary, args };
    // Don't wrap absolute paths to fake fixtures (.js / explicit .cmd files
    // that are already concrete) — they work with direct spawn, and wrapping
    // them would break the test mocks.
    if (binary.includes('/') || binary.includes('\\') || binary.toLowerCase().endsWith('.exe')) {
        return { binary, args };
    }
    return { binary: 'cmd.exe', args: ['/c', binary, ...args] };
}

function buildCliArgs(params: {
    cli: CliKind;
    model: string;
    sessionId: string;
    resume: boolean;
}): string[] {
    if (!params.sessionId) {
        throw new CliSessionSpawnError('pty_failed', `${params.cli} spawn requires a session id`);
    }
    const args: string[] = [];
    if (params.resume) {
        args.push('--resume', params.sessionId);
    } else {
        args.push('--session-id', params.sessionId);
    }
    args.push('--model', params.model);
    if (CLI_DIALECT[params.cli] === 'copilot') {
        // Copilot uses one big "allow everything" switch instead of named
        // allow/disallow lists. The user is at the terminal so any
        // guardrails belong in repo config, not the spawn flags. Matches
        // how agent-runner.ts invokes copilot for non-interactive jobs.
        args.push('--allow-all-tools');
    } else {
        args.push('--allowedTools', DEFAULT_ALLOWED_TOOLS);
        args.push('--disallowedTools', DEFAULT_DISALLOWED_TOOLS);
    }
    return args;
}

// Idle detector: fires `terminal.waiting_for_input` notifications when a
// session has no PTY output AND no user keystrokes for the configured
// threshold (settings.terminal_idle_notify_seconds, default 300 s). The
// threshold is read lazily on each fire so the Owner can change it in
// Settings without restarting any sessions. CLI-agnostic: works for any
// future spawned binary (Claude today, Copilot tomorrow) because it only
// looks at byte timing, not transcript contents.

async function readIdleThresholdMs(): Promise<number> {
    try {
        const row = await db
            .selectFrom('settings')
            .select(['terminal_idle_notify_seconds'])
            .where('id', '=', 1)
            .executeTakeFirst();
        const secs = (row as { terminal_idle_notify_seconds?: number } | undefined)?.terminal_idle_notify_seconds;
        if (typeof secs === 'number' && Number.isFinite(secs) && secs > 0) {
            return secs * 1_000;
        }
    } catch {
        /* fall through to default */
    }
    return IDLE_THRESHOLD_DEFAULT_MS;
}

// PTY output bytes mean the agent is still doing work (response stream,
// TUI redraw, cursor blink, "thinking" indicator). They reset the idle
// countdown — we don't want to notify mid-response — but they do NOT
// re-arm the notify-once flag. Once the user has been told the session
// went quiet, the next ping has to wait for a real human keystroke.
function markPtyActivity(entry: SessionEntry): void {
    entry.lastActivityAt = Date.now();
}

// User keystroke = the user is actively at the terminal. Reset both
// flags so the next idle stretch is eligible for a fresh notification.
function markUserActivity(entry: SessionEntry): void {
    entry.lastActivityAt = Date.now();
    entry.idleNotifiedAt = null;
}

async function notifyTerminalWaiting(sessionId: string): Promise<void> {
    // Look up the row each fire so the title reflects the latest rename
    // and the row's `item_id` is current. Best-effort: a deleted row
    // skips the notification.
    const row = await db
        .selectFrom('cli_sessions')
        .select(['title', 'project_id', 'item_id', 'status'])
        .where('id', '=', sessionId)
        .executeTakeFirst();
    if (!row || row.status !== 'active') return;
    const title = row.title || `Session ${sessionId.slice(0, 8)}`;
    const message = `Terminal "${title}" has been idle and may be waiting for your input.`;
    try {
        const created = await notificationsService.create({
            kind: 'needs_you',
            event_type: 'terminal.waiting_for_input',
            message,
            // cli_sessions.project_id is a NOT NULL FK (migration 012); the ??
            // null fallback only exists to satisfy the notifications table's
            // nullable project_id column type and can never actually trigger
            // from a real row.
            /* v8 ignore next */
            project_id: row.project_id ?? null,
            issue_id: row.item_id ?? null,
            // Direct deep-link so a push click + an in-app row click both
            // land on the session, not the generic /notifications page.
            link_url: `/terminal/${sessionId}`,
        });
        // External (Teams/Telegram) fires only if the Owner opted in via
        // Settings → Notifications. shouldSendForEvent defaults the new
        // 'terminal.waiting_for_input' key to OFF, matching the chosen UX.
        await sendExternalForNotification(created.id, message, 'terminal.waiting_for_input').catch(
            () => {
                /* delivery failure is non-fatal */
            },
        );
    } catch {
        /* DB hiccup; next idle tick will retry once activity flips */
    }
}

function startIdleCheck(entry: SessionEntry): void {
    // Defensive double-start guard: the only two callers (startSession,
    // resumeSession) each invoke this exactly once per successful spawn, and
    // pty.onExit always calls stopIdleCheck (clearing idleCheckTimer) in the
    // same synchronous handler that nulls entry.pty before either caller can
    // run again. There's no code path today that calls this twice on an
    // entry whose timer is still armed.
    /* v8 ignore next */
    if (entry.idleCheckTimer) return;
    entry.idleCheckTimer = setInterval(() => {
        void (async () => {
            // Two-fault defensive: entry.pty only becomes null inside
            // pty.onExit, which clears this very interval (stopIdleCheck) in
            // the same synchronous tick that nulls pty. There's no window in
            // which a pending tick observes pty === null before the interval
            // that would have delivered that tick is already cleared.
            /* v8 ignore next */
            if (!entry.pty) return;
            if (entry.lastActivityAt === null) return;
            if (entry.idleNotifiedAt !== null) return;
            const thresholdMs = await readIdleThresholdMs();
            if (Date.now() - entry.lastActivityAt < thresholdMs) return;
            entry.idleNotifiedAt = Date.now();
            await notifyTerminalWaiting(entry.sessionId);
        })().catch(() => { /* tick failure is non-fatal */ });
    }, IDLE_CHECK_INTERVAL_MS);
}

function stopIdleCheck(entry: SessionEntry): void {
    if (entry.idleCheckTimer) {
        clearInterval(entry.idleCheckTimer);
        entry.idleCheckTimer = null;
    }
}

// Opt-in raw PTY capture. Set ATLAS_PTY_DUMP=true and every byte the PTY
// emits is appended verbatim to `<repo>/.atlas-dump/pty-<sessionId>.bin`.
//
// This exists because the terminal's byte stream is platform-specific —
// ConPTY on Windows produces materially different output from a Unix PTY for
// the same CLI — and rendering defects that only reproduce on one platform
// cannot be diagnosed from the other. A captured stream replays into a
// headless xterm anywhere, which turns "works on my machine" into an actual
// reproduction. Off unless the flag is set; no cost on the hot path beyond
// one boolean check per chunk.
//
// The location is fixed rather than configurable: a debug switch you have to
// think about is one you get wrong while already chasing a bug. `.atlas-dump/`
// is gitignored, so a capture can never be committed by accident.
const PTY_DUMP_ENABLED = /^(true|1)$/i.test(process.env['ATLAS_PTY_DUMP'] ?? '');
// packages/api/src/services/  -> repo root is ../../../..
// packages/api/dist/services/ -> same depth. Resolved from this module's own
// location, not process.cwd(), so it lands in the repo no matter where the
// API was launched from (matches load-env.ts).
const PTY_DUMP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.atlas-dump');
let ptyDumpDirReady = false;

function dumpPtyBytes(sessionId: string, bytes: Buffer): void {
    if (!PTY_DUMP_ENABLED) return;
    try {
        if (!ptyDumpDirReady) {
            mkdirSync(PTY_DUMP_DIR, { recursive: true });
            ptyDumpDirReady = true;
        }
        appendFileSync(join(PTY_DUMP_DIR, `pty-${sessionId}.bin`), bytes);
    } catch {
        // Diagnostics must never take a session down. A full disk or a
        // permissions error silently disables the capture.
    }
}

function broadcastPtyBytes(entry: SessionEntry, bytes: Buffer): void {
    // Snapshot the subscribers before iterating — ws.send() can synchronously
    // trigger ws.on('close') which mutates entry.subscribers, and iterating
    // the live Set during deletion silently skips entries.
    for (const ws of Array.from(entry.subscribers)) {
        if (entry.pendingSnapshot.has(ws)) continue;
        try {
            ws.send(bytes);
        } catch {
            // Subscriber dropped; ws.on('close') will clean up.
        }
    }
}

function spawnPty(params: {
    sessionId: string;
    cli: CliKind;
    worktreePath: string;
    cliSessionId: string;
    model: string;
    resume: boolean;
    gitConfigPath: string | null;
    ghToken: string | null;
}): IPty {
    const rawBinary = resolveCliBinary(params.cli);
    const rawArgs = buildCliArgs({
        cli: params.cli,
        model: params.model,
        sessionId: params.cliSessionId,
        resume: params.resume,
    });
    const { binary, args } = spawnSpecForWindows(rawBinary, rawArgs);
    try {
        return ptySpawn(binary, args, {
            name: 'xterm-256color',
            cols: TERMINAL_COLS,
            rows: TERMINAL_ROWS,
            cwd: params.worktreePath,
            // gitInvokeEnv merges in `GIT_CONFIG_GLOBAL` + `GH_TOKEN` (when set)
            // plus the GCM-silencing env vars that keep Windows credential
            // prompts from popping during `git push` from inside the user's PTY.
            // process.env is overlaid by gitInvokeEnv's spread, so we lay
            // it down first.
            env: {
                ...gitInvokeEnv(params.gitConfigPath, params.ghToken),
                // Must follow the gitInvokeEnv spread (which spreads
                // process.env) so an ANTHROPIC_API_KEY in the host env can't
                // divert a free local session to Anthropic. No-op unless
                // params.cli === 'ollama'.
                ...ollamaEnv(params.cli, params.model),
                // node-pty on Windows silently discards the `name:` option
                // (it is never passed to WindowsPtyAgent), so without these
                // the CLI sees no terminal type at all and may downgrade its
                // color output. After the spread so they win over whatever
                // the API host process inherited.
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor',
                ATLAS_CLI_SESSION_ID: params.sessionId,
            },
        });
    } catch (err) {
        const msg = (err as Error).message ?? String(err);
        if (/ENOENT/i.test(msg) || /not found/i.test(msg)) {
            throw new CliSessionSpawnError('binary_missing', `${params.cli} CLI not on PATH: ${msg}`);
        }
        throw new CliSessionSpawnError('pty_failed', `PTY spawn failed: ${msg}`);
    }
}

function attachPtyToEntry(entry: SessionEntry, pty: IPty): void {
    entry.pty = pty;
    // Fresh mirror per PTY lifetime, so a resumed session's replay starts
    // from the new PTY's first paint — the same clean-slate rule the old
    // backlog reset enforced.
    const screen = createScreenState(TERMINAL_COLS, TERMINAL_ROWS, PTY_HOST_WINDOWS);
    entry.screen = screen;
    pty.onData((data) => {
        const buf = Buffer.from(data, 'utf8');
        // Capture before anything interprets the bytes, so a dump is exactly
        // what the PTY produced — not what we made of it.
        dumpPtyBytes(entry.sessionId, buf);
        // Broadcast from the mirror's write callback, not synchronously:
        // feed callbacks fire FIFO with the attach flush marker, which is
        // what guarantees an attaching browser sees each byte exactly once
        // (inside the snapshot XOR live) — see attachWebSocket.
        screen.feed(data, () => {
            broadcastPtyBytes(entry, buf);
            // PTY emitted bytes -> session isn't idle right now, but we don't
            // re-arm the notification here. See markPtyActivity for the why.
            markPtyActivity(entry);
        });
    });
    pty.onExit(({ exitCode }) => {
        // Mark the session entry's pty null so attach attempts fail fast;
        // attaches from here on get a bare subscription with no snapshot.
        entry.pty = null;
        entry.screen = null;
        // Idle detector is per-PTY-lifetime; stop polling now that the
        // PTY is gone. resumeSession spawns a fresh timer.
        stopIdleCheck(entry);
        // Tell every attached browser the PTY ended. The notice rides the
        // mirror's write queue so it lands AFTER any still-queued output;
        // teardown (close + dispose) happens in the same callback so no
        // later-queued callback can fire on a disposed mirror.
        const noticeStr = `\r\n[atlas-terminal] PTY exited with code ${exitCode}\r\n`;
        screen.feed(noticeStr, () => {
            broadcastPtyBytes(entry, Buffer.from(noticeStr, 'utf8'));
            for (const ws of Array.from(entry.subscribers)) {
                try { ws.close(); } catch { /* best-effort */ }
            }
            entry.subscribers.clear();
            entry.pendingSnapshot.clear();
            screen.dispose();
        });
        // The PTY held the only handle to GIT_CONFIG_GLOBAL; with the PTY
        // dead the tmp file's only consumer is gone. Drop it now so we
        // don't leak per-session tmp files when the user types `/exit`.
        // resumeSession rebuilds a fresh one.
        if (entry.gitConfigPath) {
            cleanupGitConfig(entry.gitConfigPath);
            entry.gitConfigPath = null;
            entry.ghToken = null;
        }
        // Best-effort: flip the DB row to `paused` so the user is offered
        // a Resume affordance instead of staring at a frozen "active"
        // session whose PTY is gone. Both CLIs support `--resume <sid>`
        // against their on-disk transcript (claude: ~/.claude/projects;
        // copilot: ~/.copilot/sessions), so the same row state works for
        // both. Wrapped in void+catch because pty.onExit fires
        // synchronously from native code -- we don't want a DB blip to
        // leak unhandled.
        void (async () => {
            try {
                await db
                    .updateTable('cli_sessions')
                    .set({
                        status: 'paused',
                        updated_at: new Date().toISOString(),
                        last_active_at: new Date().toISOString(),
                    })
                    .where('id', '=', entry.sessionId)
                    .where('status', '=', 'active')
                    .execute();
                broadcastSSE({
                    type: 'cli_session_status',
                    cliSessionId: entry.sessionId,
                    cliSessionStatus: 'paused',
                });
            } catch {
                /* row may have been deleted; nothing to do */
            }
        })();
    });
}

export function startSession(input: StartSessionInput): void {
    if (SESSIONS.has(input.sessionId)) {
        throw new CliSessionSpawnError('already_running', `Session ${input.sessionId} is already attached.`);
    }
    const hasInitialPrompt = !!(input.initialPrompt && input.initialPrompt.trim().length > 0);
    const entry: SessionEntry = {
        sessionId: input.sessionId,
        cli: input.cli,
        pty: null,
        screen: null,
        subscribers: new Set(),
        pendingSnapshot: new Set(),
        pendingInputQueue: [],
        autoPromptPending: hasInitialPrompt,
        lastActivityAt: null,
        idleNotifiedAt: null,
        idleCheckTimer: null,
        gitConfigPath: input.gitConfigPath ?? null,
        ghToken: input.ghToken ?? null,
    };
    SESSIONS.set(input.sessionId, entry);
    let pty: IPty;
    try {
        pty = spawnPty({
            sessionId: input.sessionId,
            cli: input.cli,
            worktreePath: input.worktreePath,
            cliSessionId: input.cliSessionId,
            model: input.model,
            resume: false,
            gitConfigPath: entry.gitConfigPath,
            ghToken: entry.ghToken,
        });
    } catch (err) {
        // PTY spawn failed -- remove the orphan entry so we don't leak an
        // autoPromptPending=true ghost that would queue user input forever
        // if anything later tries to attach by this sessionId. Also drop
        // the tmp git config we already wrote; nothing else holds it.
        if (entry.gitConfigPath) {
            cleanupGitConfig(entry.gitConfigPath);
            entry.gitConfigPath = null;
            entry.ghToken = null;
        }
        SESSIONS.delete(input.sessionId);
        throw err;
    }
    attachPtyToEntry(entry, pty);
    startIdleCheck(entry);
    if (hasInitialPrompt) {
        // Settle delay so the CLI's welcome screen renders before we type.
        // Without this, the prompt gets eaten by the boot sequence. While
        // this timer is pending, the WS input handler queues user keystrokes
        // so they don't interleave with the auto-write.
        const prompt = input.initialPrompt!;
        setTimeout(() => {
            if (entry.pty) entry.pty.write(prompt + '\r');
            entry.autoPromptPending = false;
            // Flush anything the user typed while the timer was in flight.
            if (entry.pty) {
                for (const chunk of entry.pendingInputQueue) entry.pty.write(chunk);
            }
            entry.pendingInputQueue.length = 0;
        }, 1_500);
    }
}

export function resumeSession(input: ResumeSessionInput): void {
    const existing = SESSIONS.get(input.sessionId);
    if (existing && existing.pty) {
        throw new CliSessionSpawnError('already_running', `Session ${input.sessionId} is already attached.`);
    }
    const entry: SessionEntry = existing ?? {
        sessionId: input.sessionId,
        cli: input.cli,
        pty: null,
        screen: null,
        subscribers: new Set(),
        pendingSnapshot: new Set(),
        pendingInputQueue: [],
        autoPromptPending: false,
        lastActivityAt: null,
        idleNotifiedAt: null,
        idleCheckTimer: null,
        gitConfigPath: input.gitConfigPath ?? null,
        ghToken: input.ghToken ?? null,
    };
    // If we're reusing an existing entry (from a prior PTY exit), reset
    // the idle-state for the new PTY's lifetime — old timestamps from
    // before the exit shouldn't carry into the resumed session.
    entry.lastActivityAt = null;
    entry.idleNotifiedAt = null;
    // Carry the latest gitConfigPath through; the route rebuilds this on
    // every resume because the previous tmp file was unlinked on pause /
    // didn't survive an API restart. Same for ghToken — freshly minted.
    entry.gitConfigPath = input.gitConfigPath ?? null;
    entry.ghToken = input.ghToken ?? null;
    SESSIONS.set(input.sessionId, entry);
    let pty: IPty;
    try {
        pty = spawnPty({
            sessionId: input.sessionId,
            cli: input.cli,
            worktreePath: input.worktreePath,
            cliSessionId: input.cliSessionId,
            model: input.model,
            resume: true,
            gitConfigPath: entry.gitConfigPath,
            ghToken: entry.ghToken,
        });
    } catch (err) {
        // Mirror startSession: clean up the entry we just put in SESSIONS so
        // it doesn't linger as a ghost. If `existing` was already there we
        // still drop it -- the route handler returns 500 and the user will
        // retry via Resume which creates a fresh entry.
        if (entry.gitConfigPath) {
            cleanupGitConfig(entry.gitConfigPath);
            entry.gitConfigPath = null;
            entry.ghToken = null;
        }
        SESSIONS.delete(input.sessionId);
        throw err;
    }
    attachPtyToEntry(entry, pty);
    startIdleCheck(entry);
}

export function attachWebSocket(sessionId: string, ws: WebSocketLike): boolean {
    const entry = SESSIONS.get(sessionId);
    if (!entry) return false;
    entry.subscribers.add(ws);
    // Hello frame FIRST, so the client applies windowsPty before the
    // snapshot (or any live byte) is parsed at the wrong resize semantics.
    try {
        ws.send(PTY_INFO_FRAME);
    } catch {
        // Subscriber already dead; close handler will purge.
    }
    // No geometry adoption: PTY, mirror, and every client are pinned to
    // TERMINAL_COLS x TERMINAL_ROWS, so the snapshot is always laid out
    // exactly as the client will render it.
    const screen = entry.screen;
    if (screen) {
        // Withhold live broadcasts until the serialized snapshot is sent.
        // Bytes queued before the flush marker are parsed before it fires,
        // so they arrive inside the snapshot; bytes queued after it are
        // broadcast live once the pending flag clears — exactly once
        // either way, with no settle-window heuristics.
        entry.pendingSnapshot.add(ws);
        screen.whenFlushed(() => {
            // The socket may have closed while the marker was queued.
            if (!entry.subscribers.has(ws)) {
                entry.pendingSnapshot.delete(ws);
                return;
            }
            const snapshot = screen.snapshot();
            if (snapshot.length > 0) {
                try {
                    ws.send(Buffer.from(snapshot, 'utf8'));
                } catch {
                    // Subscriber already dead; close handler will purge.
                }
            }
            entry.pendingSnapshot.delete(ws);
        });
    }
    ws.on('message', (data: Buffer) => {
        // Control messages are JSON-encoded UTF-8 starting with `{`; raw
        // typed bytes are forwarded straight to the PTY. ConPTY doesn't
        // care about CRLF vs LF since xterm.js sends what the user typed.
        // Decode once and reuse for both the JSON-parse attempt and the
        // PTY write fallback.
        if (!entry.pty) return;
        const chunk = data.toString('utf8');
        if (data.byteLength > 0 && data[0] === 0x7b /* '{' */) {
            try {
                const ctrl = JSON.parse(chunk) as { cmd?: string };
                if (ctrl.cmd === 'resize') {
                    // Consumed and DROPPED. Geometry is pinned (see the
                    // header note) — the PTY is never resized. The envelope
                    // is still recognized so a stale client's frame can
                    // never fall through as keystrokes and type literal
                    // JSON into the shell.
                    return;
                }
            } catch {
                // Not a control envelope -- fall through and write to PTY.
            }
        }
        if (entry.autoPromptPending) {
            // Hold user input until the auto-prompt fires so the two
            // streams don't interleave at the PTY's stdin.
            entry.pendingInputQueue.push(chunk);
            return;
        }
        entry.pty.write(chunk);
        // User keystroke -> human is back at the terminal. Re-arm both
        // the idle countdown and the notify-once flag. Resize control
        // envelopes (handled above with `return`) deliberately don't
        // count — they fire from the browser, not the user. The snapshot
        // replay contains no DSR queries for xterm.js to auto-answer, so
        // every inbound byte here really is typed by the user.
        markUserActivity(entry);
    });
    ws.on('close', () => {
        entry.subscribers.delete(ws);
        entry.pendingSnapshot.delete(ws);
    });
    ws.on('error', () => {
        entry.subscribers.delete(ws);
        entry.pendingSnapshot.delete(ws);
    });
    return true;
}

export function pauseSession(sessionId: string): void {
    const entry = SESSIONS.get(sessionId);
    if (!entry) return;
    stopIdleCheck(entry);
    if (entry.pty) {
        try {
            entry.pty.kill();
        } catch {
            /* best-effort */
        }
        entry.pty = null;
    }
    // Drop subscribers -- the next attach (after Resume) will get a
    // fresh PTY's output. Browsers stay open and reconnect when the
    // user clicks Resume.
    for (const ws of Array.from(entry.subscribers)) {
        try {
            ws.close();
        } catch {
            /* best-effort */
        }
    }
    entry.subscribers.clear();
    entry.pendingSnapshot.clear();
    entry.screen?.dispose();
    entry.screen = null;
    if (entry.gitConfigPath) {
        cleanupGitConfig(entry.gitConfigPath);
        entry.gitConfigPath = null;
        entry.ghToken = null;
    }
    SESSIONS.delete(sessionId);
}

export function killSessionPty(sessionId: string): void {
    // Used by the Stop flow BEFORE git operations: kill the PTY so it
    // releases any open file handles on the worktree, but don't bother
    // notifying subscribers (the route handler will move the row to
    // `closed` and the client will get that via SSE).
    const entry = SESSIONS.get(sessionId);
    if (!entry) return;
    stopIdleCheck(entry);
    if (entry.pty) {
        try {
            entry.pty.kill();
        } catch {
            /* best-effort */
        }
    }
    for (const ws of Array.from(entry.subscribers)) {
        try {
            ws.close();
        } catch {
            /* best-effort */
        }
    }
    entry.pendingSnapshot.clear();
    entry.screen?.dispose();
    entry.screen = null;
    if (entry.gitConfigPath) {
        cleanupGitConfig(entry.gitConfigPath);
        entry.gitConfigPath = null;
        entry.ghToken = null;
    }
    SESSIONS.delete(sessionId);
}

export function isSessionLive(sessionId: string): boolean {
    const entry = SESSIONS.get(sessionId);
    return !!entry && !!entry.pty;
}

/** For unit tests + the debug surface. */
export function listLiveSessionIds(): string[] {
    return Array.from(SESSIONS.keys());
}

/** Test-only snapshot of the in-memory entry's idle / settle state. Returns
 *  `null` if the session id isn't currently in the live map. Not exported
 *  for production use — production code should read DB state, not host
 *  internals. */
export function __peekSessionStateForTest(sessionId: string): {
    lastActivityAt: number | null;
    idleNotifiedAt: number | null;
    autoPromptPending: boolean;
} | null {
    const entry = SESSIONS.get(sessionId);
    if (!entry) return null;
    return {
        lastActivityAt: entry.lastActivityAt,
        idleNotifiedAt: entry.idleNotifiedAt,
        autoPromptPending: entry.autoPromptPending,
    };
}

/** Test-only mutator for setting idleNotifiedAt without waiting for the
 *  real idle timer to fire. Production code MUST NOT call this. */
export function __setIdleNotifiedAtForTest(sessionId: string, value: number | null): boolean {
    const entry = SESSIONS.get(sessionId);
    if (!entry) return false;
    entry.idleNotifiedAt = value;
    return true;
}

// 2026-06-22 - Boot-time sweep. Any cli_sessions row marked `active` whose
// id is NOT in the in-memory SESSIONS map is by definition stranded from a
// previous process: the API just started, the map is empty, so anything
// still flagged `active` lost its PTY when the previous process exited.
//
// Recovery: flip to `paused`. The Claude JSONL transcript is preserved on
// disk under ~/.claude/projects/<encoded-cwd>/<claude_session_id>.jsonl
// across restarts, so the user can click Resume and the conversation
// continues. If the worktree was corrupted by the crash, the resume PTY
// will surface that and the user can DELETE the row.
//
// Mirrors `failOrphanedRuns` in agent-runner.ts:99. Runs once at boot via
// main.ts; no periodic timer because the only orphan source is process
// restart -- a live API never strands its own sessions.
export async function failOrphanedCliSessions(): Promise<number> {
    try {
        const live = new Set(listLiveSessionIds());
        const candidates = await db
            .selectFrom('cli_sessions')
            .select(['id'])
            .where('status', '=', 'active')
            .execute();
        const orphanIds = candidates.map((r) => r.id).filter((id) => !live.has(id));
        if (orphanIds.length === 0) return 0;
        const now = new Date().toISOString();
        await db
            .updateTable('cli_sessions')
            .set({ status: 'paused', updated_at: now, last_active_at: now })
            .where('id', 'in', orphanIds)
            .where('status', '=', 'active')
            .execute();
        for (const id of orphanIds) {
            broadcastSSE({
                type: 'cli_session_status',
                cliSessionId: id,
                cliSessionStatus: 'paused',
            });
        }
        return orphanIds.length;
    } catch {
        // Best-effort boot step; never let a sweeper failure crash the API.
        return 0;
    }
}
