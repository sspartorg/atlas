# Issues

**Route:** `/issues` • **Component:** `packages/web/src/pages/Issues.tsx` • **Slug:** `issues`

## Purpose
Unified list across Stories, Bugs, Sub-tasks, Sub-bugs. Filter by project, status, kind, assignee, and free-text. When the "All" pill is active *and* the sort is the default (`Updated` desc), sub-items nest under their parent stories. Two view modes share the same filtered+sorted data: a sortable table and a drag-and-drop Kanban.

## States
- **Loading**: 6 skeleton rows (table view only)
- **Empty**: empty state + **New issue** button
- **Populated**: hierarchical sortable table OR Kanban depending on `ViewModeToggle`

## UI elements
**Header**
- Title "Issues" + subtitle (stories · sub-items · bugs counts)
- `ViewModeToggle` (Table | Kanban — icon + label) — persists in `localStorage` under `atlas.viewMode.issues`
- **New issue** button → opens `NewIssueModal` with `initialKind='story'`

**Filter row** (`IssueFiltersBar` — shares the styling primitives that `EpicFiltersBar` uses)
- **Primary pills**: All / Stories / Bugs / Sub-tasks / Sub-bugs / Assigned to me, each with a count
- **Project**, **Status**, **Assignee** dropdown chips
- Right-aligned **search field** (`9999px` radius, `/` hotkey)

**Table view**
- Columns: ID, Issue, Reporter, Assignee, Status, Updated
- ID, Title, Status, Updated are sortable via `SortableHeader` (toggle on click)
- Each row is clickable; navigates to the kind's detail page
- Hierarchy: when pill = All and sort = `Updated`, sub-items render indented under their parent story
- Reporter is the real `reporter_agent_id` agent (or Owner if null)

**Kanban view** (`WorkItemKanban`)
- 6 columns matching the unified status enum
- Card layout: top row has kind icon + short id (mono) on the left and a pulsing green `<LiveDot />` on the right when status is `in_progress`; title (clamped to 2 lines) in the middle; assignee chip (or Owner fallback when unassigned) at the bottom right
- Drag a card to a valid next column → API transition + invalidate `['issues','stories','bugs']`
- Shift-drop bypasses the state machine (override transition)
- Click a card → kind's detail page

## Why these affordances exist
- **Unified list across kinds** — Stories, bugs, sub-tasks and sub-bugs share the same status machine; one list with kind filters beats four pages because the Owner usually needs cross-kind triage.
- **Hierarchical sort (default)** — Sub-items make no sense without their parent story when scanning by recency; nesting preserves context. Other sorts flatten because nesting fights column predictability.
- **Kind pills with counts** — One-click narrow to a kind; counts tell the Owner whether the filter is even worth applying.
- **Kanban with shift-drop override** — Drag fires a validated transition; shift overrides for "I know what I'm doing" cases (e.g., re-opening a done item).
- **New issue defaults to story** — The most common manual create; modal lets the Owner pick a different kind without re-entering.

## Modals / drawers
- `NewIssueModal` — opens from **New issue**. Pre-fills `initialKind` and `initialProjectId`.

## Hooks used
- `useIssues({projectId})` — calls `GET /api/issues/tree` once. Response inlines `projects` and `agents` plus a hierarchical `tree` (stories+bugs at top, sub-tasks/sub-bugs nested as `children`). `flattenIssueTree(tree)` produces the legacy flat-row shape the table/kanban render pipeline expects.
- `useSettings` (owner name + accent colour)
- Direct `api.{stories,bugs,subTasks,subBugs}.transition` from Kanban drop handler
- `useQueryClient` for kanban-drop cache invalidation

## API endpoints touched
- `GET /api/issues/tree?project_id=…` — single composite call replacing the prior 6-call fan-out (projects + epics + stories + bugs + sub-tasks + sub-bugs).
- On Kanban drop: `PATCH /api/{kind}/:id/status[?override=1]`

## Edge cases / quirks
- Hierarchy is suppressed when the user clicks any sort header other than `Updated` — flat sort wins so columns behave predictably.
- `assigned_me` pill counts items where `assignee_agent_id === null` (Owner-assigned).

## Connectivity
- **Pages**: [Story Detail](09-story-detail.md), [Sub-task Detail](10-sub-task-detail.md), [Bug Detail](11-bug-detail.md), [Sub-bug Detail](12-sub-bug-detail.md) — row/card clicks deep-link to the kind's detail page.
- **Routes**: `GET /api/issues/tree?project_id=…` — single composite call replacing a 6-call fan-out; centralized server-side because flattening + parent-linking client-side cost noticeable time on larger workspaces.
- **MCP tools**: `search_items { q }`, `list_stories`, `list_bugs`, `list_sub_tasks`, `list_sub_bugs` — external agents reproduce this same cross-kind view by combining the list tools; `search_items` is the closer match when the agent has a free-text intent.
- **Entities**: `story`, `bug`, `sub_task`, `sub_bug`, `agent` (assignee/reporter), `project` (filter scope).

## Coming soon on this page
None.
