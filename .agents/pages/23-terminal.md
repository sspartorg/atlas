# Terminal

**Route:** `/terminal` • **Component:** `packages/web/src/pages/Terminal.tsx` • **Slug:** `terminal`

## Purpose
List every PTY-backed Claude Code or GitHub Copilot CLI session scoped to a project worktree. Filter the list by status, CLI, project, or free-text search; click a card to open the single-session view; create a new session from the Start Session dialog.

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
- **CLI dropdown chip**: Any · Claude Code · GitHub Copilot.
- **Project dropdown chip**: Any · then every project from `useProjects()`.
- **Search field**: substring match against `title`, `worktree_branch`, `id`, and `item_id`. `/` keyboard shortcut focuses it (inherited from `SearchPillTextField`).
- Filter state persists to `localStorage` under `atlas.terminal-filters.v1` so a reload preserves the chip configuration.

**Card grid (`SessionCard`)** — `gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' }`, fixed `height: 200`, hover-lift transform.
- Row 1: CLI icon (TerminalRounded for Claude, SmartToyRounded for Copilot) + truncated title.
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

## Hooks used
- `useCliSessions()` — `GET /api/cli/sessions`, returns `ICliSession[]` sorted by `last_active_at desc` (cap 200).
- `useProjects()` — fuels the project dropdown.
- `useCreateCliSession()` (consumed inside `StartSessionDialog`).
- `useToast`, `useNavigate`.

## API endpoints touched
- `GET /api/cli/sessions`
- (Indirectly via the dialog) `POST /api/cli/sessions`

## Permissions / guards
- Post-onboarding only.
- The dialog requires a project — Start is disabled until one is picked.

## Edge cases / quirks
- Filter state lives in `localStorage` with a versioned key (`v1`). Bumping the shape later requires bumping the key and clearing stale state on first load.
- `relativeAgo` returns `''` for non-finite or future timestamps to avoid noisy "NaN ago" strings.
- The Copilot icon (`SmartToyRounded`) is a stand-in — MUI has no Copilot mark in its icon set.

## Connectivity
- **Pages**: [Terminal Session](24-terminal-session.md) — single-session deep link target.
- **Routes**: `GET /api/cli/sessions`, `POST /api/cli/sessions`.
- **Entities**: `cli_sessions`, `projects` (for the filter + dialog dropdowns), `agents`-adjacent only insofar as a session's `item_id` may link to a Atlas issue.

## Coming soon on this page
- Multi-pane workspace entry-point (Task 2 — split-button caret on Start Session linking to `/terminal/layout`).
- "View transcript" affordance on closed/errored cards (Task 3 — routes to `/terminal/:id/history`).
