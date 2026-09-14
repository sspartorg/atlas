# Swarm architecture

The **autonomous SDLC swarm** is Atlas's long-term fleet vision: one agent per phase of the software lifecycle plus the product-lifecycle adjacencies — discovery, build, review, ship, monitor, learn. This doc captures the strategic shape of that fleet. How agents are chained is a **workflow** concern (ADR 0014, `docs/adr/0014-workflows-replace-agent-handoffs.md`); for how a project-level run is wired, see [`freedom-agents.md`](freedom-agents.md). For the canonical role list, see [`role-catalog.md`](role-catalog.md).

**Nothing is installed on a fresh DB** — `runSeed()` only syncs the on-disk catalog (`packages/api/src/marketplace/catalog/`) into `marketplace_agents`. The Owner installs agents from `/agents/marketplace` (copies prompt + checklists), or creates a workflow from a starter template, which installs the agents its graph needs. SDLC catalog entries ship `status: 'active'`; autonomous scouts ship `inactive` so the Owner opts each one in after wiring its inputs (channels, MCP servers, deploy targets, etc.).

## Capability matrix

| Capability | State |
|---|---|
| Building software (engineering chain) | **Template** — `planning` workflow (PO Writer ⇄ PO Reviewer, stories → `dev`) and `dev` workflow (Architect ⇄ Architect Reviewer → Coder ⇄ Code Reviewer, one PR) |
| Reviewing engineering work | **Template** — each performer has a separate paired reviewer agent; a reviewer's fail connection loops back to its writer |
| Autonomous regression testing | **Template** — `qa` workflow (QA Writer ⇄ QA Reviewer → Automation ⇄ Automation Reviewer, one PR) |
| Market research | **Catalog, inactive** — Playwright MCP scrape → epic; needs a scheduled no-item workflow |
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
| `agent-po-writer` | `po` | claude | `planning` (fail → Owner node → back to PO Writer) |
| `agent-po-reviewer` | `po` | claude | `planning` (fail → PO Writer). Checks stories + `[QA]` twins; does not assign them |
| `agent-architect` | `architect` | claude | `dev` |
| `agent-architect-reviewer` | `architect` | claude | `dev` (fail → Architect) |
| `agent-coder` | `engineer` | copilot | `dev` |
| `agent-code-reviewer` | `engineer` | copilot | `dev` (fail → Coder) |
| `agent-qa-writer` | `qa` | claude | `qa` |
| `agent-qa-reviewer` | `qa` | claude | `qa` (fail → QA Writer) |
| `agent-automation` | `automation` | copilot | `qa` |
| `agent-automation-reviewer` | `automation` | copilot | `qa` (fail → Automation) |

### Starter workflows (`packages/api/src/marketplace/workflows/*.json`)

| Template | Input / trigger | Graph | Delivery |
|---|---|---|---|
| `planning` ("Planning") | item / `item_ready` | PO Writer → PO Reviewer → End; PO Writer fail → Owner → PO Writer; PO Reviewer fail → PO Writer | worktree, no push, no PR. End `child_workflow_id: template:dev` queues the dev stories created during the run for the project's Development workflow and `test_child_workflow_id: template:qa` queues their `[QA]` twins for Quality (both created from their templates when the project lacks them) |
| `dev` ("Development") | item / `item_ready` | Architect → Architect Reviewer → Coder → Code Reviewer → End; reviewer fails loop back | push + one PR; item → `in_review` |
| `qa` ("Quality") | item / `item_ready` | QA Writer → QA Reviewer → Automation → Automation Reviewer → End; reviewer fails loop back | push + one PR |
| `ai-readiness` ("AI Readiness") | none / `manual` | AI Readiness → End | push + one PR |

**Routing rules (engine):** a fail connection increments `loop_count`; past `max_loops` (default 3) the run parks with the Owner. `asked_question`, a missing outcome block, a step error or a missing/inactive agent also park. A parked run holds its worktree; the Owner's comment on the item re-runs the asking step. Nothing reaches `done` automatically when a PR opens — the item goes to `in_review`.

**`[QA]` twins:** PO Writer links each twin to its dev story with `tested_by` (twin → dev). `planning`'s End sends children with that outgoing link to `test_child_workflow_id` (Quality) and the rest to `child_workflow_id` (Development). Automation parks on `waiting_on_dev_pr_merge` until the dev PR is merged; merge it and reply on the twin to continue.

**Run isolation:** item runs on the claude / ollama dialect spawn with `--setting-sources project,local --strict-mcp-config --mcp-config <atlas only>`, so the Owner's `~/.claude` hooks, plugins, user CLAUDE.md and user MCP servers don't leak into agent runs; only the Atlas MCP (`http://127.0.0.1:4500/mcp`) is available. Runs with no item keep the Owner's config, because scouts rely on the Owner's Playwright plugin and claude.ai Atlassian connector. Copilot runs are not isolated. Copilot-default agents fail with `cli_not_installed` when `copilot` is not on PATH — switch their CLI + model on Agent Detail.

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

- **Item workflows** (`input_kind='item'`) — the Owner (or a parent workflow's End) queues an item with `items.workflow_id`; `trigger='item_ready'` starts the oldest `ready` item whenever the workflow has no `running` run. Steps chain immediately, with no scheduler wait.
- **Project-level workflows** (`input_kind='none'`) — `trigger='schedule'` (cron) or `manual`. Items the agent creates are routed to the End node's child workflow.

Agents escalate only by parking the workflow run with the Owner; they never assign items or change status (the API returns 409 while a run is working the item). Runtime details: [`architecture.md`](architecture.md) (Workflow runs) and [`freedom-agents.md`](freedom-agents.md).

## Future capability gaps

The fleet was audited against the Owner's vision; the Knowledge Base agent landed (`07ed867`), and three further gaps are deferred until Atlas ships a product to act on:

**Deferred — pre-product:**

- Prod deploy agent — event-driven post-PR-merge deploy + verify; produces incident epics on failure. Needs a live product to deploy. Revisit when one ships.
- Live-system monitoring agent — scheduled metrics-endpoint poll + SLO comparison; produces alert epics on breach. Needs a live product to monitor.
- User feedback ingest agent — hourly poll of Slack / email / support channels; produces actionable epics per real complaint. Needs a product whose users have feedback channels.

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
