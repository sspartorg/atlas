# Workflow Run

**Route:** `/workflows/:id/runs/:runId` • **Component:** `packages/web/src/pages/workflows/WorkflowRunDetail.tsx` • **Slug:** `workflows`

## Purpose
Watch one workflow run move node-by-node: the run's `graph_snapshot` on a read-only canvas with per-node state, a step timeline, and Stop / Resume.

## States
- **Loading**: centered spinner.
- **Not found**: "Workflow run not found."
- **Populated**: header, status banner, canvas + Steps panel (side by side on `lg`, stacked below).

## UI elements
**Header**
- Breadcrumb `Workflows / {workflow_name}` (→ `/workflows/:id?tab=runs`).
- H2 item title (or "Project run") + run status chip.
- Metadata: item id (links to the item when found in the project's issue tree), started (relative), duration · total step cost · `N loops` when `loop_count > 0` · branch.
- **Resume** (green, only `waiting_for_owner`) → `POST /api/workflow-runs/:id/resume`.
- **Stop** (outlined error, `running` or `waiting_for_owner`) → `POST /api/workflow-runs/:id/stop`.
- **Pull request** (outlined) when `pr_url` is set.

**Banner**
- `waiting_for_owner` → warning "The run is waiting for you. Reply on the item to continue — open {item}." (project runs: "Resume it when you are ready.").
- `completed` with a PR → success "Delivered — open the pull request".
- `error` → "The run stopped on an error. Check the failed step's log."

**Canvas** (read-only `WorkflowCanvas`)
- Node state from `nodeRunStates(run)` (`pages/workflows/graph.ts`): Start always done; each agent node takes its latest step's status (completed → done / green border + check, error·setup_failed → failed / red + error icon, cancelled → grey + block icon, queued·in_progress → current); `parked_node_id` on a waiting run → parked (amber + hand icon); `current_node_id` on a running run → current (accent border, pulsing halo, live dot); on a completed run the `current_node_id` (the End) is done. Nodes never reached are dimmed.
- **×N** badge when a node ran more than once (fail loops).

**Steps panel**
- One row per `agent_runs` step, oldest first: status dot, agent name, status, `outcome: {kind}`, summary — reason, `cli · model`, duration, cost.
- Row click → `/agents/:agentId/runs/:runId` (existing run detail with the event viewer / live tail).

## Why these affordances exist
- **Snapshot, not the live graph** — the run follows the graph as it was when it started; editing the workflow mid-run must not redraw history.
- **Resume button besides reply-to-continue** — project-level runs have no item to comment on; the API resume endpoint is their only way forward.

## Hooks used
- `useWorkflowRun(runId)` — `['workflow-run', runId]`; `useSSE` invalidates it on `workflow_run_updated` and on every `agent_status` / `run_completed` / `run_error` (step statuses).
- `useStopWorkflowRun`, `useResumeWorkflowRun` — write the returned detail into the cache.
- `useWorkflows(projectId)` (End delivery label + child name), `useAgents`, `useIssues({projectId})` (item link).

## API endpoints touched
- `GET /api/workflow-runs/:id`
- `POST /api/workflow-runs/:id/stop`, `POST /api/workflow-runs/:id/resume`
- `GET /api/workflows?project_id=`, `GET /api/agents`, `GET /api/issues/tree?project_id=`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- The run summary has no `item_type`, so the item link is resolved through the project's issue tree; an item outside the tree (e.g. archived) renders as plain mono text.
- Owner nodes have no steps; they only light up while parked.

## Connectivity
- **Pages**: [Workflow Detail](34-workflow-detail.md) — Runs tab rows, Run now; [Agent Run Detail](16a-agent-run-detail.md) — step rows; item detail pages — the rail's Workflow run chip ([Story](09-story-detail.md), [Epic](07-epic-detail.md), [Bug](11-bug-detail.md)).
- **Entities**: `workflow_run`, `agent_run`.

## Coming soon on this page
None.
