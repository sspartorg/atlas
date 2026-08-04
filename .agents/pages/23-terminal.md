# Terminal

**Route:** `/terminal` • **Component:** `packages/web/src/pages/Terminal.tsx` • **Slug:** `terminal`

## Purpose
List every PTY-backed Claude Code, GitHub Copilot, or Ollama CLI session scoped to a project worktree. Filter the list by status, CLI, project, or free-text search; click a card to open the single-session view; create a new session from the Start Session dialog.

## States
- **Loading**: `useCliSessions().isLoading` → centered `CircularProgress` (`Terminal.tsx`).
- **Empty (no sessions at all)**: `sessions.length === 0` → `<EmptyState>` card with a dashed border and a "Start Session" CTA.
- **Filtered-empty**: `sessions.length > 0 && filtered.length === 0` → centered "No sessions match these filters." text. The filter pills stay rendered so the user can clear them.
- **Populated**: header + filter row + card grid.

## UI elements

**Header**
- `h1` "Terminal" with a 36px `TerminalRounded` icon tinted with `ATLAS_PALETTE.green`.
- Stats line in JetBrains Mono: `{total} sessions · {active} active · {paused} paused`.
- **Start Session** button (right) → opens `<StartSessionDialog>`.

**Filter row (`TerminalFilters`)**
- **Status pills** (single-select with All): All · Active · Paused · Closed · Errored. Each pill carries the status's accent color and a material-symbols icon. Count chip shows the unfiltered session count per status.
- **CLI dropdown chip**: Any · Claude Code · GitHub Copilot · Ollama. Options render from `AGENT_CLIS` via `utils/cliPresentation.ts`.
- **Project dropdown chip**: Any · then every project from `useProjects()`.
- **Search field**: substring match against `title`, `worktree_branch`, `id`, and `item_id`. `/` keyboard shortcut focuses it (inherited from `SearchPillTextField`).
- Filter state persists to `localStorage` under `atlas.terminal-filters.v1` so a reload preserves the chip configuration.

**Card grid (`SessionCard`)** — `gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' }`, fixed `height: 200`, hover-lift transform.
- Row 1: CLI icon from `utils/cliPresentation.ts` (TerminalRounded for Claude, SmartToyRounded for Copilot, MemoryRounded for Ollama) + truncated title.
- Row 2: status chip (colored), CLI chip (outlined), optional item-id chip (monospace, outlined).
- Row 3 (bottom-anchored): project name (mono), branch · model line, "last active …" timestamp.
- Click anywhere on the `CardActionArea` → `navigate('/terminal/:id')`.

## Why these affordances exist
- **Filter pills** — the list grows quickly because sessions live until explicitly closed; status + CLI + project are the three axes the Owner naturally reaches for.
- **Persisted filter state** — without persistence, the user re-toggles "Active only" every reload; with it, the page lands where they left it.
- **Fixed-height cards** — keeps the grid uniform even when one session has an item-id chip and another doesn't.
- **Start Session in the header** — the most frequent action; the dialog itself stays callback-driven so other pages (the multi-pane workspace, future deep-links) can reuse it inline.

## Modals / drawers
- `StartSessionDialog` (`packages/web/src/components/StartSessionDialog.tsx`) — CLI toggle, project select, model select, item picker, title/branch/initial-prompt inputs. Calls `POST /api/cli/sessions` and emits `onCreated(session)` so the caller decides what to do next (this page navigates to the new session's deep link; the multi-pane workspace would set the new id into a pane slot).
- `StopSessionModal` (`packages/web/src/components/StopSessionModal.tsx`) — "Stop session — review & finalize", reached from any session's Stop control. A full-height two-pane review, and the gate before Atlas commits + pushes + (optionally) opens a PR.
  - **Two scope tabs**: *Uncommitted* (worktree vs HEAD, incl. untracked — these carry the staging checkboxes) and *Committed on branch* (merge-base..HEAD, read-only). Together they are what the PR will contain.
  - **Left panel** `DiffFileList`: status letter, dir-dimmed path, `+N −M`, `← old/path` on renames, `bin` for binaries. **Right pane** `DiffFilePane`: split (default) or unified, per-file lazy patch fetch, hunk separators that expand context `3 → 25`, and gates on binary / too-large / >5 000-line diffs.
  - Rendering lives in `components/diff/` behind `lazyNamed` + `Suspense` — a static import would put ~10 KB gz into the initial chunk, which has ~0.1 KB of slack.
  - **"Open a pull request for this branch"** checkbox. Disabled when there is nothing to push (mirrors the server gate). The confirm button relabels "Stop & open PR" / "Stop session". The **push always happens** — the worktree is deleted on close — so unchecking only skips PR creation.
  - Preferences (`openPr`, `viewMode`, `wrap`) persist to `localStorage` under `atlas.stop-session-prefs.v1`.
  - A failed diff request shows an inline alert and does **not** block stopping.

## Hooks used
- `useCliSessions()` — `GET /api/cli/sessions`, returns `ICliSession[]` sorted by `last_active_at desc` (cap 200).
- `useProjects()` — fuels the project dropdown.
- `useCreateCliSession()` (consumed inside `StartSessionDialog`).
- `useToast`, `useNavigate`.

## API endpoints touched
- `GET /api/cli/sessions`
- (Indirectly via the dialog) `POST /api/cli/sessions`
- (Indirectly via `StopSessionModal`) `POST /api/cli/sessions/:id/preflight-stop`, `GET /api/cli/sessions/:id/diff`, `GET /api/cli/sessions/:id/diff/file`, `POST /api/cli/sessions/:id/stop`

## Permissions / guards
- Post-onboarding only.
- The dialog requires a project — Start is disabled until one is picked.

## Edge cases / quirks
- Filter state lives in `localStorage` with a versioned key (`v1`). Bumping the shape later requires bumping the key and clearing stale state on first load.
- `relativeAgo` returns `''` for non-finite or future timestamps to avoid noisy "NaN ago" strings.
- The Copilot (`SmartToyRounded`) and Ollama (`MemoryRounded`) icons are stand-ins — MUI ships no mark for either. All three live in `utils/cliPresentation.ts`.

## Connectivity
- **Pages**: `/terminal/:id` (`TerminalSession.tsx`) — single-session deep link target; no dedicated page doc yet, see the route row in [routes-map](../routes-map.md). Its live pane is the shared `TerminalXterm` documented in [Terminal Layout](24-terminal-layout.md).
- **Routes**: `GET /api/cli/sessions`, `POST /api/cli/sessions`.
- **Entities**: `cli_sessions`, `projects` (for the filter + dialog dropdowns), `agents`-adjacent only insofar as a session's `item_id` may link to a Atlas issue.

## Coming soon on this page
- Multi-pane workspace entry-point (Task 2 — split-button caret on Start Session linking to `/terminal/layout`).
- "View transcript" affordance on closed/errored cards (Task 3 — routes to `/terminal/:id/history`).
