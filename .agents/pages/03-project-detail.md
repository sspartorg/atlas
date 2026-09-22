# Project Detail

**Route:** `/projects/:id` • **Component:** `packages/web/src/pages/ProjectDetail.tsx` • **Slug:** `project`

## Purpose
Single-project workspace. 6 tabs (Overview, Tasks, Guard-rails, Repos, Setup, History) with shared header + right rail.

## States
- **Loading**: `projectsLoading` → skeleton (lines 103-111)
- **Not found**: `!project` → "Project not found" + back button (lines 113-122)
- **Loaded**: header + tabs + content + right rail (lines 130-284)

## UI elements
**Header (`ProjectHeader`)**
- Breadcrumb: Projects > project name
- Project name + display ID (`ATL-NNN`, monospace)
- Repo-count pill (`Add a repo` / `1 repo` / `N repos`) — a button that switches to the **Repos** tab (`onViewRepos`). It used to special-case exactly one repo and print its URL + branch, which read as "the project's repo"; with New Project no longer asking for one, a repo-less project is the normal first state and the old "no repo URL set" was a dead end.
- Last activity (relative time)
- Guard-rails shield indicator (if `project.guardrails_md.trim().length > 0`)
- **Actions** menu button → `ProjectActionsMenu`

**Project actions menu (`ProjectActionsMenu`)** — most items toast "coming soon":
- **Rename project** → stub (`stubMessage` line 125)
- **Edit repository URL** → stub
- **Change default branch** → disabled item
- **Edit guard-rails** → switches active tab to `guardrails`
- **Manage .env secrets…** → opens `ProjectEnvSecretsModal` (read/write `<git_path>/.env`)
- **Notification routing** → disabled item
- ~~**Archive project**~~, ~~**Edit repository URL**~~, ~~**Change default branch**~~, ~~**Notification routing**~~ — **none of these exist.** `ProjectActionsMenu.tsx:57-96` has exactly: Rename project… (real, opens `RenameProjectModal`), Edit guard-rails, Manage Secrets, **Generate AI scaffold…** (previously undocumented; disabled until a repo is `clone_status='ready'`), and Delete project…. *(corrected 2026-09-20 — campaign task-21.)*
- **Delete project** (danger color) → opens `DeleteProjectModal`

All three **Edit guard-rails** affordances (header badge, actions menu, right-rail card) call the same `handleEditGuardrails = () => setTab('guardrails')` callback. The earlier right-rail variant pushed `?tab=guardrails` via a RouterLink, which became a no-op on the second click from the same URL (the `useTabParam` hook syncs URL → state, not state → state). The imperative callback path is idempotent and works every time.

**Tabs (URL-controlled via `?tab=`):**
| Tab | Key | Renders |
|---|---|---|
| Overview | `overview` (default; query absent) | `OverviewTab` — `GET /api/counts/project/:id`: three KPI tiles (**Open tasks** · "N awaiting pickup", **Tasks in flight** = `in_progress` + `in_review` · "N waiting info", **AI Cost** for the month) + recent runs (rows link via `utils/itemPath.ts`) + jump-to-history |
| Tasks | `tasks` | `TasksTab` → `TasksTabContent` (`pages/project/`) — "Showing N tasks in this project", **Open in Tasks** link (`/tasks?project=<name>`), and the shared `TaskTable` (Sub-tasks column = `sub_task_count`). Data is lifted to the page (below); Skeleton until the tree loads |
| Guard-rails | `guardrails` | `GuardrailsTab` — full `ProjectGuardrailsBody` (see page 04) |
| Repos | `repos` | `ProjectReposCard` (`pages/project/`) — every git repo of the project (ADR 0018), in order; **none is primary**. Each row: name (mono), default-branch chip (mono), clone-status chip (`CloneStatusChip` — `Pending` / `Cloning` / `Ready` / `Error`; was a bare colour-tinted `Typography` whose `ready` and `cloning` both rendered in the Mercury accent and so looked identical), `git_url` link, and one **Actions for `<name>`** row menu: **Edit** (`EditRepoDialog`, default branch only), **Auto-fetch schedule…** (`AutoFetchScheduleModal`, per repo), **Re-clone from remote** (`RecloneProjectModal`, per repo), **Open folder** (`POST …/repos/:repoId/reveal`), **Remove** (confirm; allowed on **every** repo including the last — the folder stays on disk). **Add repo** opens `AddRepoDialog`. Empty state: "No repos yet" |
| Setup | `setup` | `SetupTab` — a **Repo** select (ADR 0018) plus the `.sh` + `.ps1` editors for that repo, saved with `PATCH /api/projects/:id/repos/:repoId`. An info alert replaces the editors when the project has no repos. Copy states the real behaviour: the agent runner (`project-setup-runner`) runs the PowerShell body on Windows hosts and the shell body elsewhere in the run's fresh worktree **before the CLI starts**; a failing script ends the run as `setup_failed` and the CLI never spawns. |
| History | `history` | `HistoryTab` — newest-first list of every agent run that touched any item in this project (Tasks and sub-tasks). Each row: status dot + agent chip + linked item id + run-status pill + relative timestamp. The item id links to `/tasks/:id` or `/sub-tasks/:id`; "in progress / completed / error" link to the run detail page. Empty state when no runs have happened yet. |

**Right rail (`ProjectRightRail`)** — hidden on the guardrails tab.
- `activeAgents` list — agents assigned to any not-`done` Task or sub-task in this project
- `guardrailsMd` summary

## Why these affordances exist
- **Tab strip** — Single project is the work-unit context; tabs avoid a sub-route explosion and let the right rail stay mounted across tabs.
- **Manage .env secrets** — Agents spawn in the worktree; without per-project secrets they can't authenticate to project-specific services. Modal-shaped because secret editing benefits from a hard Save boundary.
- **Delete project (danger)** — Wipes the worktree via `delete-runner`; isolated as a red menu item plus confirmation so a misclick doesn't destroy local work.
- **Right rail active agents** — Compresses "who's working on this repo right now" into one glance; the project may have dozens of Tasks, the rail answers the only question that matters at-a-glance.

## Modals / drawers
- `AddRepoDialog` (Repos tab, mounted while open) — **Clone fresh** / **Use existing folder** toggle. Fields: Existing folder (`FolderPicker`, connect only; picking one fills the URL from its origin), Repository URL (github.com HTTPS), **Name** (the repo's folder in a Task workspace; follows the URL until typed over; `^[a-z0-9][a-z0-9-]{0,39}$`), Default branch (clone only), Git credential (`CredentialSelect`, shared with `NewProjectModal` via `pages/projects/RepoFormParts.tsx`). **Clone repo** → `POST /api/projects/:id/repos {mode:'clone'}`, then the live `clone_output` lines via `useCloneJob`; `clone_completed` carrying `repo` closes it with a "Repo added — name" toast; `clone_error` shows the detail + **Edit details**. **Verify & add** → `{mode:'connect'}`; a 400 renders `ConnectErrorDetails` (the same headline / checks / "Try" list as `NewProjectModal`) with **Edit details**; a 409 (name taken) shows the API message inline.
- `EditRepoDialog` (extra repos) — Default branch + `.sh` / `.ps1` setup scripts → `PATCH /api/projects/:id/repos/:repoId`.
- **Remove <name>?** (`ConfirmActionModal`, destructive) → `DELETE /api/projects/:id/repos/:repoId`: unregisters the repo and drops it from the project's Tasks; the folder stays on disk. A 409 (a run is working on it) toasts the API message.
- `DeleteProjectModal` — `open={deleteOpen}` controlled at page level (lines 276-281).
- `ProjectEnvSecretsModal` — `open={secretsOpen}`. Lets the owner edit `<git_path>/.env` for the project (key/value rows, masked values, per-row Reveal, Reveal all, Copy, Import .env, Export, Add variable, dirty-counter, Save secrets). Backed by `GET/PUT /api/projects/:id/env` plus `GET /api/projects/:id/env/:key/value` for reveal.
  - **Reveal is a fetch, not a toggle.** The list endpoint is metadata-only (`{key, updated_at, has_value}` — no plaintext), so a stored row hydrates with an empty value. Until 2026-09-12 the eye icon, **Reveal all** and **Copy** all operated on that empty string: the eye flipped the input `type` and revealed a blank box, and Copy put `''` on the clipboard. Each now calls the per-key reveal endpoint (Reveal all fans out one call per stored row — the endpoint is per-key by design so every reveal is audited) and stashes the plaintext in transient row state. Rows show read-only while revealed; typing drops the revealed value and means "replace this secret".

## Hooks used
- Page: `useProject(id)`, `useIssues({projectId})` (one `GET /api/issues/tree` — `tasks` + the nested tree; the page derives each Task's `sub_task_count` and the flat sub-task list client-side), `useAgents`, `useSettings`, `useToast`
- Overview tab: `useProjectCounts(id)` — single consolidated KPI fetch
- Repos tab: `useProjectRepos(id)` (key `['projects', id, 'repos']`, so the page refresh and the SSE `clone_completed` invalidation cover it), `useRemoveProjectRepo`, `useUpdateProjectRepo`; `AddRepoDialog`: `useCloneProjectRepo`, `useConnectProjectRepo`, `useCloneJob`, `useCredentials`

## API endpoints touched
- `GET /api/projects/:id`, `GET /api/issues/tree?project_id=…`, `GET /api/agents`, `GET /api/settings`
- `GET /api/counts/project/:id` — Overview KPIs (`open_tasks`, `tasks_ready`, `tasks_in_flight`, `tasks_waiting_info`, `costSummary`, `terminalCostSummary`)
- `GET /api/run?project_id=…&limit=200` — backs the History tab. Server-side join on `items.project_id` so the page doesn't have to enumerate every child item; a single query returns runs across all levels of the project tree.
- `DELETE /api/projects/:id` (via `DeleteProjectModal`)
- `GET /api/projects/:id/env`, `PUT /api/projects/:id/env`, `GET /api/projects/:id/env/:key/value` (via `ProjectEnvSecretsModal`)
- `GET/POST /api/projects/:id/repos`, `PATCH/DELETE /api/projects/:id/repos/:repoId`, `GET /api/credentials`, `GET /api/projects/folder-origin`, `GET /api/fs/stat` (Repos tab)

## Permissions / guards
- Post-onboarding only.
- Right rail is hidden when `currentTab === 'guardrails'`.

## Edge cases / quirks
- Display ID falls back to `ATL-???` if the project isn't found in the sorted list (line 68).
- `activeAgents` filters by `status !== 'done'` (line 83).
- The History tab can be reached from the Overview tab via the `onJumpToHistory` callback (line 248).

## Connectivity
- **Pages**: [Project Guard-rails](04-project-guardrails.md) — renders inside the guardrails tab; [Task Detail](07-task-detail.md), [Sub-task Detail](10-sub-task-detail.md), [Tasks](05-tasks.md) — tab rows and links land here.
- **Routes**: `GET/PUT /api/projects/:id/env` — per-project secrets path (separate from workspace `.env` so projects don't leak each other's tokens); `DELETE /api/projects/:id` — destructive, routed through `delete-runner` for SSE-streamed feedback.
- **MCP tools**: `listProjects`, `getProject`, `search_item` — how an external agent scopes an Atlas context fetch to one project.
- **Entities**: `project`, `task`, `sub_task`, `project_guardrail`.

## Coming soon on this page
- Rename, Edit repo URL, Change default branch, Notification routing, Archive — see [coming-soon.md](../coming-soon.md).
- Bulk edit / assign — see [coming-soon.md](../coming-soon.md).
