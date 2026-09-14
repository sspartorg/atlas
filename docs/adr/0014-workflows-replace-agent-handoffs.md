# 0014. Workflows Replace Per-Agent Schedules and Handoffs

**Date:** 2026-09-14
**Status:** Accepted

This ADR doubles as the design spec. Phase plans live under `docs/superpowers/plans/`.

## Context

Today every agent is its own independent system:
- **Schedule:** each agent has its own schedule (`schedule_*`, `cron_expr`).
- **Git flags:** each agent has its own `requires_worktree` / `push_code` / `raises_pr`.
- **Routing:** each agent has its own on-pass/on-fail route in the **Handoffs tab** (`/agents/:id`).

A "chain" is only an item mutation (`assignee_agent_id` + `status=ready`) that the 60s scheduler picks up later. Each run pushes, tears down its worktree, and the next agent re-provisions it from origin. Consequences:
- Nobody can *see* a flow.
- 100 agents are impossible to reason about.
- Steps wait on ticks, and context is lost between agents.
- Every PR-raising agent opens its own PR.

**Goal (organizational discipline, like scrum over thousands of people):** the Owner designs a **Workflow** in a ReactFlow canvas.
- A workflow is a graph of agents executed back-to-back in **one workflow run**: one worktree, one branch, one PR.
- The workflow, not the agent, owns project, input, trigger/schedule, worktree/push/PR and where children go.
- Agents shrink to prompt + memory + checklists + cli/model/effort + settings.
- A workflow can send an item back to the Owner ("not clear") and resume when the Owner answers.
- Workflows chain into other workflows: Planning WF → Dev WF, one PR per story.

### Decisions made with the Owner
| Topic | Decision |
|---|---|
| Execution | Shared worktree for the whole run. Each agent node is its own CLI call (own cli/model), run immediately after the previous one. One push + one PR at End. |
| Input | Declared per workflow on the Start node. `item` means each ready item assigned to the workflow, one run per item. `none` means a project-level run (stack analysis, AI-readiness). |
| Graph | Node types: Start, Agent, Owner, End. Agent nodes have 1 pass edge and ≤1 fail edge; fail edges may loop back. `max_loops` sends the item to the Owner. Strictly sequential, no parallel branches. |
| Fan-out | The End node's `child_workflow_id` routes children created during the run into another workflow. There is no for-each node. |
| Migration | Hard cut: drop the agent schedule, handoff and git flags. No auto-conversion. Ship starter templates. |
| Eval / golden sets | Follow-up project. This plan only records `cli/model/effort/prompt_version/workflow_run_id/node_id` per step so eval can be built later. |
| `packages/shared` | Owner-sanctioned edits for this feature: new workflow types/schemas/SSE events, removal of dropped agent fields. |

## Decision

Workflows own orchestration. A workflow is a graph (Start, Agent, Owner and End nodes; pass and fail edges) that runs its agents back-to-back in one worktree, and delivers one push and one PR. Agents keep only what shapes their behavior: prompt, memory, checklists, cli/model/effort and settings. Per-agent schedules, handoff rules and git flags are removed with no auto-conversion. The rest of this document is the binding design.

### Verified traps the design must handle
1. **The CLI never sees the Outcome Contract.**
   - `spawnCli` discards the built prompt (`agent-runner.ts:1389` `void prompt`). The CLI only reads `.atlas/handoff.md`, which says "route yourself via MCP" (`handoff-assembler.ts:103`).
   - Routing on `atlas-outcome` alone would park every step.
   - The same gap is why memory never reaches the CLI (`prompt-builder.ts:295` goes only into the snapshot; nothing writes `.atlas/self-memory.md`).
2. **`withProjectGitLock` is not re-entrant** (`project-git-lock.ts:25`), and `ensureWorktree` / `pushWorktree` / `openPullRequest` / `cleanupWorktreeAfterPush` each take it internally. The engine must never wrap them in another lock.
3. **`ensureWorktree` Path 1 does `reset --hard` + `clean -fd`** (`worktree-orchestrator.ts:224,518`). Provision exactly once per workflow run, never per step.
4. **Several terminal paths bypass `completeRun`/`errorRun`:**
   - `sweepStuckRuns` (`agent-schedule-registry.ts`)
   - `failOrphanedRuns` / reaper (`main.ts:100,187-230`)
   - `setup_failed` (`agent-runner.ts:2542`)
   - `DELETE /api/run/:id` (`run.ts:295`)
   - the cancelled and no-item early returns in `completeRun` (584, 605)
5. **The reaper pushes and cleans any worktree it finds via `items.worktree_path`.** Workflow runs must call `ensureWorktree({ item: null, branch })` and keep path/branch only on `workflow_runs`.
6. **Outcome parsing happens after the no-item early return** (605 vs 650). Project-level runs never get parsed.
7. **Item lock gaps.** Between steps and during End push/PR, no `agent_runs` row is live, so `agent_runs_one_live_per_item` (migration 003) doesn't protect the item. A live `workflow_runs` row must act as the lock.
8. **`in_progress → done` is not a valid status-machine transition.** The engine writes End status directly, the way the runner already does. The status machine is not changed.
9. **Import cycle** runner → comments → engine → runner. Break it with a dynamic `await import('./workflow-engine.js')` at the runner call site.

## Design

### Data model: migration `035_workflows.ts` (additive)
- **`workflows`**
  - Identity: `id, project_id FK CASCADE (nullable only when input_kind='none' && !use_worktree), name, description, status active|inactive`.
  - Graph: `graph JSONB`.
  - Behavior: `input_kind item|none`, `trigger manual|schedule|item_ready`, `use_worktree, push_code, raises_pr`, `max_loops int default 3`.
  - Schedule: `schedule_preset/schedule_time_of_day/schedule_weekday/cron_expr/next_run_at/last_run_at`, mirroring `project_schedules` so `materializeCron` (`cron-materializer.ts`) and `SchedulePreset` are reused.
- **`workflow_runs`**
  - Identity: `id, workflow_id FK, item_id FK SET NULL, project_id`.
  - Progress: `graph_snapshot JSONB, current_node_id, parked_node_id, loop_count int`.
  - Status: `running|waiting_for_owner|completed|cancelled|error`.
  - Git: `branch, worktree_path, setup_done bool, pr_url`.
  - Times: `started_at, updated_at, finished_at`.
  - Unique partial index on `(item_id) WHERE status IN ('running','waiting_for_owner')`.
- **`agent_runs` new columns:** `workflow_run_id FK SET NULL, node_id, cli, model, effort, prompt_version`. These are filled on insert **and** on the `existingRunId` UPDATE branch.
- **`items` new columns:**
  - `workflow_id FK SET NULL`
  - `created_by_workflow_run_id FK SET NULL`, for child routing from project-level runs. MCP `create_item` reads it from `ATLAS_WORKFLOW_RUN_ID`, which is passed in the CLI env.
- **Graph shape (Zod in shared, `WorkflowGraphSchema` + `validateWorkflowGraph`):**
  - `nodes[{id, type: start|agent|owner|end, agent_id?, child_workflow_id?, position}]`
  - `edges[{id, source, target, kind: pass|fail}]`
  - Rules: exactly 1 start; ≥1 end with no outgoing edges; agent nodes have exactly 1 pass edge and ≤1 fail edge; start and owner nodes have exactly 1 pass edge; every node is reachable from start; **pass edges form a DAG**, so loops only exist via fail edges and `loop_count` counts them. Referenced agents must exist when the graph is saved.
- JSONB rather than node/edge tables because ReactFlow saves whole graphs and runs need a snapshot anyway.
- **Agent delete** returns 409 when any workflow graph references the agent (`graph @> '{"nodes":[{"agent_id":…}]}'`). The engine parks the run if a snapshot references a missing agent.

### Engine: `packages/api/src/services/workflow-engine.ts` (new, event-driven)
- **`startWorkflowRun(workflowId, itemId|null)`**
  1. Check the lock (no live run on the item) and the deps gate (`assertDepsAllDoneForDispatch`, run once).
  2. Branch = `item.worktree_branch ?? atlas/wf/<itemId>`, or `atlas/wf/<runId8>` for project-level runs. Both fit `WORKTREE_BRANCH_RE`.
  3. Call `ensureWorktree({item:null, branch})` once when `use_worktree`.
  4. Item goes `ready → in_progress`.
  5. Spawn the node after Start.
- **`spawnNode(run, node)`** calls the existing `spawnAgentRun` with a new option `workflowRun: {id, nodeId, worktreePath, branch, skipSetup: run.setup_done}` and sets `items.assignee_agent_id` to the node's agent, so Queue and board cards keep working.
- **`onStepFinished(agentRunId)`** reloads the row and returns if it has no `workflow_run_id`:
  - `cancelled` → the workflow run is cancelled.
  - `error` or `setup_failed` → park.
  - `completed` → reuse `decideRunRouting` (`agent-runner-outcome-routing.ts:52`) unchanged: `apply_on_pass` follows the pass edge, `apply_on_fail` follows the fail edge (or parks if there isn't one), `park` parks.
  - Following a fail edge increments `loop_count`. Going past `max_loops` parks.
  - Target is an Owner node → park.
  - Target is an End node → run End.
  - Otherwise spawn the next node **immediately**.
- **Park:**
  - `workflow_runs.status=waiting_for_owner`, `parked_node_id` set.
  - Item `waiting_for_info`, assignee null, plus a comment giving the reason.
  - Worktree is kept.
  - One external notification.
- **Resume**, via a rewrite of `resumeParkedItem` (`comments.ts:19`):
  - If the item has a parked workflow run, set the item to `in_progress` and the run to `running` inside the transaction.
  - After the transaction commits (`comments.ts:~199`), parked on an Owner node → follow its pass edge; parked on an agent node → re-run that node and reset `loop_count`.
  - Project-level runs have no item, so they resume with `POST /api/workflow-runs/:id/resume`.
- **End:**
  - If `push_code`: make a safety commit of anything uncommitted, then `pushWorktree`.
  - If `raises_pr`: `openPullRequest` (already handles `alreadyExists`) and store the result as an `item_external_links` row plus `workflow_runs.pr_url`.
  - `cleanupWorktreeAfterPush`.
  - Item → `in_review` if a PR was opened, else `done` (direct write).
  - Route children to `child_workflow_id` with `workflow_id` set and `status ready`. Children are matched by `parent_id=item_id AND created_at>=started_at`, or `created_by_workflow_run_id`. Then kick the dispatch tick so the child workflow starts without waiting 60s.
  - Send one notification.
- **Stop:** `POST /api/workflow-runs/:id/stop` stops the live step and marks the run cancelled. It pushes if `push_code`, cleans up, opens no PR, and sets the item to `waiting_for_info`. Stopping or deleting a step's run via `run.ts` also cancels its parent workflow run.
- **Reconcile:** `reconcileWorkflowRuns()` joins the existing 60s tick. It parks any `running` workflow run with no live `agent_runs` row and `updated_at` older than 5 min. This covers traps 4 and 5, including an API restart.
- **Dispatch tick:** replaces agent dispatch in `tickAgentScheduler`.
  - `trigger=item_ready` workflows: take the oldest `ready` item with that `workflow_id`, but only if the workflow has **no `running` run**. Parked runs don't block the queue, so one unanswered question doesn't stall the others.
  - `trigger=schedule`: when `next_run_at` is due, start one project-level run, or drain the item queue sequentially.
  - Next fire time uses the existing `cron-materializer.ts` (`materializeCron`) + croner.

### Runner changes: `agent-runner.ts`, minimal diff
- **`spawnAgentRun`:**
  - When `opts.workflowRun` is set, skip the deps gate, the branch-fallback + `ensureWorktree` block (2137-2227) and the item `ready→in_progress` txn (2419-2465). Use the provided `worktreePath` as cwd instead. Non-workflow runs keep the temp dir.
  - Skip setup when `skipSetup`. On setup failure, notify the engine instead of rolling the item back.
  - Pass `ATLAS_WORKFLOW_RUN_ID` in the env.
- **`finalizeAfterCli`:** delete the push/PR/cleanup block (1672-1854) and `shouldOpenPullRequest`. Only the engine owns git delivery now, which also fixes cancelled steps pushing and deleting the shared worktree.
- **`completeRun`:**
  - Move `persistRunOutcome` above the no-item return.
  - Delete rounds, self-routing and on-pass/on-fail/park routing (641-798).
  - Call `notifyStep(runId)` at **every** exit.
  - Gate per-step Owner notifications on `!workflow_run_id`.
- **`errorRun`:** delete `incrementRound` and the item status/assignee writes (987-1040), and call `notifyStep`.
- **Also call `notifyStep`** from `sweepStuckRuns`, the `setup_failed` branch and `DELETE /api/run/:id`. The `main.ts` reaper skips push/cleanup for rows that have a `workflow_run_id`.
- **Delivery fix in `worktree-stage.ts:108`:** replace `includeHandoff` with writing `.atlas/outcome.md` (from `renderRunOutcomeContract`, `prompt-builder.ts:330`) and `.atlas/self-memory.md` (the memory section). Update the preamble and the Copilot trigger to read `outcome.md` instead of `handoff.md`. `simulateRun` (1165) appends an `atlas-outcome: done` block so AI-disabled e2e runs advance.
- **Re-key gates on `issueId != null`** instead of `requires_item`: `claudeIsolationArgs` (1263), preamble (2346), `commands-assembler.ts:226`.
- **MCP `update_item`:** `change_status` / `assign` from an agent return 409 ("workflow owns routing — emit your atlas-outcome") while a live workflow run holds the item.
- **`current-task.md`** (`current-task-writer.ts`) must include the latest Owner comments so a resumed node sees the answer.

### API routes: `routes/workflows.ts` (new)
- `GET/POST /api/workflows`
- `GET/PATCH/DELETE /api/workflows/:id`: PATCH validates the graph and recomputes `next_run_at`.
- `POST /api/workflows/:id/runs`: manual start, body `{item_id?}`.
- `GET /api/workflows/:id/runs`
- `GET /api/workflow-runs/:id`: includes step `agent_runs`.
- `POST /api/workflow-runs/:id/stop|resume`
- `PATCH /api/items/:id` accepts `workflow_id`.
- `POST /api/workflows/from-template {template_id, project_id}`: installs any missing catalog agents via `marketplaceService.install`, then creates the workflow.
- `POST /api/run`: item-attached ad-hoc runs are removed, project-level/test runs stay. Re-run starts the workflow.
- `generate-ai-scaffold` (`projects.ts:404`) starts a run of the project's AI-readiness workflow, creating it from template if it's missing.
- SSE `workflow_run_updated {workflowRunId, status, current_node_id}`, added to `SSEEvent` in shared.

### Web: `@xyflow/react` (new dep), lazy-loaded route to respect the chunk budget (ADR 0013)
- **Sidenav:** "Workflows" is first in the Agents group (`Sidenav.tsx:61`, `MoreSheet.tsx`).
- **`/workflows`:** card list showing name, project, trigger/next run, last run status. "New workflow" offers blank or template.
- **`/workflows/:id` builder** (`pages/Workflows/WorkflowBuilder.tsx`):
  - **Left palette:** installed agents, draggable (reuses `useAgents`), plus Owner and End nodes.
  - **Center:** ReactFlow canvas. Agent nodes use `accent_color`/`glyph` and have two source handles, pass (success palette) and fail (error palette).
  - **Right inspector:** Start node → project, input kind, trigger and schedule (reuse `AutoFetchScheduleModal`'s preset controls); agent node → cli/model read-only plus a link to the agent; End node → worktree/push/PR, child workflow.
  - **Save** runs the shared validator client-side and shows errors on the offending nodes.
  - Colors come from `ATLAS_PALETTE` CSS vars used whole, with no alpha suffix. Only `@xyflow/react/dist/base.css` is imported, as the single allowed library stylesheet (noted in `packages/web/AGENTS.md`).
- **Tabs:** Builder | Runs.
- **`/workflows/:id/runs/:runId`:** the same canvas read-only, with node state highlighting (done/current/failed/visit count), plus a step timeline. Clicking a step opens the existing `AgentRunDetail` / `RunEventViewer`, with a Stop / Resume button. Live updates via `useSSE` invalidating `['workflow-run', id]`.
- **Item detail:** the "Assign" control picks a workflow (Owner or workflow) and shows a link to the active run.
- **Hooks and API:** `hooks/useWorkflows.ts`, plus an `api.workflows` / `api.workflowRuns` section in `api/api.ts`.

### Hard cut: migration `036_drop_agent_routing.ts` + deletions
- **Drop agent columns:** `schedule_*`, `cron_expr`, `next_run_at`, `last_run_at`, `requires_item`, `requires_worktree`, `push_code`, `raises_pr`, `concurrent_runs`, `max_rounds`, `handoff_prompt_md`.
- **Drop tables:** `agent_handoff_rules`, `marketplace_agent_handoffs`, `agent_round_counts`.
- **Keep:** checklists (the agent's quality gate feeding `outcome_checklist`), `kind_slug`, `settings_json`.
- **Delete, API:** `agent-handoff.ts`, `agent-rounds.ts`, `agent-self-routing.ts`, `handoff-assembler.ts`, `agent-dispatcher.ts` (move `findLiveRunOnItem` first) and their tests; the freedom/agent-slot code in `agent-schedule-registry.ts:204-420` (`computeNextAgentSlot`, `decideFreedomDispatch`); `resetRoundsForIssue` in `routes/{stories,bugs,epics}.ts`; `scripts/extract-seeds-to-catalog.ts`.
- **Delete, web:** `HandoffsTab*`, `ResetRoundsPopover.tsx`, `useMarketplacePairing.ts`; the schedule UI in `OverviewTabContent.tsx` + `agentViewModel.ts` slot helpers; handoff sections in `MarketplaceAgentDetail.tsx` / `AcceptUpgradeModal.tsx`; round UI in item detail pages.
- **Edit, shared:** `IAgent`, marketplace manifest types, agent Create/Update schemas (`schemas/index.ts:100-285`).
- **Edit, MCP:** `tools/agents.ts:41-64`, `tools/items.ts` descriptions.
- **Catalog (16 agents):**
  - Strip the dropped fields from `manifest.json` and delete `handoff_rules.json` (`catalog-loader.ts`, `agent-bundle.ts`, `marketplace.ts`, `seed.ts:840`).
  - Rewrite the "assign / change_status / hand off / raises_pr / push" instructions in `prompt.md` for po-writer, po-reviewer (keep creating children, drop assigning them), architect(+reviewer), coder, code-reviewer, qa-writer(+reviewer), automation(+reviewer), ai-readiness, jira-to-epic, knowledge-base. Every prompt instead ends with "emit your atlas-outcome".
  - Fix the constitution `FORBIDDEN_TOOLS_SECTION` (`prompt-builder.ts:158-251`): "the workflow pushes and opens the PR".
- **Templates:** `packages/api/src/marketplace/workflows/*.json`:
  - `planning`: epic → PO Writer ⇄ PO Reviewer → End(child → dev)
  - `dev`: Architect ⇄ Architect Reviewer → Coder ⇄ Code Reviewer → End(push+PR)
  - `ai-readiness`: single node, input none, push+PR
  - Keeping today's QA twin fan-out: MCP `create_item` accepts an optional `workflow_id`, so PO Reviewer's prompt can route `[QA]` twins to a QA workflow explicitly. At End, children that already have a `workflow_id` keep it, and the rest get `child_workflow_id`. Children are created `draft` during the run and all flip to `ready` at End.

### Docs (same change as each phase, per AGENTS.md)
- New ADR `docs/adr/0014-workflows-replace-agent-handoffs.md` (this design).
- New `.agents/pages/NN-workflows.md` + `NN-workflow-run.md`.
- Update `.agents/{README,routes-map,data-model,api-surface,architecture,swarm-architecture,freedom-agents,glossary,mcp}.md` and pages 16 (agent detail, drop Handoffs tab) / 15 / 27 / 28.
- `AGENTS.md` domain rules: "Agent escalation constraint" becomes "Workflows escalate only to the Owner; items are assigned to workflows".

## Phases (each a PR, main green after each)
1. **Additive schema + shared:** migration 035, shared types/Zod graph schema + validator tests, runner fills `cli/model/effort/prompt_version`. No behavior change.
2. **Delivery fixes:** `.atlas/outcome.md` + `.atlas/self-memory.md`, `simulateRun` outcome block, persist the outcome before the no-item return, re-key gates on `issueId`. Useful on its own for the current chain.
3. **Engine + routes:** `workflow-engine.ts`, the `workflowRun` spawn option, `notifyStep` hooks at every terminal path, reconcile sweep, reaper exclusion, workflow-run lock, the resume branch in comments, the MCP 409 guard, SSE. Old routing still runs for items without `workflow_id`.
4. **Web:** Workflows list, ReactFlow builder, run view, item workflow picker, templates endpoint.
5. **Hard cut** (one PR, mostly deletions): migration 036, remove old routing/scheduling/handoff code + UI, catalog rewrite, `generate-ai-scaffold` via workflow.
6. **Docs + e2e sweep:** ADR, `.agents/`, e2e specs (`tabs/agent-detail.spec.ts`, `flows/walk-detail-pages.spec.ts`, `forensic/*`, `perf/baseline.spec.ts` + `floors.json`, `flows/navigate-sidenav.spec.ts`, `sdlc-full-chain`, `run-now-dialog`, `item-lock-conflict`). Docs for each phase ship with that phase; this phase catches the rest.

Implementation runs in a git worktree branch per phase. Parallel api test agents need their own test DB (known contention).

## Verification
- **Shared:** vitest for `validateWorkflowGraph`. Cases: pass-cycle rejected, fail-loop allowed, unreachable node, missing pass edge, end with outgoing edge.
- **API unit/integration** (`pnpm --filter @atlas/api test`), engine tests driving `onStepFinished` with seeded `agent_runs` rows:
  - pass chain → End pushes/PRs once (mock `worktree-orchestrator`)
  - fail loop → `loop_count` → park at `max_loops`
  - `asked_question` → park → Owner comment → same node re-runs
  - Owner node → resume follows pass edge
  - cancelled step → run cancelled, no PR
  - reconcile parks orphaned runs
  - End routes children to child workflow as `ready`
  - item_ready tick skips workflows with a `running` run but not a `waiting_for_owner` one
  - MCP `assign` returns 409 during a live run
  - agent delete returns 409 when referenced
- **Migrations:** `migrations.test.ts` + `migrations-rollback.test.ts` for 035/036.
- **End-to-end on dev** (ports 4100/4101, sandbox project), AI disabled then enabled:
  1. Create the `dev` workflow from template in the builder.
  2. Assign a story.
  3. Watch the run view advance node-by-node live with no 60s gaps.
  4. Confirm one branch `atlas/wf/<id>` and one PR.
  5. Force a reviewer fail to see the loop, then an `asked_question` to see the park, reply by comment, and see it resume.
  6. Run `planning` → children appear in `dev`'s queue and start automatically.
- **Web:** `pnpm --filter @atlas/web test`, typecheck, bundle budget script (`scripts/check-bundle-budget.mjs`), updated Playwright specs.

## Consequences

- You can see the whole flow, and agents no longer need to know about each other. Adding the 100th agent doesn't make routing harder to follow.
- Steps chain with no 60s scheduler wait, share one worktree, and deliver one PR per workflow run instead of one per PR-raising agent.
- Hard cut: existing handoff chains and agent schedules stop working at phase 5. The Owner rebuilds them as workflows, starting from the shipped templates.
- New dependency `@xyflow/react` in `@atlas/web`, lazy-loaded to stay inside the initial-chunk budget (ADR 0013). The total-bundle budget in `packages/web/scripts/check-bundle-budget.mjs` rose 830 → 880 KB gz to absorb it (see Implementation notes).
- Each step records `cli/model/effort/prompt_version`, which unlocks golden-set evaluation and model comparison as a follow-up.
- The engine owns routing: agents lose MCP `assign`/`change_status` on items held by a live workflow run.

## Skipped (add when needed)
- Parallel branches / fan-in: add when a real flow needs two steps at once, which also needs per-branch worktrees.
- For-each node inside one run: add if one PR per epic becomes a requirement.
- Golden sets / model comparison: the next project, built on the per-step `cli/model/prompt_version/outcome/cost` columns.
- Auto-layout (dagre/elk): nodes are placed by hand and templates ship positions.

## Implementation notes (2026-09-14)

Where the shipped code differs from the plan above. The code wins; `.agents/` documents the code.

- **Delivery.** All six phases landed on one branch (`worktree-workflows-phase-1`) rather than six PRs.
- **Per-child routing is not implemented.** MCP `create_item` has no `workflow_id`, and the PO Reviewer prompt does not route `[QA]` twins. End's `child_workflow_id` routes every child (dev stories and `[QA]` twins alike) as `ready`; a child that already has a `workflow_id` (set by the Owner via `PUT /api/items/:id/workflow`) keeps it. The `qa` template (QA Writer ⇄ QA Reviewer → Automation ⇄ Automation Reviewer) is shipped and started per item. Children are matched in `draft` or `ready`; nothing forces them to `draft` during the run.
- **The routing guard is HTTP-wide, not MCP-only.** `services/workflow-lock.ts` is a global Fastify `preHandler` that 409s `PATCH /api/{epics,stories,bugs,sub-tasks,sub-bugs}/:id/{status,assign}`, so it covers the UI and MCP (which calls the same routes). It locks only while the run is `running`; a parked (`waiting_for_owner`) run doesn't lock, so the Owner can move a parked item by hand.
- **Agent delete is blocked while a workflow uses the agent** (`DELETE /api/agents/:id` → 409 naming the workflows, via `workflowsService.workflowsUsingAgent`). The engine still parks a run whose snapshot names a missing or inactive agent.
- **Reconcile threshold is 10 min**, not 5 (`WORKFLOW_RECONCILE_AFTER_MS`), so a slow End push + PR isn't mistaken for a hang.
- **`ATLAS_WORKFLOW_RUN_ID` is not passed to the CLI.** `items.ts::createItem` stamps `created_by_workflow_run_id` from the reporter agent's live workflow step (`agent_runs` in `queued`/`in_progress` with a `workflow_run_id`), so an agent must pass its `agent_id` to `create_item` for its children to be routed from a project-level run.
- **Item assignment** is `PUT /api/items/:id/workflow { workflow_id | null }`, not a `workflow_id` field on `PATCH /api/items/:id`. Extra routes: `GET /api/workflows/templates`, `GET /api/items/:id/workflow-runs`.
- **`POST /api/run`** rejects any `issue_type` / `issue_id` with 400 and runs only ad-hoc no-item runs (temp dir, no routing). It does not start a workflow.
- **SSE payload** is `workflow_run_updated { workflowId, workflowRunId, workflowRunStatus, nodeId, issueId? }`.
- **Reaper.** `main.ts` `failOrphanedRuns` no longer pushes or cleans worktrees for any run; it flips orphans to `error` and calls `onStepFinished`.
- **Deps gate** runs once in `startWorkflowRun`; `spawnAgentRun` no longer checks it.
- **Templates.** End nodes reference child workflows as `template:<id>`, resolved at `from-template` time to that template's workflow **by name in the same project**, created from its template when the project doesn't have it yet. `planning` also routes a PO Writer fail to an Owner node, and runs with a worktree but no push or PR. `generate-ai-scaffold` finds the project's AI Readiness workflow by template name before creating one.
- **Scheduled item workflows** drain the items that were `ready` at the last fire, one per tick; later arrivals wait for the next fire.
- **`workflow_runs.status = 'error'`** is allowed by the CHECK but never written; every failure parks, and `workflow_runs.park_reason` says why (the run view banner and the park comment show it).
- **Delivery failures park at End.** A failed push or PR leaves the worktree in place and parks the run on the End node; resuming (button or Owner reply) re-runs delivery, so fixing a credential or turning push off in the builder and resuming finishes the run. Found in the UI walkthrough: without this the item was marked done with its work unpushed.
- **Template child references create the child.** `template:dev` on Planning's End creates the Development workflow when the project doesn't have it yet (it no longer silently drops the link).
- **Simulated runs pass their checklist.** With `ATLAS_AI_ENABLED` off, the simulated outcome reports every `agent_checklists` row as passed; otherwise strict mode turns `done` into a fail for agents that ship required rows and no AI-disabled workflow can finish.
- **Web bundle budget.** The total budget in `packages/web/scripts/check-bundle-budget.mjs` was raised 830 → 880 KB gz: `@xyflow/react` is a 53.9 KB gz lazy chunk plus ~12.5 KB of workflow pages (measured total 863.9 KB). The initial chunk is unchanged (231.8 KB, budget 264 KB) because the canvas loads only on `/workflows` routes.
- **`IAgentRun`** gained `workflow_run_id` + `node_id` (returned by `GET /api/run/:id` and the run lists); the `cli` / `model` / `effort` / `prompt_version` snapshot stays on the row, surfaced through `IWorkflowRunStep`.
- **`current-task.md`** needed no change: it already renders the full comment thread, so a resumed step sees the Owner's answer.
