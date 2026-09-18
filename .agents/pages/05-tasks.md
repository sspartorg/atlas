# Tasks

**Route:** `/tasks` • **Component:** `packages/web/src/pages/Tasks.tsx` • **Slug:** `tasks`

## Purpose
List every Task across all projects (ADR 0015: a Task is the top-level item; its children are Sub-tasks, shown on the Task's detail page). Filter by project, status, assignee scope and free text. Table or Kanban.

## States
- **Loading**: skeleton rows (`Tasks.tsx:216`)
- **No projects**: `projects.length === 0` → empty state linking to `/projects` ("Create a project first, then add tasks.", `Tasks.tsx:249`)
- **Empty filter result**: `TaskTable` shows "No tasks match this view." (`TaskTable.tsx:459`)
- **Populated**: `TaskTable` (`Tasks.tsx:297`) or `WorkItemKanban` (`Tasks.tsx:259`)

## UI elements
**Header**
- "Tasks" title + subtitle: `N tasks` (all, or scoped to `?project=`) · project name · `M awaiting pickup` (ready Tasks, from `GET /api/tasks/stats`)
- **Show archived** switch → `?include_archived=true` (done Tasks older than 7 days are hidden by default)
- `ViewModeToggle` (Table | Kanban) — persisted in `localStorage` under `atlas.viewMode.tasks`
- **New Task** button → `/tasks/new`; disabled when no projects exist

**Filters (`TaskFiltersBar`)**
- Assignee chips — All / Assigned to me (no agent) / Assigned to AI; counts scoped to the other active filters
- **By project** dropdown, **Status** dropdown (unified `IssueStatus` set), **Search tasks** field (`/` focuses it, `TaskFiltersBar.tsx:163`)
- State lives in the URL (`?project` by name, `?status`, `?filter`, `?q`)

**TaskTable**
- Columns: ID, Task, Sub-tasks (`sub_task_count`), Reporter, Assignee, Status, Updated; ID / Task / Updated sortable
- Row click → `/tasks/:id`; client-side pagination footer (default 20 rows)

**Kanban view**
- `WorkItemKanban`, one column per status; card = kind icon + Task id, title, assignee chip, live dot while `in_progress`
- Drag to a valid next column → `useTransitionTask`; shift-drop overrides the status machine. A refused move (e.g. 422 closing a Task with open sub-tasks) toasts the server's reason
- Card click → `/tasks/:id`

**Mobile** — `PageFab` "New Task" replaces the header button; the table renders as `MobileTaskList`.

## Why these affordances exist
- **Global New Task** — the project is picked inside the form, so the Owner doesn't have to open a project first.
- **Table vs Kanban** — Table answers "what's the state of all my Tasks"; Kanban answers "what do I move today".
- **Sub-tasks column** — a Task's sub-tasks are the list of what its one PR will contain.

## Modals / drawers
None.

## Hooks used
- `useTasks(projectId?, includeArchived)` — `['tasks', {…}]` → `GET /api/tasks`
- `useTaskStats()` — `['tasks-stats']` → `GET /api/tasks/stats`
- `useTransitionTask`, `useProjects`, `useAgents`, `useSettings`, `useToast`

## API endpoints touched
- `GET /api/tasks?project_id=…&include_archived=…`, `GET /api/tasks/stats`
- `PATCH /api/tasks/:id/status` (Kanban; `?override=1` on shift-drop)
- `GET /api/projects`, `GET /api/agents`, `GET /api/settings`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- "Assigned to me" means `assignee_agent_id === null` — single Owner, so unassigned is the Owner's.
- A Task a workflow run is working returns 409 on status PATCH (`workflow-lock.ts`); the Kanban toasts it.

## Connectivity
- **Pages**: [New Task](06-task-new.md), [Task Detail](07-task-detail.md), [Projects](02-projects.md) (empty state), [Project Detail](03-project-detail.md) Tasks tab ("Open in Tasks" deep-links here with `?project=`).
- **MCP tools**: `search_item` / `get_item { issue_type: 'task' }`.
- **Entities**: `task`, `project`, `agent`.

## Coming soon on this page
None.
