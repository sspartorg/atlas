# Epics

**Route:** `/epics` • **Component:** `packages/web/src/pages/Epics.tsx` • **Slug:** `epics`

## Purpose
List all epics across all projects. Filter by project, status, assignee scope, and free-text search. Single sortable table.

## States
- **Loading**: `isLoading` → 5 skeleton rows (lines 170-179)
- **No projects**: `projects.length === 0` → empty state card linking to `/projects` (lines 181-214)
- **Empty filter result**: `EpicTable` shows "No epics match these filters" (`EpicTable.tsx:136-162`)
- **Populated**: sortable `EpicTable` (lines 216-223)

## UI elements
**Header**
- "Epics" title + subtitle (count + project filter + awaiting-PO count)
- `ViewModeToggle` (Table | Kanban — icon + label) — persists choice in `localStorage` under `atlas.viewMode.epics`
- **New Epic** button → navigates to `/epics/new`; disabled when no projects exist

**Kanban view**
- `WorkItemKanban` with 6 columns matching the unified status enum.
- Card layout: top row has kind icon + `EPC-NNN` short id on the left and a pulsing green `<LiveDot />` on the right when status is `in_progress`; title (clamped to 2 lines) in the middle; assignee chip (or Owner fallback when unassigned) at the bottom right.
- Drag a card to a valid next column → fires `useTransitionEpic`. Shift-drop bypasses the state machine (override).
- Click a card → `/epics/:id`.

**Filters (`EpicFiltersBar`)**
- **Assignee chips** — All / Assigned to me / Assigned to AI (`onFilterChange`)
- **By project** dropdown — all projects + "All projects"
- **Status** dropdown — full `IssueStatus` enum (draft/ready/in_progress/in_review/blocked/done/etc — see `@atlas/shared/types`); `ready_for_po` is retired
- **Search field** — hotkey `/` focuses it (lines 161-172)
- **Show archived** toggle — flips the `archived=1` query param so the table includes archived epics (`Epics.tsx:173-188`)
- URL-controlled state (filter/status/q + `page` + `page_size`) via `useSearchParams` (`Epics.tsx:35-46`) — deep-link / reload preserves filters and pagination

**EpicTable**
- Columns: ID, Epic, Stories, Reporter, Assignee, Status, Updated
- ID, Title, Updated are sortable (`SortableHeader`)
- Row click → `/epics/:id`
- Agent badges show category sub-label
- Pagination footer (rows-per-page + Mui Pagination) below the table; controlled by `?page=N&page_size=NN` URL params (`Epics.tsx:48-61, 306-311`)

**Mobile**
- `PageFab` (`Epics.tsx:314`) replaces the desktop "+ New Epic" button on `<md` viewports

## Why these affordances exist
- **New Epic (global)** — Without a global create-path the Owner has to navigate into a project first; the project choice is better made inside the new-epic form.
- **View toggle (Table/Kanban)** — Table answers "what's the state of all my epics"; Kanban answers "what should I move forward today". Persisted in localStorage.
- **Kanban drag** — Direct status transitions (with shift-drop override) faster than opening each epic; state machine validates server-side.
- **Assignee chips (All / Mine / AI)** — Single-Owner means "mine" filters to unassigned (Owner-held); the split isolates "my plate" from "agent work".
- **Status dropdown excludes `in_spec` / `in_dev`** — Epics never enter those; listing them would invite the Owner to filter to an empty bucket.

## Modals / drawers
None.

## Hooks used
- `useEpics()` — `GET /api/epics?project_id=…`, staleTime 15s
- `useEpicStats()` — `GET /api/epics/stats`, staleTime 15s
- `useProjects`, `useAgents`, `useSettings`

## API endpoints touched
- `GET /api/epics?project_id=…`
- `GET /api/epics/stats`
- `GET /api/projects`, `GET /api/agents`, `GET /api/settings`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Filter `mine` == `assignee_agent_id === null` (no agent assigned). Filter `ai` == `assignee_agent_id !== null` (lines 49-50). There's no real "Owner-only" filter because there's only one owner.
- Status filter excludes `in_spec` and `in_dev` from the dropdown because epics don't enter those states (per the status machine).
- Filter chip counts exclude items that fail other active filters (search/status) — counts are scoped to the current filter context.

## Connectivity
- **Pages**: [Epic New](06-epic-new.md) — New Epic button target; [Epic Detail](07-epic-detail.md) — row/card click; [Projects](02-projects.md) — empty state when no projects exist.
- **Routes**: `GET /api/epics/stats` — pre-aggregated awaiting-PO/in-review counts so the subtitle doesn't re-scan client-side; `PATCH /api/epics/:id/status` — fired by Kanban drag, accepts `?override=1` for shift-drops.
- **MCP tools**: `list_epics { project_id?, status? }` — the workflow an external agent runs to scope to "what epics need attention" before drilling into one with `get_epic_tree`.
- **Entities**: `epic`, `project` (filter), `agent` (assignee chip).

## Coming soon on this page
None.
