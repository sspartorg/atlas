# Queue

**Route:** `/queue` • **Component:** `packages/web/src/pages/Queue.tsx` • **Slug:** `search_queues`

## Purpose
What each workflow is running, what is parked on me, and which ready Tasks it picks up next (ADR 0015). Work is queued for **workflows**, not agents: a ready Task with `items.workflow_id` is started by that workflow's dispatch, up to `workflows.max_parallel_runs` Task runs at once; a parked run doesn't hold a slot; a Task's sub-tasks run inside its run, so they never appear here on their own.

## Sections
1. **Workflow cards** (`pages/queue/WorkflowQueueCard.tsx`) — one per workflow from `GET /api/workflow-queue`, 1 column (2 from `lg`). Paused workflows are listed too; a project-run (`none`) workflow only while one of its runs is live; sub-workflows never.
2. **Needs a workflow** (`pages/queue/UnassignedTasks.tsx`) — ready Tasks with no `workflow_id`, which nothing will start. Hidden when empty.

The old per-agent cards, agent drawer, "Pause All Agents" and the "Waiting on You" table are gone. Parked runs show on their workflow's card; `in_review` Tasks awaiting my sign-off live on the Dashboard's Awaiting You panel.

## States
- **Loading**: two rounded `Skeleton` cards.
- **Error**: `Alert` "Couldn't load the queue: …".
- **No workflows**: dashed `EmptyState` "No workflows yet" + **Go to workflows** (`/workflows`). The Needs a workflow section still renders under it.
- **Idle card**: "Nothing running or queued. Set a ready Task's workflow to this one to queue it."

## UI elements
**Page header**
- "Queue" (`h2`) and the counter strip (mono): `N running · N queued · N waiting on you · N need a workflow` — sums over the cards plus the unassigned count.
- **Project** select (`All projects` + each project) → refetches with `?project_id=`. The only filter; the status chips went with the agent cards.

**Workflow card**
- Name → `/workflows/:id`; sub-line `project · trigger` (`Scheduled · next <time>` when scheduled).
- **Active / Paused** switch (`aria-label "<name> active"`) → `PATCH /api/workflows/:id {status}`.
- **Running meter** — `running / max_parallel_runs` (mono) + a determinate `LinearProgress` (`aria-label "<name> running slots"`).
- **Running** — each live Task run: Task id + title → `/tasks/:id`, the current step (the node's agent name from `graph_snapshot` via `agentLabel`, or `Sub-tasks` / `Owner` / `Starting` / `Delivering`), **Open run** → `/workflows/:wid/runs/:rid`. A project run shows "Project run" instead of a Task.
- **Waiting on you** — each parked run: Task → `/tasks/:id` (where I reply), `Waiting for you` chip, **Open run**, and its `park_reason`.
- **Queued** — ready Tasks in dispatch order (numbered). **Start now** → `POST /api/workflows/:id/runs {item_id}`, shown only while `running < max_parallel_runs`. On a paused or manual workflow a line explains that these wait for me ("Paused: these wait until you turn it back on." / "Manual: these wait until you start them.").

**Needs a workflow**
- Each Task → `/tasks/:id`, its project, and a workflow picker (`aria-label "Workflow for <id>"`) listing that project's Task workflows → `PUT /api/items/:id/workflow {workflow_id}`. No workflow in the project → **Create a workflow** link (`/workflows`).

Every action toasts on failure and invalidates `['workflow-queue']` on success.

## Why these affordances exist
- **One card per workflow** — parallelism, pausing and ordering are workflow settings now; the card shows exactly what dispatch will do next.
- **Slot meter + Start now only with a free slot** — starting past `max_parallel_runs` by hand would defeat the cap the Owner set.
- **Pause switch on the card** — pausing one misbehaving workflow is the common case; it sits next to what it would stop.
- **Needs a workflow** — a ready Task without a workflow otherwise sits forever with nothing telling me why.

## Modals / drawers
None.

## Hooks used
- `useWorkflowQueue(projectId)` (`['workflow-queue', projectId]`) — no polling. `useSSE` invalidates `['workflow-queue']` on `workflow_run_updated` and `counts_changed`.
- `useProjects`, `useAgents` (step names).
- `useUpdateWorkflow`, `useStartWorkflowRun`, `useSetItemWorkflow` (from `hooks/useWorkflows.ts`).

## API endpoints touched
- `GET /api/workflow-queue?project_id=`
- `PATCH /api/workflows/:id`
- `POST /api/workflows/:id/runs`
- `PUT /api/items/:id/workflow`

## Permissions / guards
- Post-onboarding only. Writes are token-gated like every workflow write.

## Edge cases / quirks
- Queued lists Tasks blocked by a `depends_on` target too, in `updated_at` order; dispatch skips them until the target is done, so the next one to start may not be #1.
- A queued Task on an active `item_ready` workflow with a free slot normally starts within a dispatch tick; **Start now** matters for manual, scheduled and paused workflows.
- The sidenav **Queue** badge (`GET /api/counts` → `queue`) counts the same queued + running Tasks this page lists, across all projects.

## Connectivity
- **Pages**: [Workflows](33-workflows.md), [Workflow detail](34-workflow-detail.md), [Workflow run](35-workflow-run.md), Task detail (`/tasks/:id`).
- **Routes**: `GET /api/workflow-queue` (`services/workflow-queue.ts`).
- **Entities**: `workflow`, `workflow_run`, `task`.

## Coming soon on this page
None.
