# Terminal — Standalone

**Route:** `/terminal/standalone` • **Component:** `packages/web/src/pages/TerminalStandalone.tsx` • **Slug:** `terminal-standalone`

## Purpose
List and launch **standalone terminals** — PTY sessions the Owner opened directly on any folder on the machine, under a git credential they picked. No Atlas project, no worktree, no branch, and nothing written into the folder. The independent channel next to [Terminal](23-terminal.md), which stays project-scoped.

Spend is still tracked: `ingestTranscript` resolves the CLI's on-disk JSONL from `worktree_path` (which here holds the chosen folder) + `claude_session_id`, so `total_cost_usd` and the token columns fill in at close exactly as they do for project sessions.

## States
- **Loading**: `useCliSessions({ standalone: true }).isLoading` → centered `CircularProgress`.
- **Empty**: `sessions.length === 0` → dashed-border `EmptyState` with an "Open folder" CTA.
- **Populated**: header + card grid. No filter row — none of `/terminal`'s axes (project, branch, item) exist here.

## UI elements

**Header**
- `h1` "Standalone" with a 36px `FolderOpenRounded` tinted `ATLAS_PALETTE.green`.
- Stats line in JetBrains Mono: `{total} sessions · {active} active · {paused} paused · {spend} spent`.
- **Open folder** button → opens `<StartStandaloneSessionDialog>`.

**Card grid (`StandaloneSessionCard`)** — same `1fr / 1fr 1fr / repeat(3,1fr)` grid and fixed `height: 200` as the project cards, so the two surfaces read as siblings.
- Row 1: CLI icon + title (defaults to the folder's basename).
- Row 2: status chip · CLI chip · credential chip (`KeyRounded` + label, or "machine git config" when none was picked).
- Row 3: folder path (mono, `direction: rtl` so a long path truncates on the LEFT — the tail is the identifying part), model · spend, "last active …".
- Click → `/terminal/:id`, the same single-session view project terminals use.

## Why these affordances exist
- **A separate page, not a filter on /terminal** — the two are independent channels. Every filter and every column on the project page (project, branch, item) is empty for a standalone session, and the Stop semantics are opposite (finalize-and-tear-down vs. leave-untouched).
- **Credential picker instead of a project** — the whole point. A project session inherits `project.credential_id`; here the Owner names the identity per session.
- **Folder path as the card's identity line** — with no project or branch, the folder is the only thing that distinguishes one session from another.
- **Left-truncated path** — `/Users/owner/code/…` is noise; the repo name at the end is the signal.

## Modals / drawers
- **`StartStandaloneSessionDialog`** (`packages/web/src/components/StartStandaloneSessionDialog.tsx`) — CLI toggle, **Folder** (the shared `FolderPicker`, backed by `GET /api/fs/list|stat|join|home`), **Git credentials** select (default: "This machine's git config"), model select, optional title + initial prompt. Posts `POST /api/cli/sessions/standalone` and emits `onCreated(session)`.
  - A credential deleted between renders is cleared from the select on the next effect pass — the server 404s on a dangling id, and failing at submit time is worse than failing silently in the field.
- **Stop** routes through `TerminalSessionControls`, which branches on `session.project_id === null` and shows `ConfirmActionModal` ("Close terminal?") instead of `StopSessionModal`. The body names the folder and states it is left exactly as it is. Confirm sends `{files_to_stage: [], open_pull_request: false}`; the server short-circuits before any git work.

## Hooks used
- `useCliSessions({ standalone: true })` — `GET /api/cli/sessions?standalone=true`.
- `useCredentials()` — card labels + the dialog's select.
- `useCreateStandaloneCliSession()` (inside the dialog), `useCliModels()`, `useToast`, `useNavigate`.

## API endpoints touched
- `GET /api/cli/sessions?standalone=true`
- `POST /api/cli/sessions/standalone` (via the dialog)
- `POST /api/cli/sessions/:id/stop` (via the Stop confirm)
- `GET /api/fs/list|stat|join|home` (via `FolderPicker`)

## Permissions / guards
- Post-onboarding only.
- `POST /api/cli/sessions/standalone` carries `preHandler: requireMcpToken` — the same write gate `/api/fs/*` uses. It takes an arbitrary server-side path from the caller and spawns a process there, so it must not be reachable from any local HTTP client. The gate auto-passes for same-origin browser requests, so the web UI needs no token handling.
- The server rejects a non-absolute `folder_path`, a path that does not exist, and a path that is not a directory — all 400 `validation_error`.

## Edge cases / quirks
- **`worktree_path` holds the folder.** The column means "the session's cwd"; `worktree_branch !== null` is what means "Atlas created and owns this directory". Reusing the column is what makes transcript ingest, cost accounting and `/terminal/:id/history` work unchanged.
- **The review endpoints 409.** `preflight-stop`, `diff`, and `diff/file` return `409 {details: {code: 'standalone_session'}}` — there is no worktree to review and no button that would act on the result.
- **Resume skips staging.** Nothing was staged at create time; re-staging on resume would write `.atlas/` into the Owner's repo behind their back. Auth on resume comes from `session.credential_id`.
- Multiple standalone sessions on the same folder are allowed. The unique partial index `cli_sessions_one_active_per_project_branch` is scoped `WHERE ... AND worktree_branch IS NOT NULL`, so null-branch rows never collide.
- Commit authorship needs the credential to carry a name + email (Settings → Credentials → the PAT's "Commit identity" block). Without both, `git commit` inside the session falls back to the host machine's `~/.gitconfig`.

## Connectivity
- **Pages**: [Terminal](23-terminal.md) — the project-scoped sibling; `/terminal/:id` (`TerminalSession.tsx`) and [Terminal History](25-terminal-history.md) are shared by both kinds; [Credentials](20-credentials.md) — where the commit identity is set.
- **Routes**: `GET /api/cli/sessions`, `POST /api/cli/sessions/standalone`, `POST /api/cli/sessions/:id/stop`, WS `/api/cli/sessions/:id/stream`.
- **Entities**: `cli_sessions` (`project_id` null, `worktree_branch` null, `credential_id` set), `credentials`.

## Coming soon on this page
- (none)
