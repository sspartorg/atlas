# Terminal Layout (Multi-Pane Workspace)

**Route:** `/terminal/layout` • **Component:** `packages/web/src/pages/TerminalLayout.tsx` • **Slug:** `terminal-layout`

## Purpose
A TradingView-style multi-pane workspace for running 1–4 live Claude / Copilot sessions side-by-side. Pick a layout shape (single, 2 stacked, 2 cols, 3 in various splits, 2×2 grid), then fill each pane by either attaching to an existing active/paused session or starting a brand new one. Drag the dividers to resize panes. Hide the chrome to give terminals the full viewport.

## States
- **Default**: single pane, empty — `<EmptyPane>` centered "Connect ▾" button.
- **Partially populated**: any mix of attached panes (`PaneChrome` + `TerminalXterm`) and empty panes.
- **All attached**: every pane has a session id; "Attach to existing" submenu only lists not-yet-attached sessions.
- **Chrome hidden**: the page-level toolbar is replaced by a small floating eye-icon in the top-right (re-shows on click).

## UI elements

**Toolbar (44px, sticky top)**
- Back IconButton → `/terminal`.
- `LayoutPickerMenu` — opens a 4-column grid of layout icons (single · h2 · v2 · h3-top · h3-bottom · v3 · h3 · grid2x2). Click selects the new layout; if the new shape has fewer panes, a toast announces how many were detached (sessions stay running on the server).
- Status label `{attached}/{total} attached` in mono-style.
- Hide-chrome IconButton → collapses the toolbar; a floating eye in the top-right brings it back.

**Pane chrome (`PaneChrome`, 32px tall)**
- Colored status dot (success/warning/slate/error).
- CLI icon from `utils/cliPresentation.ts` (TerminalRounded for Claude, SmartToyRounded for Copilot, MemoryRounded for Ollama).
- Truncated session title.
- Kebab menu (`MoreVertRounded`) — reuses `TerminalSessionControls compact` for Pause/Resume/Stop, plus:
  - "Open in single view" → `/terminal/:id`
  - "Detach pane (keep session)" → clears `panes[i].sessionId`, leaves the server session running.

**Empty pane**
- Dashed-border tile with "Empty pane — connect a session" + a "Connect ▾" Button.
- Menu contents:
  - "Start new session…" → opens shared `StartSessionDialog`. On `onCreated(s)`, attaches the new session to this pane (no navigation).
  - "Attach to existing" submenu listing every session whose status is `active` or `paused`, sorted by `last_active_at desc`. Sessions already attached to another pane in this layout are disabled with "(in another pane)".

**Panel splits (`react-resizable-panels` v2)** — `PanelGroup` + `Panel` + `PanelResizeHandle`. Each `PanelGroup` carries an `autoSaveId` (`atlas.terminal-layout.<kind>`) so dragged sizes persist per-kind in localStorage. `minSize` of 20 (15 for 3-column variants) keeps panes legible.

**Terminal pane body** — the existing `TerminalXterm` component renders inside each attached pane. It is a raw byte pipe: server PTY bytes go straight into xterm.js's stateful parser (no client-side decode/buffer). The first frame after each (re)connect is a `ptyInfo` text control frame (on a Windows host it flips xterm's ConPTY compatibility mode, `windowsPty`), followed by a serialized screen snapshot from the server-side headless mirror, so refresh/reconnect repaints cleanly. The grid is **pinned** to the shared `TERMINAL_COLS × TERMINAL_ROWS` (120×30) — the same size the PTY spawned at and the server mirror parses at — and is never resized: any transient width mismatch between the PTY and a viewer strands unerased cells from Ink-style TUI repaints (the ConPTY "zombie characters"), and with one PTY and N panes a dynamic geometry can never be mismatch-free. A divider drag instead rescales the pane's FONT (`fitFontToWidth`, trailing-debounced ~100 ms, integer px clamped 8–24) so the fixed grid fits the pane width; nothing is sent to the server on resize.

## Why these affordances exist
- **Drag-to-resize** — the request was explicitly "stacks like TradingView". Static splits don't match that mental model.
- **Persistence (URL + localStorage)** — a multi-pane layout is the kind of state you want back after reload, and copy-pasteable URLs let you share workspace setups.
- **Detach vs. stop** — once a user has 4 panes and wants to swap one out, you almost never mean "kill that session". Detach defaults to "keep the session alive".
- **Hide chrome** — three live xterms inside a viewport already eat most of the screen; surrendering 44px back to the terminals matters.

## Modals / drawers
- Reuses `StartSessionDialog` (`packages/web/src/components/StartSessionDialog.tsx`) inline. The dialog's `onCreated` callback attaches the new session to the originating pane.
- Reuses `StopSessionModal` indirectly through `TerminalSessionControls compact`. The modal portals to `document.body`, so pane geometry never affects it — only viewport width does. Its `onClosed` hands back `{pushed, committed, prUrl}` and `PaneChrome`'s toast branches on that ("Session stopped + PR opened" / "+ branch pushed" / plain).

## Hooks used
- `useCliSessions()` — list of all sessions (the "Attach to existing" submenu filters this to `active|paused`).
- `useSearchParams` — URL state `?k=<kind>&s=<id1>,<id2>,...` (mirrors local layout state).
- `useToast`, `useNavigate`.

## Persisted state
- **localStorage key** `atlas.terminal-layout.v1` → `{ kind, panes: [{ sessionId }, ...] }`.
- **localStorage keys** `atlas.terminal-layout.<kind>` → pane-size percentages, written by `react-resizable-panels`' `autoSaveId`.
- **URL query** `?k=…&s=…` → same shape as the localStorage record; URL takes precedence on first load (so a shared link wins over the local copy).

## API endpoints touched
- `GET /api/cli/sessions` (via `useCliSessions`).
- Each attached pane opens its own WebSocket to `/api/cli/sessions/:id/stream` via `TerminalXterm` — no new endpoints.
- The dialog still calls `POST /api/cli/sessions`.

## Edge cases / quirks
- If a stored sessionId no longer exists on the server (deleted between visits), the pane renders a small "Session not found" notice with a Clear button.
- Closed/errored sessions can technically be attached if pasted via URL, but the pane body shows "Session is <status>. Open in single view for transcript." instead of an xterm.
- Switching layouts when N → fewer panes truncates `panes[]`; the dropped sessions keep running and can be re-attached.
- `autoSaveId` is per-kind so switching back to a previously-used kind restores the user's drag sizes.

## Connectivity
- **Pages**: [Terminal](23-terminal.md) — entry point via the DashboardCustomize icon-button in the header; [Terminal Session](.) — kebab "Open in single view" target.
- **Routes**: `GET /api/cli/sessions`, `POST /api/cli/sessions` (dialog), WS `/api/cli/sessions/:id/stream`.
- **Entities**: `cli_sessions`.

## Coming soon on this page
- (none)
