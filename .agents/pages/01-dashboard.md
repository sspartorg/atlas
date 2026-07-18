# Dashboard

**Route:** `/` • **Component:** `packages/web/src/pages/Dashboard.tsx` • **Slug:** `dashboard`

## Purpose
The post-onboarding home. Shows a greeting, KPI strip, "Awaiting you" worklist, "In motion" queue snapshot, and Today's Pass card. Empty state takes over until at least one project exists.

## States
- **Loading**: `isPending || data === undefined` → renders `<BrandedFallback />` inside a 60vh flex box (Dashboard.tsx:14-20)
- **Empty**: `(data.kpis?.projectCount ?? 0) === 0` → `DashboardEmptyState` (Dashboard.tsx:22-26)
- **Populated**: `DashboardPopulated` (Dashboard.tsx:28-32)

## UI elements
**Empty state (`pages/dashboard/DashboardEmptyState.tsx`)**
- **Add your first project** card with **New Project** button (line 123-131) → opens `NewProjectModal`
- **Credentials Alert** (lines 134-158) → click navigates to `/settings/credentials`

**Populated (`pages/dashboard/DashboardPopulated.tsx`)**
- **Greeting block** — "Hi {ownerFirstName}" + awaiting count (line 29)
- **KPI strip** — 5 KPI tiles (line 30)
- **Awaiting You panel** (line 38) — table of items that need Owner action; rows from `data?.awaiting`
- **In Motion panel** (line 39) — current queue snapshot; rows from `data?.queue`
- **Today's Pass section** (line 41) — KPI summary from `data?.kpis?.todaysPass`

The panels are read-only listings; clicking a row navigates to that issue's detail page.

## Why these affordances exist
- **Add your first project (empty state)** — Every other surface renders empty without at least one project; the empty state funnels here rather than offering distracting alternatives.
- **Credentials Alert (empty state)** — Surfacing the credential gap before the new-project modal saves a failed clone round-trip on private repos.
- **Awaiting You panel** — Single inbox of items needing Owner input; without it the Owner has to check each issue type's list page.
- **In Motion panel** — Live queue snapshot; row click jumps to the issue (the agent runs on behalf of an issue, not vice versa).
- **KPI strip** — Pre-aggregated server-side because each tile is otherwise a per-entity scan.

## Modals / drawers
- `NewProjectModal` (from empty state) — opens via `setNewProjectOpen(true)`, closes via `setNewProjectOpen(false)`.

## Hooks used
- `useSettings()` — owner name + accent (`Dashboard.tsx:11`)
- `useDashboard()` — KPI + awaiting + queue payload (`Dashboard.tsx:12`); staleTime 10s. Refreshed via SSE `counts_changed` / `run_queued` / `run_completed` events (no polling). Drives the empty/populated branch via `data.kpis?.projectCount`.

(`DashboardPopulated` and `DashboardEmptyState` are pure presentational children — no additional data hooks on the page itself.)

## API endpoints touched
- `GET /api/dashboard` — the single composite endpoint backing `useDashboard()` (KPIs, awaiting, queue, todaysPass all in one payload). Route handler: `packages/api/src/routes/counts.ts:14`. (Note: historical docs called this `/api/counts/dashboard`; the actual path is `/api/dashboard`.)

## Permissions / guards
- Post-onboarding only (route guard).

## Edge cases / quirks
- Empty state takes over when `(data.kpis?.projectCount ?? 0) === 0`. The loading branch beats both — `isPending || data === undefined` always renders `<BrandedFallback />` first, even if `useSettings` has data ready.
- The "Greeting" pulls just the first word of `owner_name` (`Dashboard.tsx:23-24`).

## Connectivity
- **Pages**: [Projects](02-projects.md) — empty-state CTA opens its New Project modal; [Queue](13-queue.md) — "In motion" rows are the same underlying runs Queue lists; issue detail pages — every awaiting/in-motion row deep-links straight to its entity.
- **Routes**: `GET /api/dashboard` — the only page that consumes this composite endpoint; bundles KPIs + awaiting + in-motion + project count so the home view costs one round-trip and decides empty vs. populated in a single payload.
- **Entities**: aggregates over `epic`, `story`, `sub_task`, `sub_bug`, `bug`, `agent_run`, `notification`.

## Coming soon on this page
None.
