# Dashboard

**Route:** `/` • **Component:** `packages/web/src/pages/Dashboard.tsx` • **Slug:** `dashboard`

## Purpose
The post-onboarding home. Shows a greeting with fleet figures, the Running now pipelines, "Awaiting you" worklist, "In motion" queue snapshot, and the agent roster. Empty state takes over until at least one project exists.

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
- **Greeting block** (`GreetingBlock.tsx`) — "{greeting}, {ownerFirstName}" + awaiting count.
- **Fleet strip** (`FleetStrip.tsx`) — one panel, three cells: **agents** (active count, one dot per agent — green while it has a queued/in-progress run via `useActiveRuns`, working first, capped at 40 with "+N" — plus "N working"/"all idle"); **runs live** (sum of `agentStatsByCategory[cat].running`; green with a `LiveDot` when > 0, muted "All quiet right now" at 0; pulse off under `prefers-reduced-motion`); **this month** spend (`costTotals()` sums `costSummary30d` + `terminalCostSummary30d`, caption "N runs, T tokens"; "—" / "No spend yet this month" when neither is present). Three columns from `md`, agents on its own row below that.
- **Running now** (`LivePipelines.tsx`) — every Task workflow run in flight (`pipelines.runs` on `GET /api/dashboard`: running + waiting_for_owner top-level runs, oldest first), each drawn as a route map of its workflow's main line: `pipelineView()` (`pipeline.ts`) follows pass edges Start → End (Start/End not drawn) and names each station (agent name, script label, "Sub-tasks: label", "You" for an Owner step). Travelled track and the current station are green while running, amber when `waiting_for_owner` ("Needs you: {park_reason}", placed at `parked_node_id`). A run inside a fail-edge fix-up detour sits at the station the detour hangs off, with "Fixing with {step}, then back to {station}". Lines over 12 stations (and all lines below `md`) name only the current station. Title links to `/workflows/:workflowId/runs/:runId`; elapsed time ticks every 30s; retries shown when `loop_count > 0`. Footer: "Up next: N in {workflow}" from `pipelines.queued` (ready Tasks per workflow, counted in SQL), plus `pipelines.unassigned` (draft/ready Tasks with no workflow). **Open queue** → `/queue`. Empty: "Nothing is running…". Live via SSE: `workflow_run_updated` now also invalidates `['dashboard']`. Empty state: a centred empty route with a light running along it (CSS transform/opacity in a `contain: strict` box; static under `prefers-reduced-motion`).
- **Awaiting You panel** — table of items that need Owner action; rows from `data?.awaiting`. Kind filter: All / Tasks / Sub-tasks. When capped: "Showing N of M — open Tasks to see the rest."
- **In Motion panel** — current queue snapshot; rows from `data?.queue`. Same All / Tasks / Sub-tasks filter; empty copy "Assign a task to an agent to get things moving."
- **Your agents roster** (`AgentRoster.tsx`) — active agents grouped by category, working agents (queued/in-progress run, via `useActiveRuns`) first with a live dot; each row links to `/agents/:id`. Beside the worklists (`lg`+) it takes their height and shows as many agents as fit (`fitRows()`, measured with a ResizeObserver); stacked, it previews 6. **Show all N** moves it to a full-width row (agents in auto-fill columns, Awaiting/In Motion go side by side above) and scrolls it into view; **Show fewer** restores. **Manage agents** → `/agents`. No active agents → link to `/agents/marketplace`.

Layout: Greeting → Fleet strip → Running now → 8/4 grid (Awaiting + In Motion stacked | roster); stacks below `lg`.

The panels are read-only listings; clicking a row navigates to `/tasks/:id` or `/sub-tasks/:id` (`utils/itemPath.ts`).

## Why these affordances exist
- **Add your first project (empty state)** — Every other surface renders empty without at least one project; the empty state funnels here rather than offering distracting alternatives.
- **Credentials Alert (empty state)** — Surfacing the credential gap before the new-project modal saves a failed clone round-trip on private repos.
- **Awaiting You panel** — Single inbox of items needing Owner input; without it the Owner has to scan every Task and its sub-tasks.
- **In Motion panel** — Live queue snapshot; row click jumps to the issue (the agent runs on behalf of an issue, not vice versa).
- **Running now** — Shows orchestration itself: where each Task is in its workflow, what's being fixed, and what's parked on the Owner — without opening each run.
- **Agent roster** — Answers "who's working right now" without leaving the home page.

## Modals / drawers
- `NewProjectModal` (from empty state) — opens via `setNewProjectOpen(true)`, closes via `setNewProjectOpen(false)`.

## Hooks used
- `useSettings()` — owner name + accent (`Dashboard.tsx:11`)
- `useAgents()` — empty state only (Marketplace hint).
- `useActiveRuns()` — working/idle state for the roster and fleet strip (`['runs','active']`: `GET /api/run?status=queued,in_progress`, SSE-invalidated under `['runs']`).
- `useAgentSummaries()` — the agent list without prompts (`['agents','summary']`: `GET /api/agents?view=summary`).
- `useDashboard()` — KPI + awaiting + queue payload (`Dashboard.tsx:12`); staleTime 10s. Refreshed via SSE `counts_changed` / `run_queued` / `run_completed` events (no polling). Drives the empty/populated branch via `data.kpis?.projectCount`.

(`DashboardEmptyState` is presentational; `DashboardPopulated` reads `useSettings` + `useAgents`, and `AgentRoster` and `FleetStrip` read `useActiveRuns`.)

## API endpoints touched
- `GET /api/dashboard` — the composite endpoint backing `useDashboard()` (KPIs, awaiting, queue, and `pipelines` for Running now in one payload — `pipelines` comes from `workflowQueueService.dashboardSummary()`, which counts waiting Tasks instead of sending them, so a large backlog doesn't bloat the home page; `kpis.todaysPass` is still sent but the dashboard no longer renders it). Route handler: `packages/api/src/routes/counts.ts:14`. (Note: historical docs called this `/api/counts/dashboard`; the actual path is `/api/dashboard`.)

## Permissions / guards
- Post-onboarding only (route guard).

## Edge cases / quirks
- Empty state takes over when `(data.kpis?.projectCount ?? 0) === 0`. The loading branch beats both — `isPending || data === undefined` always renders `<BrandedFallback />` first, even if `useSettings` has data ready.
- The "Greeting" pulls just the first word of `owner_name` (`Dashboard.tsx:23-24`).

## Connectivity
- **Pages**: [Projects](02-projects.md) — empty-state CTA opens its New Project modal; [Queue](13-queue.md) — "In motion" rows are the same underlying runs Queue lists; issue detail pages — every awaiting/in-motion row deep-links straight to its entity.
- **Routes**: `GET /api/dashboard` — the only page that consumes this composite endpoint; bundles KPIs + awaiting + in-motion + project count so the home view costs one round-trip and decides empty vs. populated in a single payload.
- **Entities**: aggregates over `task`, `sub_task`, `agent_run`, `notification`. The API's KPI payload also carries `tasks` / `tasksInProgress` (Task counts; formerly `epics` / `storiesInProgress`), which the dashboard doesn't render.

## Coming soon on this page
None.
