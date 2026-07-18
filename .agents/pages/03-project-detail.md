# Project Detail

**Route:** `/projects/:id` • **Component:** `packages/web/src/pages/ProjectDetail.tsx` • **Slug:** `project`

## Purpose
Single-project workspace. 5 tabs (Overview, Epics, Issues, Guard-rails, History) with shared header + right rail.

## States
- **Loading**: `projectsLoading` → skeleton (lines 103-111)
- **Not found**: `!project` → "Project not found" + back button (lines 113-122)
- **Loaded**: header + tabs + content + right rail (lines 130-284)

## UI elements
**Header (`ProjectHeader`)**
- Breadcrumb: Projects > project name
- Project name + display ID (`ATL-NNN`, monospace)
- Repo URL link → external href to `git_url`
- "no repo URL" fallback if missing
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
- **Archive project** → disabled item
- **Delete project** (danger color) → opens `DeleteProjectModal`

All three **Edit guard-rails** affordances (header badge, actions menu, right-rail card) call the same `handleEditGuardrails = () => setTab('guardrails')` callback. The earlier right-rail variant pushed `?tab=guardrails` via a RouterLink, which became a no-op on the second click from the same URL (the `useTabParam` hook syncs URL → state, not state → state). The imperative callback path is idempotent and works every time.

**Tabs (URL-controlled via `?tab=`):**
| Tab | Key | Renders |
|---|---|---|
| Overview | `overview` (default; query absent) | `OverviewTab` — pulls `GET /api/counts/project/:id` (one request, three KPI tiles + sub-captions) + jump-to-history |
| Epics | `epics` | `EpicsTab` — owns its own `useEpics(projectId)` hook so the list refetches on every tab activation (matches IssuesTab); shows a Skeleton during the in-flight fetch |
| Issues | `issues` | `IssuesTab` — owns its own `useIssues({projectId})` hook so the list refetches on every tab activation; shows a Skeleton during the in-flight fetch |
| Guard-rails | `guardrails` | `GuardrailsTab` — full `ProjectGuardrailsBody` (see page 04) |
| History | `history` | `HistoryTab` — newest-first list of every agent run that touched any item in this project (epic / story / bug / sub-task / sub-bug). Each row: status dot + agent chip + linked issue id + run-status pill + relative timestamp. Issue id links to the detail page; "in progress / completed / error" link to the run detail page. Empty state when no runs have happened yet. |

**Right rail (`ProjectRightRail`)** — hidden on the guardrails tab.
- `activeAgents` list — agents assigned to any open epic/story/bug in this project
- `guardrailsMd` summary

## Why these affordances exist
- **Tab strip** — Single project is the work-unit context; tabs avoid a sub-route explosion and let the right rail stay mounted across tabs.
- **Manage .env secrets** — Agents spawn in the worktree; without per-project secrets they can't authenticate to project-specific services. Modal-shaped because secret editing benefits from a hard Save boundary.
- **Delete project (danger)** — Wipes the worktree via `delete-runner`; isolated as a red menu item plus confirmation so a misclick doesn't destroy local work.
- **Right rail active agents** — Compresses "who's working on this repo right now" into one glance; the project may have dozens of epics, the rail answers the only question that matters at-a-glance.

## Modals / drawers
- `DeleteProjectModal` — `open={deleteOpen}` controlled at page level (lines 276-281).
- `ProjectEnvSecretsModal` — `open={secretsOpen}`. Lets the owner edit `<git_path>/.env` for the project (key/value rows, masked values, reveal-all, Import .env, Export, Add variable, dirty-counter, Save secrets). Backed by `GET/PUT /api/projects/:id/env`.

## Hooks used
- Page: `useProject(id)`, `useEpics(id)`, `useStories({projectId})`, `useBugs({projectId})`, `useAgents`, `useSettings`, `useSearchParams`, `useToast`
- Overview tab: `useProjectCounts(id)` — single consolidated KPI fetch; replaces the previous client-side filtering of the four entity lists

## API endpoints touched
- `GET /api/projects/:id`, `GET /api/epics?project_id=…`, `GET /api/stories?project_id=…`, `GET /api/bugs?project_id=…`, `GET /api/agents`, `GET /api/settings`
- `GET /api/counts/project/:id` — 6-number KPI envelope for the Overview tab (open_epics, epics_ready, stories_in_flight, stories_waiting_info, open_bugs, bugs_ready)
- `GET /api/run?project_id=…&limit=200` — backs the History tab. Server-side join on `items.project_id` so the page doesn't have to enumerate every child item; a single query returns runs across all levels of the project tree.
- `DELETE /api/projects/:id` (via `DeleteProjectModal`)
- `GET /api/projects/:id/env`, `PUT /api/projects/:id/env` (via `ProjectEnvSecretsModal`)

## Permissions / guards
- Post-onboarding only.
- Right rail is hidden when `currentTab === 'guardrails'`.

## Edge cases / quirks
- Display ID falls back to `ATL-???` if the project isn't found in the sorted list (line 68).
- `activeAgents` filters by `status !== 'done'` (line 83).
- The History tab can be reached from the Overview tab via the `onJumpToHistory` callback (line 248).

## Connectivity
- **Pages**: [Project Guard-rails](04-project-guardrails.md) — renders inside the guardrails tab; [Epic Detail](07-epic-detail.md), [Issues](08-issues.md), [Story Detail](09-story-detail.md), [Bug Detail](11-bug-detail.md) — tab rows deep-link to these.
- **Routes**: `GET/PUT /api/projects/:id/env` — per-project secrets path (separate from workspace `.env` so projects don't leak each other's tokens); `DELETE /api/projects/:id` — destructive, routed through `delete-runner` for SSE-streamed feedback.
- **MCP tools**: `list_projects`, `list_epics { project_id }`, `list_bugs { project_id }` — the project view is the entity an external agent uses to scope a Atlas context fetch (e.g., when the Owner pastes a project into Claude Code and asks for the work-in-flight summary).
- **Entities**: `project`, `epic`, `story`, `bug`, `project_guardrail`.

## Coming soon on this page
- Rename, Edit repo URL, Change default branch, Notification routing, Archive — see [coming-soon.md](../coming-soon.md).
- Bulk edit / assign — see [coming-soon.md](../coming-soon.md).
