# Analytics — Task

**Route:** `/analytics/task/:taskId`  •  **Component:** `packages/web/src/pages/AnalyticsTask.tsx`

## Purpose
All-time cost for one Task and its sub-tasks, filterable by item kind.

## States
- No id in the URL: "No task id in the URL." (`:77`).
- Loading: three `<Skeleton>` blocks (`:86-88`).
- Error: `Failed to load task analytics: <message>` (`:97`).
- Populated: Task totals → per-kind cards (clickable filters) → paged descendant table.

## UI elements

**Header** — project link (→ `/analytics/project/:projectId`), Task id, Task title + all-time rolled totals.

**Per-kind cards** (`:252`) — one per descendant kind (`task`, `sub_task`). Each is a **filter toggle**: clicking sets `typeFilter` and resets `page` to 1 (`:259-260`). `byKindPie` filters to `total_cost_usd > 0` (`:105`), so a kind with no spend shows no card.

**Descendant table**
- Sub-caption: `Every descendant of this task. Sorted by cost. Filtered to <label> only.` (`:335`)
- **`Showing only: <label>` chip** (`:340`) — deletable; clearing it resets `page` (`:342-343`).
- **Rows-per-page** select — resets `page` (`:524`). **Pagination** over the filtered total.

## Modals / drawers
None.

## Hooks used
- `useQuery(['analytics-task', taskId])` → `api.analytics.task(id)`; `staleTime: 30_000`.
- `useQuery(['analytics-task-children', taskId, page, limit, typeFilter ?? 'all'])` → `api.analytics.taskChildren(...)`; `placeholderData: keepPreviousData`. Always enabled — the descendant list is the page's main content.

## API endpoints touched
`routes/analytics.ts`; both routes only accept a `task` id:
- `GET /api/analytics/task/:taskId` — `task` header, rolled totals + per-kind breakdown; 404 `Item is not a task` for a sub-task id
- `GET /api/analytics/task/:taskId/children?page&limit&type` — paged descendants **plus the root Task itself at `depth: 0` when it owns completed runs**; `type` ∈ `task | sub_task`. A Task-level workflow writes `agent_runs.item_id = <task id>` for every non-Sub-tasks step, so those runs are the Task's own. Before this, the root was excluded unconditionally: the hero total exceeded the sum of the visible rows and the `task` per-kind card was a dead filter that always returned "No items match the current filter."

## Permissions / guards
- Auth: post-onboarding only. Read-only.

## Edge cases / quirks
- **`typeFilter ?? 'all'` is in the query key** so `null` and `undefined` don't share a cache slot with a filtered payload. Don't "simplify" it away.
- Every control that changes the result set resets `page` to 1 (`:259-260`, `:342-343`, `:524`); a new filter control must too.
- Totals are descendant-rolled. All-time, like the project page — not the current month (see [`30-analytics.md`](30-analytics.md)).

## Related pages
- [`31-analytics-project.md`](31-analytics-project.md) — one level up
- [`30-analytics.md`](30-analytics.md) — workspace roll-up
- [`07-task-detail.md`](07-task-detail.md)

## Coming soon on this page
- None.
