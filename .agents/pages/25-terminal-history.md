# Terminal History

**Route:** `/terminal/:id/history` • **Component:** `packages/web/src/pages/TerminalHistory.tsx` • **Slug:** `terminal-history`

## Purpose
Re-open a *closed* or *errored* terminal session's transcript by reading the JSONL the CLI itself wrote to its on-disk state directory. Same mental model as Atlas's automatic-agent-run detail page, but the bytes come from `~/.claude/projects/...` or `~/.copilot/session-state/.../events.jsonl` instead of from a `--output-format=stream-json` capture.

## When the route is reachable
- `Terminal.tsx` (the list page) routes `closed`/`errored` cards to `/terminal/:id/history` and `active`/`paused` cards to `/terminal/:id` (live xterm).
- A deep link to `/terminal/:id/history` for an `active`/`paused` session redirects to `/terminal/:id` (live view) via a `useEffect` in `TerminalHistory.tsx`.
- The transcript GET endpoint returns 409 for live sessions, so even if a stale link slips through, the UI shows a clean error.

## States
- **Loading session row**: `useCliSession(id).isLoading` → centered `CircularProgress`.
- **Session not found**: Alert + back link.
- **Live session deep link**: returns null and redirects to `/terminal/:id`.
- **Loading transcript**: terminal-state session loaded, `useCliSessionTranscript().isLoading` → centered spinner.
- **Transcript fetch error**: red Alert with the error message.
- **Transcript unavailable** (file missing on disk + DB null): info Alert "Transcript unavailable — the CLI may have removed its on-disk copy".
- **Populated**: `<JsonlTranscriptViewer>` renders role-tinted bubbles.

## UI elements

**Header row**
- Back IconButton → `/terminal`.
- History icon + session title.
- CLI chip (outlined) + status chip (color-mapped).

**Metadata strip**
- Branch · Model · Closed-at timestamp · "Transcript captured" timestamp (when `ingested_at` is set).

**Finalize PR alert** (success) — when `session.finalize_pr_url` is set, links to the PR opened by the Stop flow.

**Transcript viewer (`JsonlTranscriptViewer`)** — see component doc below.

## Why these affordances exist
- **Closed/errored only** — Owner explicitly carved out paused sessions: a paused session is "still alive, just sleeping"; history surface is for sessions you're done with.
- **DB-cached transcripts** — Claude and Copilot each rotate their on-disk state independently. Once a session is finished, we slurp the file into `cli_sessions.transcript_jsonl` so subsequent views work even after the user wipes `~/.claude`.

## Transcript viewer component (`JsonlTranscriptViewer.tsx`)
- Generic JSONL viewer with three dispatch branches: `claude` (interactive on-disk JSONL), `copilot` (events.jsonl), and `agent-stream-json` (matches the `AgentRunDetail` viewer's existing shape). Dispatch is on the CLI **dialect**, not the `cli` value — Ollama sessions write Claude's own JSONL, so they take the `claude` branch.
- One row per JSONL line. Each row carries a role chip (You / Assistant / Tool / System / Meta), a typed event header in monospace, and a per-source preview. Clicking expands the raw JSON.
- Caps at 5 000 events to keep the DOM tractable; any further lines are summarised at the bottom.

## API endpoints touched
- `GET /api/cli/sessions/:id` (via `useCliSession`).
- `GET /api/cli/sessions/:id/transcript` (via `useCliSessionTranscript`) — the handler reads the persisted `transcript_jsonl` column; if NULL, it lazily calls the ingest service before responding. Returns 409 for `active`/`paused` sessions.

## Hooks used
- `useCliSession(id)` — single session row.
- `useCliSessionTranscript(id, status)` — `enabled` only for terminal-state sessions, `staleTime: Infinity` because finished-session transcripts are immutable.

## Edge cases / quirks
- **Missing on-disk file**: if both the DB column and the file are gone, the UI shows the info Alert; no crash.
- **Live-session deep link**: handled with a redirect effect; the 409 from the server is a safety net.
- **Oversized transcripts** (>10 MB): the ingest service skips the write but the UI still renders whatever was last persisted.

## Connectivity
- **Pages**: [Terminal](23-terminal.md) — back-link target and card-click origin; [Terminal Session](.) — redirect target if the session is somehow live.
- **Routes**: `GET /api/cli/sessions/:id`, `GET /api/cli/sessions/:id/transcript`.
- **Entities**: `cli_sessions` (new columns `transcript_jsonl`, `transcript_ingested_at`).

## Coming soon on this page
- (none)
