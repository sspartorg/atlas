# Swarm architecture

The **autonomous SDLC swarm** is Atlas's long-term fleet vision: one agent per phase of the software lifecycle plus the product-lifecycle adjacencies â€” discovery, build, review, ship, monitor, learn. This doc captures the strategic shape of that fleet. For the implementation details of how a single agent is wired, see [`freedom-agents.md`](freedom-agents.md). For the canonical role list and disable-by-default seed policy, see [`role-catalog.md`](role-catalog.md).

**Nothing is installed on a fresh DB** — `runSeed()` only syncs the on-disk catalog (`packages/api/src/marketplace/catalog/`) into `marketplace_agents`; the Owner installs each agent from `/agents/marketplace`, which also copies its handoff rules and checklists. SDLC catalog entries ship `status: 'active'`; autonomous scouts ship `inactive` so the Owner opts each one in after wiring its inputs (channels, MCP servers, deploy targets, etc.).

## Capability matrix

Eleven capability areas, mapped against the current state of the codebase (audit of `db/seed.ts`, `db/seeds/sdlc-roles.ts`, and the `packages/api/src/agents/prompts/` set on 2026-05-27):

| Capability | State |
|---|---|
| Building software (engineering chain) | **Catalog (install to activate)** â€” PO Writer â†’ PO Reviewer â†’ fan-out: Architect â†’ Architect Reviewer â†’ Coder â†’ Code Reviewer (dev) and QA Writer â†’ QA Reviewer (QA twin) |
| Reviewing engineering work | **Catalog** â€” each performer has a separate paired reviewer agent (no in-agent reviewer persona) |
| Autonomous regression testing | **Active** â€” QA Writer agent in the chain |
| Market research | **Inactive (seeded)** â€” weekly Playwright MCP scrape â†’ weekly epic |
| Regulatory awareness | **Inactive (seeded)** â€” weekly Legal Scout |
| Daily AI-news ingest | **Inactive (seeded)** â€” daily 09:00, external notification digest |
| External work ingest (Jira) | **Inactive (seeded)** â€” 4-hourly Atlassian MCP poll, dedup via `Source: <KEY>` |
| AI-readiness audit (per-project) | **Inactive (seeded)** â€” manual trigger, branch + PR via `gh` |
| Exploratory bug-finding | **Disabled** â€” Tester role exists in `role-catalog`, prompt shipped, no dispatch wired |
| Knowledge base | **Inactive (seeded)** â€” `agent-knowledge-base`, per-project `skills/` folder, branch + PR via `gh`, Owner-on-demand |
| Prod deploy | **Deferred â€” no product yet** |
| Live-system monitoring | **Deferred â€” no product yet** |
| User feedback ingest | **Deferred â€” no product yet** |

## Current fleet

### SDLC chain (10 catalog agents: 5 performers + 5 paired reviewers)

Each has `role_id` pointing at a row in [`role-catalog.md`](role-catalog.md); the chain advances via `agent_handoff_rules` on `on-pass` / `on-fail`, copied at install time from the catalog's `handoff_rules.json`. Spec Writer was removed — its job merged into Architect.

| Agent | Role | CLI (catalog default) | On-pass handoff |
|---|---|---|---|
| `agent-po-writer` | `po` | claude | â†’ `agent-po-reviewer` (ready) |
| `agent-po-reviewer` | `po` | claude | â†’ `owner` (in_review); fans children out via MCP: dev stories â†’ `agent-architect`, `[QA]` twins â†’ `agent-qa-writer` |
| `agent-architect` | `architect` | claude | â†’ `agent-architect-reviewer` (ready) |
| `agent-architect-reviewer` | `architect` | claude | â†’ `agent-coder` (ready) |
| `agent-coder` | `engineer` | copilot | â†’ `agent-code-reviewer` (ready) |
| `agent-code-reviewer` | `engineer` | copilot | â†’ `owner` (in_review); `raises_pr` |
| `agent-qa-writer` | `qa` | claude | â†’ `agent-qa-reviewer` (ready) |
| `agent-qa-reviewer` | `qa` | claude | â†’ `owner` (in_review); `raises_pr` |
| `agent-automation` | `automation` | copilot | â†’ `agent-automation-reviewer` (ready); never auto-routed â€” Owner assigns after the dev PR merges |
| `agent-automation-reviewer` | `automation` | copilot | â†’ `owner` (in_review); `raises_pr` |

**On-fail (2026-09-14):** a reviewer rejection goes back to its writer with status `ready` (`agent-po-reviewer` -> `agent-po-writer`, `agent-architect-reviewer` -> `agent-architect`, `agent-code-reviewer` -> `agent-coder`, `agent-qa-reviewer` -> `agent-qa-writer`, `agent-automation-reviewer` -> `agent-automation`); migration `032` rewrites installed rows still on the old `owner`/`waiting_for_info` default. The generated `.atlas/handoff.md` makes the reviewer post its gap-list comment before reassigning, and keeps an Owner-only blocker path (assign null + `Waiting for Info` + comment) for problems the writer can't fix. Performers' on-fail still escalates to `owner` / `waiting_for_info`. Bounce loops are capped: rounds accumulate on hand-backs and `maybeAutoDispatch` parks the item with the Owner once `agents.max_rounds` is reached. A run that crashes always parks with the Owner, whatever its on-fail rule says. If a rule's target isn't installed or is inactive, the item parks with the Owner (`handoff_target_unavailable: <slug>`). Nothing reaches `done` automatically.

**Run isolation:** item-driven claude- and ollama-dialect runs spawn with `--setting-sources project,local --strict-mcp-config --mcp-config <atlas only>`, so the Owner's `~/.claude` hooks, plugins, user CLAUDE.md and user MCP servers don't leak into agent runs. The worktree's `.claude/commands/atlas-*` still load, and only the Atlas MCP (`http://127.0.0.1:4500/mcp`) is available. Freedom-mode scouts (`agent-ai-news`, `agent-market-research`, `agent-regulations`, `agent-jira-to-epic`, …) are exempt and keep the Owner's config, because they rely on the Owner's Playwright plugin and claude.ai Atlassian connector. Copilot runs are not isolated. Copilot-default agents fail with `cli_not_installed` when `copilot` is not on PATH â€” switch their CLI + model on Agent Detail.

### Seeded-inactive autonomous agents (6)

All `requires_item: false`, `role_id: NULL`, `status: 'inactive'`. Owner enables by editing the prompt's `{{ placeholder }}` blocks then flipping status.

| Agent | Kind | Cadence |
|---|---|---|
| `agent-ai-news` | `ai-news` | daily 09:00 |
| `agent-market-research` | `market-research` | weekly |
| `agent-regulations` | `regulations` | weekly |
| `agent-jira-to-epic` | `jira-to-epic` | every 4h |
| `agent-ai-readiness` | `ai-readiness` | manual |
| `agent-knowledge-base` | `knowledge-base` | manual |

### Type-only SDLC roles (5)

`spec-writer`, `tester`, `devops`, `security`, `designer` exist in the `SdlcRole` union but have no `roles` row and no catalog agent (see [`role-catalog.md`](role-catalog.md)).

## Dispatch model

Atlas runs two dispatch modes:

- **Item-driven** â€” an agent's run is scoped to a specific item (`requires_item: true`). Handoff rules on `agent_handoff_rules` advance the item through the chain. The PO Writer â†’ PO Reviewer â†’ Architect / QA Writer â†’ â€¦ chain works this way; reviewers are separate agents. Since 2026-09-14 the scheduler dispatches item-driven agents on ready (within ~1 min of an item becoming Ready + assigned, capacity permitting) â€” cadence no longer delays handoffs.
- **Freedom-mode** â€” `requires_item: false`. The agent runs on a clock-driven schedule (`cron_expr`) or manual trigger and produces new items (epics) rather than advancing existing ones. The 6 inactive autonomous agents work this way (any future autonomous agents follow the same shape).

Full implementation details â€” runner null-item guards, prompt-builder freedom preamble, MCP tool availability matrix â€” live in [`freedom-agents.md`](freedom-agents.md).

## Future capability gaps

The fleet was audited against the Owner's vision; the Knowledge Base agent landed (`07ed867`), and three further gaps are deferred until Atlas ships a product to act on:

**Deferred â€” pre-product:**

- Prod deploy agent â€” event-driven post-PR-merge deploy + verify; produces incident epics on failure. Needs a live product to deploy. Revisit when one ships.
- Live-system monitoring agent â€” scheduled metrics-endpoint poll + SLO comparison; produces alert epics on breach. Needs a live product to monitor.
- User feedback ingest agent â€” hourly poll of Slack / email / support channels; produces actionable epics per real complaint. Needs a product whose users have feedback channels.

When any of the three gets unblocked by a product shipping, update this section.

## Disable-by-default policy

The policy is a **seed-time curation signal, not a runtime guard.**

- New autonomous agents ship with `status: 'inactive'` in the seed. Migration time is the only point this is enforced.
- Once an agent exists in the DB, the Owner can flip `agents.status` freely (via the Agents page or `PATCH /api/agents/:id`); the seed never re-disables a runtime-enabled agent on a subsequent boot.
- Each agent's prompt carries an "Edit before activating" block listing the placeholders Owner must fill in (endpoints, channels, project IDs, etc.) before the agent will produce useful output. Activating an unedited agent is harmless â€” it just produces empty / generic runs.
- The Owner's vision is explicit: "keep only the engineering and engineering reviewing agents as active." The catalog holds this â€” the 10 SDLC chain agents ship `active`; the 6 autonomous agents ship `inactive`. Nothing is active until installed.

## Why a roadmap doc lives here

This file is the **strategic** view of the swarm. It answers "what fleet are we building, and where is it today?" â€” not "how does a single agent's runner wire up". The implementation-level docs:

- [`role-catalog.md`](role-catalog.md) â€” schema + seed policy for the 10 SDLC roles
- [`freedom-agents.md`](freedom-agents.md) â€” runtime wiring of `requires_item: false` agents (dispatch, prompt contract, guard rails, test coverage)
- [`api-surface.md`](api-surface.md) â€” the routes / services / migrations that back the agents
- [`data-model.md`](data-model.md) â€” the `agents` / `agent_runs` / `agent_handoff_rules` entity model

Updates to this doc should be limited to:

- A capability moves from **Absent** â†’ **Inactive (seeded)** â†’ **Active** (update the matrix + the fleet tables)
- A new gap is identified (add a row to the matrix + a bullet under "Future capability gaps")
- The disable-by-default policy changes (rare)
