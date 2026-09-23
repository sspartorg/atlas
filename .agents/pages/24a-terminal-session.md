# Terminal Session

**Route:** `/terminal/:id` • **Component:** `packages/web/src/pages/TerminalSession.tsx` • **Slug:** `terminal-session`

## Purpose
The live, single-pane view of one PTY-backed CLI session: a real xterm attached over the WebSocket, with the session's branch, model and CLI session id in a header strip. The multi-pane workspace is `/terminal/layout`; the read-only transcript of a finished session is `/terminal/:id/history`.

## When the route is reachable
- `Terminal.tsx` (the list page) routes `active` / `paused` cards here, and `closed` / `errored` cards to `/terminal/:id/history`.
- A deep link here for a `closed` / `errored` session **redirects to `/terminal/:id/history`** (`history.replace`), mirroring the opposite guard in `TerminalHistory.tsx`. The effect depends on `session?.status`, not `session` — a TanStack refetch produces a new object every poll and would otherwise re-fire the redirect.
- `/terminal/standalone` must stay declared BEFORE `/terminal/:id` in `App.tsx`, or the param route swallows "standalone" as an id (see `routes-map.md`).

## States
- **No id in the URL**: Alert "Missing session id."
- **Loading**: centered `CircularProgress`.
- **Error / no session**: Alert "Session not found or no longer accessible." + **Back to sessions** link (`/terminal`).
- **Terminal-state session**: renders `null` while the redirect fires, so the closed-state alerts don't paint for one tick first.

## UI elements
- **Back to sessions** icon button (`ArrowBackRounded`, tooltip "Back to sessions") → `/terminal`.
- **Title** — `session.title`, `noWrap`.
- **Chips** — `session.cli` (outlined, capitalised, `data-testid="session-cli-chip"`), `session.status` (coloured via `STATUS_COLOUR`: active → success, paused → warning, closed → default, errored → error, `data-testid="session-status-chip"`), and `session.item_id` when the session is attached to an item (mono, `data-testid="session-item-chip"`).
- **Header strip** — `HeaderField` for **Branch** (`worktree_branch ?? '—'`), **Model**, and **Session id** (`claude_session_id`, mono, with a **Copy** icon button; toasts "Session id copied", or "Clipboard write blocked by browser" when the write throws). Fields show `—` when unset.
- **`TerminalSessionControls`** — Pause / Resume / Stop, including the `StopSessionModal` confirmation. It also owns the "Session stopped + branch pushed" toast; this page deliberately does NOT fire its own, which used to produce a duplicate on every Stop.
- **`TerminalXterm`** — the terminal itself, `sessionLive` only while `status === 'active'`.

## Data
- `useCliSession(id)` → `GET /api/cli/sessions/:id`
- WS `/api/cli/sessions/:id/stream` (via `TerminalXterm`)
- Pause / Resume / Stop endpoints are called from `TerminalSessionControls`: `POST /api/cli/sessions/:id/{pause,resume,preflight-stop,stop}`

## Edge cases / quirks
- `useSetPageTitle('Terminal Session')` sets the shell title.
- The page is sized `calc(100vh - 64px)` so the xterm fills the viewport under the topbar rather than scrolling the page.
- The diff panel lives in the multi-pane and layout surfaces, not here (`routes-map.md` lists `useCliSessionDiff` / `useCliSessionFilePatch` against this route; they are reached through `TerminalSessionControls`, lazy-loaded).
