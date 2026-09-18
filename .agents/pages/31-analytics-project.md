# Analytics — Project

**Route:** `/analytics/project/:projectId`  •  **Component:** `packages/web/src/pages/AnalyticsProject.tsx`

## Purpose
All-time cost for one project, broken down by item kind (`task` / `sub_task`) and rolled up per Task.

## States
- No id in the URL: "No project id in the URL." (`:76`).
- Loading: three `<Skeleton>` blocks (`:86`).
- Error: `Failed to load project analytics: <message>` — the real error text, not a generic line (`:96`).
- No Tasks with cost: "No tasks with cost data yet." (`:487`).
- Populated: totals header → by-kind pie → top-Tasks bars → optional paged Task table.

## UI elements

**Header** — project name + all-time totals (cost, tokens, `N tasks`, run and terminal-session counts).

**By kind** — pie over `data.byKind`, filtered to `total_cost_usd > 0` so zero-cost kinds don't render a 0° slice (`:106`).

**Top tasks by total cost** — horizontal bars over `data.topTasks` (top 25 Tasks from the summary endpoint), scaled to the max in the set; row → `/analytics/task/:taskId`.
- Caption: `Showing top N of {task_count} tasks — sorted by descendant-rolled cost.` (`:363`)
- **View all {task_count} tasks** (`:513`) → flips `showAll`, which is what `enabled` on the paged query keys off. Nothing is fetched until the Owner asks.

**Paged Task table** (only when `showAll`; row → `/analytics/task/:taskId`)
- **Rows-per-page** select (`:651`) — changing it resets `page` to 1, so the Owner can't land on an out-of-range page.
- **Pagination** (`:663`) — `count` = `ceil(total / limit)`, floored at 1.
- Sub-caption names the page and the total (`:525`).

## Modals / drawers
None.

## Hooks used
- `useQuery(['analytics-project', projectId])` → `api.analytics.project(id)`; `staleTime: 30_000`, `enabled` only with an id.
- `useQuery(['analytics-project-tasks', projectId, page, limit])` → `api.analytics.projectTasks(...)`; `enabled` only once `showAll` is true, `placeholderData: keepPreviousData` so paging doesn't flash a skeleton.

## API endpoints touched
- `GET /api/analytics/project/:projectId` — totals, `byKind`, top 25 Tasks (`topTasks`), `task_count`
- `GET /api/analytics/project/:projectId/tasks?page&limit` — the full paged Task list

## Permissions / guards
- Auth: post-onboarding only. Read-only.

## Edge cases / quirks
- **All-time here, current-month on `/analytics`.** These two pages are *supposed* to disagree, and they reconcile: during the sweep this page's `$8.12` = completed runs `$7.5030` + closed terminal sessions `$0.6428`, while the Dashboard's September figure was `$2.28`. Read [`30-analytics.md`](30-analytics.md) before treating a difference as a bug.
- Task bars are **descendant-rolled** — a Task's number includes its sub-tasks' cost, so bars will not sum to the project total.
- `paged.data?.total ?? data.task_count` is the fallback used in both the caption and the page count, so the first render (before the paged query resolves) still shows a sane total.

## Related pages
- [`30-analytics.md`](30-analytics.md) — workspace roll-up
- [`32-analytics-task.md`](32-analytics-task.md) — next drill-down
- [`03-project-detail.md`](03-project-detail.md)

## Coming soon on this page
- None.
