# Swarm architecture

The **autonomous SDLC swarm** is Atlas's long-term fleet vision: one agent per phase of the software lifecycle plus the product-lifecycle adjacencies — discovery, build, review, ship, monitor, learn. This doc captures the strategic shape of that fleet. How agents are chained is a **workflow** concern (ADR 0014, `docs/adr/0014-workflows-replace-agent-handoffs.md`; one Task = one branch = one PR, ADR 0015 `docs/adr/0015-one-task-one-pr.md`); for how a project-level run is wired, see [`freedom-agents.md`](freedom-agents.md). For the canonical role list, see [`role-catalog.md`](role-catalog.md).

**Nothing is installed on a fresh DB** — `runSeed()` only syncs the on-disk catalog (`packages/api/src/marketplace/catalog/`) into `marketplace_agents`. The Owner installs agents from `/agents/marketplace` (copies prompt + checklists), or creates a workflow from a starter template, which installs the agents its graph needs. SDLC catalog entries ship `status: 'active'`; autonomous scouts ship `inactive` so the Owner opts each one in after wiring its inputs (channels, MCP servers, deploy targets, etc.).

## Capability matrix

| Capability | State |
|---|---|
| Building software (engineering chain) | **Template** — `delivery` workflow on a Task (PO Writer ⇄ PO Reviewer → Architect ⇄ Architect Reviewer → Sub-tasks: `build` → Sub-tasks: `test`, one branch and one PR) |
| Reviewing engineering work | **Template** — each performer has a separate paired reviewer agent; a reviewer's fail connection loops back to its writer |
| Autonomous regression testing | **Template** — `test` sub-workflow (QA Writer ⇄ QA Reviewer → Automation ⇄ Automation Reviewer) runs every `qa` sub-task inside the Task's `delivery` run, after the dev sub-tasks are built on the same branch |
| Market research | **Catalog, inactive** — Playwright MCP scrape → draft Task; needs a scheduled no-item workflow |
| Regulatory awareness | **Catalog, inactive** — Legal Scout; needs a scheduled no-item workflow |
| Daily AI-news ingest | **Catalog, inactive** — external notification digest; needs a scheduled no-item workflow |
| External work ingest (Jira) | **Catalog, inactive** — Atlassian MCP poll, dedup via `Source: <KEY>`; needs a scheduled no-item workflow |
| AI-readiness audit (per-project) | **Template** — `ai-readiness` workflow (one node, no item, push + PR); started by "Generate AI scaffold" |
| Exploratory bug-finding | **Disabled** — Tester role exists in the `SdlcRole` type only; no catalog agent |
| Knowledge base | **Catalog, inactive** — `agent-knowledge-base`, per-project `skills/` folder via PR; needs a no-item workflow |
| Prod deploy | **Deferred — no product yet** |
| Live-system monitoring | **Deferred — no product yet** |
| User feedback ingest | **Deferred — no product yet** |

## Current fleet

### SDLC agents (10 catalog agents: 5 performers + 5 paired reviewers)

Each has `role_id` pointing at a row in [`role-catalog.md`](role-catalog.md). Agents carry no routing: every prompt ends with the `atlas-outcome` block (`done` / `rejected` / `asked_question`) and the workflow graph decides what happens next. Spec Writer was removed — its job merged into Architect.

| Agent | Role | CLI (catalog default) | Starter workflow node |
|---|---|---|---|
| `agent-po-writer` | `po` | claude | `delivery` (fail → Owner node → back to PO Writer). Splits the Task into `dev`-labelled sub-tasks, each with a `[QA]` twin labelled `qa` and linked `tested_by` |
| `agent-po-reviewer` | `po` | claude | `delivery` (fail → PO Writer). Checks the sub-tasks + `[QA]` twins; does not assign them |
| `agent-architect` | `architect` | claude | `delivery`. One spec for the whole Task (`specs/<n>-<slug>/spec.md`, persisted to the Task's `spec_md`), with a file-level change group per `dev` sub-task |
| `agent-architect-reviewer` | `architect` | claude | `delivery` (fail → Architect) |
| `agent-coder` | `engineer` | copilot | `build` — implements one dev sub-task (its spec group, else its acceptance criteria) |
| `agent-code-reviewer` | `engineer` | copilot | `build` (fail → Coder) — reviews that sub-task's commits and re-runs the test gate |
| `agent-qa-writer` | `qa` | claude | `test` — test-plan CSV `tests/qa/<qaSubTaskId>.csv` for one `[QA]` sub-task |
| `agent-qa-reviewer` | `qa` | claude | `test` (fail → QA Writer) |
| `agent-automation` | `automation` | copilot | `test` — automates the `automation-yes` rows on the Task's branch (no waiting on a merged dev PR) |
| `agent-automation-reviewer` | `automation` | copilot | `test` (fail → Automation) |

### Starter workflows (`packages/api/src/marketplace/workflows/*.json`)

| Template | Input / trigger | Graph | Delivery |
|---|---|---|---|
| `delivery` ("Delivery") | Task (`item`) / `item_ready` | PO Writer → PO Reviewer → Architect → Architect Reviewer → **Sub-tasks** (`template:build`, no label) → **Sub-tasks** (`template:test`, label `qa`) → End; PO Writer fail → Owner → PO Writer; each reviewer fail → its writer | worktree, push + one PR per Task; the PR body lists every sub-task. Creating it also creates the project's Build / Test sub-task workflows when missing |
| `build` ("Build sub-task") | `sub_task` / `manual` | Coder → Code Reviewer → End; reviewer fail → Coder | none of its own — the sub-task goes to `in_review` and the Task run continues |
| `test` ("Test sub-task") | `sub_task` / `manual` | QA Writer → QA Reviewer → Automation → Automation Reviewer → End; reviewer fails loop back | none of its own |
| `ai-readiness` ("AI Readiness") | none / `manual` | AI Readiness → End | push + one PR |

**Routing rules (engine):** a fail connection increments `loop_count`; past `max_loops` (default 3) the run parks with the Owner. `asked_question`, a missing outcome block, a step error or a missing/inactive agent also park. A parked run holds its worktree; the Owner's comment on the item re-runs the asking step. A parked sub-task holds its Task run too; replying on either resumes both. Nothing reaches `done` automatically: finished sub-tasks go to `in_review`, and the Task goes to `in_review` when its PR opens.

**Sub-task order:** `delivery`'s first Sub-tasks step (no label) builds every sub-task not labelled `qa`, oldest first; the second tests every `qa` sub-task, so each `[QA]` twin runs after all the code is built on the branch. A sub-task created mid-run (e.g. a fix a reviewer asked for) is picked up by its step, or the End gate sends the run back to that step.

### Autonomous catalog agents (6, inactive)

All `role_id: NULL`, `status: 'inactive'`. Owner enables by editing the prompt's `{{ placeholder }}` blocks, flipping status, and adding the agent to a no-item workflow (scheduled or manual).

| Agent | Kind | Intended cadence |
|---|---|---|
| `agent-ai-news` | `ai-news` | daily |
| `agent-market-research` | `market-research` | weekly |
| `agent-regulations` | `regulations` | weekly |
| `agent-jira-to-epic` | `jira-to-epic` | every 4h |
| `agent-ai-readiness` | `ai-readiness` | manual (`ai-readiness` template) |
| `agent-knowledge-base` | `knowledge-base` | manual |

### Type-only SDLC roles (5)

`spec-writer`, `tester`, `devops`, `security`, `designer` exist in the `SdlcRole` union but have no `roles` row and no catalog agent (see [`role-catalog.md`](role-catalog.md)).

## Dispatch model

One mode: **workflows**. A workflow run executes its agent nodes back-to-back in one worktree and delivers one push + one PR at End.

- **Task workflows** (`input_kind='item'`) — the Owner queues a Task with `items.workflow_id`; `trigger='item_ready'` starts the oldest `ready` Tasks, up to `max_parallel_runs` at once, each on its own branch. Steps chain immediately, with no scheduler wait. Sub-tasks run one at a time inside the Task's run via Sub-tasks steps and their **sub-workflows** (`input_kind='sub_task'`).
- **Project-level workflows** (`input_kind='none'`) — `trigger='schedule'` (cron) or `manual`. Tasks the agent creates stay as created (`draft`) until the Owner queues them.

Agents escalate only by parking the workflow run with the Owner; they never assign items or change status (the API returns 409 while a run is working the item). Runtime details: [`architecture.md`](architecture.md) (Workflow runs) and [`freedom-agents.md`](freedom-agents.md).

## Future capability gaps

The fleet was audited against the Owner's vision; the Knowledge Base agent landed (`07ed867`), and three further gaps are deferred until Atlas ships a product to act on:

**Deferred — pre-product:**

- Prod deploy agent — event-driven post-PR-merge deploy + verify; produces incident Tasks on failure. Needs a live product to deploy. Revisit when one ships.
- Live-system monitoring agent — scheduled metrics-endpoint poll + SLO comparison; produces alert Tasks on breach. Needs a live product to monitor.
- User feedback ingest agent — hourly poll of Slack / email / support channels; produces actionable Tasks per real complaint. Needs a product whose users have feedback channels.

When any of the three gets unblocked by a product shipping, update this section.

## Disable-by-default policy

The policy is a **catalog curation signal, not a runtime guard.**

- Autonomous catalog entries ship `status: 'inactive'`; installing one keeps that status.
- Once an agent exists in the DB, the Owner can flip `agents.status` freely (via the Agents page or `PATCH /api/agents/:id`); nothing re-disables a runtime-enabled agent.
- Each autonomous prompt carries an "Edit before activating" block listing the placeholders the Owner must fill in (endpoints, channels, project IDs, etc.). Activating an unedited agent is harmless — it just produces empty / generic runs.
- The Owner's vision is explicit: "keep only the engineering and engineering reviewing agents as active." The 10 SDLC agents ship `active`; the 6 autonomous agents ship `inactive`. Nothing runs until installed and placed in an active workflow.

## Why a roadmap doc lives here

This file is the **strategic** view of the swarm. It answers "what fleet are we building, and where is it today?" — not "how does a single run wire up". The implementation-level docs:

- [`role-catalog.md`](role-catalog.md) — schema + seed policy for the SDLC roles
- [`freedom-agents.md`](freedom-agents.md) — project-level workflow runs (no item): prompt contract, runner behaviour, MCP tools
- [`api-surface.md`](api-surface.md) — the routes / services / migrations that back agents and workflows
- [`data-model.md`](data-model.md) — the `agents` / `agent_runs` / `workflows` / `workflow_runs` entity model

Updates to this doc should be limited to:

- A capability changes state (update the matrix + the fleet tables)
- A starter workflow is added or its graph changes
- A new gap is identified (add a row to the matrix + a bullet under "Future capability gaps")
- The disable-by-default policy changes (rare)
