# Freedom-mode agents (`requires_item = false`)

Most Atlas agents are **item-driven**: they sit waiting for an epic / story / bug / sub-task / sub-bug to land on their assignee queue, the scheduler picks the oldest `ready` item, spawns a CLI against it, and the agent works the item. Some agents don't fit that model â€” they need to **wake up on a schedule and produce output without any item attached**. Those are *freedom-mode* agents.

This doc explains how freedom mode is wired end-to-end (Theme 06 + Theme 09 + Theme 09b + A05 close-out), which built-in agents use it, and the rules for adding new ones.

---

## The `requires_item` flag

`agents.requires_item` is a boolean column added by migration `008_agent_framework.ts`. Default `TRUE`. When the scheduler ticks an agent:

- `requires_item = true` â†’ look up the `items` table for a `ready` item assigned to this agent. Dispatch with `(issue_type, issue_id)`. If no item is ready, the agent stays "due" silently (no log noise) until work arrives.
- `requires_item = false` â†’ **skip the items lookup entirely**. Dispatch on every tick, capped by `concurrent_runs`. The resulting `agent_runs` row has `item_id = null`.

The flag is editable on the Agent Detail page (Overview tab) and on `POST /api/agents` / `PATCH /api/agents/:id`. The decision branch lives in `agent-schedule-registry.ts::dispatchOneAgent`; the predicate is extracted as the pure `decideFreedomDispatch(input)` helper so the branch is unit-testable.

---

## Dispatch flow

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ startAgentSchedulerPoller()    â”‚   (interval timer; runs every minute)
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
               â–¼
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
        â”‚ dispatchOne â”‚ â€” picks each agent whose next_run_at is past
        â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”˜
               â–¼
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚ requires_item === true â”‚â”€â”€ true â”€â”€â–¶ items.where(assignee=agent, status='ready')
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                      â”‚
              â”‚ false                              â–¼
              â–¼                          spawnAgentRun({ agentId, issueType, issueId })
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                â”‚
   â”‚ decideFreedomDispatch({...}) â”‚                â–¼
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜       runner builds prompt
              â–¼                            with full item context
       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
       â”‚ kind=spawn?  â”‚
       â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
              â–¼
       spawnFreedomRun(agentId)
       â”‚
       â–¼
       spawnAgentRun({ agentId, issueType: null, issueId: null })
       â”‚
       â–¼
       runner builds prompt
       WITHOUT any item context
```

`spawnAgentRun` is the same entry point in both branches â€” only the parameters differ. Subsequent stages (prompt builder, CLI spawn, output capture, completion handling) read `issueType` / `issueId` from the `agent_runs` row.

---

## Prompt-builder contract

`prompt-builder.ts::buildPrompt(agent, issueType, issueId)` is where the two paths diverge.

When `!issueType || !issueId`, the builder emits a tight 4-block prompt:

1. **Atlas Constitution** â€” system rules (always included if non-empty).
2. **Your Role** â€” the agent's `prompt_md` with `{{ key }}` placeholders substituted from `settings_json`.
3. **Freedom Run** â€” a short paragraph reminding the agent that it was dispatched on schedule with no item, and that side effects (comments, notifications, agent memory) are at its discretion via the MCP tools its row grants.
4. **Output Instructions** â€” what shape the output should take.

The builder **never** queries items, comments, sub-items, related links, or the RAG index for a freedom run. There is nothing item-shaped to look up.

---

## Runner contract â€” null-item guards

`agent-runner.ts::completeRun` / `errorRun` are the same code for both item-attached and freedom runs, but every item-scoped side effect is gated:

| Side effect | Item run | Freedom run |
|---|---|---|
| Round counter (`incrementRound`) | âœ“ bumped each CLI | **skipped** (`if (!issueId \|\| !issueType)`) |
| `advanceIssueStatus` | âœ“ moves item to next status | **skipped** |
| `applyOnPassHandoff` (reassign to next agent) | âœ“ | **skipped** |
| `commitVerifier.snapshot` | âœ“ | **skipped** |
| Item-detail SSE broadcast | âœ“ `issue_detail_changed` | **skipped** |
| Run-scope SSE (`run_started`, `run_completed`, `run_error`) | âœ“ | âœ“ |
| `agent_memory` upsert (procedural memory) | âœ“ | âœ“ (intentional â€” memory across runs is useful even without items) |
| Comments + activity-log writes on the item | âœ“ | **skipped** (no item to attach to) |
| Notifications | âœ“ with `item_id` set | âœ“ with `item_id = null` |

Output: a freedom run's only persistent artifact is `agent_runs.output_text` plus whatever the agent wrote via MCP tools (e.g., creating an epic, posting an external external notification). The Agent Detail Runs tab + the Agent Run Detail page are the canonical surfaces.

---

## Which MCP tools work from a freedom run

Freedom-mode agents share the same MCP server as item-driven agents, but a tool's usefulness depends on whether it needs an item id.

**Always available (no item context required):**

- `listAgents`, `getAgent`, `updateAgent` â€” read / update agent metadata
- `getAgentMemory`, `updateAgentMemory` â€” read / write the agent's procedural memory
- `listProjects`, `getProject` â€” read project state
- `searchItems { query, top_k? }` â€” substring + FTS over titles and descriptions; how autonomous agents dedup against `Source: <key>` markers in prior imports
- `getEpic`, `getItemFull` â€” read a specific item once you have its id (e.g. from `searchItems` result)
- `createStory` / `createSubTask` / `createSubBug` / `createBug` â€” produce new child work
- `setReminder`, `cancelReminder`, `listReminders` â€” schedule one-shot or recurring reminders
- `sendExternalNotification` â€” push a digest to the Owner's external notification channel
- Web / external API tools (External broadcast, fetch endpoints) â€” available from whatever MCP servers the Owner has registered at the user level (post-`253c43d` the spawned CLI inherits Owner's `~/.claude.json` wholesale)

**Requires an item to be in scope (NOT usable from a freedom run):**

- `addCommentToItem`, `replyToItem`, `updateItem`, `transitionItemStatus`, `assignItem`, `deleteItem` â€” all anchor on an issue id
- `listItemLinks`, `createItemLink`, `deleteItemLink` â€” same
- `submit_review` â€” only valid for two-persona reviewer legs

**Known MCP gap:** there is no `createEpic` (or polymorphic `createItem`) MCP tool today. The Jira Importer prompt currently calls `createItem({ type: 'epic', ... })` which would fail at runtime against the live MCP surface. Filed for an MCP B-chunk follow-up. Until shipped, autonomous agents that need to create top-level epics must call the REST endpoint `POST /api/epics` directly via `Bash` + `curl` (the spawned CLI has shell access).

This shape isn't a bug â€” freedom agents do **reporting / scanning / ingestion** work; mutating a specific item is item-driven by definition. A freedom agent that needs to act on an existing item should create one (via `createStory` for child work, or the REST `POST /api/epics` for top-level) and let the item-driven chain take over.

---

## Built-in freedom agents (`seed.ts`)

| Agent ID | Name | Cadence | Purpose |
|---|---|---|---|
| `agent-ai-news` | AI News Scout | daily 09:00 cron (`0 9 * * *`) | Pulls AI / ML news, summarises into `agent_memory` and posts to external notification. |
| `agent-market-research` | Competitive Analyst | weekly | Tracks competitors from `settings_json.competitors`; produces a market report. |
| `agent-regulations` | Legal Scout | weekly | Watches regulation feeds from `settings_json.sources`; flags changes. |
| `agent-jira-to-epic` | Jira Importer | every 4h | Pulls Jira issues (dry-run on by default); proposes epics from imports. |
| `agent-ai-readiness` | AI-Readiness Agent | manual (no cron) | Theme 09b â€” project-scope runs (`item_id = null`, `project_id` set); generates AGENTS.md + CLAUDE.md + `.agents/` scaffolding on a PR. |
| `agent-knowledge-base` | Knowledge Base Curator | manual (no cron) | C08 â€” project-scope runs (`item_id = null`, `project_id` set); curates a `skills/` folder of Confluence-style technical docs about the application via a PR. |

All 6 are seeded `status='inactive'` so they don't start running on a clean install. The Owner activates them per workspace via Agent Detail â†’ Overview â†’ Status switch.

The first 4 are pure freedom mode (no item, no project). The last 2 (`agent-ai-readiness` and `agent-knowledge-base`) are the **project-scope** variant â€” same `requires_item = false` but the dispatcher attaches a `project_id` to the run row instead of leaving both nullable. Both are manual-trigger only (`schedule_hours: 0`, `cron_expr: null`) â€” Owner picks when to run them via the Agents â†’ Run-now flow.

---

## UI surfaces

- **Queue page (`/queue`)** â€” Queue reads from `items` filtered by `assignee_agent_id` + `status='ready'`. Freedom runs have no item, so they correctly never appear in the queue.
- **Agent Detail â†’ Runs tab (`/agents/:id`)** â€” Lists every run (item-attached + freedom + project-scope). Item-attached rows show `story/ATL-12` (issue type + short id) in mono. Freedom-mode rows show a small **"Freedom run"** pill (clock glyph). Project-scope rows show **"Project scope"**.
- **Agent Run Detail (`/agents/:id/runs/:runId`)** â€” Renders the prompt snapshot + output. When `issue_id` is empty / null, the parent-item link is omitted.
- **Agent Detail â†’ Overview tab** â€” `requires_item` is a toggle. Editing it persists via `PATCH /api/agents/:id`.

---

## Adding a new freedom agent

1. **Seed it in `packages/api/src/db/seed.ts::AGENT_SEEDS`** with `requires_item: false`, an appropriate `schedule_preset` or `cron_expr`, and `status: 'inactive'` so installs don't auto-activate.
2. **Write the prompt** as a generic role description in `prompt_md`. Reference `settings_json` via `{{ key }}` placeholders for any per-agent config the Owner can edit (sources, competitors, cron expr, etc.).
3. **Grant tools** in `ALLOWED_TOOL_SEEDS` for whatever MCP calls the agent will make. Item-mutating tools won't be reachable; don't bother granting them.
4. **Optionally add a per-`kind_slug` settings schema** in `packages/shared/src/agents/settings-schemas.ts` so the Agent Detail page renders a typed editor for `settings_json` â€” see `ai-news` / `market-research` for examples.
5. **No new tables, no migrations.** The whole machinery is already in place; only `seed.ts` + (optionally) `settings-schemas.ts` change.
6. **Boot to verify.** On a fresh install, `runSeed` inserts the row; `syncAgentDefaults` on every boot patches the prompt to the latest seed body **only while the Owner hasn't edited it** (`prompt_version === 1`).

---

## Testing

- `agent-schedule-registry.test.ts::decideFreedomDispatch` covers the gate predicate (not_freedom / spawn / at_capacity branches).
- `prompt-builder.test.ts` covers the no-item preamble rendering.
- The full dispatch â†’ spawn â†’ complete loop is exercised in `auto-fetch-runner.integration.test.ts` for the item-driven path; freedom-mode end-to-end currently relies on the pure decision tests + manual smoke against a seeded freedom agent.

---

## Related docs

- [`data-model.md`](data-model.md) â€” `agents.requires_item` field, `agent_runs` row shape (`item_id` nullable).
- [`api-surface.md`](api-surface.md) â€” `POST /api/agents` and `PATCH /api/agents/:id` accept `requires_item`.
- [`pages/16-agent-detail.md`](pages/16-agent-detail.md) â€” Overview tab edits.
- [`pages/16a-agent-run-detail.md`](pages/16a-agent-run-detail.md) â€” the run-detail page.
