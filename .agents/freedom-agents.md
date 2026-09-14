# Project-level runs (no item)

"Freedom mode" (`agents.requires_item = false`, per-agent schedules) no longer exists — migration `036_drop_agent_routing.ts` dropped it (ADR 0014). An agent that works on a project, or on nothing, instead runs as a step of a workflow with `input_kind = 'none'`. This doc covers how those runs are started, what the agent sees, and what happens to their output. The file name is kept for link stability.

---

## Starting one

| Trigger | How |
|---|---|
| Schedule | `workflows.trigger = 'schedule'`. `schedule_preset` (`hourly` / `every_4h` / `daily` / `weekly` / `custom`) + `schedule_time_of_day` + `schedule_weekday` (or a custom `cron_expr`) materialise to `cron_expr` + `next_run_at`. `tickWorkflowDispatch` starts one run when due, only if the workflow has no `running` run. |
| Manual | `POST /api/workflows/:id/runs` with no `item_id` (an `item_id` → 400). |
| "Generate AI scaffold" | `POST /api/projects/:id/generate-ai-scaffold` creates the project's AI Readiness workflow from the `ai-readiness` template if missing, then starts it. |
| Ad-hoc test | `POST /api/run { agent_id, project_id? }` (Run-now dialog). Not a workflow: temp dir, no worktree, no routing, no push. |

`workflows.project_id` may be null only when `use_worktree = false` (a news digest). A workflow that works on a repo needs a project; its run gets branch `atlas/wf/<runId8>` and one worktree for all steps.

---

## What the agent sees

`spawnAgentRun({ agentId, projectId, workflowRun })` with no item. `buildPrompt` (`services/prompt-builder.ts`) has two no-item branches:

- **With a project** — constitution, `# Your Role` (`prompt_md` with `{{ key }}` placeholders filled from `settings_json`), outcome contract, `# Project Context` (id, name, repo path, description, guardrails, every epic + `spec_md`), `# Working Protocol`, commit discipline, output instructions, self-memory.
- **Without a project** — constitution, `# Your Role`, outcome contract, `# Project-level Run` (no item attached; side effects via MCP are at the agent's discretion), output instructions, self-memory.

The CLI never sees that built prompt directly — it is the audit `prompt_snapshot`. What the CLI reads is staged on disk by `stageCliWorktree(... includeOutcome)`: `.atlas/constitution.md`, `.atlas/outcome.md` (how to report the result), `.atlas/self-memory.md`, and the `.claude/commands/atlas-<agent>.md` / `.github/prompts/atlas-<agent>.prompt.md` body, whose preamble (`preamble-assembler.ts`) says: do your job, commit, end with the `atlas-outcome` block, never assign, change status, push or open PRs. `.atlas/current-task.md` is absent.

Isolation: no-item runs skip `claudeIsolationArgs`, so they keep the Owner's user-level MCP servers (Playwright plugin, claude.ai Atlassian) that scouts depend on.

---

## What happens after

- `completeRun` persists the parsed outcome (`outcome_*` columns) for every run shape, then reports to `workflow-engine.onStepFinished`. Pass / fail / park work exactly as for item runs.
- A park on a project-level run has no item to comment on: the Owner gets a `needs_you` notification (`agent.run_finished_no_item` external key) and resumes with `POST /api/workflow-runs/:id/resume`.
- **End** pushes and opens a PR when the workflow says so (`[<workflow name>] <project name>` title), cleans up the worktree, and sends one `update` notification.
- **Items the agent creates** (Jira import, market research epics) are stamped `items.created_by_workflow_run_id` by `createItem` — matched through the reporter agent's live workflow step, so the agent must pass its `agent_id` to `create_item`. End sets them `ready` with `workflow_id = child.workflow_id ?? End.child_workflow_id`; with no child workflow they are left as created.
- Ad-hoc `POST /api/run` runs notify the Owner directly (`agent_completed_no_item` / `agent_error_no_item`); workflow steps don't notify per step.

---

## MCP tools from a no-item run

All 13 consolidated tools (`mcp.md`) are available. Tools that need an item id (`get_item`, `update_item`, `delete_item`) work once the agent has one, e.g. from `search_item`. `create_item` covers every type including `epic` (parent `project_id`). `update_item` `change_status` / `assign` return 409 only while a `running` workflow run holds that item.

---

## Built-in autonomous agents (marketplace catalog)

| Agent ID | Name | Intended use |
|---|---|---|
| `agent-ai-news` | AI News Scout | daily scheduled workflow, no project; digest to the external channel |
| `agent-market-research` | Competitive Analyst | weekly; competitors from `settings_json.competitors` |
| `agent-regulations` | Legal Scout | weekly; sources from `settings_json.sources` |
| `agent-jira-to-epic` | Jira Importer | every 4h; proposes epics from Jira (dry-run by default) |
| `agent-ai-readiness` | AI-Readiness Agent | `ai-readiness` template; scaffold files + spec-kit bootstrap, PR from End |
| `agent-knowledge-base` | Knowledge Base Curator | manual project workflow; curates a `skills/` folder via PR |

All ship `status: 'inactive'` with `role_id: NULL`. Only `ai-readiness` has a starter workflow; the rest need a workflow built in the builder.

---

## Adding a new autonomous agent

1. Add a catalog entry under `packages/api/src/marketplace/catalog/<id>/` (`manifest.json` with `status: 'inactive'`, `prompt.md`, optional `checklists.json`). No schedule or routing fields — `catalog-loader.ts` strips them.
2. End the prompt with the `atlas-outcome` block; reference `settings_json` via `{{ key }}` placeholders.
3. Optionally add a per-`kind_slug` settings schema in `packages/shared/src/agents/settings-schemas.ts`.
4. Optionally ship a starter workflow in `packages/api/src/marketplace/workflows/<id>.json` (`input_kind: "none"`).

---

## Testing

- `services/workflow-engine.integration.test.ts` — "stamps items an agent creates during a project-level run and routes them at End", "a scheduled project-level workflow starts when its cron fires".
- `services/prompt-builder.test.ts` — no-item prompt branches.
- `routes/projects.test.ts` — `generate-ai-scaffold` starts the AI Readiness workflow.

---

## Related docs

- [`data-model.md`](data-model.md) — `IWorkflow`, `IWorkflowRun`, `IAgentRun` lifecycle shapes.
- [`api-surface.md`](api-surface.md) — `routes/workflows.ts`, `POST /api/run`, `services/agent-schedule-registry.ts`.
- [`swarm-architecture.md`](swarm-architecture.md) — fleet + starter workflows.
- [`pages/16a-agent-run-detail.md`](pages/16a-agent-run-detail.md) — the run-detail page.
