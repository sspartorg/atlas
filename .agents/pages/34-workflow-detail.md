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
- Metadata: `{project} · {Per Task|Project run|Sub-task workflow} · {trigger} · {delivery}` — delivery is `Push + PR` / `Push branch` / `Push to default branch` / `No delivery`, or `Back to the Task` for a sub-workflow (`deliveryLabel`, `labels.ts`).
- The trigger segment comes from `triggerLabel()` (`labels.ts`) and spells the cadence out: `Manual`, `On item ready`, or `Scheduled · every hour · next 14:00`. On a Task / project workflow it is a **button** opening `WorkflowScheduleDialog` — the trigger and cadence without going to the canvas and selecting Start. The dialog edits the **draft** through the builder's `onSettings`, so its change is persisted by the header's **Save** like any other edit (no separate PATCH, no fight with the unsaved-changes guard). It renders flat text when the header gets no `onScheduleChange`, and is hidden for a sub-workflow (forced `manual`).
- **Save** (green) → `PATCH /api/workflows/:id` with the whole workflow (all settings + graph). Disabled when nothing changed, the name is blank, or client validation fails. On success: toast "Workflow saved". On 400: `details.graph_errors` join the error list and outline their nodes.
- **Run now** (outlined) — disabled with tooltip "Save your changes before running" while dirty. `input_kind=item` → `RunWorkflowDialog`; otherwise `POST /api/workflows/:id/runs` then navigate to the run view. On a sub-workflow that POST is refused (400 "A sub-task workflow runs only from a Task workflow's Sub-tasks step") and toasts.
- **Export** (outlined, download icon) — a link to `GET /api/workflows/:id/export`: a zip of this workflow, the sub-workflows its Sub-tasks steps run and every agent they use (layout in `api-surface.md` → Workflow bundles). Disabled with tooltip "Save your changes before exporting" while dirty — the bundle is the saved workflow. Import it on another project or Atlas from **Workflows → Import**.
- **Publish** (outlined, storefront icon) → `POST /api/workflows/:id/publish`: stores that same bundle as a Marketplace entry (Workflow Marketplace → **Published by you**). Toast "Published to the marketplace" the first time, "Updated in the marketplace" when it replaces this workflow's existing entry (the response's `published_at === updated_at`); failure toasts "Could not publish workflow". Disabled with tooltip "Save your changes before publishing" while dirty, and while publishing ("Publishing…"). The mutation lives in `WorkflowHeader` itself (`usePublishWorkflow`).
- **Delete** (trash icon) → `ConfirmActionModal` → `DELETE /api/workflows/:id` → `/workflows`. 409 (live runs, or a sub-workflow another workflow's Sub-tasks step uses) surfaces as a toast.

**Builder tab**
- **Validation list** — `validateWorkflowGraph(graph, input_kind)` (shared) runs on every graph or input change; errors render in an `Alert` ("Fix before saving") and offending nodes get a dashed error border.
- **Palette** (`NodePalette.tsx`, left): **Owner**, **Sub-tasks** (only when `input_kind='item'`, `showSubtasks`) and **End** chips, agent search (`SearchTextInput`), one chip per installed agent. Drag onto the canvas to drop at the cursor, or click / Enter to add at the canvas centre (touch path).
- **Canvas** (`WorkflowCanvas.tsx` + `WorkflowNodes.tsx`): dotted background, MiniMap, zoom Controls, fit view on load. The flow runs **top to bottom**; node positions anchor the node's top centre (`nodeOrigin [0.5, 0]`), so cards and pills in one column line up. Edges are right-angle `smoothstep` lines (also while drawing).
  - Every node but Start takes input on its **top** (`in`) and has a faint side entry on its **right** (`loop`, full opacity on hover). `toFlow` routes an edge into the target's `loop` when the target sits above the source (a reviewer's fail loop, an Owner's answer), else into `in` — loops run down the side instead of crossing the main line. Handle choice is by position only; it isn't saved.
  - **Start** pill (can't be deleted) — `{input} · {trigger}` caption (e.g. `Per Task · On item ready`); one green `pass` source handle at the bottom.
  - **Agent** card — accent bar + glyph tile in `accent_color`, name, `cli · model · effort`; green `pass` source at the bottom, red `fail` source on the right (labelled **FAIL**). Dragging from a handle creates an edge of that kind and **replaces** the handle's previous edge (a node owns one pass and ≤1 fail connection).
  - **Owner** card — "Sent back to you"; pass source at the bottom.
  - **Sub-tasks** card — checklist glyph, title = the sub-workflow's name (else "Sub-tasks"), caption `Labelled "<label>"` or `All other sub-tasks`; one pass source at the bottom (no fail handle).
  - **End** pill — delivery label; inputs only.
  - Pass edges solid success colour; fail edges dashed error colour; arrow markers match.
  - Delete / Backspace removes the selected node (and its edges) or edge.
- **Inspector** (`WorkflowInspector.tsx`, right on `lg`, below on `md`): follows the selected node; nothing selected = workflow settings.
  - Start / nothing → `StartInspector`: Name, Description, Project, **Input** cards — **Per Task** ("Each ready Task assigned to this workflow, on its own branch"), **Project run** ("Runs on the project"), **Sub-task workflow** ("Runs inside a Task workflow's Sub-tasks step, one sub-task at a time"; picking it also sets `trigger='manual'`). **Trigger** (Manual / On item ready / Scheduled — Scheduled seeds `daily` 09:00) + schedule presets via shared `SchedulePresetFields` + Time of day for daily/weekly — **hidden for a sub-task workflow**. These fields live in `WorkflowTriggerFields.tsx`, shared with the header's `WorkflowScheduleDialog` so the two can't drift. **Tasks in parallel** (`max_parallel_runs`, 1–10, Per Task only; "Each Task runs on its own branch; its sub-tasks always run one at a time"). **Max loops** (1–20), **Active** switch.
  - Agent → Agent select (swap), CLI / Model / Effort read-only, link "Open agent" → `/agents/:id`, pass/fail explainer.
  - Owner → explanation of parking and resume.
  - Sub-tasks → **Sub-workflow** select (the project's `input_kind='sub_task'` workflows; helper "Create a workflow with the Sub-task workflow input first" when none), **Label** (≤40 chars; "Only sub-tasks with this label. Empty: every sub-task no other Sub-tasks step claims"), **Open <sub-workflow>** link, and an explainer: open sub-tasks run one at a time, oldest first, on the Task's branch, then the pass connection; a sub-task that needs you pauses the whole Task.
  - End on a Task / project workflow → **Use a worktree** switch + **Delivery** cards writing workflow-level `push_code` / `raises_pr` / `push_to_default`: **Push + pull request** (true / true / false), **Push branch** (true / false / false), **Push to the default branch** (true / false / true — no review), **Keep local** (all false — the worktree and its branch are left on disk; they are the only copy of the work).
  - End on a sub-task workflow → explainer only: the sub-task goes to review, its work stays on the Task's branch, and the Task workflow delivers once every sub-task is done.
- **Unsaved-changes guard** — `useDraftGuard(dirty)`: app navigation asks "Discard draft?", reload warns. A newer server copy (SSE refetch) replaces the draft only when it isn't dirty.

**`RunWorkflowDialog`** — **Ready task** select over the project's `ready` Tasks (`tree.tasks` from `useIssues({projectId})`), Tasks already queued for this workflow first ("(queued here)"); empty copy "No ready tasks in this project. Move a task to Ready to run it here." **Start run** → `POST /api/workflows/:id/runs {item_id}` → run view. API 400/404/409 messages show inline.

**Runs tab** (`WorkflowRunsTab.tsx`)
- Table: Item (Task / sub-task title + mono id, or "Project run"), Status chip (`WORKFLOW_RUN_STATUS_PALETTE`), Started (relative, absolute tooltip), Duration, Pull request link. Row click → `/workflows/:id/runs/:runId`. Empty: "No runs yet…".

## Why these affordances exist
- **Whole-workflow PATCH** — ReactFlow edits the graph as one document and the run needs a frozen snapshot anyway; one save keeps settings and graph consistent.
- **Replace-on-connect** — the graph rules allow exactly one pass edge and at most one fail edge per node, so redrawing a connection is the natural way to reroute.
- **Client validation + server `graph_errors`** — the shared validator catches structure instantly; only the server knows whether referenced agents exist and whether a Sub-tasks step's sub-workflow exists, is `input_kind='sub_task'` and belongs to the same project.
- **Delivery as one choice** — the three flags only make sense in four combinations; `push_to_default` needs push on and PR off (the API 400s otherwise).
- **Run now blocked while dirty** — the engine runs the saved graph, not the draft on screen.
- **Export / Publish blocked while dirty** — same reason: the bundle is built from the saved row.

## Hooks used
- `useWorkflow(id)`, `useWorkflows()`, `useUpdateWorkflow`, `useDeleteWorkflow`, `useStartWorkflowRun`, `useWorkflowRuns(id)`, `usePublishWorkflow` (header)
- `useAgents`, `useProjects`, `useIssues({projectId})` (run dialog), `useTabParam`, `useDraftGuard`, `useToast`

## API endpoints touched
- `GET /api/workflows/:id`, `PATCH /api/workflows/:id`, `DELETE /api/workflows/:id`
- `GET /api/workflows` (Sub-tasks step select + node titles)
- `GET /api/workflows/:id/runs`, `POST /api/workflows/:id/runs`
- `GET /api/workflows/:id/export` (Export link), `POST /api/workflows/:id/publish`
- `GET /api/agents`, `GET /api/projects`, `GET /api/issues/tree?project_id=`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- An agent node whose agent isn't installed shows its raw id and "not installed"; saving returns a server graph error for it.
- The Sub-tasks chip is hidden unless the Start input is **Per Task**; switching an existing graph away from Per Task leaves its Sub-tasks nodes flagged by the validator ("Only workflows that run on a Task can have a Sub-tasks step").
- A Sub-tasks step whose sub-workflow is missing shows the plain "Sub-tasks" title; saving returns a server graph error for it.
- `@xyflow/react/dist/base.css` is the only library stylesheet; all canvas colours come from tokens on the wrapper `sx`, so light and dark themes follow the CSS vars.

## Connectivity
- **Pages**: [Workflows](33-workflows.md) — list; [Workflow Run](35-workflow-run.md) — run rows, Run now; [Agent Detail](16-agent-detail.md) — inspector link.
- **Entities**: `workflow`, `workflow_run`, `agent`.

## Coming soon on this page
None.
