# Search

**Route:** `/search` • **Component:** `packages/web/src/pages/Search.tsx` • **Slug:** `search_queues`

## Purpose
Cross-entity search across Tasks and Sub-tasks (and agents for prompt search). Two modes: structured pill-filter builder, or a KQL-like query string.

## States
- **Empty results**: `SearchEmptyState` (lines 209-216)
- **Populated**: `SearchResults` grid (lines 217-226)

## UI elements
**Mode toggle (`SearchModeToggle`)** — Filters icon / Query icon.

**Text input (`SearchTextInput`)** — full-width pill-style search box bound to `filters.text`. Filters results across title, description, and short ID. Serialises to `?q=…` (debounced 250 ms) so deep links and reload preserve the query.

**Filters mode (`SearchFilterBuilder`)**
- Active filter pills: Type, Project, Updated, Status — click to edit, X to remove
- **Add Filter** dashed pill — menu with options Type / Project / Updated / Status
- Multi-select for Type (task / sub-task / prompt); single-select for the others
- **Save This Search** button + ⌘S shortcut (lines 140-149) — currently just toasts "Search saved"

**Query mode (`SearchQueryInput`)**
- Monospace input with syntax-coloring overlay (tokens: field / op / value / connector / unknown)
- Header shows parse status (valid / invalid)
- **Tab** → autocompletes first suggestion (up to 6 suggestions shown)
- **Enter** → submits
- Example query rows — click to apply

**Results (`SearchResults`)**
- Sort dropdown: updated_desc / updated_asc / type
- Grouped by type
- Each row: line 1 = short id + status + assignee · line 2 = title (single-line ellipsis) + project pill · line 3 = description **clamped to 2 lines** with ellipsis (no wrap past line 2) — long descriptions never push card height
- Result row click → `/tasks/:id`, `/sub-tasks/:id` (`utils/itemPath.ts`) or `/agents/:id` for a prompt hit

## Why these affordances exist
- **Mode toggle (Filters / Query)** — Filters for Owners who know which dimensions to narrow on; Query for power-user KQL not expressible as pills.
- **`?q=` URL serialization** — Search results are linkable and reload-safe; pasting the URL into chat recreates the view.
- **Editable filter pills** — Inline refine without rebuilding the query; matches Linear / Jira filter patterns.
- **Tab autocomplete (query mode)** — KQL syntax is unforgiving; Tab completes field names + values from the live corpus so the Owner doesn't memorize grammar.
- **Example query rows** — Clickable scaffolds so Owners learn by mutation.

## Modals / drawers
None.

## Hooks used
- `useSearch({ q, type, project_id, agent_id, status, updated, labels, limit })` — `Search.tsx:11`. The page-level hook that POSTs the active query+filters to the server-side FTS endpoint. Debounced upstream via `useDebouncedValue`.
- `useDebouncedValue<string>` — companion in the same module; holds keystrokes off for 250ms.
- `useAgents`, `useProjects`, `useSettings` — for filter-chip suggestions only (NOT search corpus).
- `useProjectLabels(undefined, { workspace: true })` — workspace-wide labels for the Labels filter chip (Task 2).
- `useToast` — for the "Save this search" stub.

## API endpoints touched
- `GET /api/search?q=…&type=…&project_id=…&status=…&updated=…&labels=…&limit=…` — server-side Postgres FTS (`items.search_tsv` GIN index). Replaces the legacy "7 parallel GETs on mount" client-side corpus build. Cold visit cost is now one round-trip; subsequent keystrokes hit the same endpoint behind the debounce + `keepPreviousData` so the UI doesn't flash empty.
- `GET /api/agents`, `GET /api/projects` are fetched for filter-chip suggestions (cached, not search input).
- `GET /api/labels?workspace=true` — workspace-scope labels for the Labels chip.

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Switching modes resets the query parse state but keeps active filters in their respective pills.
- KQL parser supports `field = "value"` and `AND` connector; other connectors or operators surface as "unknown" tokens.
- `SearchEmptyState` has helper buttons for clearing filters and a **Create a Task / Sub-task** button (label from the first Type filter, default Task) that only toasts "Create from search is not wired up yet." (`Search.tsx:138`, see coming-soon).

## Connectivity
- **Pages**: [Task Detail](07-task-detail.md), [Sub-task Detail](10-sub-task-detail.md) — search results click through.
- **Routes**: `GET /api/search?q=…` — the page's only data source (Postgres FTS); `type` accepts `task` / `sub_task`.
- **MCP tools**: `search_item { query }` → `get_item { issue_type, id }` on the top hit.
- **Entities**: `task`, `sub_task`, `agent` (prompt search).

## Coming soon on this page
- "Create from search" — see [coming-soon.md](../coming-soon.md).
