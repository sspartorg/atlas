# Analytics — Epic

**Route:** `/analytics/epic/:epicId`  •  **Component:** `packages/web/src/pages/AnalyticsEpic.tsx`

## Purpose
All-time cost for one epic and every descendant, filterable by item type.

## States
- No id in the URL: "No epic id in the URL." (`:84`).
- Loading: three `<Skeleton>` blocks (`:93`).
- Error: `Failed to load epic analytics: <message>` (`:103`).
- Populated: epic totals → per-kind cards (clickable filters) → paged descendant table.

## UI elements

**Header** — epic title + all-time rolled totals.

**Per-kind cards** (`:269`) — one per descendant type. Each is a **filter toggle**: clicking sets `typeFilter` and resets `page` to 1 (`:276`). The active card renders as selected.

**Descendant table**
- Sub-caption names the scope and the active filter: `Every descendant of this epic. Sorted by cost. Filtered to <label> only.` (`:345`)
- **`Showing only: <label>` chip** (`:349`) — the deletable escape hatch; clearing it also resets `page` (`:353`).
- **Rows-per-page** select — resets `page` (`:521`).
- **Pagination** — over the filtered total.

## Modals / drawers
None.

## Hooks used
- `useQuery(['analytics-epic', epicId])` → `api.analytics.epic(id)`; `staleTime: 30_000`.
- `useQuery(['analytics-epic-children', epicId, page, limit, typeFilter ?? 'all'])` → `api.analytics.epicChildren(...)`; `placeholderData: keepPreviousData`, `staleTime: 30_000`. Unlike the project page's table, this one is **always** enabled — the descendant list is the page's main content, not an opt-in.

## API endpoints touched
- `GET /api/analytics/epic/:epicId` — rolled totals + per-kind breakdown
- `GET /api/analytics/epic/:epicId/children?page&limit&type` — paged descendants

## Permissions / guards
- Auth: post-onboarding only. Read-only.

## Edge cases / quirks
- **`typeFilter ?? 'all'` is in the query key.** Without the `?? 'all'`, `null` and `undefined` would collapse to the same cache slot and the unfiltered view would serve a filtered payload. Don't "simplify" it away.
- Every control that changes the result set resets `page` to 1 — three separate call sites (`:276`, `:353`, `:521`). A new filter control must do the same, or the Owner lands on an empty page past the new end.
- Totals are **descendant-rolled**, so per-kind figures sum to the epic total but individual item rows nest.
- All-time, like the project page — not the current month. See [`30-analytics.md`](30-analytics.md).

## Related pages
- [`31-analytics-project.md`](31-analytics-project.md) — one level up
- [`30-analytics.md`](30-analytics.md) — workspace roll-up
- [`07-epic-detail.md`](07-epic-detail.md)

## Coming soon on this page
- None.
