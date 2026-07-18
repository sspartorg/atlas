# Swarm architecture

The **autonomous SDLC swarm** is Atlas's long-term fleet vision: one agent per phase of the software lifecycle plus the product-lifecycle adjacencies â€” discovery, build, review, ship, monitor, learn. This doc captures the strategic shape of that fleet. For the implementation details of how a single agent is wired, see [`freedom-agents.md`](freedom-agents.md). For the canonical role list and disable-by-default seed policy, see [`role-catalog.md`](role-catalog.md).

The fleet ships **engineering + engineering-reviewer agents active** by default. Every other agent is seeded with `status: 'inactive'` so the Owner explicitly opts each one in after wiring its inputs (channels, MCP servers, deploy targets, etc.).

## Capability matrix

Eleven capability areas, mapped against the current state of the codebase (audit of `db/seed.ts`, `db/seeds/sdlc-roles.ts`, and the `packages/api/src/agents/prompts/` set on 2026-05-27):

| Capability | State |
|---|---|
| Building software (engineering chain) | **Active** â€” PO Writer â†’ Spec Writer â†’ Coder â†’ QA Writer with paired reviewers |
| Reviewing engineering work | **Active** â€” every active SDLC agent ships with a paired reviewer persona |
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

### Active item-driven chain (4 agents + paired reviewers)

Each of these has `role_id` pointing at a row in [`role-catalog.md`](role-catalog.md) and a paired reviewer persona; the chain advances via `agent_handoff_rules` on `on-pass`/`on-fail`/`on-needs-info` transitions.

| Agent | Role | On-pass handoff |
|---|---|---|
| `agent-po-writer` | `po` | â†’ `agent-spec-writer` (status: `ready`) |
| `agent-spec-writer` | `spec-writer` | â†’ `agent-coder` (status: `ready`) |
| `agent-coder` | `engineer` | â†’ `agent-qa-writer` (status: `ready`) |
| `agent-qa-writer` | `qa` | â†’ `owner` (status: `done`) |

All four `on-fail` paths escalate to `owner` with status `waiting_for_info`.

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

### Seeded-inactive SDLC roles (6)

These rows exist in the `roles` catalog with curated `default_prompt_md`, but no corresponding active agent ships in the chain. Each is one Owner decision away from activation (add handoff rule + flip the agent's status).

| Role | Why disabled by default |
|---|---|
| `architect` | Architecture-doc handoff isn't wired upstream of Coder; one-off rather than every-story |
| `tester` | Exploratory testing is human-paced; no dispatch trigger fits the auto-pipeline |
| `automation` | CI/CD ownership belongs to the project â€” Owner decides what's in scope |
| `devops` | Infra changes need explicit Owner approval; opt-in only |
| `security` | Cross-cutting review; Owner decides when to slot it in |
| `designer` | UX work is upstream of Stories; needs Epic-level trigger |

## Dispatch model

Atlas runs two dispatch modes:

- **Item-driven** â€” an agent's run is scoped to a specific item (`requires_item: true`). Handoff rules on `agent_handoff_rules` advance the item through the chain. The PO Writer â†’ Spec Writer â†’ Coder â†’ QA Writer chain works this way. Reviewer personas run as a second CLI invocation against the same item after the performer leg.
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
- The Owner's vision is explicit: "keep only the engineering and engineering reviewing agents as active." The fleet's default state holds this â€” only the 4 chain agents (po-writer, spec-writer, coder, qa-writer) ship active; all 5 seeded autonomous agents + the 6 disabled SDLC roles ship inactive.

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
