# Queue

**Route:** `/queue` • **Component:** `packages/web/src/pages/Queue.tsx` • **Slug:** `search_queues`

## Purpose
Live snapshot of every agent's queue. One card per agent. Click any card to open a side drawer with detailed run info.

## Sections
The page has **2 sections** (not 4):
1. **Agents grid** — `QueueAgentCard` cards, one per agent, filtered by `QueueFiltersBar`. Section header label "AGENTS N" (count of visible summaries).
2. **`QueueWaitingOnYou`** — table/card list of items in a waiting status; only renders when `waitingItems.length > 0`.

There are no "Awaiting Decision", "Active", or "Done" sections.

## States
- **Loading**: skeleton grid (lines 321-337)
- **No results**: filtered set is empty → empty state (lines 338-351)
- **Populated**: 2-column grid of `QueueAgentCard` (lines 352-371)

## UI elements
**Page header**
- "Queue" title
- **Pause All Agents** button (lines 220-236) — calls `handlePauseAll()` (lines 161-175); sets every active agent to `inactive`

**Filters (`QueueFiltersBar`)**
- Multi-select filter chips: running / queued / waiting / idle / failed
- "Live" label (was "Refreshing every 30s") — the page no longer polls; updates arrive via SSE `run_queued`, `agent_status`, `run_completed` events.

**Agent cards (`QueueAgentCard`)**
- Header: agent icon + name
- Status badge (colored dot; blinks if running)
- "Next Run" / "Last Completed" two-column summary
- Up to 3 queued items; "view all" link opens drawer
- Click card body → opens `QueueAgentDrawer`

**`QueueWaitingOnYou` section** (lines 355-359) — only renders if there are waiting items.
- Desktop: 5-column table (ID · Item · Agent Asked · Asked Time · Reply button).
- Mobile (`< md`, via `useIsMobile`): stacked card list — each card has a top row (ID + relative time), title (2-line clamp), project name + status chip, asked-by agent row, and a full-width orange **Reply** CTA (`TOUCH.cta` height).

## Why these affordances exist
- **Pause All Agents** — One-button kill switch for misbehaving loops or demos; faster than walking each agent's toggle.
- **Multi-select status chips** — Overlapping states (running AND failed-previously) need combined views; multi-select replaces a query language.
- **Card click opens drawer (not modal)** — Drawer keeps the queue grid context intact while the Owner inspects one agent.
- **Run now opens RunNowDialog in place** — Pre-fills the picker with the agent's first queued item (`summary.queued[0]`) so the owner can launch the obvious next target without bouncing to `/agents/:id`. The picker is still editable in case the owner wants a different item.
- **Full trace navigates to Agent Detail** — The drawer is a viewer for prompt/config edits.
- **Pause/Resume per agent (drawer)** — Owners usually want to pause one misbehaving agent, not all; the toggle sits beside its diagnostic info for tight cause-effect.

## Modals / drawers
**`QueueAgentDrawer`** (right-side drawer)
- Header: agent icon, name, CLI/model/category/queue count, close button
- Status badge
- **Run now** → opens `RunNowDialog` in place with `preselect` set to `summary.queued[0]` (project_id + type + id); falls back to an empty picker if the queue is empty. The dialog still navigates to `/agents/:id/runs/:runId` on successful trigger.
- **Pause/Resume** → toggles agent status via `useUpdateAgent`
- **Full trace** → navigates to `/agents/:id`
- Currently Executing section — picks the agent's first `in_progress` (or `queued`) `agent_runs` row, looks up the item via `itemsById`, renders the item card + a live terminal block fed by `useRunOutputTail(runId)` (per-drawer SSE subscription on `/api/events`). When no live run exists, renders an idle state ("Idle until <next pass>") or a failure state if the last run errored.
- Next Scheduled section — up to 3 queued runs (clicking an item navigates via `issuePath` for the right detail page)
- Last Completed section — most recent completed/errored run; shows a tail (last 160 chars) of the real `output_text`, not a hardcoded per-agent string

## Hooks used
- `useStories`, `useBugs`, `useAgents`, `useEpics`, `useProjects`
- `useQuery(['runs', 'all', 'queue-page'])` — no polling. Invalidated via SSE `run_queued` / `agent_status` / `run_completed` in `useSSE`.
- `useUpdateAgent`

## API endpoints touched
- `GET /api/run?limit=500`
- `PATCH /api/agents/:id` (pause/resume; invalidates `['agents']`)

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Filters are multi-select (`Set<QueueFilterKey>`); empty set means show all (lines 135-150).
- Each open drawer opens its own `EventSource` against `/api/events` for the live log. Closing the drawer tears the connection down. Trade-off: browsers cap same-origin SSE connections at 6 — for a single-owner app the practical risk is negligible. A shared event-bus refactor would be the right move if a future page needs to live-tail multiple runs simultaneously.
- The drawer's "Run now" and "Full trace" buttons both navigate to `/agents/:id`; there is no inline trigger for a new run from the queue.

## Connectivity
- **Pages**: [Agents](15-agents.md) — drawer "Run now" and "Full trace" both navigate to Agent Detail; issue detail pages — drawer rows for queued/running runs deep-link to the issue.
- **Routes**: `GET /api/run?limit=500` — fat pull of all recent runs; the page groups client-side because grouping logic varies (by status, by agent) and a server-side group would lock the shape.
- **Entities**: `agent_run`, `agent`, `epic` / `story` / `sub_task` / `sub_bug` / `bug` (run target).

## Coming soon on this page
None.
