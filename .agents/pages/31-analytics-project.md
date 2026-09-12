# Analytics — Project

**Route:** `/analytics/project/:projectId`  •  **Component:** `packages/web/src/pages/AnalyticsProject.tsx`

## Purpose
All-time cost for one project, broken down by item kind and rolled up per epic.

## States
- No id in the URL: "No project id in the URL." (`:76`).
- Loading: three `<Skeleton>` blocks (`:86`).
- Error: `Failed to load project analytics: <message>` — the real error text, not a generic line (`:96`).
- Empty epics: "No epics with cost data yet." (`:487`).
- Populated: totals header → by-kind pie → top-epics bars → optional paged epic table.

## UI elements

**Header** — project name + all-time totals (cost, tokens, run count).

**By kind** — pie over `data.byKind`, filtered to `total_cost_usd > 0` so zero-cost kinds don't render a 0° slice (`:106`).

**Top epics** — horizontal bars over `data.topEpics` (top 25 from the summary endpoint), scaled to the max in the set.
- Caption: `Showing top N of {epic_count} epics — sorted by descendant-rolled cost.` (`:363`)
- **View all {epic_count} epics** (`:513`) → flips `showAll`, which is what `enabled` on the paged query keys off. Nothing is fetched until the Owner asks.

**Paged epic table** (only when `showAll`)
- **Rows-per-page** select (`:651`) — changing it resets `page` to 1, so the Owner can't land on an out-of-range page.
- **Pagination** (`:663`) — `count` = `ceil(total / limit)`, floored at 1.
- Sub-caption names the page and the total (`:525`).

## Modals / drawers
None.

## Hooks used
- `useQuery(['analytics-project', projectId])` → `api.analytics.project(id)`; `staleTime: 30_000`, `enabled` only with an id.
- `useQuery(['analytics-project-epics', projectId, page, limit])` → `api.analytics.projectEpics(...)`; `enabled` only once `showAll` is true, `placeholderData: keepPreviousData` so paging doesn't flash a skeleton.

## API endpoints touched
- `GET /api/analytics/project/:projectId` — totals, `byKind`, top 25 epics, `epic_count`
- `GET /api/analytics/project/:projectId/epics?page&limit` — the full paged list

## Permissions / guards
- Auth: post-onboarding only. Read-only.

## Edge cases / quirks
- **All-time here, current-month on `/analytics`.** These two pages are *supposed* to disagree, and they reconcile: during the sweep this page's `$8.12` = completed runs `$7.5030` + closed terminal sessions `$0.6428`, while the Dashboard's September figure was `$2.28`. Read [`30-analytics.md`](30-analytics.md) before treating a difference as a bug.
- Epic bars are **descendant-rolled** — a parent's number includes its children's cost, so bars will not sum to the project total.
- `paged.data?.total ?? data.epic_count` is the fallback used in both the caption and the page count, so the first render (before the paged query resolves) still shows a sane total.

## Related pages
- [`30-analytics.md`](30-analytics.md) — workspace roll-up
- [`32-analytics-epic.md`](32-analytics-epic.md) — next drill-down
- [`03-project-detail.md`](03-project-detail.md)

## Coming soon on this page
- None.
