# Project Detail

**Route:** `/projects/:id` • **Component:** `packages/web/src/pages/ProjectDetail.tsx` • **Slug:** `project`

## Purpose
Single-project workspace. 7 tabs (Overview, Tasks, Guard-rails, Repos, Jira, Setup, History) with shared header + right rail.

## States
- **Loading**: `projectsLoading` → skeleton
- **Load error**: `GET /api/projects/:id` failed with anything but a 404 (500, dropped connection) → `ApiErrorAlert` "Could not load this project — …" with **Retry**
- **Not found**: a 404 → "Project not found" + **Back to Projects**
- **Loaded**: header + tabs + content + right rail

## UI elements
**Header (`ProjectHeader`)**
- Breadcrumb: Projects > project name
- Project name + display ID (`ATL-NNN`, monospace)
- Repo-count pill (`Add a repo` / `1 repo` / `N repos`) — a button that switches to the **Repos** tab (`onViewRepos`). It used to special-case exactly one repo and print its URL + branch, which read as "the project's repo"; with New Project no longer asking for one, a repo-less project is the normal first state and the old "no repo URL set" was a dead end.
- Last activity (relative time)
- **Guard-rails active** pill — shown when the project has at least one enabled rule (`useProjectGuardrails`, the Guard-rails tab's own query). The legacy `guardrails_md` column is no longer read by the UI
- **Actions** menu button → `ProjectActionsMenu`

**Team config (`ProjectTeamCard`)** — under the header; hidden while the team config role is Off.
- Publisher: an **Include in team config** switch → `PATCH /api/projects/:id { team_managed }`. Included projects are published with their repos, guardrails, scripts, Jira queries, workflows and those workflows' agents — never secrets.
- Subscriber: a warning (`TeamManagedAlert`) on a team-managed project: local edits are overwritten on the next sync.

**Project actions menu (`ProjectActionsMenu`)** — two groups (EDIT / WORKSPACE `ListSubheader`s, a `Divider` between). Items are direct children of the menu list, so ArrowUp/ArrowDown move between them:
- **Rename project…** → `RenameProjectModal`
- **Edit guard-rails** → switches the active tab to `guardrails`
- **Manage Secrets** → `ProjectEnvSecretsModal`
- **Generate AI scaffold…** → `GenerateAiScaffoldDialog`. Disabled until a repo is `clone_status='ready'`; while disabled it says why inline ("Needs a cloned repo first" — a disabled item can't show a tooltip)
- **Delete project…** (danger color) → `DeleteProjectModal`

All three **Edit guard-rails** affordances (header badge, actions menu, right-rail card) call the same `handleEditGuardrails = () => setTab('guardrails')` callback. The earlier right-rail variant pushed `?tab=guardrails` via a RouterLink, which became a no-op on the second click from the same URL (the `useTabParam` hook syncs URL → state, not state → state). The imperative callback path is idempotent and works every time.

**Tabs (URL-controlled via `?tab=`):**
| Tab | Key | Renders |
|---|---|---|
| Overview | `overview` (default; query absent) | `OverviewTab` — `GET /api/counts/project/:id`: three KPI tiles (**Open tasks** · "N awaiting pickup", **Tasks in flight** = `in_progress` + `in_review` · "N waiting info", **AI Cost** for the month: completed agent runs + closed terminal sessions, as Analytics → Spend counts them; tokens = input + output + cache read + cache write; always a dollar figure, `$0.00` with no spend; the caption's tooltip spells out the scope) + **Recent activity** (last 5 runs; rows link via `utils/itemPath.ts`) + **Full history →** (a real button → History tab). A failed counts load shows "Could not load the overview" + **Retry** instead of a skeleton; a failed runs load shows "Could not load recent activity" + **Retry** instead of "No recent activity yet" |
| Tasks | `tasks` | `TasksTab` → `TasksTabContent` (`pages/project/`) — "Showing N tasks in this project", **Open in Tasks** link (`/tasks?project=<name>`), and the shared `TaskTable` (Sub-tasks column = `sub_task_count`). Data is lifted to the page (below); Skeleton until the tree loads; a failed tree load shows "Could not load tasks" + **Retry** |
| Guard-rails | `guardrails` | `GuardrailsTab` — full `ProjectGuardrailsBody` (see page 04) |
| Repos | `repos` | `ProjectReposCard` (`pages/project/`) — every git repo of the project (ADR 0018), in order; **none is primary**. Each row: name (mono), default-branch chip (mono), clone-status chip (`CloneStatusChip` — `Pending` / `Cloning` / `Ready` / `Error`; was a bare colour-tinted `Typography` whose `ready` and `cloning` both rendered in the Mercury accent and so looked identical), an **Auto-fetch · <preset>** chip when the repo has an enabled schedule (from `GET /api/schedules`; tooltip shows the next fetch), `git_url` link, and one **Actions for `<name>`** row menu: **Edit** (`EditRepoDialog`, default branch only), **Auto-fetch schedule…** (`AutoFetchScheduleModal`, per repo), **Pull from remote…** (`RecloneProjectModal`, per repo: stash if dirty → fetch → fast-forward; success shows the commit count the API measured; button "Pull", or "Stash & pull" with local changes, which are stashed with a patch under `.git/atlas-stash/`), **Open folder** (`POST …/repos/:repoId/reveal`; toast "Opened in <Finder / File Explorer / file manager>" from the API's `opened_in`, or "Could not open folder" + the error, e.g. folder missing), **Remove** (confirm; allowed on **every** repo including the last — the folder stays on disk; its auto-fetch schedule is deleted). Auto-fetch Save sends the switch's state (switched off → saved disabled); picking Weekly with no weekday saves Monday, the shown default. **Add repo** opens `AddRepoDialog`. Empty state: "No repos yet" |
| Jira | `jira` | `ProjectJiraCard` (`pages/project/`) — this project's Jira **sources** (migration 010), moved off the global Settings list. Each row: the JQL (mono), the workflow name ("No workflow — you pick one" when unset) and a chip per repo, with an **Actions for source N** menu (**Edit**, **Remove**). **Add source** / **Edit** open `JiraSourceDialog`: JQL (multiline, mono), a **Workflow** select restricted to `input_kind='item'` workflows that are global or this project's, and a multi-select **Repos** (pre-filled with every repo — a Task must name at least one). **Sync now** → `POST /api/projects/:id/jira-sync`: only this project's sources and Tasks (other projects' lower-id sources are still searched so a shared issue lands where a full sync would put it); toast "Jira sync for {project}: N imported, M comment(s) posted". It doesn't move the poller's `last_sync_at`, and its result line on Settings → Jira is prefixed with the project name. Disabled until a token is stored **and the Import switch is on** (G-014); its tooltip (on a wrapping span, so it shows while disabled) explains why; an info alert links to Settings → Jira when no token is stored, and a separate warning alert ("Import is switched off") shows when the site is connected but the bridge is off — sources look configured while nothing is polled and no progress reaches Jira. Ordering matters: an issue matching sources in two projects becomes ONE Task under the **lowest-id** (first-created) source, and editing never re-orders. Empty state: "No Jira sources yet".<br>Below it, `JiraStatusMapCard` (**Status mapping**):<br>
- Six rows, Draft … Done, each a comma-separated text field (`aria-label` "Jira statuses for <status>").<br>
- Inline errors: Ready is required, and no status may appear twice.<br>
- **Save mapping** sends `PATCH /api/projects/:id {jira_status_map}`. It is disabled until something changes.<br>
- **Clear mapping** sends `null` and only shows when a mapping is set.<br>
- An info alert says Jira's status is ignored while no mapping is set; the card copy says a mapping needs at least one Ready status and that ignoring Jira's status means not saving one (or **Clear mapping**). |
| Setup | `setup` | `DefaultWorkflowCard` (`pages/project/`) first — a **Default workflow** select (migration 022): "None — Tasks wait until you pick one" + the `input_kind='item'` workflows that are global or this project's (the Jira dialog's filter). Saved on change with `PATCH /api/projects/:id {default_workflow_id}` ("Default workflow saved" toast); an API refusal shows inline under the select. Helper copy says Jira imports use their source's workflow instead — only `/tasks/new` reads the default. It renders even when the project has no repos. Then `SetupTab` — **Setup scripts**: "Each repo has a shell and a PowerShell script that run in its fresh worktree before the agent CLI starts. A failing script ends the run as setup failed." A list (`ul` "Repos") with one button per repo (`aria-label` "Edit setup scripts for {name}") showing `.sh · N lines|empty` and `.ps1 · …` chips. Clicking one opens `SetupScriptsDialog` (`aria-labelledby` its title): the Bash and PowerShell editors, a collapsed "Using secrets in your scripts" reference (`${variable.KEY}`; values from Settings > Shared Secrets and this project's Manage Secrets, the project's winning), **Cancel** / **Save scripts** (disabled until dirty) → `PATCH /api/projects/:id/repos/:repoId`. A failed save keeps the edits and shows "Could not save: …". Closing with unsaved edits asks "Discard your unsaved changes?" (**Keep editing** / **Discard**). A repos load failure shows "Could not load this project's repos. Refresh to try again."; no repos → an info alert pointing at the Repos tab. The API host (`project-setup-runner`) runs the PowerShell body on Windows and the shell body elsewhere. |
| History | `history` | `HistoryTab` — header "Agent activity · N · $X total" (over the ≤200 runs fetched), then a newest-first list (50 per "Show more") of every agent run that touched any item in this project. Each row: agent chip + linked item id (`/tasks/:id` or `/sub-tasks/:id`) + run-status pill + cost + relative time + a "View run" arrow to the run page. Empty state "No agent activity yet for this project."; a failed load shows "Could not load agent activity" + **Retry** instead. |

**Right rail (`ProjectRightRail`)** — hidden on the guardrails tab.
- **Health · 30 d** (`GET /api/projects/:id/health`, `useProjectHealth`) — the fleet page's delivery maths scoped to this project: **PRs merged** "`merged` of `opened`", **Specs accepted first try** "`accepted` of `reviewed`" (runs whose first Architect Reviewer look approved the spec), **Median time to PR** (`formatSpan`, run start → PR), **Tasks that needed you** (distinct Tasks with a recorded park; `—` until migration 024 has a start). Counts carry denominators and nothing is a percentage (ADR 0023). A zero denominator shows `—`, not "0 of 0". Caption: "From N workflow runs started in the last 30 days." / "No workflow runs in the last 30 days." / "Could not load: …". Replaced the old "stubbed" card.
- `activeAgents` list — agents assigned to any not-`done` Task or sub-task in this project
- **Guard-rails** — "Rules every agent must respect inside this project." then the enabled rule titles joined with " · " (cut at 140 chars with "…"), or "No active rules."; **Edit →** switches to the Guard-rails tab

## Why these affordances exist
- **Tab strip** — Single project is the work-unit context; tabs avoid a sub-route explosion and let the right rail stay mounted across tabs.
- **Manage Secrets** — a project's setup script needs project-specific credentials (`${variable.KEY}`); modal-shaped because secret editing benefits from a hard Save boundary.
- **Delete project (danger)** — Wipes the worktree via `delete-runner`; isolated as a red menu item plus confirmation so a misclick doesn't destroy local work.
- **Right rail active agents** — Compresses "who's working on this repo right now" into one glance; the project may have dozens of Tasks, the rail answers the only question that matters at-a-glance.

## Modals / drawers
- `AddRepoDialog` (Repos tab, mounted while open) — **Clone fresh** / **Use existing folder** toggle. Fields: Existing folder (`FolderPicker`, connect only; picking one fills the URL from its origin), Repository URL (github.com HTTPS), **Name** (the repo's folder in a Task workspace; follows the URL until typed over; `^[a-z0-9][a-z0-9-]{0,39}$`), Default branch (clone only), Git credential (`CredentialSelect`, shared with `NewProjectModal` via `pages/projects/RepoFormParts.tsx`). **Clone repo** → `POST /api/projects/:id/repos {mode:'clone'}`, then the live `clone_output` lines via `useCloneJob`; `clone_completed` carrying `repo` closes it with a "Repo added — name" toast; `clone_error` shows the detail + **Edit details**. **Verify & add** → `{mode:'connect'}`; a 400 renders `ConnectErrorDetails` (the same headline / checks / "Try" list as `NewProjectModal`) with **Edit details**; a 409 (name taken) shows the API message inline.
- `EditRepoDialog` (any repo) — Default branch + **Credential** (`CredentialSelect`, with a Manage link to `/settings/credentials`) → `PATCH /api/projects/:id/repos/:repoId`. The credential is sent only when it changed, so a branch edit never trips over a credential deleted since. Setup scripts live on the Setup tab.
- **Remove <name>?** (`ConfirmActionModal`, destructive) → `DELETE /api/projects/:id/repos/:repoId`: unregisters the repo and drops it from the project's Tasks; the folder stays on disk. A 409 (a run is working on it) toasts the API message.
- `DeleteProjectModal` — opened at page level with its own copy of the project (`deleting` state), rendered in the same fragment slot on every branch (loading / not found / loaded), so the success view survives the page losing its project after the delete. Steps shown are only the real ones (purge: "Remove repo folders" → "Unregister from Atlas"; unregister: "Unregister from Atlas"). On success "Back to projects →" navigates to `/projects`, and closing it any other way off the list page does too; the project's `['projects', id]` cache is dropped.
- `ProjectEnvSecretsModal` — `open={secretsOpen}`; dialog named "Project Secrets", close button "Close". Subtitle: "Substituted into {project}'s setup script as `${variable.KEY}` — not passed to agent runs. Runs already set up keep the previous values." (the verification gate also masks them in its output). Stored in the `project_env_vars` table, encrypted (not a `.env` file). Key/value rows, masked values, per-row Reveal, Reveal all, Copy, JSON Import / Export, Add variable, dirty-counter, Save. Backed by `GET/PUT /api/projects/:id/env` plus `GET /api/projects/:id/env/:key/value` for reveal.
  - **Save safety.** Save replaces the whole set, so it is disabled until the stored set has loaded; a failed load shows an error instead of the empty state.
  - **Keep rows.** A stored row the Owner didn't retype goes up as `{ key, keep: originalKey }`, so the server keeps its stored value (under the new key on a rename) without anything being revealed first.
  - **Reveal is a fetch, not a toggle.** The list endpoint is metadata-only (`{key, updated_at, has_value}` — no plaintext), so a stored row hydrates with an empty value. Until 2026-09-12 the eye icon, **Reveal all** and **Copy** all operated on that empty string: the eye flipped the input `type` and revealed a blank box, and Copy put `''` on the clipboard. Each now calls the per-key reveal endpoint (Reveal all fans out one call per stored row — the endpoint is per-key by design so every reveal is audited) and stashes the plaintext in transient row state. Rows show read-only while revealed; typing drops the revealed value and means "replace this secret".

## Hooks used
- Page: `useProject(id)`, `useIssues({projectId})` (one `GET /api/issues/tree` — `tasks` + the nested tree; the page derives each Task's `sub_task_count` and the flat sub-task list client-side), `useAgents`, `useSettings`, `useToast`
- Overview tab: `useProjectCounts(id)` — single consolidated KPI fetch
- Setup tab: `useWorkflows`, `useUpdateProject` (`DefaultWorkflowCard`), `useProjectRepos`, `useUpdateProjectRepo` (`SetupTab`)
- Jira tab: `useProjectJiraSources(id)` (key `['projects', id, 'jira-sources']`), `useCreateJiraSource`, `useUpdateJiraSource`, `useDeleteJiraSource`, `useJiraConfig`, `useSyncJira`, `useWorkflows`
- Repos tab: `useProjectRepos(id)` (key `['projects', id, 'repos']`, so the page refresh and the SSE `clone_completed` invalidation cover it), `useRemoveProjectRepo`, `useUpdateProjectRepo`; `AddRepoDialog`: `useCloneProjectRepo`, `useConnectProjectRepo`, `useCloneJob`, `useCredentials`

## API endpoints touched
- `GET /api/projects/:id`, `GET /api/issues/tree?project_id=…`, `GET /api/agents`, `GET /api/settings`
- `GET /api/counts/project/:id` — Overview KPIs (`open_tasks`, `tasks_ready`, `tasks_in_flight`, `tasks_waiting_info`, `costSummary`, `terminalCostSummary`)
- `GET /api/run?project_id=…&limit=200` — backs the History tab. Server-side join on `items.project_id` so the page doesn't have to enumerate every child item; a single query returns runs across all levels of the project tree.
- `PATCH /api/projects/:id` `{default_workflow_id}`, `GET /api/workflows` (Setup tab `DefaultWorkflowCard`)
- `DELETE /api/projects/:id` (via `DeleteProjectModal`)
- `GET /api/projects/:id/env`, `PUT /api/projects/:id/env`, `GET /api/projects/:id/env/:key/value` (via `ProjectEnvSecretsModal`)
- `GET /api/projects/:id/guardrails` (header pill + rail; shared with the Guard-rails tab)
- `POST /api/projects/:id/generate-ai-scaffold {repo_id?}` — the run works the repo the dialog picked (recorded on `workflow_runs.repo_ids`, migration 019)
- `GET/POST /api/projects/:id/jira-sources`, `PATCH/DELETE /api/projects/:id/jira-sources/:sourceId`, `POST /api/projects/:id/jira-sync` (Jira tab)
- `GET/POST /api/projects/:id/repos`, `PATCH/DELETE /api/projects/:id/repos/:repoId`, `GET /api/credentials`, `GET /api/projects/folder-origin`, `GET /api/fs/stat` (Repos tab)

## Permissions / guards
- Post-onboarding only.
- Right rail is hidden when `currentTab === 'guardrails'`.

## Edge cases / quirks
- `activeAgents` filters by `status !== 'done'`.
- The History tab can be reached from the Overview tab via the `onJumpToHistory` callback.
- An API error's plain-text `detail` (e.g. "Attach a credential before generating AI scaffold — git push needs it.") is appended to the message by `api.ts`, so toasts show it.

## Connectivity
- **Pages**: [Project Guard-rails](04-project-guardrails.md) — renders inside the guardrails tab; [Task Detail](07-task-detail.md), [Sub-task Detail](10-sub-task-detail.md), [Tasks](05-tasks.md) — tab rows and links land here.
- **Routes**: `GET/PUT /api/projects/:id/env` — per-project secrets path (separate from workspace `.env` so projects don't leak each other's tokens); `DELETE /api/projects/:id` — destructive, routed through `delete-runner` for SSE-streamed feedback.
- **MCP tools**: `listProjects`, `getProject`, `search_item` — how an external agent scopes an Atlas context fetch to one project.
- **Entities**: `project`, `task`, `sub_task`, `project_guardrail`.

## Coming soon on this page
- Edit repo URL, Change default branch, Notification routing, Archive — see [coming-soon.md](../coming-soon.md).
- Bulk edit / assign — see [coming-soon.md](../coming-soon.md).
