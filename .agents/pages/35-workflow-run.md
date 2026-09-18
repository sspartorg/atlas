# Workflow Run

**Route:** `/workflows/:id/runs/:runId` • **Component:** `packages/web/src/pages/workflows/WorkflowRunDetail.tsx` • **Slug:** `workflows`

## Purpose
Watch one workflow run move node-by-node: the run's `graph_snapshot` on a read-only canvas with per-node state, a step timeline, the sub-task runs a Task run started, and Stop / Resume. A sub-task's run (ADR 0015) opens on this same page.

## States
- **Loading**: centered spinner.
- **Not found**: "Workflow run not found."
- **Populated**: header, status banner, canvas + Steps panel (side by side on `lg`, stacked below).

## UI elements
**Header**
- Breadcrumb `Workflows / {workflow_name}` (→ `/workflows/:id?tab=runs`); on a sub-task's run it adds **part of the Task run** → `/workflows/:workflowId/runs/:parent_workflow_run_id` (the page reads only `:runId`).
- H2 item title (Task, sub-task, or "Project run") + run status chip.
- Metadata: item id (links to the item when found in the project's issue tree), started (relative), duration · cost of the run's steps plus its sub-task runs' steps (`total_cost_usd`) · `N loops` when `loop_count > 0` · branch.
- **Resume** (green, only `waiting_for_owner`) → `POST /api/workflow-runs/:id/resume`.
- **Stop** (outlined error, `running` or `waiting_for_owner`) → `POST /api/workflow-runs/:id/stop`. Stopping a sub-task's run stops its whole Task run (they share one branch).
- **Pull request** (outlined) when `pr_url` is set.

**Banner**
- `waiting_for_owner` → warning led by `park_reason`, then "The run is waiting for you. Reply on the item to continue — open {item}." (project runs: "Resume it when you are ready."). A Task run held by a parked sub-task reads `Sub-task <id> is waiting for you: <reason>`; replying on either the sub-task or the Task resumes both.
- `completed` with a PR → success "Delivered — open the pull request".
- `error` → "The run stopped on an error. Check the failed step's log."

**Canvas** (read-only `WorkflowCanvas`)
- Node state from `nodeRunStates(run)` (`pages/workflows/graph.ts`): Start always done; each agent node takes its latest step's status (completed → done / green border + check, error·setup_failed → failed / red + error icon, cancelled → grey + block icon, queued·in_progress → current); `parked_node_id` on a waiting run → parked (amber + hand icon; the warning banner leads with `park_reason`, e.g. a failed checklist or push); `current_node_id` on a running run → current (accent border, pulsing halo, live dot); on a completed run the `current_node_id` (the End) is done. Nodes never reached are dimmed.
- **×N** badge when a node ran more than once (fail loops).
- **Sub-tasks** nodes take their state from `run.children` started at that node (`parent_node_id`): done (cancelled if any child was cancelled) with caption `X of Y sub-tasks done`; the parked / current overlay still applies.

**Steps panel**
- One row per `agent_runs` step, oldest first: status dot, agent name, status, `outcome: {kind}`, summary — reason, `cli · model · {effort} effort` (the step's snapshot), duration, cost.
- Row click → `/agents/:agentId/runs/:runId` (existing run detail with the event viewer / live tail).
- A Task run's own steps don't include its sub-tasks' steps. Below them, **Sub-tasks · X of Y done** lists `run.children` (`ChildRow`: sub-task id, title, run status chip), oldest first; a row opens that child run's view.

## Why these affordances exist
- **Snapshot, not the live graph** — the run follows the graph as it was when it started; editing the workflow mid-run must not redraw history.
- **Resume button besides reply-to-continue** — project-level runs have no item to comment on; the API resume endpoint is their only way forward.

## Hooks used
- `useWorkflowRun(runId)` — `['workflow-run', runId]`; `useSSE` invalidates it on `workflow_run_updated` (also under `parentWorkflowRunId`, so a Task run's view follows its sub-task runs) and on every `agent_status` / `run_completed` / `run_error` (step statuses).
- `useStopWorkflowRun`, `useResumeWorkflowRun` — write the returned detail into the cache.
- `useWorkflows(projectId)` (End delivery label + Sub-tasks node titles), `useAgents`, `useIssues({projectId})` (item link).

## API endpoints touched
- `GET /api/workflow-runs/:id` — `IWorkflowRunDetail`: summary (incl. `parent_workflow_run_id` / `parent_node_id`) + `steps` + `children`
- `POST /api/workflow-runs/:id/stop`, `POST /api/workflow-runs/:id/resume`
- `GET /api/workflows?project_id=`, `GET /api/agents`, `GET /api/issues/tree?project_id=`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- The run summary has no `item_type`, so the item link is resolved through the project's issue tree; an item outside the tree (e.g. archived) renders as plain mono text.
- Owner nodes have no steps; they only light up while parked.

## Connectivity
- **Pages**: [Workflow Detail](34-workflow-detail.md) — Runs tab rows, Run now; [Agent Run Detail](16a-agent-run-detail.md) — step rows; [Task Detail](07-task-detail.md) — the rail's Workflow run chip; [Sub-task Detail](10-sub-task-detail.md).
- **Entities**: `workflow_run`, `agent_run`.

## Coming soon on this page
None.
