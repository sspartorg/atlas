# API Surface

> **2026-05 â€” Postgres migration in progress.** DB engine is Postgres 16 (docker compose service `atlas-postgres`). Migration history collapsed to a single Knex baseline: `packages/api/src/db/migrations/001_baseline.ts`. Query layer: **Kysely** for queries (type-safe, async) and **Knex** for schema migrations. Side tables (`comments`, `issue_events`, `agent_runs`, `notifications`) now reference `items(id)` directly via a single `item_id` FK with `ON DELETE CASCADE`. Issue links now live in `item_links(from_id, to_id, relation_type)` where `relation_type âˆˆ {relates_to, depends_on}`. Existing per-type API contracts (`/api/epics/...`, `/api/stories/...`, etc.) are preserved by projection layers in `services/items.ts`.

Fastify server in `packages/api/src/server.ts`. All routes registered as plugins from `packages/api/src/routes/`. All requests validated against Zod schemas in `@atlas/shared/schemas`. Responses use snake_case fields matching `@atlas/shared/types`.

Base URL in dev: `http://localhost:4001`. In prod (`pnpm prod`, `ATLAS_ENV=prod`): `http://localhost:5001`. Web calls go through `packages/web/src/api/api.ts` and are proxied via vite's `/api` â†’ `API_PROXY_TARGET` rule, so the bundle itself never sees an absolute URL.

Live Swagger UI at `/api/docs`; OpenAPI 3 JSON at `/api/docs/json`. This markdown file is the human index; the JSON is what's actually served. Routes without `schema:` blocks appear in the spec with method + path only (no body/response details) â€” fill in `schema:` on a route to get richer docs.

---

## Routes

### `routes/agents.ts` â€” Agents
**Why this group exists**: Agents are the configurable AI workers that act on behalf of the Owner. CRUD is exposed here because only the Owner configures, pauses, and routes them; the MCP layer intentionally does not touch this surface (external AI clients should never create or rename agents â€” that's an Owner-only concern). Checklists and memory live under the agent rather than separate top-level resources so authorization is always anchored to one agent. Scheduling, routing and git delivery are not agent concerns — see `routes/workflows.ts`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agents` | List all agents |
| GET | `/api/agents/:id` | Single agent |
| POST | `/api/agents` | Create agent (Add Agent dialog). `400 MODEL_NOT_IN_REGISTRY` when `(cli, model)` is absent from `cli_models`; **2026-09-12** `400 ROLE_NOT_IN_CATALOG` when `role_id` is a `SdlcRole` slug with no `roles` row (`assertRoleInCatalog`) — both FKs previously surfaced as raw 500s. `role_id: null` is always valid: autonomous agents sit outside the SDLC chain. |
| PATCH | `/api/agents/:id` | Update agent (rename, pause/resume, CLI/model/effort, prompt, checklists) |
| DELETE | `/api/agents/:id` | Delete agent. `409 conflict` (`Agent is used by workflow(s): <names>`) while any `workflows.graph` has a node with that `agent_id` (`workflowsService.workflowsUsingAgent`, JSONB `@>`) |
| POST | `/api/agents/:id/duplicate` | Duplicate agent with new ID |
| GET | `/api/agents/:id/memory` | Read the agent's procedural-memory markdown (auto-creates an empty row on first read) |
| PUT | `/api/agents/:id/memory` | Replace or append the memory body. Body: `{ body_md, mode?: 'replace' \| 'append' }`. `'replace'` (default) bumps version + flips source to `manual-edit`. **Theme 08** â€” `'append'` calls `appendLesson()`: inserts a `- <body_md>` bullet under `## Course corrections`, bumps version, audits with `trigger='mcp_update'`, does NOT reset the cadence counter. |
| POST | `/api/agents/:id/memory/regenerate` | Regenerate from recent runs; bumps version, flips source to `ai-generated`, links `last_run_id`. **Theme 08** â€” audits a row in `memory_regenerations` with `trigger='manual'` + resets `runs_since_regen`. |
| GET | `/api/agents/:id/memory/history` | **Theme 08** â€” last N `memory_regenerations` rows (newest first; `limit` query param 1..50, default 10). Powers the Memory tab's regen-history list. |
| GET | `/api/agents/:id/commit-verifications` | **Theme 11** â€” last N `commit_verifications` rows (newest first; `limit` 1..50, default 10). Powers the Overview tab's commit-discipline dots tile. |
| GET | `/api/agents/:id/prompt-versions` | List all prompt versions (newest first) for the Prompt tab's history table |
| POST | `/api/agents/:id/prompt-versions/:version/revert` | Set this historical version as the new active prompt; appends a new version row whose `reverted_from` points back to the source |
| POST | `/api/agents/:id/dry-run` | Smoke-test the CLI wiring. Spawns the agent's configured `cli` (e.g. `claude`) with `--print --model <agent.model>` and streams stdout/stderr via SSE (`dry_run_started`, `dry_run_output`, `dry_run_done`). Prompt is **only** the workspace constitution (guardrails) + an optional Owner note + a 3-line verification ask. No issue context, no agent prompt_md, no MCP, no DB write. Body: `{ extra_prompt?: string \| null }`. Returns `{ dryRunId, model, cli, promptLen }`. Powers the Agent Detail â†’ Test Run tab. |
| POST | `/api/agents/:id/compile-prompt` | Pure read â€” compile the **exact prompt** that `Run now` would pipe to the CLI, without spawning anything. Reuses `services/prompt-builder.ts:buildPrompt()` (same function the runner calls). Body: `{ issue_type?, issue_id? }` — both or neither; omitted = the project-level prompt (`# Project-level Run` section). Returns `{ prompt, filename, length, agent: {id, name, cli, model}, issue: {type, id, title}, guardrails_count, sections }`. No DB write, no CLI spawn, no SSE. Used by the Run Now dialog's **Preview prompt** button to download the prompt as `.md` for offline inspection. |

A08 â€” `POST /api/agents` and `PATCH /api/agents/:id` accept an optional `role_id` (one of the 10 SDLC role slugs, or `null` to detach). The MCP `createAgent` / `updateAgent` tools also expose `role_id` via the shared `SdlcRoleSchema`. The runner reads `agent.prompt_md` exclusively â€” never `roles.default_prompt_md` â€” so re-pointing an agent at a different role does not change the prompt the next dispatch sees.

### `routes/roles.ts` â€” Roles (A08)
**Why this group exists**: The SDLC role catalog is the canonical lookup table for agent roles. CRUD is intentionally minimal: the catalog *shape* is governed by the `SdlcRole` enum in `@atlas/shared` (the runtime never invents roles), so the only operation that varies at runtime is the Owner editing curated default prompts. See `role-catalog.md` for the full design.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/roles` | List the seeded SDLC roles, ordered by `sort_order`. **2026-09-12: this returns 5, not 10** — `po`, `architect`, `engineer`, `qa`, `automation`. `SdlcRole` in `@atlas/shared` declares ten slugs; the baseline seeds five. Powers the Agents page Role filter dropdown, which iterates `SDLC_ROLES` for its options, so the five unseeded slugs appear in the dropdown and filter to zero agents. See `role-catalog.md`. |
| GET | `/api/roles/:id` | Single role row. `id` must be one of the `SdlcRole` slugs; otherwise 400. |
| PATCH | `/api/roles/:id` | Owner-only (`requireMcpToken`). Body: `{ label?, description?, default_prompt_md?, default_reviewer_prompt_md? }`. Edits affect the catalog only â€” existing agents that previously copied a default into their own `prompt_md` are not retroactively updated. |

### `routes/projects.ts` â€” Projects
**Why this group exists**: Projects are the only top-level work container â€” every issue, schedule, and per-project guardrail tunnels through a project_id. Clone, reclone, and delete are exposed as POST/DELETE that spawn subprocesses (`clone-runner`, `reclone-runner`, `delete-runner`) and stream SSE because they're long-running and can fail mid-way; doing them inline would block the request handler and lose user feedback. The per-project `/env` endpoints are intentionally separate from the workspace-wide `/settings/env` so secrets stay scoped to one repo.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects` | List projects |
| POST | `/api/projects/clone` | Start a clone via `clone-runner` (emits SSE) |
| POST | `/api/projects/connect` | Connect an already-cloned local repo |
| POST | `/api/projects/:id/reclone` | Wipe + reclone via `reclone-runner` |
| DELETE | `/api/projects/:id` | Delete project (and worktree) via `delete-runner` |
| POST | `/api/projects/:id/reveal` | Reveal folder in OS file manager |
| GET | `/api/projects/:id/status` | Git status snapshot |
| GET | `/api/projects/:id/head` | Current HEAD ref |
| GET | `/api/projects/:id/env` | Read per-project secrets (DB-backed, AES-256-GCM). 2026-06-10: disk fallback to `<git_path>/.env` removed â€” DB is the only source of truth. |
| PUT | `/api/projects/:id/env` | Replace per-project secrets (DB-only; no longer writes `<git_path>/.env`). MCP-token gated. |
| GET | `/api/environment-secrets` | Read global tier of shared secrets (DB-backed, AES-256-GCM). Merged with per-project secrets by the setup runner â€” project wins on collision. |
| PUT | `/api/environment-secrets` | Replace global shared secrets. MCP-token gated. |
| POST | `/api/projects/:id/generate-ai-scaffold` | **Theme 09b / ADR 0014** — starts a project-level run of the project's **AI Readiness** workflow, creating it from the `ai-readiness` template (`workflowsService.createFromTemplate`, installs `agent-ai-readiness` if missing) on first use; matched by template name in the project. Token-gated. 409 if `clone_status !== 'ready'` or no `credential_id`. Returns `202 { run_id, workflow_id }` (`run_id` is the **workflow run** id). The agent commits the scaffold (AGENTS.md + CLAUDE.md + Copilot instructions + `.agents/`) in the run's worktree on `atlas/wf/<runId8>`; the workflow's End pushes and opens the PR. 500 `Failed to spawn AI-readiness run` if the start throws. |

### `routes/epics.ts`
**Why this group exists**: Epics are the top-level work unit inside a project and the entity an AI client most often pulls full context on (`get_epic_tree` is the MCP killer call). Status transitions go through a dedicated `/status` endpoint instead of generic PATCH so the status machine and assignee validation can be enforced in one place. Agents post their narrative to the comments thread (one auto-comment per agent persona at run end); the legacy `proposed_plan_md` field + its `PATCH /:id/plan` endpoints were retired by A03's revised design â€” see `data-model.md`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/epics?project_id=â€¦` | List epics, optional project filter |
| GET | `/api/epics/stats` | Aggregate counts (awaiting PO etc.) |
| GET | `/api/epics/:id` | Single epic |
| PATCH | `/api/{epics,stories,sub-tasks,sub-bugs,bugs}/:id` (attribution) | **2026-09-14:** every field PATCH route credits the optional `x-atlas-agent-id` header (sent by MCP `patch_fields` when the agent passes `agent_id`) as the `field_updated` event actor; unknown ids fall back to the Owner. The PR `link_created` event the workflow engine writes at End has no actor (Owner). |
| POST | `/api/epics` | Create epic. Optional `x-atlas-agent-id` header (sent by MCP `create_item` when the agent passes `agent_id`): credited as the `created` event actor and used as `reporter_agent_id` when the body omits it. Unknown agent ids are ignored (Owner attribution). Same for every create route below (`services/request-actor.ts::headerAgentId`) |
| PATCH | `/api/epics/:id` | Update epic (description) |
| PATCH | `/api/epics/:id/status` | Transition status (validates via `isValidTransition`) |
| PATCH | `/api/epics/:id/assign` | Reassign |

**Workflow item lock (ADR 0014).** `PATCH /api/{epics,stories,bugs,sub-tasks,sub-bugs}/:id/{status,assign}` returns `409 {error, kind:'conflict', workflow_run_id}` while a `running` workflow run holds the item — UI and MCP alike (global `preHandler` in `services/workflow-lock.ts`, registered in `server.ts`). A parked (`waiting_for_owner`) run does not lock. Stop the workflow run to change the item by hand.

### `routes/stories.ts` â€” Stories + SubTasks + SubBugs (combined plugin)
**Why this group exists**: Stories, sub-tasks, and sub-bugs are co-located because sub-items are only meaningful in the context of their parent story â€” fetching them is always "give me this story's children", never "give me sub-task NNN out of nowhere" (hence no `GET /sub-tasks/:id`). Combining the plugin keeps the URL contract clear: sub-items are nested under `/stories/:id/sub-tasks`, but mutations target them directly by id. The same status / assign / plan triplet repeats for all three kinds so the unified `IssueDetailShell` on the web can stay generic.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/stories?project_id=â€¦&epic_id=â€¦` | List stories |
| GET | `/api/stories/:id` | Single story |
| POST | `/api/stories` | Create story. Optional `x-atlas-agent-id` header: `created` actor + default reporter (see `POST /api/epics`) |
| PATCH | `/api/stories/:id` | Update story (title, description, acceptance_criteria, spec_md, pr_url, points) |
| PATCH | `/api/stories/:id/status` | Transition status |
| PATCH | `/api/stories/:id/assign` | Reassign |
| GET | `/api/stories/:id/sub-tasks` | List sub-tasks under a story |
| POST | `/api/stories/:id/sub-tasks` | Create sub-task. Optional `x-atlas-agent-id` header: `created` actor + default reporter |
| PATCH | `/api/sub-tasks/:id` | Update sub-task (title, description, acceptance_criteria) |
| PATCH | `/api/sub-tasks/:id/status` | Transition sub-task status |
| PATCH | `/api/sub-tasks/:id/assign` | Reassign sub-task |
| GET | `/api/stories/:id/sub-bugs` | List sub-bugs under a story |
| POST | `/api/stories/:id/sub-bugs` | Create sub-bug. Optional `x-atlas-agent-id` header: `created` actor + default reporter |
| PATCH | `/api/sub-bugs/:id` | Update sub-bug (title, description, AC, steps, expected, actual, frequency, scope) |
| PATCH | `/api/sub-bugs/:id/status` | Transition sub-bug status |
| PATCH | `/api/sub-bugs/:id/assign` | Reassign sub-bug |

### `routes/bugs.ts`
**Why this group exists**: Bugs are standalone defects nested under an epic (not a story), modeled separately because they have a different lifecycle â€” they can be reported before any implementation work begins, and they carry repro-specific fields (steps, expected/actual, frequency, scope) that don't apply to a generic issue. Reusing the same status / assign / plan triplet keeps the detail-page shell uniform.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bugs?project_id=â€¦&epic_id=â€¦` | List bugs (optional epic filter for epic detail page) |
| GET | `/api/bugs/:id` | Single bug |
| POST | `/api/bugs` | Create bug. Optional `x-atlas-agent-id` header: `created` actor + default reporter (see `POST /api/epics`) |
| PATCH | `/api/bugs/:id` | Update bug (title, description, AC, steps, expected, actual, frequency, scope) |
| PATCH | `/api/bugs/:id/status` | Transition bug status |
| PATCH | `/api/bugs/:id/assign` | Reassign |

### `routes/issues.ts` â€” Composite
**Why this group exists**: The `/issues` web page needs every story, bug, sub-task and sub-bug for a project plus the projects + agents dictionaries to render correctly. Doing that client-side meant six round-trips and noticeable latency on larger workspaces. `/api/issues/tree` exists purely as a performance composite â€” it has no other consumer and intentionally duplicates data that's individually fetchable from the typed routes above.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issues/tree?project_id=â€¦` | One round-trip view for the `/issues` page: tree of stories+bugs (children = sub-tasks/sub-bugs) plus inline `projects` and `agents` dictionaries. Replaces the prior 6-call fan-out (projects, epics, stories, bugs, sub-tasks, sub-bugs). Returns `IIssueTreeResponse` from `@atlas/shared`. |

### Theme 09 â€” agents route validation extensions

`POST /api/agents` and `PATCH /api/agents/:id` (both gated by `ATLAS_MCP_TOKEN`) perform **per-`kind_slug` settings validation** alongside the Zod boundary check.

- `body.settings_json` (when present) is validated against the matching Zod schema from `getAgentSettingsSchema(kind_slug)` in `@atlas/shared/agents/settings-schemas.ts`. PATCH uses the incoming `kind_slug` (if changed) else the agent's current `kind_slug`. Validation failures return 400 with `error: 'invalid settings_json for kind_slug=X'` plus `detail` carrying the Zod flat-errors object.

`agentsService.create` and `update` plumb `kind_slug` and `settings_json` through `AGENT_SCALAR_FIELDS`. Defaults on create: `kind_slug='custom'`, `settings_json={}`. Agents have no schedule (`cron_expr` moved to workflows, migration 036).

### `routes/comments.ts`
**Why this group exists**: Comments are polymorphic across all five issue types (`issue_type` + `issue_id`); a single comments table avoids five parallel comment tables that would all share identical shape. The `/activity` endpoint here merges comments with `issue_events` so the detail page's ActivityCard can render one ordered timeline of state changes, reassignments, and discussion without the web stitching two streams together.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/comments?issue_type=â€¦&issue_id=â€¦` | Thread for one issue |
| POST | `/api/comments` | Add comment. **ADR 0014 — Owner reply resumes a parked workflow run:** an Owner-authored comment on an item with a `waiting_for_owner` workflow run claims it inside the comment's transaction (`claimParkedWorkflowRun`, `FOR UPDATE`): run → `running`, item → `in_progress` (`status_changed` event, `detail='resumed_by_owner_reply'`). After commit it broadcasts `counts_changed {issueType, issueId}` and calls `workflow-engine.continueResumedRun` in the background: parked on an Owner node → follow its pass connection; parked on an agent node → re-run that node with `loop_count` reset to 0. Agent comments never resume. |
| DELETE | `/api/comments/:id` | Delete comment |
| POST | `/api/issues/:type/:id/links` | Create an item link. Body `{ to_type, to_id, relation_type? = 'relates_to' }` (`depends_on` cycle-checked, `relates_to` normalised, `tested_by` directed QA to dev). Idempotent. Writes `link_created` on both endpoints; the optional `x-atlas-agent-id` header is the actor on both (unknown ids ignored). 400 with `reason` (`self` / `missing_from` / `not_found` / `cycle`) |
| DELETE | `/api/issues/links/:linkId` | Delete an item link (204). Writes `link_deleted` on both endpoints, actor from the optional `x-atlas-agent-id` header |
| GET | `/api/issues/:type/:id/external-links` | `IItemExternalLink[]`, newest first. Each row carries `pr_state` (`'open'\|'merged'\|'closed'\|null`). **2026-09-14:** when any `pull_request` link's `pr_state_checked_at` is null or ≥ 5 min old, the response returns immediately and a background refresh re-reads GitHub (deduped per item), broadcasting `counts_changed {issueType, issueId}` if any state changed. The same list feeds every `/api/{type}s/:id/full` envelope, so those trigger it too |
| POST | `/api/issues/:type/:id/external-links` | Attach an off-platform link (`CreateItemExternalLinkSchema`; `pull_request` URLs must be GitHub PRs). Idempotent on (item, url). Writes `link_created` with the optional `x-atlas-agent-id` header as actor (sent by MCP `add_external_link` when the agent passes `agent_id`). 201 |
| POST | `/api/issues/:type/:id/external-links/refresh` | **2026-09-14.** Synchronously re-checks every `pull_request` link on the item against GitHub (`GET /repos/{o}/{r}/pulls/{n}` with the project credential's token: `merged_at` → `merged`, `state='closed'` → `closed`, else `open`) and returns the updated `IItemExternalLink[]` (200). No body. 400 unknown `:type`, 404 unknown item. A project without a credential, or a failed lookup, leaves `pr_state` as it was (null if never checked); `pr_state_checked_at` is stamped on every attempt. Used by the web "Done" guard |
| GET | `/api/issues/:type/:id/activity` | Merged activity feed (comments + status / assignment / field events). Returns `IActivityItem[]` from `services/events-log.ts`. |
| GET | `/api/issues/:type/:id/reply-context` | A12 â€” returns the `IReplyContext` envelope (item + project + head+tail-elided thread + linked items with description + AC + recent comments inlined for depends_on + recent activity events). Pure read; no side effects. Pairs with the `replyToItem` MCP tool's load-context mode. |
| POST | `/api/issues/:type/:id/reply` | A12 â€” context-aware reply. Body: `{ body, author?='owner', agent_id?=null }` (Zod `ReplyToItemSchema` from `@atlas/shared`; `agent_id` required when `author='agent'`). Loads the same envelope as the GET, posts the comment via `commentsService.create()` (existing `comment_added` event + `comment-created` SSE fire unchanged), returns `{ comment, context }` as `IReplyResponse`. |
| POST | `/api/issues/:type/:id/history/prune` | **2026-07-01 (MCP feature) + 2026-07-03 audit hardening** â€” bulk history cleanup for a single item. Body: `{ before_time }` (`PruneItemHistorySchema` from `@atlas/shared`, ISO-8601 datetime). Hard-deletes every AGENT-authored `comments` row and every `issue_events` row on the item whose `created_at` is strictly less than the cutoff, in one transaction. **Owner-authored comments are always preserved.** Writes a `history_pruned` audit event inside the same transaction (attributed to `x-atlas-agent-id` header if present). Rejects `before_time` less than 1 hour in the past. 404 if the item doesn't exist; 400 if the URL `:type` doesn't match the stored item type. Returns `{ comments_deleted, events_deleted, owner_comments_preserved }`. Called from the MCP `update_item` action `remove_history`. |

### `routes/search.ts`
**Why this group exists**: SQLite's FTS5 virtual table is the only way to get reasonable full-text performance over titles + descriptions across all five issue types. The web `/search` page builds an in-memory corpus from already-loaded entities for sub-second filter feedback, but the server endpoint remains the authoritative answer when the page is cold or an external client (MCP `search_items`) needs to search without having pre-loaded everything.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/search?q=â€¦` | FTS5 full-text across `issues_fts` virtual table |

(The web Search page also builds an in-memory corpus from already-loaded entities; the server FTS endpoint is the slower-path fallback.)

### `routes/events.ts` â€” SSE
**Why this group exists**: Atlas has no periodic polling â€” freshness is push-driven so the UI updates within milliseconds of a mutation instead of waiting on a poll cycle. SSE was chosen over WebSockets because the traffic is serverâ†’client only (heartbeat aside) and SSE survives HTTP proxies without special configuration. The in-memory client registry is intentional: a restart drops subscribers and the web reconnects, with `refetchOnWindowFocus` covering any drift during reconnection.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/events` | Open SSE stream. Long-lived. 30s heartbeat. |

In-memory client registry (`Set<(SSEEvent) => void>` in `routes/events.ts:5`). Dropped on server restart.

### `routes/run.ts` â€” Agent runs
**Why this group exists**: Runs are the audit trail of every agent spawn â€” used by the Queue page to show what's executing now, the Agent Detail Runs tab to show one agent's history, and the dashboard "in motion" panel. The single composite list endpoint with optional filters means all three consumers share the same data shape, and the `POST` spawns an ad-hoc run (agent-runner takes over from there and broadcasts SSE). Work on an item always goes through `routes/workflows.ts`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/run` | **Ad-hoc, no-item run only (ADR 0014).** Body `{ agent_id, project_id? }`. Any `issue_type` / `issue_id` → `400` (`Runs on an item go through a workflow …`). 404 unknown agent, 400 inactive agent. Inserts the `queued` row synchronously, returns `202 { runId }`, spawns in a `queueMicrotask` (`existingRunId`); a background failure marks the row `error` with `outcome_summary`. Runs in a throwaway temp dir (no worktree, no push, no PR). |
| GET | `/api/run/:id` | Single run. While the run is in-flight, `output_text` reflects the in-memory accumulator (fresher than the DB row, which only flushes every 10s). Optional `?since=<bytes>` returns only the tail past that byte offset â€” used by the web run-detail page after an SSE reconnect to fill the output gap. Bogus/non-integer values fall through to the full string. Rows (here and in the list) carry `workflow_run_id` + `node_id` (null outside a workflow). |
| GET | `/api/run?issue_type=â€¦&issue_id=â€¦&project_id=â€¦&limit=â€¦` | List runs. `project_id` joins through `items.project_id` so the Project Detail History tab can pull every run that touched any item in the project (epic / story / bug / sub-task / sub-bug) in one query. Also used by Queue and Agent Detail Runs tab. **List-mode projection (2026-05-30):** `prompt_snapshot` is returned as `NULL` and `output_text` is truncated to head 100 + tail 300 chars (with an `â€¦[elided]â€¦` separator when shortened). The detail endpoint `GET /api/run/:id` still returns the full payload. Cut the Queue / Agents `?limit=500` body from ~1.8 MB to ~6 KB; `GET /api/agents/:id/runs` uses the same projection. Max `limit` is now 500 (was 200). |
| GET | `/api/run?issue_type=…&issue_id=…&project_id=…&agent_id=…&limit=…` | **2026-09-12 — `agent_id` and `issue_type` now actually filter.** Both were in the accepted query shape and applied to nothing: `?agent_id=x` returned every run in the workspace, including for an agent with zero runs. Nothing user-facing broke (the Agent Detail Runs tab uses the dedicated `GET /api/agents/:id/runs`), but the params read as supported — `api.ts::run.list` sends `issue_type` and `routes-map.md` documented `?agent_id=`. For a single agent's history prefer `GET /api/agents/:id/runs`. |
| DELETE | `/api/run/:id` | Token-gated. Workflow step (`workflow_run_id` set): `cancelWorkflowRun` first (kills the step, keeps committed work, item → `waiting_for_info`), then deletes the row. Other runs: deletes the row plus sibling live runs on its item and resets that item to `ready` (`draft` stays) with no assignee. 204 |
| POST | `/api/run/:id/stop` | Flips a live run to `cancelled`, kills the CLI (`cancelRun`), then reports the step to the engine (`onStepFinished`) so a workflow step cancels its workflow run. 409 when already terminal. Broadcasts `run_completed` with the re-read status. Returns `{ runId, status, killedSubprocess, pidKilled }` |

### `routes/workflows.ts` — Workflows (ADR 0014)
**Why this group exists**: Workflows own orchestration — which agents run on an item (or the project), in what order, and how the work is delivered. Agents are just the nodes. Execution lives in `services/workflow-engine.ts`; CRUD, templates and read-models in `services/workflows.ts`. All writes are token-gated.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/workflows?project_id=…` | `IWorkflow[]` ordered by name |
| GET | `/api/workflows/templates` | `IWorkflowTemplate[]` read from `packages/api/src/marketplace/workflows/*.json` (`dev`, `planning`, `qa`, `ai-readiness`), graphs parsed with `WorkflowGraphSchema` |
| POST | `/api/workflows` | `CreateWorkflowSchema` (only `name` required). Defaults: `status active`, `input_kind item`, `trigger manual`, `use_worktree/push_code/raises_pr true`, `max_loops 3`, graph Start→End. Validates the graph (`validateWorkflowGraph` + every `agent_id` exists) → `400 {details:{graph_errors:[{node_id,message}]}}`; `project_id` required unless `input_kind='none'` and `!use_worktree`; `trigger='schedule'` needs `schedule_preset`, materialised to `cron_expr` + `next_run_at` via `materializeCron` in `settings.quiet_hours_timezone`. 201 |
| POST | `/api/workflows/from-template` | `{ template_id, project_id }`. Installs missing catalog agents (`marketplaceService.install`), resolves End `child_workflow_id` / `test_child_workflow_id: "template:<id>"` to that template's workflow **by name in the same project** (creating that workflow from its template first when the project lacks it), then creates. 201 |
| GET | `/api/workflows/:id` | Single `IWorkflow`, 404 |
| PATCH | `/api/workflows/:id` | `UpdateWorkflowSchema` (partial). Same graph / project / schedule validation on the merged row; recomputes `cron_expr` + `next_run_at` |
| DELETE | `/api/workflows/:id` | `409` while any run is `running` / `waiting_for_owner`; else 204 (runs cascade; step `agent_runs` keep history via SET NULL) |
| GET | `/api/workflows/:id/runs` | Last 50 `IWorkflowRunSummary` (run + `item_title`), newest first |
| POST | `/api/workflows/:id/runs` | Manual start. Body `{ item_id? }` — required for `input_kind='item'`, rejected for `'none'`. `202 { run_id }`. 404 workflow/item; 400 invalid graph, item in another project, item `done`; `409` item already has a live workflow run, or `depends_on` blockers not done (`details.blockers`) |
| GET | `/api/workflow-runs/:id` | `IWorkflowRunDetail`: summary + `workflow_name` + `steps` (`IWorkflowRunStep` per `agent_runs` row, oldest first: node, agent, status, cli, model, outcome, cost, times) |
| POST | `/api/workflow-runs/:id/stop` | `cancelWorkflowRun`: run → `cancelled`, live steps cancelled + killed, pushes committed work when `push_code` (no PR), cleans the worktree on a good push, item → `waiting_for_info`. Returns the run detail |
| POST | `/api/workflow-runs/:id/resume` | Only a `waiting_for_owner` run (else 409). Run → `running`, item → `in_progress`, then `continueResumedRun`. The resume path for project-level runs (no item to reply on) |
| GET | `/api/items/:id/workflow-runs` | Last 20 runs on the item |
| PUT | `/api/items/:id/workflow` | `{ workflow_id \| null }` — queue the item for a workflow (or unqueue). 400 workflow with `input_kind='none'` or another project. Does not change status; an `item_ready` workflow picks up `ready` items. 204 |

### `routes/settings.ts`
**Why this group exists**: Workspace-level config (owner profile, env, External Notification Channel, notification routing) all live in a single `settings` row, so the routes are organized by editing surface rather than entity. `POST /settings/reset` is the nuclear option â€” it drops all data and forces onboarding again â€” and is segregated from PATCH because it's destructive and irreversible. The env / external notification split exists because env changes typically need a server restart while external notification changes apply immediately.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | Single settings row. Response also includes a read-only `ai_enabled: boolean` field sourced from `process.env.ATLAS_AI_ENABLED` (never persisted). |
| PATCH | `/api/settings` | Update profile (name, accent, workspace) |
| POST | `/api/settings/onboard` | Initial onboarding submission. **2026-09-14** — creates `workspace_path` (`mkdirSync` recursive) before persisting, honoring the onboarding copy "We'll create this folder if it doesn't exist". Non-absolute path or mkdir failure → `400 { kind: 'validation_error', error: 'Could not create workspace folder <path>: <reason>' }` and nothing is saved (`onboarding_complete` stays 0). |
| GET | `/api/settings/env` | List env vars |
| PATCH | `/api/settings/env` | Save env vars (mirrors to `.env` file via env-file.ts) |
| PATCH | `/api/settings/external-notification` | Update External Notification Channel (token + chat id) |
| POST | `/api/settings/external-notification/test` | Send test message |
| PATCH | `/api/settings/notifications` | Per-event toggles + quiet hours |
| POST | `/api/settings/reset` | **Destructive.** Drop all data and return to onboarding. Wipes: `comments`, `notifications`, `agent_runs`, `items`, `projects` (cascades to project workflows + their runs), `credentials`, `agent_checklists`, `agents` (cascades to `agent_memory` + `agent_prompt_versions`). Preserved: reference seed data (`cli_models`, `tool_catalog`, `guardrail_rules`, `guardrail_scripts`, `roles`, `marketplace_agents`) and — not in the delete list — `reminders`, `scratch_pad`, project guardrail tables cascade with `projects`. Does not re-install any agent; the Owner lands on onboarding with zero agents. Resets the `settings` singleton to defaults. |

### `routes/credentials.ts`
**Why this group exists**: Git credentials are secrets that must never round-trip plaintext through a list response, so the GET deliberately omits the token (only fingerprint + metadata leaves the server). Create validates the token against the host before persisting to catch typos at write time rather than at clone time. The PATCH semantic of "blank token = keep existing" lets the Owner rotate labels or scopes without re-typing secrets. Reading a stored token back is a separate, gated, audited call — not something a list render can do by accident.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/credentials` | List. `token_encrypted` is nulled by `stripSecretsForApi`; `token_fingerprint` (prefix + mask + last 4) IS returned — it is the Credentials table's disambiguation column, and nulling it left that column, the saved-view detail and "Copy fingerprint" permanently blank. |
| GET | `/api/credentials/:id/token` | **2026-09-12.** On-demand plaintext for one stored PAT. `preHandler: requireMcpToken`; logs `{tag:'secret_reveal', scope:'credential'}`. `400` for a `github_app` row (its token is an ephemeral minted installation token — revealing it hands out a credential that outlives the click and tells the Owner nothing). Powers the eye icon in `CredentialModal`, which previously toggled the input `type` over a field nothing ever hydrated. Mirrors `GET /api/environment-secrets/:key/value`. |
| POST | `/api/credentials` | Create (validates token against host, encrypts at rest) |
| PATCH | `/api/credentials/:id` | Update (token optional — blank keeps existing) |
| DELETE | `/api/credentials/:id` | Delete |

### `routes/schedules.ts` â€” Project auto-fetch
**Why this group exists**: Auto-fetch keeps the worktree's view of remote refs fresh so the Owner doesn't need to `git fetch` before every session; it's per-project because different repos have different staleness tolerances. The `/fire` endpoint exists for manual testing â€” without it, validating a new cron expression required waiting for the next scheduled fire. Croner jobs live in an in-memory registry that rebuilds on startup and catches missed fires (server may have been off when a schedule was due).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/:id/schedule` | Read schedule |
| PUT | `/api/projects/:id/schedule` | Upsert schedule |
| POST | `/api/projects/:id/schedule/fire` | Manual one-off fire (testing) |

Registered Croner jobs live in `services/schedule-registry.ts` (boot on startup, catch missed fires on restart).

### `routes/notifications.ts`
**Why this group exists**: Notifications are the delivery queue for both external notification and in-app feed; modeling them as a queue with explicit states (pending / sent / failed / cancelled) lets the Owner retry transient failures and cancel pending items during quiet hours. Resend exists separately from create because it preserves the original event metadata for the audit trail. Mark-all-read is bulk because the in-app feed accumulates noise the Owner has already addressed elsewhere.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notifications?external_status=â€¦&limit=â€¦` | List |
| PATCH | `/api/notifications/:id/sent` | Mark as sent (external notification service callback) |
| POST | `/api/notifications/:id/resend` | Resend a failed/sent notification |
| POST | `/api/notifications/:id/cancel` | Cancel a pending one |
| POST | `/api/notifications/mark-all-read` | Bulk mark read (in-app feed) |
| POST | `/api/notifications/send-external` | A09 one-shot external message (MCP `sendExternalNotification`). Body `{message (1-4000), event_key? (≤64)}`. **2026-09-14:** returns `202 {ok: true, sent: boolean}` — `sent:false` means quiet hours, an off event toggle, or no configured transport suppressed it (previously always `{ok:true}`) |

**2026-09-14 — delivery status honesty.** `sendExternalNotification` returns `true` only when a transport actually sent; quiet hours, an off event toggle, or an unconfigured transport return `false`. `sendExternalForNotification` then writes `external_status='sent'` only on `true`, otherwise reverts the row to `'none'` (the schema's existing "no external delivery" value, same as cancel — no new status added), so the Notification Log never shows "Sent" with no channel connected.

**2026-09-14 — stale `needs_you`.** The list endpoint and the unread count (`notificationsService.list` / `countUnread`) hide `kind='needs_you'` + `event_type='agent_completed'` rows whose linked item is no longer `waiting_for_info` / `in_review`. Rows with no item, and other `needs_you` sources (`agent_error`, terminal idle, auto-fetch), are never hidden — they aren't derived from item status.

### `routes/scratchPad.ts` â€” Scratch Pad (P12)
**Why this group exists**: A free-form markdown surface the Owner uses to capture half-formed thoughts that aren't yet Epics / Stories / Bugs. Sits outside the item/project/agent graph by design â€” no FK, no SSE, no validation beyond "title and body are strings". The web page autosaves every 5 s while open, so PATCH is the hot path.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/scratch-pad` | List all tiles, newest-first by `updated_at`. |
| GET | `/api/scratch-pad/:id` | Single tile (404 when missing). |
| POST | `/api/scratch-pad` | Create a tile. Body is optional: `{ id?, title?, body_md? }`. Empty body creates an empty tile with a server-minted UUID. |
| PATCH | `/api/scratch-pad/:id` | Patch title and/or body_md. Rejects empty bodies with 400. |
| DELETE | `/api/scratch-pad/:id` | Delete (hard, no soft-delete trail). |

### `routes/counts.ts` â€” sidenav + dashboard aggregates
**Why this group exists**: The sidenav badges and dashboard KPIs are visible on nearly every page, and computing them client-side from the loaded entity lists is slow plus inaccurate (the page only loads what it needs). A pre-aggregated server endpoint shrinks the badge refresh to one query and means SSE `counts_changed` can refresh both surfaces uniformly.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/counts` | Sidenav badge counts (projects, epics, issues, queue, notifications-unread) |
| GET | `/api/dashboard` | KPI strip + awaiting-you + in-motion (route handler at `routes/counts.ts:14`; historical docs called this `/api/counts/dashboard`). **2026-09-14** — `agentStatsByCategory[cat].queued` counts Ready epics/stories/bugs assigned to an agent of that category (same rule as the Queue badge), not `agent_runs.status='queued'`; `running` still counts `in_progress` runs. Shape unchanged. |
| GET | `/api/counts/project/:id` | Project Detail Overview tab KPIs (open_epics, epics_ready, stories_in_flight, stories_waiting_info, open_bugs, bugs_ready) |

### `routes/reminders.ts` â€” Reminders (A10)
**Why this group exists**: Owner-set reminders fired by the scheduler tick; stored separately from notifications because they're future-pointing intents rather than past-event records.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/reminders` | List active + completed reminders |
| POST | `/api/reminders` | Create a reminder (body: `{ subject, next_fire_at, frequency?, payload? }`) |
| DELETE | `/api/reminders/:id` | Cancel a reminder (status â†’ 'cancelled', does not delete the row) |
| POST | `/api/reminders/:id/fire` | Manual fire (testing) |

### `routes/analytics.ts` â€” Analytics
**Why this group exists**: Cost rollup + token usage + run-frequency reports aggregated server-side because computing them client-side requires the full `agent_runs` table.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/analytics/workspace` | Workspace-wide rollup (cost, tokens, runs, top agents) |
| GET | `/api/analytics/project/:projectId` | Per-project rollup |
| GET | `/api/analytics/epic/:epicId` | Per-epic rollup (includes child stories/bugs in the cost tree) |

### `routes/labels.ts` â€” Labels (Task 2)
**Why this group exists**: Item labels stored as a jsonb array on `items.labels`. The labels endpoint surfaces the union of labels currently used in a project (or across the workspace) so the labels picker can suggest existing strings before the user types a brand new one.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/labels?project_id=â€¦` | Distinct labels in use across items in a project |
| GET | `/api/labels?workspace=true` | Workspace-wide label union (Search filter chip) |

### `routes/marketplace.ts` â€” Agent marketplace
**Why this group exists**: The marketplace is the only install path for new agents (see ADR 0007). Browse the catalog, inspect a single bundle, install it into the workspace.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/marketplace/agents?limit=â€¦` | List catalog entries (sort_order) |
| GET | `/api/marketplace/agents/:id` | Single catalog entry (composite) |
| POST | `/api/marketplace/agents/:id/install` | Install a marketplace agent into the workspace. `409 {details:{code:'SLUG_TAKEN', suggested_id}}` when the local slug is taken. **2026-09-12:** `400 {code:'MODEL_NOT_IN_REGISTRY'}` when the catalog entry names a `(cli, model)` pair absent from `cli_models` — `install` now calls `assertModelInRegistry` (exported from `services/agents.ts`) before the transaction. `agents` carries a composite FK on `(cli, model)` that `marketplace_agents` does not, so a pruned registry row previously surfaced as an opaque FK `500` and the bulk-install bar could only report "N couldn't be added". `marketplaceService.importBundle` (behind `POST /api/agents/import`) got the same guard — identical hole. |
| POST | `/api/agents/import` | Upload a zipped agent bundle (multipart). Token-gated. |
| GET | `/api/agents/:id/export` | Download the active agent as a zip |
| POST | `/api/agents/:id/detach` | Detach from marketplace source (`marketplace_source_id` â†’ NULL) |

### `routes/guardrail-scripts.ts` and `routes/project-guardrail-scripts.ts` â€” Guardrail scripts
**Why this group exists**: Scripted guardrails (sh/ps1) live in `guardrail_scripts` + `project_guardrail_scripts`. Agents fetch + execute these as part of the SDLC validation flow. A project script with the same slug as a workspace script (e.g. `coder-tests-green`) overrides it for that project's worktrees. **2026-09-14:** the seeded `coder-tests-green` gate is project-agnostic — it runs `typecheck` / `lint` only when `package.json` declares them, via the package manager the lockfile implies (pnpm / yarn / npm), and accepts `*.test|spec.{js,ts,jsx,tsx,mjs,cjs}`, `*_test.go`, `test_*.py`. It used to hardcode `pnpm typecheck` + `pnpm lint` + `*.test.ts`, so Coder parked every non-pnpm project.

**2026-09-14 — PO / QA gates made real.** `po-writer-output` (arg: epic id) used to only check `.atlas/current-task.md` existed. It now reads `GET $ATLAS_API_URL/api/epics/:id/full` + `GET /api/issues/story/:id/links` (curl + `node -e` / `Invoke-RestMethod`) and requires: at least one dev story (title not ending `[QA]`); non-empty `acceptance_criteria` on every dev story; a `<dev title> [QA]` twin with a `tested_by` link either direction; `worktree_branch` matching `WORKTREE_BRANCH_RE_SOURCE` on every story. `ATLAS_API_URL` unset is a gap, not a pass. `qa-writer-csv` and `check-automation-tests` now use the Jira-importable header the QA prompts write (`Summary,Description,Issue Type,Priority,Labels,Components`; `qa-plan.csv` template matches) instead of the retired `test-id,criterion-id,...` schema: `qa-writer-csv` checks the exact header, at least one non-blank data row, and that HEAD touched the CSV; `check-automation-tests` parses the CSV RFC-4180 (quoted commas/newlines) and, for every row whose `Labels` (`;`-separated) contain `automation-yes`, requires a test file changed since merge-base (same `*.test|spec.*` / `*_test.go` / `test_*.py` patterns as the coder gate) that contains the row's `Summary`. Rows that are all `automation-no` pass without test changes. Behavioural tests in `db/seed.test.ts`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/guardrail-scripts` | List workspace scripts |
| POST | `/api/guardrail-scripts` | Upload a new script |
| PATCH | `/api/guardrail-scripts/:id` | Update body or kind |
| DELETE | `/api/guardrail-scripts/:id` | Delete |
| GET | `/api/projects/:projectId/guardrail-scripts` | List per-project scripts |
| POST | `/api/projects/:projectId/guardrail-scripts` | Add per-project script |
| PATCH | `/api/projects/:projectId/guardrail-scripts/:id` | Update |
| DELETE | `/api/projects/:projectId/guardrail-scripts/:id` | Delete |

### `routes/projects.ts` â€” added 2026-06-09 audit
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/paged?page=N&limit=M` | Paginated projects list (Projects page footer pagination) |

### `services/tool-catalog-sync.ts` â€” read-only MCP tool directory

The `tool_catalog` table is a read-only directory of MCP tools the spawned CLI may call. **A06**: `syncToolCatalog()` imports `ALL_TOOL_REGISTRATIONS` from `@atlas/mcp/registrations` and projects every non-excluded registration (`name`, `title`, `description`, `group_name`, `sort_order`). One source of truth for the MCP server registrations *and* the directory; adding a new MCP tool is a one-line append to `tools/<group>.ts`'s typed `<GROUP>_TOOLS` array and both consumers pick it up on the next boot.

`excludeFromCatalog: true` on a registration hides it from the directory (e.g. `submit_review` â€” the runner injects it on every reviewer run, so a toggle would have no effect). 31 tools surface today (32 registered âˆ’ 1 excluded: `submit_review`); per-group counts in `.agents/mcp.md`. The per-agent allow-gate that used to consume this table was removed by `253c43d` + B14 (`d3cc9bf`); the spawned CLI inherits Owner's user-level MCP config wholesale and the constitution carries `FORBIDDEN_TOOLS_SECTION` as the only safety net. Guardrails (general + project) and project auto-fetch schedules were stripped from the MCP surface 2026-05-28 â€” Owner-only via REST and web UI; agents receive guardrails through the prompt's constitution section, never via MCP.

### `services/agent-schedule-registry.ts` — one-minute poller

A single `setInterval` ticks every 60s, first tick aligned to the next wall-clock minute (`startAgentSchedulerPoller`, started from `main.ts`). Agents have no schedule or queue (ADR 0014); the tick (`tickAgentScheduler`) runs, in order, each step isolated in its own try/catch:

1. **Stuck-run watchdog** (`sweepStuckRuns`) — `in_progress` runs started > 30 min ago with no `output_text` → `error`, then `onStepFinished` so the workflow parks.
2. **Reminders** — `remindersService.fireDueReminders`.
3. **GitHub App tokens** — pre-warm installation tokens within 15 min of expiry.
4. **Workflow reconcile** (`reconcileWorkflowRuns`) — parks any `running` workflow run with no live step and `updated_at` older than 10 min (`WORKFLOW_RECONCILE_AFTER_MS`; longer than a worst-case End push + PR).
5. **Workflow dispatch** (`tickWorkflowDispatch`) — for active `item_ready` / `schedule` workflows. A workflow starts a run only when none of its runs is `running`; parked runs don't hold the queue. `item_ready` → oldest `ready` item with that `workflow_id` and no live run. `schedule` → when `next_run_at <= now`, advance `next_run_at` (croner, `settings.quiet_hours_timezone`) and stamp `last_run_at`; `input_kind='none'` starts one project-level run, `input_kind='item'` drains items that were `ready` by `last_run_at`, one per tick. A missed fire while the server was off starts on the first tick.

Consecutive steps never wait for this tick — the engine chains them directly. `finishRun` / `cancelWorkflowRun` also kick one dispatch pass immediately so a child workflow or the next queued item starts without the 60s wait.

### `routes/fs.ts` â€” filesystem helpers for the folder picker UI
**Why this group exists**: Browsers can't enumerate the filesystem directly; the FolderPicker component used in Onboarding and Settings depends on these endpoints to walk the Owner's local drives. They're intentionally narrow (list / stat / join / home) â€” no write operations â€” because the browser-side picker only needs read access to pick a target path.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/fs/list?path=â€¦` | List children of a path (handles Windows drive letters) |
| GET | `/api/fs/stat?path=â€¦` | Stat a path |
| GET | `/api/fs/join` | Path join helper |
| GET | `/api/fs/home` | Home directory |

### `routes/cli-availability.ts`
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cli/availability` | **2026-09-14.** `ICliAvailability[]`, one entry per `AGENT_CLIS` value in order (`claude`, `copilot`, `ollama`): `{cli, binary, available, version}`. `binary` comes from `cli-session-host.ts::resolveCliBinary` (`ATLAS_CLAUDE_BINARY` / `ATLAS_COPILOT_BINARY` overrides, else `claude`/`copilot`; `ollama` → the claude binary). `available` = `<binary> --version` exited 0 within 3 s (execFile, no shell except on win32 where `.cmd` shims need cmd.exe); `version` = first stdout line trimmed, or null. Results cached in-memory 60 s (`services/cli-availability.ts`) |

### `routes/cli-models.ts`
**Why this group exists**: CLIs (`claude`, `copilot`, `ollama`) ship new model names faster than the app releases; making the model registry editable lets the Owner add tomorrow's model without a code change. Pre-validating model names through this endpoint means the agent picker dropdowns never surface an unsupported value, which would otherwise spawn a failing CLI invocation.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cli-models` | List registered models per CLI |
| POST | `/api/cli-models` | Register new model (Add row in Model Registry tab) |
| DELETE | `/api/cli-models/:id` | Remove. **2026-09-12:** refuses with `409 {details:{code:'MODEL_IN_USE', agents, marketplace_agents}}` while any `agents` OR `marketplace_agents` row still names the `(cli, model)` pair. `agents` has a composite FK with ON DELETE RESTRICT so Postgres already blocked the installed-agent case; `marketplace_agents` has no FK, so removing a model only catalog entries referenced used to succeed silently and then make those entries permanently uninstallable. |

### `routes/tool-catalog.ts`
**Why this group exists**: Read-only directory of every Atlas MCP tool the server exposes. Owner-facing for discoverability; no enforcement attached (per-agent allowlists were dropped 2026-05-27 â€” spawned CLIs inherit Owner's user-level MCP config wholesale).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/tool-catalog` | Seed-ordered groups + tools |

### `routes/guardrails.ts` â€” global workspace guardrails
**Why this group exists**: Workspace guardrails are the constitution every agent is bound by; CRUD is per-rule because the Owner reviews and tightens rules over time. The bulk `/save` endpoint exists because rules are typically reviewed in batch ("I'm hardening security this session") and a single commit makes audit history cleaner than fifteen separate PATCH calls.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/guardrails` | List rules |
| POST | `/api/guardrails` | Create rule |
| PATCH | `/api/guardrails/:id` | Update rule |
| DELETE | `/api/guardrails/:id` | Delete rule |
| POST | `/api/guardrails/save` | Bulk commit "session dirty" rules (Save Guard-rails button in the page) |

### `routes/project-guardrails.ts` â€” per-project guardrails
**Why this group exists**: Per-project rules layer on top of workspace rules so a project can carry repo-specific constraints ("don't touch /migrations in this repo") without polluting the global set. The dedicated `/toggle` endpoint exists because enable/disable is the high-frequency operation (temporarily turning a rule off during a planned migration) and the payload is just `{ enabled }` â€” folding it into the generic PATCH would force every toggle to roundtrip the full rule body.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/projects/:projectId/guardrails` | List per-project rules |
| POST | `/api/projects/:projectId/guardrails` | Create rule |
| PATCH | `/api/projects/:projectId/guardrails/:id` | Update rule |
| PATCH | `/api/projects/:projectId/guardrails/:id/toggle` | Enable/disable |
| DELETE | `/api/projects/:projectId/guardrails/:id` | Delete |

### `routes/cli-sessions.ts` — Terminal (PTY-backed CLI sessions)
**Why this group exists**: The Terminal pages run real `claude` / `copilot` CLIs in server-side ConPTY sessions (`cli = ollama` runs `claude` with the Ollama env overlay); the browser is only a viewport. REST manages the session lifecycle; one WebSocket per attached pane carries the byte stream.

**Two kinds of session share this table and every endpoint below.** A **project** session is scoped to an Atlas-provisioned worktree. A **standalone** session (`project_id IS NULL`) is a PTY on a folder the Owner picked: no project, no worktree, no `.atlas/` staging, and no commit/push/PR on the way out. `project_id === null` is the sole discriminator; the route's `isStandalone()` helper gates every branch. See [`26-terminal-standalone`](pages/26-terminal-standalone.md).

`worktree_path` means "the session's cwd" for both kinds — the standalone folder is stored there so transcript ingest, cost accounting and the history page work unchanged. `worktree_branch !== null` is what means "Atlas created and owns this directory", and it is what the finalize path must key its teardown off: `cleanupWorktreeAfterPush` deletes the directory it is handed, which for a standalone session would be the Owner's real repository.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cli/sessions` | List sessions (optional `?project_id=`, `?standalone=true\|false`), `last_active_at desc`, cap 200. The standalone filter is server-side precisely because of that cap — a busy project would otherwise push standalone rows off the end of their own page's list |
| GET | `/api/cli/sessions/:id` | Single session row |
| POST | `/api/cli/sessions` | Create + spawn PTY (stages worktree via `stageCliWorktree`) |
| POST | `/api/cli/sessions/standalone` | Create + spawn PTY in a caller-supplied folder. Body `{folder_path, credential_id?, cli, model?, title?, initial_prompt?}` (`CliSessionStandaloneCreateSchema`, `.strict()`). Skips `ensureWorktree` / `stageCliWorktree` / `runProjectSetup` entirely. **Gated by `requireMcpToken`** — same gate as `/api/fs/*`, because it spawns a process at an arbitrary server path. 400 on a non-absolute path, a missing path, or a path that isn't a directory; 404 on an unknown `credential_id`. Title defaults to the folder's basename |
| POST | `/api/cli/sessions/:id/pause` | Kill PTY, keep row (`paused`) for later `--resume` |
| POST | `/api/cli/sessions/:id/resume` | Respawn PTY with `--resume <cli_session_id>`. Re-stages the worktree for project sessions only; auth comes from `session.credential_id ?? project.credential_id` so an explicit pick is never replaced by the project default |
| POST | `/api/cli/sessions/:id/preflight-stop` | Dry-run of the stop finalize (dirty files, branch state). Owns the *stageable* path set — `files_to_stage` is built from it. 409 `details.code='standalone_session'` for standalone rows |
| GET | `/api/cli/sessions/:id/diff` | Per-file change summary for BOTH review scopes (`uncommitted` = worktree vs HEAD incl. untracked; `committed` = merge-base(base, HEAD)..HEAD) + `base_ref`/`base_sha`/`commits_ahead_of_base`. 409 `details.code='worktree_missing'` when the dir is gone (closed rows keep a stale `worktree_path`); 409 `details.code='standalone_session'` for standalone rows |
| GET | `/api/cli/sessions/:id/diff/file` | One file's unified patch. `?scope=uncommitted\|committed&path=<rel>&context=0..25` (default 3). 404 when `path` isn't in that scope's changed set — that membership check, not the zod schema, is what stops this being an arbitrary-file reader. 409 `standalone_session` as above |
| POST | `/api/cli/sessions/:id/stop` | Kill PTY, commit/push/PR finalize, `closed`. Body takes `open_pull_request` (default `true`); `false` still pushes — the worktree is deleted right after close — and only skips `gh pr create` + the `item_external_links` row. **Standalone short-circuit**: kills the PTY, ingests the transcript (so spend lands), marks `closed`, returns `{pushed:false, committed:false, finalize_pr_url:null}` — no commit, no push, no PR, and above all no `cleanupWorktreeAfterPush`. It sits ABOVE the `worktree_branch` guard on purpose: that guard would 409 a standalone row and strand it `active` with a live PTY and no way to close it |
| GET | `/api/cli/sessions/:id/transcript` | Ingested CLI JSONL transcript (lazy ingest if NULL) |
| DELETE | `/api/cli/sessions/:id` | Kill PTY + delete row |
| GET (WS) | `/api/cli/sessions/:id/stream` | Live byte stream; terminal data is binary both directions, text frames are control envelopes |

**WS stream contract** (`services/cli-session-host.ts`): terminal geometry is **pinned** — PTY, server mirror, and every browser pane all run at the shared `TERMINAL_COLS × TERMINAL_ROWS` (120×30, `@atlas/shared`) for the whole session lifetime, and `pty.resize()` has zero call sites. This is the fix for the ConPTY "zombie characters": ConPTY answers any resize by repainting its whole buffer with reflow semantics that never exactly match xterm's, so any moment where the PTY's believed width and a viewer's width differ strands unerased cells — and with one PTY and N viewers, dynamic geometry can never be mismatch-free. Browser panes adapt by scaling their font, never the grid. On attach the server first sends a **`{cmd:'ptyInfo'}` text frame** — on a Windows host it carries `windowsPty: {backend:'conpty'|'winpty', buildNumber}` (node-pty's own gate: conpty iff build ≥ 18309), which the browser applies to xterm's `windowsPty` option (also passed to the headless mirror at creation) to honor ConPTY's other repaint assumptions. Then the server replays a **serialized screen snapshot** — a clean, well-formed VT stream produced by a per-session `@xterm/headless` mirror (`services/terminal-screen-state.ts`) — then forwards raw PTY bytes live, each byte delivered exactly once (snapshot XOR live). The snapshot contains no DSR queries and is always laid out at the pinned grid, so reconnect/refresh never renders mid-sequence "zombie" characters. Inbound: raw bytes are typed into the PTY; the JSON control envelope `{cmd:'resize'}` is recognized, consumed, and **dropped** (kept only so a stale client's frame can never be typed into the shell as literal JSON). Auth: WS upgrades bypass the POST-only write gate, so the route accepts only trusted browser Origins or `?token=<ATLAS_MCP_TOKEN>`.

### `routes/server.ts` â€” process control
**Why this group exists**: Several env vars are read once at process boot (DB path, port); applying their new values requires a restart. Rather than instruct the Owner to find the shell and kill the process, the app exposes one button that exits cleanly and expects a supervisor (nodemon in dev, PM2 in deploy) to relaunch â€” the only mechanism by which a non-CLI Owner can apply restart-required env changes.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/server/restart` | `process.exit()` and expect a supervisor (e.g. nodemon, PM2) to relaunch |

### Documentation â€” `@fastify/swagger` + `@fastify/swagger-ui`
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/docs` | Swagger UI |
| GET | `/api/docs/json` | OpenAPI 3 JSON spec |

---

## SSE event catalogue

All events flow through `/api/events`. The web subscribes via `useSSE()`. SSE is the **primary** freshness mechanism â€” most UI surfaces have NO polling and rely entirely on these events plus `refetchOnWindowFocus`.

| Event | Emitted by | When |
|---|---|---|
| `heartbeat` | events.ts:31 | every 30s on every open stream |
| **Agent run lifecycle** | | |
| `agent_status` | services/agent-runner.ts | run started / state change |
| `agent_output` | agent-runner.ts | CLI stdout/stderr chunk |
| `agent_error` | agent-runner.ts | spawn failure or non-zero exit |
| `run_queued` | agent-runner.ts (after `INSERT INTO agent_runs`) | a new run row was created in `queued` state |
| `run_completed` / `run_error` | agent-runner.ts, routes/run.ts (stop) | terminal run state |
| **Workflows (ADR 0014)** | | |
| `workflow_run_updated` | services/workflow-engine.ts (`broadcastRun`) | a workflow run started, moved to a node, parked, completed or was cancelled. Payload `workflowId`, `workflowRunId`, `workflowRunStatus`, `nodeId` (null at start), `issueId` for item runs. Item status changes the engine makes also broadcast `counts_changed {issueType, issueId}` |
| **Data mutations (push replaces polling)** | | |
| `counts_changed` | services/stories, issues, epics, **agents**, **projects** on create/update/transition/assign/delete; services/workflows on workflow create/update/delete (`scope: 'sidenav'`) and `PUT /api/items/:id/workflow`; services/workflow-engine on every item status write and child routing; services/comments on an Owner reply that resumes a parked workflow run; services/external-links when a PR's `pr_state` changes; notifications on create/markAllRead; agent-runner on run queue; routes/marketplace on install | any DB mutation that could affect sidenav badges or dashboard KPIs |
| `notification_created` | services/notifications.ts:create() | a new notification row was inserted |
| `notification_updated` | services/notifications.ts:updateExternalStatus, markAllRead | external notification delivery status changed or read state flipped |
| **Project ops** | | |
| `clone_status` / `clone_output` / `clone_completed` / `clone_error` | services/clone-runner.ts | git clone lifecycle |
| `reclone_status` / `reclone_output` / `reclone_completed` / `reclone_error` | services/reclone-runner.ts | reclone lifecycle |
| `delete_status` / `delete_output` / `delete_error` | services/delete-runner.ts | delete lifecycle |
| `autofetch_status` / `autofetch_output` / `autofetch_completed` | services/auto-fetch-runner.ts | scheduled fetch lifecycle |
| **CLI smoke-test (dry-run)** | | |
| `dry_run_started` | services/dry-run.ts | `POST /api/agents/:id/dry-run` accepted; carries `dryRunId`, `agentId`, summary line |
| `dry_run_output` | services/dry-run.ts | stdout / stderr chunk from the spawned CLI; carries `stream: 'stdout' \| 'stderr'` |
| `dry_run_done` | services/dry-run.ts | CLI exited (or timed out / errored); carries `exitCode` |
| **Memory regeneration (Theme 08)** | | |
| `memory_regenerated` | services/agent-memory.ts (`regenerate` + `appendLesson`) | a memory write landed; payload carries `agentId`, optional `runId`, `memoryRegenerationTrigger` (`manual`/`cadence`/`high_signal`/`mcp_update`), `memoryVersion`. Used by the Memory tab to refresh the history list + body without a manual fetch. |
| **Commit discipline (Theme 11)** | | |
| `commit_verification` | services/commit-verifier.ts (`verifyRunCommits`) | post-run audit landed; payload carries `agentId`, `runId`, `commitVerificationResult` (`compliant`/`partial`/`silent`/`clean`). Web invalidates `['agents', agentId, 'commit-verifications']`. |

**Web invalidation map (`packages/web/src/hooks/useSSE.ts`):**

| Event | React Query keys invalidated |
|---|---|
| `run_completed` / `run_error` | `['workflow-run']`, `['dashboard']`, `['sidenav-counts']`, `['runs']`, `['agents', agentId, 'runs']`, `['agent-run', runId]` |
| `agent_status` | `['workflow-run']`, `['agents']`, `['runs']`, `['agents', agentId, 'runs']`, `['agent-run', runId]` |
| `run_queued` | `['runs']`, `['dashboard']`, `['sidenav-counts']`, `['agents', agentId, 'runs']` |
| `clone_completed` | `['projects']`, `['sidenav-counts']` |
| `counts_changed` | `['sidenav-counts']`, `['dashboard']`, `['epics']`, `['stories']`, `['bugs']`, `['issues']`, `['agents']`, `['projects']`, `['workflows']` — every list whose count this event reports |
| `notification_created` | `['notifications']`, `['sidenav-counts']`, `['dashboard']` |
| `notification_updated` | `['notifications']`, `['sidenav-counts']` |
| `memory_regenerated` (Theme 08) | `['agents', agentId, 'memory']`, `['agent-memory-history', agentId]` |
| `commit_verification` (Theme 11) | `['agents', agentId, 'commit-verifications']` |
| `workflow_run_updated` (ADR 0014) | `['workflows']`, `['workflow-run', workflowRunId]`, `['workflow-runs', workflowId]`, `['item-workflow-runs', issueId]` |

`agent.run_finished_no_item` is the ExternalNotificationEventKey for runs with no item: ad-hoc `POST /api/run` runs (success and error) and project-level workflow runs (park and End). Workflow steps don't notify per step — the engine notifies once at park (`item.status_changed:waiting_for_info` for item runs) and once at End (`item.status_changed:in_review` when a PR opened).

---

## MCP tool catalogue (Theme 07)

The MCP server (`packages/mcp/src/server.ts`) registers tools via
`registerAllTools()` in `packages/mcp/src/tools/index.ts`. Each tool is a
thin wrapper over an `api-client.ts` method which in turn hits a REST
route. The token gate on the API rejects writes from non-trusted origins
unless `X-Atlas-Token` matches `ATLAS_MCP_TOKEN`.

**A06** â€” every tool's registration metadata (`name`, `title`, `description`,
`group_name`, `sort_order`, `excludeFromCatalog?`, `inputSchema`, `handler`)
lives in a typed `<GROUP>_TOOLS` array in `packages/mcp/src/tools/<group>.ts`.
`registrations.ts` re-exports `ALL_TOOL_REGISTRATIONS`; the API's
`tool-catalog-sync` projects from it so the Allowed Tools picker matches the
MCP surface automatically. Performer-persona prompts include a Working
Protocol bullet directing agents to optionally call `updateAgentMemory(mode='append')`
for generic behavioral lessons; reviewer prompts carry a symmetric clause.
Both invoke the same memory boundary rule embedded in the tool description.

**B05** â€” `update_item action='add_link'` is intentionally
**agent-discretionary**: no Working Protocol bullet mentions it in any
performer or reviewer prompt. The MCP tool description is the only trigger â€”
agents may call it when they discover a missing dependency, and the UI's
`<RelatedItemsCard>` is the Owner-side counterpart (both hit
`POST /api/issues/:type/:id/links`). The runner does not parse agent output
to infer links, and nothing auto-links at step or End time. The read-side is
non-discretionary: every prompt includes a `## Related items` section
listing existing links up-front (the `item_links` field on the `get_item`
envelope), so a fresh `get_item` mid-run is rarely needed. Full mechanism in
`.agents/data-model.md` Depends-on section.

### Tool consolidation (2026-07-01)

The 35-tool surface was collapsed to **13 enum-parameterized tools** so
low-context CLIs (Copilot CLI, Gemini, anything without semantic tool search)
pay a much smaller schema-load tax per prompt. Each tool routes to the same
REST endpoints as before; only the MCP-side dispatch changed.

| Domain | Tool | Discriminator | Method â†’ Route |
|---|---|---|---|
| Agents | `crud_agent` | `op: 'search' \| 'get' \| 'create' \| 'update' \| 'delete'` | GET / GET / POST / PATCH / DELETE /api/agents[/:id] â€” `search` returns a compact projection; `get` returns the composite (agent + checklists); `create`/`update` take a nested `payload`. **Forbidden for agents** with `op` in `{create, update, delete}` (constitution clause). |
| Agents | `agent_memory` | `op: 'get' \| 'update'` | GET / PUT /api/agents/:id/memory â€” `update` accepts `mode: 'replace' \| 'append'` and `source: 'ai-generated' \| 'manual-edit'`. Description embeds the memory-boundary rule (Theme 08). |
| Agents | `marketplace_agent` | `op: 'search' \| 'get'` | GET /api/marketplace/agents[/:id] â€” `search` returns lightweight projections with optional filters (`query`, `category`, `kind_slug`, `limit`); `get` returns the full composite (manifest + prompt + checklists + version + published_at). |
| Items | `search_item` | â€” | GET /api/search?q=â€¦ (Postgres tsvector FTS; returns up to 20 ranked items with `description` populated for dedup substring-checks). |
| Items | `create_item` | `issue_type: 'epic' \| 'story' \| 'sub_task' \| 'sub_bug' \| 'bug'` | POST /api/epics or /api/stories or /api/stories/:id/sub-{tasks,bugs} or /api/bugs â€” parent id required per type (`project_id` for epic, `epic_id` for story/bug, `story_id` for sub_task/sub_bug). Other fields live in `payload`. Optional top-level `agent_id` is forwarded as `x-atlas-agent-id` (created-event actor + default reporter). |
| Items | `get_item` | `issue_type + id` | GET /api/{type}s/:id/full + GET /api/comments â€” always returns the full envelope: item + parent + project + children + comments + item_links + external_links + activity + agents. Single MCP round-trip; the client fans out the two reads in parallel. |
| Items | `update_item` | `action: 'patch_fields' \| 'change_status' \| 'assign' \| 'add_comment' \| 'add_link' \| 'remove_link' \| 'add_external_link' \| 'remove_external_link'` | PATCH /api/{type}s/:id (patch_fields, per-type Zod) or PATCH /api/{type}s/:id/status (change_status, status-machine guard) or PATCH /api/{type}s/:id/assign (assign, active-agent guard) or POST /api/comments (add_comment) or POST /api/issues/:type/:id/links (add_link) or DELETE /api/issues/links/:linkId (remove_link) or POST /api/issues/:type/:id/external-links (add_external_link, GitHub PR URL validation) or DELETE /api/issues/external-links/:linkId (remove_external_link). All branches preserve the prior audit-trail and SSE events. `change_status` / `assign` return 409 while a `running` workflow run holds the item (workflow item lock); agents report through the `atlas-outcome` block instead. `add_link` / `remove_link` / `add_external_link` forward `agent_id` as `x-atlas-agent-id`. |
| Items | `delete_item` | `issue_type + id` | DELETE /api/{type}s/:id â€” cascade per existing API semantics. Returns `{deleted: true, issue_type, id}`. |
| Projects | `listProjects` | â€” | GET /api/projects |
| Projects | `getProject` | â€” | GET /api/projects/:id |
| Reminders | `crud_reminder` | `op: 'create' \| 'update' \| 'cancel'` | POST / PATCH / DELETE /api/reminders[/:id] |
| Reminders | `search_reminder` | optional `status` / `channel` / `since` filters | GET /api/reminders[?â€¦] |
| Notifications | `sendExternalNotification` | â€” | POST /api/notifications/send-external (A09; one-shot Owner-bound notification via the configured external channel) |

**Catalog totals:** 13 registered, all 13 in the picker. Per-group: AGENTS 3, ITEMS 5, PROJECTS 2, REMINDERS 2, NOTIFICATIONS 1.

**Deleted outright in this consolidation:** `listAgentRuns` (zero agent-prompt
refs; the REST route `GET /api/agents/:id/runs` stays for the Activity tab),
plus the entire `tools/marketplace.ts` file (folded into `tools/agents.ts`).
The legacy per-action tool names (`listAgents`, `addCommentToItem`,
`transitionItemStatus`, `assignItem`, `updateItem`, `createItemLink`,
`getItemFull`, `replyToItem`, `setReminder`, `listReminders`, etc.) are all
mapped onto the consolidated tools above. The constitution's
`FORBIDDEN_TOOLS_SECTION` was rewritten to forbid `crud_agent` actions
instead of the now-deleted per-action tool names.

The intentionally **unexposed** surfaces:
- Per `requirments_new.md` line 19: workspace settings (`/api/settings`), model registry (`/api/cli-models`), and notification settings.
- **Guardrails** (general + project) â€” removed from MCP 2026-05-28. Owner-only via REST + web UI; agents receive guardrails through the constitution baked into every spawned prompt by `buildConstitutionMarkdown()`, not by querying MCP. The 9 retired tools were `listGuardrails`, `createGuardrail`, `updateGuardrail`, `deleteGuardrail`, `listProjectGuardrails`, `createProjectGuardrail`, `updateProjectGuardrail`, `toggleProjectGuardrail`, `deleteProjectGuardrail`.
- **Schedules** (project auto-fetch cron) â€” removed from MCP 2026-05-28. One-time Owner setup; agents have no business reshaping or firing their own cron. The 4 retired tools were `listSchedules`, `upsertProjectSchedule`, `deleteProjectSchedule`, `triggerProjectAutoFetch`.

## Services (92 files in `packages/api/src/services/`, plus 3 in `transports/`)

| File | Purpose |
|---|---|
| `agent-runner.ts` | Spawn `claude` / `copilot` CLI (`ollama` -> `claude` + env overlay); stage `.atlas/*`; stream SSE; persist cost + outcome; report back. **Since ADR 0014 it never routes, provisions worktrees, pushes, opens PRs or writes item status.** `spawnAgentRun({ agentId, issueType?, issueId?, projectId?, existingRunId?, workflowRun? })`: `workflowRun = {id, nodeId, worktreePath, branch, skipSetup}` (set only by the engine) makes the run use the workflow's shared worktree as cwd and skip `runProjectSetup` once the workflow run has `setup_done`; every other run executes in a throwaway temp dir (`artefactTmpRoot`). Stages via `stageCliWorktree(... includeOutcome)`. Snapshots `cli`, `model`, `effort`, `prompt_version`, `workflow_run_id`, `node_id` on both write paths (INSERT, or UPDATE of the `existingRunId` row). `completeRun` persists the parsed `atlas-outcome` for every run shape (item, project, none), posts the run-info pin comment on item runs, notifies the Owner only for non-workflow no-item runs, then `notifyStep`. `errorRun` does the same minus the outcome, notifying only outside workflows. `notifyStep` (dynamic `import('./workflow-engine.js')` → `onStepFinished`) fires at **every** terminal exit: completed, error, cancelled, `setup_failed`. Simulated mode (`ATLAS_AI_ENABLED` not `true`) emits canned output ending in an `atlas-outcome: done` block so AI-disabled workflows advance. **Run isolation:** item runs (`issueId != null`) on the claude dialect add `claudeIsolationArgs(true)` = `--setting-sources project,local --strict-mcp-config --mcp-config {"mcpServers":{"atlas":{"type":"http","url":ATLAS_MCP_URL}}}` (`http://127.0.0.1:4500/mcp`), keeping the Owner's `~/.claude` hooks, plugins, user CLAUDE.md and MCP servers out while worktree `.claude/commands/atlas-*` still load; no-item runs get `[]` (scouts need the Owner's Playwright / claude.ai connectors). `--mcp-config` is variadic, so the prompt stays on stdin. Copilot is unchanged. **Child env:** `agentRunEnv(cli, model, gitConfigPath, ghToken)` = `gitInvokeEnv` + `ATLAS_API_URL=http://127.0.0.1:<apiPort()>` + the ollama overlay (last). |
| `worktree-orchestrator.ts` | Non-AI git worktree helpers: `ensureWorktree({ item, branch?, project, pushUpstream? })`, `pushWorktree`, `openPullRequest` (handles `alreadyExists`), `cleanupWorktreeAfterPush`, `buildWorktreePreamble`. Callers: `workflow-engine.ts` (once per workflow run at start, `item: null` so the path lives only on `workflow_runs`; push / PR / cleanup once at End or stop) and `routes/cli-sessions.ts` (terminal sessions). Each helper takes `withProjectGitLock` internally and the lock is **not** re-entrant — never wrap them in another lock. Path resolves to `<project.git_path>/../worktrees/<projectId>/<branchSlug>`; when an `item` is passed the path is persisted to `items.worktree_path`. Auth: per-call `GIT_CONFIG_GLOBAL` with `http.extraheader` when `project.credential_id` is set. Errors surface as `WorktreeProvisioningError` (`missing_worktree_branch` / `missing_project_git_path` / `invalid_branch_name` / `git_command_failed`). `buildWorktreePreamble` tells the agent the worktree is shared by every step and that the workflow pushes and opens the PR at End. **Scratch `.gitignore`:** `ensureWorktreeGitignore` commits the appended Atlas-scratch patterns as their own `chore(atlas): ignore Atlas scratch paths` commit; best-effort. |
| `workflow-engine.ts` | **ADR 0014 — event-driven workflow execution.** `startWorkflowRun(workflowId, itemId\|null)`: validates the graph, checks input kind / project / item not `done`, runs `assertDepsAllDoneForDispatch` once, inserts `workflow_runs` (`graph_snapshot` frozen; unique live-per-item → `WorkflowStartError('conflict')`), branch = valid `item.worktree_branch` ?? `atlas/wf/<itemId>` (project-level `atlas/wf/<runId8>`), item → `in_progress`, `ensureWorktree({item:null})` once when `use_worktree` (failure parks), then `goTo` the node after Start. `goTo`: Owner node → park; End → `finishRun`; agent → `spawnNode` (agent missing / inactive → park; sets `items.assignee_agent_id` to the node's agent; `spawnAgentRun({workflowRun})`). `onStepFinished(agentRunId)`: ignores non-workflow runs and stale reports (run not `running` or moved past the node); `cancelled` → cancel the run; `error` / `setup_failed` → park; `completed` → marks `setup_done`, then `decideRunRouting` (`agent-runner-outcome-routing.ts`, required `agent_checklists` rows): pass → pass edge (none → park), fail → fail edge with `loop_count + 1` (none, or past `workflows.max_loops` → park), question / missing outcome → park. `park`: run `waiting_for_owner` + `parked_node_id` + `park_reason` (cleared when the run runs again; a fail edge into an Owner node carries the routing detail, e.g. `Sent back to you: checklist_failed: …`), item `waiting_for_info` with no assignee, an agent comment with `agent_id: null` (shown as "Workflow") `**<workflow>** is waiting for you: <reason>` — skipped when the reason is the step's own `asked_question` / `rejected` reason, which its completion comment already shows — one `needs_you` notification; worktree kept. `resumeWorkflowRun` / `continueResumedRun`: Owner / agent node → first `prepareWorktree` refreshes the kept worktree (`commitPending`, then `ensureWorktree` pulls ff-only and rebases onto fresh `origin/<default>`; a failure parks with `Could not refresh the worktree onto the latest default branch: …`); Owner node → its pass edge; End node → retry delivery (no refresh); agent node → re-run it with `loop_count = 0`. `finishRun`: `deliver` (safety commit of leftovers → `pushWorktree` when `push_code` → `openPullRequest` + `items.pr_url` + `item_external_links` row when `raises_pr` and the push landed → `cleanupWorktreeAfterPush` only when every requested delivery step succeeded). A failed push or PR **parks the run at End** with `park_reason` (`Push failed: … Resume the run to retry delivery.`), worktree kept, item `waiting_for_info`; otherwise run `completed` + `pr_url`, `routeChildren`, item → `in_review` if a PR opened or children were routed else `done` (direct write), one notification, kick dispatch. `routeChildren`: items in `draft`/`ready` with `created_by_workflow_run_id = run` or (`parent_id = item` and `created_at >= started_at`) → `workflow_id = child.workflow_id ?? (outgoing tested_by link ? End.test_child_workflow_id : End.child_workflow_id)` (a test child falls back to `child_workflow_id` when the End has no test workflow), status `ready`; children with neither are left alone. `cancelWorkflowRun`: cancels + kills live steps, `deliver({openPr:false})`, item → `waiting_for_info`. `reconcileWorkflowRuns` + `tickWorkflowDispatch`: see `agent-schedule-registry.ts` above. |
| `workflows.ts` | ADR 0014 — workflow CRUD with graph / project / schedule validation (`ApiError` 400 carrying `graph_errors`), `listTemplates` / `createFromTemplate` (installs missing catalog agents, resolves `template:<id>` child refs by name in the project), run read-models (`listRuns`, `listRunsForItem`, `getRun` with steps), `setItemWorkflow`, and `workflowsUsingAgent` (JSONB `graph @> {nodes:[{agent_id}]}`) for the agent delete guard. |
| `workflow-lock.ts` | ADR 0014 — `registerWorkflowItemLock(app)` adds a global `preHandler`: `PATCH /api/{epics,stories,bugs,sub-tasks,sub-bugs}/:id/{status,assign}` → `409 {kind:'conflict', workflow_run_id}` while a `running` workflow run holds the item. Covers UI and MCP (which calls the same routes). `runningWorkflowRunOnItem(itemId)` is exported. |
| `dry-run.ts` | Smoke-test the CLI wiring without a real run. Builds a guardrails-only prompt, spawns the agent's CLI with `--print --model`, streams stdout/stderr via SSE (`dry_run_*`). No DB writes. Powers the Agent Detail â†’ Test Run tab. |
| `compile-prompt.ts` | Pure read; assembles the **exact prompt** the runner would send for a given agent+issue (calls `buildPrompt` like `agent-runner.ts` does), returns it for offline inspection. No spawn, no SSE, no DB write. Powers the Run Now dialog's **Preview prompt** button. |
| `auto-fetch-runner.ts` | Periodic `git fetch`; dirty/idle/agent guards; auth-failure â†’ external notification escalation. |
| `clone-runner.ts`, `reclone-runner.ts`, `delete-runner.ts` | Git/fs subprocesses with SSE streaming. |
| `external notification.ts` | Encrypt/decrypt token; respect quiet hours; deliver notifications. |
| `schedule-registry.ts` | Croner job registry for project auto-fetch; boot all schedules on startup; catch-up on missed fires. |
| `agent-schedule-registry.ts` | One-minute poller: stuck-run watchdog → reminders → GitHub App token refresh → `reconcileWorkflowRuns` → `tickWorkflowDispatch`. No agent scheduling (see section above). |
| `notifications.ts` | Notification queue + delivery. |
| `guardrails.ts`, `projectGuardrails.ts` | Rule CRUD. |
| `stories.ts`, `epics.ts`, `issues.ts` (covers bugs/sub_tasks/sub_bugs) | Issue services with status-machine guards and assignee validation. `items.ts::createItem` stamps `created_by_workflow_run_id` from the reporter agent's live workflow step (`agent_runs` `queued`/`in_progress` with a `workflow_run_id`), which is how End finds children of project-level runs; every item row projects `workflow_id`. |
| `comments.ts` | Threaded comments per issue. An Owner comment on an item with a parked (`waiting_for_owner`) workflow run claims and continues that run (see `POST /api/comments`). |
| `external-links.ts` | `item_external_links` CRUD + `parseGithubPrUrl` / `fetchGithubPrTitle` (`gh`) / `fetchGithubPrState` (REST, token). `list()` kicks a background PR-state refresh for stale links; `refreshPrStates(itemId)` does it synchronously. |
| `cli-availability.ts` | `getCliAvailability()` — probes each CLI binary with `--version` (3 s timeout), 60 s in-memory cache. Backs `GET /api/cli/availability`. |
| `reply-context.ts` | A12 â€” `assembleReplyContext(issueType, issueId, options?)` returns the `IReplyContext` envelope used by `replyToItem` / `GET /api/issues/:type/:id/reply-context`. Reuses `issueFullService` for item + project + activity, `itemLinks.list` for linked items (carries `direction`), `getItem` for linked-item description + AC (depends_on only), and `commentsService.list` for the target thread + per-depends_on recent comments. Applies `headTailElideComments` to the target thread and `takeRecentComments` to each depends_on neighbor. |
| `context-budget.ts` | A12 â€” pure helper. `estimateTokens(text)` is char-based (`Math.ceil(chars/4)`), `headTailElideComments(comments, headN, tailN)` returns `{kept, elided_count}`, `takeRecentComments(comments, recentN)` slices the tail. Exports `DEFAULT_REPLY_CONTEXT_BUDGET_TOKENS=16_000`, `DEFAULT_THREAD_HEAD_COMMENTS=3`, `DEFAULT_THREAD_TAIL_COMMENTS=12`, `DEFAULT_LINKED_ITEM_RECENT_COMMENTS=3`, `DEFAULT_ACTIVITY_HIGHLIGHTS=20`. No external dependencies â€” no `tiktoken`. |
| `projects.ts`, `agents.ts`, `credentials.ts`, `settings.ts`, `schedules.ts` | Entity CRUD. `credentials.ts` also accepts `human_name` / `human_email` on **both** kinds now (create + update); only `human_gh_login` and `app_installation_owner` stay github_app-only, since they feed `gh pr create --assignee` and the App installation respectively. |
| `git-credentials.ts` | `buildGitAuth(credentialId)` writes the per-invocation temp dir every credentialed git/gh call points `GIT_CONFIG_GLOBAL` at: `[http] extraheader` for auth, `[credential] helper =` to kill the helper chain, and a `[user]` block for commit identity. The `[user]` block is written for **github_app** (bot identity, `<app_slug>[bot]` + `<app_id>+<slug>[bot]@users.noreply.github.com`) and, since standalone terminals, also for **pat** when the credential carries both `human_name` and `human_email`. The two mean different things by kind: on github_app the human is a *co-author* (bot authors, human gets a `Co-Authored-By` trailer via the `prepare-commit-msg` hook); on a pat the human is the *author*, because a PAT has no identity of its own. Both-or-nothing on the pat branch — a name without an email leaves the block out entirely rather than fabricating half an identity, so every pre-existing credential behaves byte-identically. `GitAuth.humanName`/`humanEmail`/`humanGhLogin` stay github_app-only in the return value: callers use them to append an explicit trailer, and co-authoring yourself is noise. |
| `prompt-builder.ts` | Compose agent prompt from `prompt_md` + issue context. `buildLinkedItemsSection(itemId)` injects a `## Related items` section with `Depends on` (outgoing depends_on, must reach `done` first), `Blocks` (incoming depends_on), `Relates to` (undirected), and — **2026-09-14** — `Tests` (outgoing `tested_by`, on the QA twin → its dev item) / `Tested by` (incoming `tested_by`, on the dev story → its QA twin); before this, tested_by links were dropped from `.atlas/current-task.md` and QA Writer concluded its twin link was missing â€” so agents have linked-item context up front instead of fetching via MCP at runtime (Theme 04, line 14). **B04** â€” the `Depends on` subsection also inlines each dep's `description` + `acceptance_criteria` so the agent can plan against the dep without an MCP fetch. `Blocks` / `Relates to` stay shallow (id + status + title only). `spec_md` is intentionally NOT inlined; agents can `getItemFull` if they need it. |
| `env-file.ts` | Mirror `settings.env` rows to a `.env` file on disk. |
| `project-env-file.ts` | Read/write `<git_path>/.env` for a single project. Reuses `parseEnv`/`rewriteEnv` from `env-file.ts`. |
| `git-status.ts`, `git-verify.ts` | Git inspection helpers. |
| `counts.ts` | Aggregate counts for sidenav + dashboard. |
| `cli-models.ts` | CLI model registry. |
| `worktree-diff.ts` | Backs the Stop-modal review. `getWorktreeDiffSummary` / `getWorktreeFilePatch` / `WorktreeDiffError`, plus exported `-z` parsers. Uses `git diff HEAD` (single ref) for the uncommitted scope so git merges staged+unstaged itself, and a fallback chain (`origin/<default>` -> `refs/remotes/origin/HEAD` -> `origin/main|master` -> local `<default>|main|master` -> none) for the committed base; unresolvable means an empty scope, never a throw. Untracked files go through `git diff --no-index -- /dev/null <path>`, which **exits 1 on success** — the wrapper reads `err.stdout`. Every diff carries `--no-ext-diff --no-textconv --no-color`: the first two are security controls, since the worktree is agent-controlled and `diff.external` / a `.gitattributes` textconv driver would otherwise execute under the API process. Reads stdout as a Buffer and splits on NUL at byte level (a chunk-straddling codepoint would otherwise become U+FFFD and corrupt paths). Caps: 500 files/scope, 512 KB or 20k lines per patch, 8 MB maxBuffer, 30 s. |
| `worktree-stage.ts` | Shared `stageCliWorktree(opts)` — single entry point for everything that lands in a CLI worktree before spawn: `.atlas/constitution.md` + scripts, `.atlas/templates/`, `.claude/commands/atlas-*.md` + `.github/prompts/atlas-*.prompt.md` (per-agent slash-command bodies), and `.atlas/current-task.md` (when an item is linked OR a user prompt is provided). Flags carve out the agent-run-only pieces: `includeOutcome` writes `.atlas/outcome.md` (`renderRunOutcomeContract`: outcome kinds + block format + required checklist) and `.atlas/self-memory.md` (`renderSelfMemorySection`, or an empty placeholder) — the CLI only reads files on disk, so this is the only way the outcome contract and memory reach it; `activeRunCopilotAgent` writes `~/.copilot/agents/atlas-<runId>.md`. Both `agent-runner.spawnAgentRun` and `POST /api/cli/sessions` (terminal create + resume) call through this helper. `runProjectSetup` and `buildGitConfig` stay at the call site because their cleanup lifetimes differ. |
| `cli-session-host.ts` | In-memory PTY host for Terminal sessions (one Map entry per `cli_sessions.id`): spawns `claude`/`copilot` under ConPTY (`ollama` resolves to the `claude` binary) (with `TERM`/`COLORTERM` set — node-pty on Windows discards the `name:` option), feeds every output byte into a per-session `terminal-screen-state` mirror, broadcasts to WS subscribers from the mirror's write callback (FIFO with the attach flush marker → exactly-once delivery), replays `snapshot()` on attach, consumes-and-drops `{cmd:'resize'}` control frames (geometry is pinned; the PTY is never resized), runs the idle-notification detector, and flips the row to `paused` on PTY exit. |
| `terminal-screen-state.ts` | Per-session `@xterm/headless` + `@xterm/addon-serialize` mirror behind a tiny interface (`feed`/`whenFlushed`/`snapshot`/`dispose` — deliberately no `resize`; the mirror's geometry is pinned for its lifetime). Exists so WS attach replays a serialized screen instead of a byte-window of history — a byte-window can start mid-escape-sequence/mid-codepoint (rendered as literal "zombie" characters), echoes DSR queries, and carries stale geometry. |
| `cli-transcript-ingest.ts` | `ingestTranscript(sessionId)` — reads the CLI's on-disk JSONL into `cli_sessions.transcript_jsonl`. Path resolution: `claude` uses `~/.claude/projects/<encodeClaudeProjectDir(worktree_path)>/<claude_session_id>.jsonl` (encoding rule: drop drive colon, replace `\` and `/` with `-`); `copilot` uses `~/.copilot/session-state/<id>/events.jsonl`. ENOENT → log + return current DB value (no throw). Caps at 10 MB. Fired (fire-and-forget) on the Stop path and the errored-spawn path of `routes/cli-sessions.ts`; the `GET /transcript` endpoint also calls it lazily if the column is still NULL. |

---

## Database migrations

`packages/api/src/db/migrations/` â€” knex-driven PG migrations. As of 2026-06-03 the migration history has been squashed to a single baseline.

| File | Contents |
|---|---|
| `001_baseline.ts` | Loads and executes `001_baseline.sql`. |
| `012_cli_sessions.ts` | Terminal v1 — adds `cli_sessions` table + indexes (one-active-per-(project,branch)). |
| `013_cli_sessions_item_id.ts` | Adds optional `item_id` anchor on cli_sessions. |
| `014_cli_sessions_drop_cost_columns.ts` | Drops the per-session cost/token aggregates (telemetry moved upstream). |
| `015_terminal_idle_notify_seconds.ts` | Adds `settings.terminal_idle_notify_seconds` (default 300). Threshold for `terminal.waiting_for_input` notifications. |
| `016_notifications_link_url.ts` | Adds `notifications.link_url` so idle-session notifications can deep-link straight to `/terminal/<id>`. |
| `017_cli_sessions_cli.ts` | Adds `cli_sessions.cli` (claude\|copilot). Both CLIs share the `--session-id` / `--resume` argv shape, so Pause/Resume work for either; only the rest of the flags differ (`--allowedTools`/`--disallowedTools` for claude, `--allow-all-tools` for copilot). |
| `018_cli_session_transcript.ts` | Adds `cli_sessions.transcript_jsonl` (text) and `cli_sessions.transcript_ingested_at` (timestamptz). Populated when a session reaches `closed`/`errored` by `services/cli-transcript-ingest.ts`, which slurps the CLI's own on-disk JSONL (`~/.claude/projects/<encoded-cwd>/<sid>.jsonl` or `~/.copilot/session-state/<id>/events.jsonl`). |
| `028_history_pruned_event.ts` | **2026-07-03 audit round 2** (renumbered from 027 in round-3 rebase to avoid collision with upstream `027_cli_session_subagents.ts`). Extends the `issue_events.event_type` CHECK constraint to include `history_pruned`. Emitted by `services/history-prune.ts` inside the same transaction as the bulk DELETE so the destructive `POST /api/issues/:type/:id/history/prune` operation stays traceable (was previously undetectable after commit — the very issue_events rows that would record it were what got wiped). Reversible: `down()` deletes any rows carrying the new type before shrinking the allow-list. |
| `029_ollama_cli.ts` | **Third CLI option.** Widens the `cli` CHECK constraint on `agents`, `cli_models`, `marketplace_agents` (all from the squashed baseline) and `cli_sessions` (from 017) to allow `ollama`, then seeds three `cli_models` rows for it (`qwen3.5`, `kimi-k2.7-code:cloud`, `gemma4:cloud`). `qwen3.5` is required, not decorative — it is `DEFAULT_MODEL_BY_CLI.ollama`, and the composite FK `agents (cli, model) → cli_models (cli, model_name)` would reject the default without it. Reversible: `down()` moves any `ollama` agents back to `claude` + `claude-opus-4-7` (rewriting both columns together, since the FK is composite), deletes `ollama` sessions and model rows, then shrinks all four CHECKs. |
| `030_standalone_cli_sessions.ts` | **Standalone terminals.** Drops NOT NULL on `cli_sessions.project_id` (the FK and its ON DELETE CASCADE stay — a nullable FK is still enforced when non-null) and adds `credential_id text REFERENCES credentials(id) ON DELETE SET NULL`. SET NULL, not CASCADE: deleting a credential must not delete the audit trail and cost numbers of every session that used it — the session just loses auth on the next resume, surfacing as an ordinary push failure. No index work needed; `cli_sessions_one_active_per_project_branch` is already scoped `WHERE ... AND worktree_branch IS NOT NULL`, and standalone rows carry a null branch. Reversible with one caveat: `down()` must `DELETE FROM cli_sessions WHERE project_id IS NULL` first, since those rows have no project to fall back to — they are exactly the rows this migration made representable, and the folders they point at are the Owner's own directories, untouched by anything Atlas does. |
| `031_backfill_agent_comment_attribution.ts` | **Data repair, 2026-09-12.** Backfills `comments.agent_id` and `issue_events.actor_agent_id` on agent-authored rows written with a null author. Attribution rule: repair only when EXACTLY ONE distinct agent had a run open on that item at the row's `created_at` (`started_at <= created_at <= COALESCE(completed_at, now())`); ambiguous and unmatched rows stay null, because a wrong name in an audit trail is worse than a missing one. `down()` is a deliberate no-op — a backfilled value is indistinguishable from one the runner wrote correctly, so rolling back would destroy good attribution. |
| `032_reviewer_on_fail_to_writer.ts` | **Data repair, 2026-09-14.** Reviewer rejection returns to the writer. Rewrites installed `agent_handoff_rules` on-fail rows for the five SDLC reviewers (`agent-po-reviewer` -> `agent-po-writer`, `agent-architect-reviewer` -> `agent-architect`, `agent-code-reviewer` -> `agent-coder`, `agent-qa-reviewer` -> `agent-qa-writer`, `agent-automation-reviewer` -> `agent-automation`) to `target_agent_id = <writer>, status = 'ready'`, **only** where the row still equals the old catalog default (`owner` / `waiting_for_info`); Owner-customised rows are untouched. `down()` restores `owner` / `waiting_for_info` on rows equal to the new default. Superseded by `036`, which drops the table. |
| `033_external_link_pr_state.ts` | **PR merge awareness, 2026-09-14.** Adds `item_external_links.pr_state text NULL CHECK (pr_state IN ('open','merged','closed'))` and `pr_state_checked_at timestamptz NULL`. Written by `services/external-links.ts` (background refresh on read, `POST …/external-links/refresh`). `checked_at` is stamped on failed lookups too so a broken link is throttled to one attempt per 5 min. Reversible: `down()` drops both columns. |
| `034_catalog_description_checklist_sync.ts` | **Installed-agent catalog drift, 2026-09-14.** Installed agents copy `description` and checklists at install time and only `prompt_md` re-syncs on boot (`agent-defaults-sync`). Rewrites `agents.description` for Coder, Code Reviewer, Architect / QA / Automation Reviewer and the two pnpm-specific Coder checklist labels ONLY where rows still hold a prior catalog value (Owner edits survive). `down()` restores the first prior value. Drift-guarded by `src/db/catalog-sync-migration.test.ts`. |
| `035_workflows.ts` | **Workflows schema (ADR 0014), additive.** Creates `workflows` (graph JSONB, input_kind, trigger, git flags, max_loops, schedule columns mirroring `project_schedules`; `workflows_project_required_check`) and `workflow_runs` (graph_snapshot, current/parked node, loop_count, branch, worktree_path, setup_done, pr_url; partial unique `workflow_runs_one_live_per_item` over `running`/`waiting_for_owner`). Adds `agent_runs.workflow_run_id` (SET NULL, keeps step history), `node_id`, `cli`, `model`, `effort`, `prompt_version`, and `items.workflow_id` / `created_by_workflow_run_id` (both SET NULL). Both tables get `atlas_set_updated_at` triggers. `down()` drops the columns, then the tables. Tested by `src/db/workflows-migration.test.ts`. |
| `036_drop_agent_routing.ts` | **ADR 0014 hard cut.** Drops trigger + function `agents_cleanup_handoff_target`, tables `agent_handoff_rules`, `marketplace_agent_handoffs`, `agent_round_counts`, and from both `agents` and `marketplace_agents` the columns `handoff_prompt_md`, `max_rounds`, `requires_item`, `requires_worktree`, `push_code`, `raises_pr`, `schedule_hours`, `schedule_preset`, `schedule_time_of_day`, `schedule_weekdays`, `schedule_day_of_month`, `cron_expr`, `concurrent_runs` (plus `agents.last_run_at` / `next_run_at`). No data carried over — the Owner rebuilds chains as workflows. `down()` restores columns with baseline defaults and recreates the empty tables + trigger; dropped values are not recoverable. |
| `001_baseline.sql` | Full schema (all tables, indexes, triggers, enums, functions) + reference-data inserts for `cli_models` (16 rows), `roles` (5 rows), `guardrail_rules` (23 rows), and the `settings` singleton (defaults only â€” no Owner PII). Generated by applying every historical migration to a clean Postgres DB and dumping the result via `pg_dump --schema-only --no-owner --no-acl --exclude-table='_knex_migrations*'`, then appending `pg_dump --data-only --inserts -t cli_models -t roles -t guardrail_rules`. |

**Regenerating the baseline.** When the schema changes via a new numbered migration (002, 003, â€¦), the baseline does NOT need re-dumping â€” knex tracks each migration independently in `_knex_migrations`. The baseline is only regenerated if we ever decide to re-squash; in that case, apply every migration to a clean DB, dump as above, strip the two `\restrict`/`\unrestrict` psql meta-commands, drop the `SELECT pg_catalog.set_config('search_path', '', false)` line (it would strip the public schema mid-migration and break knex's post-migration insert into `_knex_migrations`), and replace `001_baseline.sql`.

**Append-only rule.** Schema changes after 2026-06-03 go in new numbered files (`002_*.ts`), never as edits to `001_baseline.ts` or `001_baseline.sql`.

**Existing-DB cleanup (one-time, after the 2026-06-03 squash).** Any local DB that already applied the pre-squash migrations carries 66 rows in `_knex_migrations` for files that no longer exist; knex's startup validation refuses to run with "migration directory is corrupt". Two ways to recover:

- **Reset** (recommended for the local Owner DB if there's no data worth preserving): `pnpm -F @atlas/api db:reset && pnpm -F @atlas/api db:seed`.
- **In-place rewrite** (keeps existing data): in `psql`, `DELETE FROM _knex_migrations WHERE name <> '001_baseline.ts';` then re-run `pnpm -F @atlas/api db:migrate` (which is now a no-op).

Seed data: `packages/api/src/db/seed.ts::runSeed` syncs the on-disk marketplace catalog (`packages/api/src/marketplace/catalog/<id>/{manifest.json,prompt.md,memory.md,checklists.json}`, 16 entries) into `marketplace_agents` + `marketplace_agent_checklists` (content-hash versioned), then seeds `agent_templates` and `guardrail_scripts`. It **never writes `agents`** — agents exist only once the Owner installs a catalog entry. `catalog-loader.ts` strips the ADR 0014 dropped keys from any older `manifest.json`. Workflow starter templates are JSON files in `packages/api/src/marketplace/workflows/`, read on request (not seeded). The 4 reference tables (`cli_models`, `roles`, `guardrail_rules`, `settings`) are seeded by `001_baseline.sql`. Idempotent.

Dev-only reset: `pnpm -F @atlas/api db:reset` drops + recreates the `atlas` database in the local Postgres container and re-runs migrations. Pair with `pnpm -F @atlas/api db:seed` to repopulate the marketplace catalog.
