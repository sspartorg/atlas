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
- **Test tag** — a row made by an agent test run (`is_test`) shows a small `TEST` pill (science icon, tooltip "Created by an agent test run") after the title, in the table and the mobile list. Test items are listed, not hidden (migration 002).

**Header**
- "Tasks" title + subtitle: `N tasks` · project name (when `?project=`) · `M ready` — both counts are of the rows listed, so they follow every filter, search and **Show archived** (no longer `GET /api/tasks/stats`, which counted archived Tasks and ignored filters)
- **Show archived** switch → `?include_archived=true` (done Tasks older than 7 days are hidden by default)
- `ViewModeToggle` (Table | Kanban) — persisted in `localStorage` under `atlas.viewMode.tasks` (read/write guarded: blocked storage falls back to Table)
- **New task** button → `/tasks/new`; disabled when no projects exist

**Filters (`TaskFiltersBar`)**
- Assignee chips — All / Assigned to me (no agent) / Assigned to AI; counts scoped to the other active filters
- **By project** dropdown, **Status** dropdown (unified `IssueStatus` set; first option **Any**) — both are buttons (Enter / Space open them); the project chip shows the picked project. **Search tasks** field matches id, title and description (`/` focuses it)
- State lives in the URL (`?project` by name — an id also works, `?status`, `?filter`, `?q`)

**TaskTable**
- Columns: ID, Task, Sub-tasks (`sub_task_count`), Reporter, Assignee, Status, Updated; ID / Task / Updated sortable
- Row click (or Enter / Space on the focused row) → `/tasks/:id`; sort headers are buttons named "Sort by X" / "X, sorted ascending|descending"; client-side pagination footer (default 20 rows; **First / Previous / Next / Last page** buttons). **Rows: All** with 60+ rows virtualises against the app shell's scroller (`useShellVirtualizer`); until 2026-09-28 it listened to `window`, which never scrolls here, and everything past the first screen was blank.

**Kanban view**
- `WorkItemKanban`, one column per status; card = kind icon + Task id, title, assignee chip, live dot while `in_progress`
- Drag to a valid next column → `useTransitionTask`. **There is no shift-drop override** — `WorkItemKanban.tsx:237-256` refuses an illegal drop outright with a toast naming the legal targets, and the only call is `onTransition(item, status, false)`. Override lives solely in `StatusPickerPopover`. *(corrected 2026-09-20 — campaign task-21.)*
- Card click (or Enter / Space on the focused card) → `/tasks/:id`. A refused move shows **one** toast from `useTransitionTask` (the closure-rule toast, the "Close them too" offer, or "Couldn't move <id>" with the API's reason).
- A column draws its first 50 cards; **Show N more · M hidden** adds 100 at a time (the header count is the full total). A 2,000-Task kanban used to draw every card — 24k DOM nodes.

**Mobile** — `PageFab` "New task" replaces the header button and the Kanban toggle is dropped; **Show archived** stays in the header. The table renders as `MobileTaskList`, in the table's sort order.

## Why these affordances exist
- **Global New Task** — the project is picked inside the form, so the Owner doesn't have to open a project first.
- **Table vs Kanban** — Table answers "what's the state of all my Tasks"; Kanban answers "what do I move today".
- **Sub-tasks column** — a Task's sub-tasks are the list of what its one PR will contain.

## Modals / drawers
None.

## Hooks used
- `useTasks(projectId?, includeArchived)` — `['tasks', {…}]` → `GET /api/tasks`
- `useTransitionTask` (toasts every refusal itself), `useProjects`, `useAgents`, `useSettings`

## API endpoints touched
- `GET /api/tasks?project_id=…&include_archived=…`
- `PATCH /api/tasks/:id/status` (Kanban; always `override=false` — the override path is the status picker, not the board)
- `GET /api/projects`, `GET /api/agents`, `GET /api/settings`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- "Assigned to me" means `assignee_agent_id === null` — single Owner, so unassigned is the Owner's.
- A Task a workflow run is working returns 409 on status PATCH (`workflow-lock.ts`); the Kanban toasts "Couldn't move <id>" with the API's reason.

## Connectivity
- **Pages**: [New Task](06-task-new.md), [Task Detail](07-task-detail.md), [Projects](02-projects.md) (empty state), [Project Detail](03-project-detail.md) Tasks tab ("Open in Tasks" deep-links here with `?project=`).
- **MCP tools**: `search_item` / `get_item { issue_type: 'task' }`.
- **Entities**: `task`, `project`, `agent`.

## Coming soon on this page
None.
