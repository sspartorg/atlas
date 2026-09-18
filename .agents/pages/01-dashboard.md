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
- **Add your first project** card with **New Project** button → opens `NewProjectModal`. Copy promises GitHub URLs only — the API accepts `https://github.com/…` only.
- **Credentials Alert** → "Add a Personal Access Token or GitHub App in **Settings → Credentials**"; click navigates to `/settings/credentials`. (SSH keys are a coming-soon stub, so they are not offered.)
- **Agents Alert** — rendered only when `useAgents()` has loaded and returns zero agents: "No agents yet? Install them from **Agents → Marketplace**"; click navigates to `/agents/marketplace`.

**Populated (`pages/dashboard/DashboardPopulated.tsx`)**
- **Greeting block** — "Hi {ownerFirstName}" + awaiting count (line 29)
- **KPI strip** — 5 KPI tiles (line 30). The three agent tiles (Software dev / Marketing / Content + Design) show live runs only — `agentStatsByCategory[cat].running`, `in_progress` agent runs, caption "live run(s) now". There is no queued count: agents have no queue, Tasks queue for workflows (see the Queue page). The AI Cost tile caption reads "N completed runs · M sessions · T tokens" — the API sums only `completed` runs (and `closed` sessions) since the start of the month.
- **Awaiting You panel** (line 38) — table of items that need Owner action; rows from `data?.awaiting`. Kind filter: All / Tasks / Sub-tasks. When capped: "Showing N of M — open Tasks to see the rest."
- **In Motion panel** (line 39) — current queue snapshot; rows from `data?.queue`. Same All / Tasks / Sub-tasks filter; empty copy "Assign a task to an agent to get things moving."
- **Today's Pass section** (line 41) — KPI summary from `data?.kpis?.todaysPass`; each row is `agent_name · issue_id`, the real item key (e.g. `SDB-4`).

The panels are read-only listings; clicking a row navigates to `/tasks/:id` or `/sub-tasks/:id` (`utils/itemPath.ts`).

## Why these affordances exist
- **Add your first project (empty state)** — Every other surface renders empty without at least one project; the empty state funnels here rather than offering distracting alternatives.
- **Credentials Alert (empty state)** — Surfacing the credential gap before the new-project modal saves a failed clone round-trip on private repos.
- **Awaiting You panel** — Single inbox of items needing Owner input; without it the Owner has to scan every Task and its sub-tasks.
- **In Motion panel** — Live queue snapshot; row click jumps to the issue (the agent runs on behalf of an issue, not vice versa).
- **KPI strip** — Pre-aggregated server-side because each tile is otherwise a per-entity scan.

## Modals / drawers
- `NewProjectModal` (from empty state) — opens via `setNewProjectOpen(true)`, closes via `setNewProjectOpen(false)`.

## Hooks used
- `useSettings()` — owner name + accent (`Dashboard.tsx:11`)
- `useAgents()` — empty state only, to decide whether to show the Marketplace hint.
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
- **Entities**: aggregates over `task`, `sub_task`, `agent_run`, `notification`. The API's KPI payload also carries `tasks` / `tasksInProgress` (Task counts; formerly `epics` / `storiesInProgress`), which the KPI strip doesn't render.

## Coming soon on this page
None.
