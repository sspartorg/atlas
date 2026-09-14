# Workflow Detail (Builder)

**Route:** `/workflows/:id` • **Component:** `packages/web/src/pages/workflows/WorkflowBuilder.tsx` • **Slug:** `workflows`

## Purpose
Design one workflow on a ReactFlow canvas (`@xyflow/react`, lazy chunk) and list its runs. Two tabs via `?tab=`: **Builder** (default) and **Runs**.

## States
- **Loading**: centered spinner.
- **Not found**: "Workflow not found." (or the API message for non-404 errors).
- **Populated**: header + tabs.
- **Phone (< `sm`)**: info alert "The canvas is read-only on a phone…"; palette and inspector hidden, canvas read-only.

## UI elements
**Header** (`WorkflowHeader.tsx`)
- "Workflows" link → `/workflows`; H2 name; **Active / Inactive** pill; "Unsaved changes" when the draft differs from the saved copy.
- Metadata: `{project} · {Per item|Project run} · {trigger} · {Push + PR|Push branch|Pull request|No delivery}`.
- **Save** (green) → `PATCH /api/workflows/:id` with the whole workflow (all settings + graph). Disabled when nothing changed, the name is blank, or client validation fails. On success: toast "Workflow saved". On 400: `details.graph_errors` join the error list and outline their nodes.
- **Run now** (outlined) — disabled with tooltip "Save your changes before running" while dirty. `input_kind=item` → `RunWorkflowDialog`; `none` → `POST /api/workflows/:id/runs` then navigate to the run view.
- **Delete** (trash icon) → `ConfirmActionModal` → `DELETE /api/workflows/:id` → `/workflows`. 409 (live runs) surfaces as a toast.

**Builder tab**
- **Validation list** — `validateWorkflowGraph` (shared) runs on every graph change; errors render in an `Alert` ("Fix before saving") and offending nodes get a dashed error border.
- **Palette** (`NodePalette.tsx`, left): **Owner** and **End** chips, agent search (`SearchTextInput`), one chip per installed agent. Drag onto the canvas to drop at the cursor, or click / Enter to add at the canvas centre (touch path).
- **Canvas** (`WorkflowCanvas.tsx` + `WorkflowNodes.tsx`): dotted background, MiniMap, zoom Controls, fit view on load.
  - **Start** pill (can't be deleted) — `Per item · On item ready` caption; one green `pass` source handle.
  - **Agent** card — accent bar + glyph tile in `accent_color`, name, `cli · model`; target handle left; two source handles right labelled **PASS** (green, 32%) and **FAIL** (red, 70%). Dragging from a handle creates an edge of that kind and **replaces** the handle's previous edge (a node owns one pass and ≤1 fail connection).
  - **Owner** card — "Sent back to you"; target + pass source.
  - **End** pill — delivery label and `→ {child workflow}`; target only.
  - Pass edges solid success colour; fail edges dashed error colour; arrow markers match.
  - Delete / Backspace removes the selected node (and its edges) or edge.
- **Inspector** (`WorkflowInspector.tsx`, right on `lg`, below on `md`): follows the selected node; nothing selected = workflow settings.
  - Start / nothing → `StartInspector`: Name, Description, Project, **Input** cards (item: "Each ready item assigned to this workflow, one at a time" / none: "Runs on the project"), **Trigger** (Manual / On item ready / Scheduled — picking Scheduled seeds `daily` 09:00), schedule presets via shared `SchedulePresetFields` (also used by `AutoFetchScheduleModal`) + Time of day for daily/weekly, **Max loops** (1–20), **Active** switch.
  - Agent → Agent select (swap), CLI / Model / Effort read-only, link "Open agent" → `/agents/:id`, pass/fail explainer.
  - Owner → explanation of parking and resume.
  - End → **Use a worktree** / **Push branch** / **Open pull request** switches (workflow-level `use_worktree` / `push_code` / `raises_pr`) + **Child workflow** select (same project, `input_kind=item`, not itself) + **Test items workflow** select (same choices, "Same as child workflow" by default) for created items with an outgoing `tested_by` link.
- **Unsaved-changes guard** — `useDraftGuard(dirty)`: app navigation asks "Discard draft?", reload warns. A newer server copy (SSE refetch) replaces the draft only when it isn't dirty.

**`RunWorkflowDialog`** — **Ready item** select over the project's ready epics / stories / bugs (from `useIssues({projectId})`), items already queued for this workflow first. **Start run** → `POST /api/workflows/:id/runs {item_id}` → run view. API 400/404/409 messages show inline.

**Runs tab** (`WorkflowRunsTab.tsx`)
- Table: Item (title + mono id, or "Project run"), Status chip (`WORKFLOW_RUN_STATUS_PALETTE`), Started (relative, absolute tooltip), Duration, Pull request link. Row click → `/workflows/:id/runs/:runId`. Empty: "No runs yet…".

## Why these affordances exist
- **Whole-workflow PATCH** — ReactFlow edits the graph as one document and the run needs a frozen snapshot anyway; one save keeps settings and graph consistent.
- **Replace-on-connect** — the graph rules allow exactly one pass edge and at most one fail edge per node, so redrawing a connection is the natural way to reroute.
- **Client validation + server `graph_errors`** — the shared validator catches structure instantly; only the server knows whether referenced agents exist.
- **Run now blocked while dirty** — the engine runs the saved graph, not the draft on screen.

## Hooks used
- `useWorkflow(id)`, `useWorkflows()`, `useUpdateWorkflow`, `useDeleteWorkflow`, `useStartWorkflowRun`, `useWorkflowRuns(id)`
- `useAgents`, `useProjects`, `useIssues({projectId})` (run dialog), `useTabParam`, `useDraftGuard`, `useToast`

## API endpoints touched
- `GET /api/workflows/:id`, `PATCH /api/workflows/:id`, `DELETE /api/workflows/:id`
- `GET /api/workflows` (child workflow select, End node names)
- `GET /api/workflows/:id/runs`, `POST /api/workflows/:id/runs`
- `GET /api/agents`, `GET /api/projects`, `GET /api/issues/tree?project_id=`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- An agent node whose agent isn't installed shows its raw id and "not installed"; saving returns a server graph error for it.
- An End node's child workflow from another project still saves (the API doesn't check) but isn't offered in the select.
- `@xyflow/react/dist/base.css` is the only library stylesheet; all canvas colours come from tokens on the wrapper `sx`, so light and dark themes follow the CSS vars.

## Connectivity
- **Pages**: [Workflows](33-workflows.md) — list; [Workflow Run](35-workflow-run.md) — run rows, Run now; [Agent Detail](16-agent-detail.md) — inspector link.
- **Entities**: `workflow`, `workflow_run`, `agent`.

## Coming soon on this page
None.
