# Data Model

> **2026-05 â€” Postgres migration in progress.** The DB engine is now Postgres 16 (docker compose service `atlas-postgres`, host port 5500 â†’ container port 5432). Schema is a single Knex migration: `packages/api/src/db/migrations/001_baseline.ts`. The five per-type issue tables (`epics`, `stories`, `sub_tasks`, `sub_bugs`, `bugs`) have been **unified into a single `items` table with a `type` discriminator** and a polymorphic `parent_id`/`parent_type` pair. The legacy polymorphic side tables (`comments`, `issue_events`, `agent_runs`, `notifications`) now use a single `item_id` FK to `items` with `ON DELETE CASCADE`. The link table is renamed `item_links` and carries a `relation_type` column (`relates_to` or `depends_on`). The entity descriptions below still document the per-type API contract (which is preserved at the route layer), but the storage shape is unified.

**2026-05-19 â€” `priority` lives on every item type.** The `items.priority` column was always present in the DB; the IStory / IBug / ISubTask / ISubBug interfaces and Create/Update schemas now expose it (previously only Epic did). `createItem` no longer hardcodes priority to null for non-epic types. The default on creation is `'normal'`. The detail-page right rail's `<DetailsRailCard>` renders a priority chip for all five types, wired to the same per-type update mutation that handles description / status changes.

**2026-05-19 â€” `depends_on` UI is live.** `item_links.relation_type` partitions into "Blocked by" (depends_on) and "Relates to" (relates_to) sections on every item detail page (`<RelatedItemsCard>`). The server enforces blocker semantics in `services/dependency-guard.ts` â€” transitions into `in_progress` / `in_review` fail with "blocked by" errors until upstream items complete.

Authoritative types live in `packages/shared/src/types/index.ts` (`IEpic`, `IStory`, etc.) plus the new `packages/shared/src/items/types.ts` (`IItem`, `IItemLink`, `ItemRelation`). Constants and label maps in `packages/shared/src/constants/index.ts`. Status transitions in `packages/shared/src/status-machine/index.ts`; depends-on enforcement helper in `packages/shared/src/status-machine/blockers.ts` (`assertCanStart`). Zod validators in `packages/shared/src/schemas/index.ts`. Migrations in `packages/api/src/db/migrations/001_baseline.ts`.

**Naming rule:** API responses use snake_case (matching DB columns). TypeScript interfaces use snake_case field names too â€” there's no transformation layer. `IProject`, `IAgent` (`I` prefix), TypeScript types use PascalCase.

## Depends-on relation (new)

Items can be linked via `item_links(from_id, to_id, relation_type)`:
- **`relates_to`** â€” semantically undirected. The service normalizes pairs so `(A,B)` and `(B,A)` collapse onto one row. Surfaces a "Relates to" section on the detail page.
- **`depends_on`** â€” strictly directed. `from depends_on to` means "from is blocked by to". Cycle detection (recursive CTE) rejects edges that would close a `depends_on` cycle. While any blocker isn't `done`, the dependency-guard refuses transitions out of `ready`/`draft` to `in_progress`/`in_review` (escalations to `waiting_for_info` are still allowed). When the last blocker resolves, `notifyDependentsUnblocked(itemId)` emits an `unblocked` issue_event on every dependent.
- **B04 — depends_on is also hard-gated at workflow start.** `workflow-engine.startWorkflowRun` calls `assertDepsAllDoneForDispatch(itemId, firstAgentId)` once, before inserting the `workflow_runs` row. If any `depends_on` target is non-`done` (including `in_review` — `done` is the only terminal status; there is no `closed`), it throws `DependenciesNotReadyError` and records a `dispatch_blocked` issue_event on the item. `POST /api/workflows/:id/runs` surfaces it as `409 {details:{blockers}}`; the dispatch tick logs and skips. Steps inside a running workflow are not re-gated, and engine status writes (`in_progress`, `in_review`, `done`) bypass `assertNoOpenBlockers`. Companion change in `services/prompt-builder.ts`: the `## Related items → ### Depends on` section bakes each dep's description + acceptance_criteria into the prompt up-front so the agent doesn't need to MCP-fetch the dep mid-run.

**B05 â€” who creates links, and how.** Link creation has two paths and **no runner-side auto-link**:

1. **UI path (Owner-driven).** The detail-page `<RelatedItemsCard>` posts to `POST /api/issues/:type/:id/links`, which calls `services/item-links.ts::itemLinks.create(fromId, toId, relation)`. That service runs cycle detection on `depends_on`, normalises pair order on `relates_to`, is idempotent (re-creating returns the existing row), and writes an `item_link_created` activity event on **both** endpoints.
2. **Agent path (discretionary).** Agents call the `createItemLink` MCP tool (`packages/mcp/src/tools/items.ts`), which hits the same REST route as the UI. Link creation is **at the agent's discretion based on the tool description** â€” performer and reviewer prompts do not carry a Working Protocol bullet instructing the agent to link (contrast: `updateAgentMemory` does carry such a bullet â€” see `.agents/api-surface.md`). An agent that notices a missing dependency may choose to call `createItemLink`; nothing in the prompt or runner mandates it. Per-agent tool gating was removed post-`253c43d` / B14; the constitution's `FORBIDDEN_TOOLS_SECTION` is the only runtime check.

The read-side is also worth noting: `services/prompt-builder.ts::buildLinkedItemsSection(itemId)` injects every existing link (`### Depends on`, `### Blocks`, `### Relates to`) into the calling prompt up-front, so the agent doesn't need to call `listItemLinks` mid-run to see what's already attached. There is no post-run heuristic that parses agent output to *infer* new links â€” the only writers are the UI route and the `createItemLink` MCP tool.

---

## Entities

### Owner (implicit)
Not a table. Always one. The "Owner" is the human running the app. Stored in `settings.owner_name` + `settings.accent_color`. Workflows escalate (park) to the Owner only; agents never route items.

### IAgent
**Why this entity exists**: An agent is a reusable AI worker definition (CLI + model + effort + prompt + memory + checklists). Since ADR 0014 it carries no schedule, routing or git-delivery state — workflows own those — so the same agent can be a node in many workflows. The engine sets `items.assignee_agent_id` to the agent of the step currently running, which keeps assignee chips meaningful.

AI agent profiles. **Not seeded** — a fresh DB has zero agents; each row is created by installing a marketplace catalog entry (`/agents/marketplace`, `POST /api/marketplace/agents/:id/install`), which also copies the entry's checklists. Creating a workflow from a template installs any catalog agents its graph references.

Fields (`IAgent`): `id, name, category, cli, model, effort, framework, prompt_md, prompt_version, status, accent_color, sort_order, description, designation, role_id, glyph, memory_cadence, kind_slug, settings_json, marketplace_source_id, marketplace_pulled_version, created_at, updated_at`

- `category` ∈ `software-dev | marketing | content | design`
- `cli` ∈ `claude | copilot | ollama` (migration 029 widened the CHECK)
- `status` ∈ `active | inactive` (pause/resume toggle). A workflow step whose agent is missing or inactive parks the workflow run.
- `prompt_version` increments on each prompt edit; history lives in `agent_prompt_versions`.
- `accent_color` is a hex string used for chips/avatars
- `description` is the free-text blurb shown on cards and the Overview tab; editable from the Overview tab.
- `glyph` is a Material Symbols icon name used on the card avatar + agent chips; editable via the Identity panel's "Replace glyph" picker. Empty falls back to a per-category default.
- **Delete guard (ADR 0014):** `DELETE /api/agents/:id` → 409 while any `workflows.graph` references the agent.
- **Identity + lifecycle columns**:
  - `designation` — human-readable role label (e.g. "Product Owner", "Code Review Lead"). Shown next to the agent name in the Sidebar identity panel. With A08 it acts as an optional **per-agent display override** on top of `role_id`; empty falls back to the role's canonical label (then category).
  - `role_id` — A08. FK into the SDLC role catalog (`roles.id`, `ON DELETE SET NULL`, indexed `idx_agents_role_id`). NULL on autonomous agents (ai-news, market-research, regulations, jira-to-epic, ai-readiness, knowledge-base). SDLC catalog entries carry their `role_id` (`po`, `architect`, `engineer`, `qa`, `automation`); there is no Spec Writer agent (its job merged into Architect).
  - **Reviewers are separate agents**: each performer has a paired reviewer agent (e.g. `agent-coder` → `agent-code-reviewer`). The pairing lives in a workflow graph (reviewer pass → next step, reviewer fail → back to the writer), not on the agent.
  - **Removed columns:** `kind` / `reviewer_agent_id` (migration 019); `handoff_prompt_md`, `max_rounds`, `requires_item`, `requires_worktree`, `push_code`, `raises_pr`, `schedule_*`, `cron_expr`, `concurrent_runs`, `last_run_at`, `next_run_at` (migration 036, ADR 0014).

**Related tables:** `agent_checklists` (the agent's quality gate: required rows must come back `passed` in the `atlas-outcome` checklist, or a `done` routes as a fail), `agent_memory` (one row per agent — procedural-memory markdown), `agent_prompt_versions` (append-only prompt history). Migration 036 dropped `agent_handoff_rules`, `marketplace_agent_handoffs` and `agent_round_counts`.

### IRole (A08 â€” SDLC role catalog)
**Why this entity exists**: A canonical lookup table for the 10 SDLC roles an agent can play (PO, Spec Writer, Engineer, QA, Architect, Tester, Automation, DevOps, Security, Designer). Created in migration 025. Read by the Agents page Role filter chip and the AgentCard subtitle fallback; edited by the Owner via `PATCH /api/roles/:id` to update curated default prompts without touching any existing agent. The catalog *shape* is governed by the `SdlcRole` enum in `@atlas/shared` â€” runtime rows mirror that enum, they don't extend it.

Fields: `id, label, description, default_prompt_md, default_reviewer_prompt_md, default_status, sort_order, created_at, updated_at`

- `id` is the slug (e.g. `'engineer'`), PRIMARY KEY, FK target for `agents.role_id`.
- `default_status` âˆˆ `'active' | 'inactive'` (DB CHECK). Active for `po`, `spec-writer`, `engineer`, `qa`; inactive for the other six. **Seed-time policy only** â€” the catalog never re-disables a runtime-enabled agent.
- `default_prompt_md` / `default_reviewer_prompt_md` are the curated starter prompts copied into a new agent's `agents.prompt_md` / `reviewer_prompt_md` at seed time. The runner reads from the agent row, never from the catalog, so edits to the role default don't propagate to existing agents.

Full doc: `role-catalog.md`.

### IAgentPromptVersion
**Why this entity exists**: Every `prompt_md` edit on an agent gets a row here, so the Prompt tab's "Version history" can survive across machines and the Owner can revert a regression. The currently-active version is whatever `agents.prompt_version` points at; older rows are kept indefinitely. Revert never mutates a historical row â€” it appends a NEW row at the next version whose `reverted_from` links back to the source.

Fields: `id, agent_id, version, body_md, edited_by, reverted_from, created_at`

- `agent_id` FK â†’ `agents(id)` ON DELETE CASCADE
- `(agent_id, kind, version)` is UNIQUE (kind partitions the performer vs reviewer histories under the two-persona model)
- `kind` âˆˆ `'performer' | 'reviewer'` (DB CHECK), DEFAULT `'performer'`. Added by migration 020 alongside the `agents.reviewer_prompt_version` column.
- `reverted_from` is null on first-time saves, set to the source version on revert

### IAgentMemory
**Why this entity exists**: Procedural memory captures *self-corrections* â€” what the agent learned from past runs ("don't bounce empty AC", "prefer concrete actors over 'user'"). It lives next to the agent rather than in the prompt body so the Owner can edit it without churning the prompt version. One row per agent (`agent_id` is the PK), so reads never have to branch on "first-ever access" â€” `GET /agents/:id/memory` auto-creates an empty row.

Fields: `agent_id, body_md, version, source, last_run_id, runs_since_regen, updated_at`

- `agent_id` FK â†’ `agents(id)` ON DELETE CASCADE
- `source` âˆˆ `ai-generated | manual-edit` â€” flips back to `ai-generated` on every regenerate, flips to `manual-edit` on every PUT.
- `version` increments on each PUT and each regenerate
- `last_run_id` FK â†’ `agent_runs(id)` ON DELETE SET NULL; the run that triggered the most recent regeneration (null until first regenerate, or after that run is deleted)
- **Theme 08 â€” `runs_since_regen`**: counter incremented per completed/errored run (errors count double â€” they carry more signal). When this reaches `agents.memory_cadence`, `maybeRegenerateAfterRun()` fires a cadence regen and resets to 0.

### Theme 08 â€” Memory boundary rule, lifecycle, and audit

**Memory boundary** (`MEMORY_BOUNDARY_RULE` const in `services/agent-memory.ts`, embedded into the regenerate prompt and the `updateAgentMemory` MCP tool description verbatim):

> Memory is for *behavioral generalizations* of how the agent should approach future similar work â€” process, style, anti-patterns, escalation triggers. It is NOT for product or project facts. Test: "would this fact be just as true if a different item or different project hit this code path?" If yes â†’ memory. If tied to project X / item Y / specific user â†’ does NOT belong; project-specific facts go in item comments or spec_md.

**Memory lifecycle (Theme 08)** â€” four triggers fire memory writes:

1. **Manual** â€” Owner clicks "Regenerate from runs" in the Memory tab, or the POST `/api/agents/:id/memory/regenerate` route is called directly.
2. **Cadence** â€” `agent-runner.completeRun/errorRun` calls `agentMemoryService.maybeRegenerateAfterRun(...)`. It increments `runs_since_regen` (by 2 on error, by 1 on success), and fires regen when the count reaches `agents.memory_cadence`. Counter resets on regen.
3. **High-signal** â€” `maybeRegenerateAfterRun` also scans the most recent Owner comment on the run's item for `[lesson:]` or `[memory:]` markers. If present, regen fires immediately regardless of cadence.
4. **A06 â€” Agent self-draft (`mcp_update`)** â€” Working Protocol bullet #5 (performer) and the symmetric "End-of-run memory draft" section (reviewer) direct agents to call `updateAgentMemory(mode='append')` when they noticed a *generic behavioral lesson*. Agents only fire it when warranted; the cadence regenerator is the safety net for runs that don't. Memory tools (`getAgentMemory` + `updateAgentMemory`) are granted to every active seeded agent (`agent-po-writer`, `agent-spec-writer`, `agent-coder`, `agent-qa-writer`, `agent-ai-readiness`) via `ALLOWED_TOOL_SEEDS`; `agent-defaults-sync` reconciles to existing DBs on boot.

`regenerate()` acquires a session-scoped `pg_advisory_lock` keyed on the agent id so two regens for the same agent can't race. The second concurrent call no-ops and returns the current memory row.

**Memory writes from MCP** â€” the `updateAgentMemory` MCP tool supports two modes:
- `mode='replace'` (default) â€” overwrites the whole body via PUT; equivalent to the legacy behaviour.
- `mode='append'` â€” surgical append of a single bullet under `## Course corrections`. Calls `agentMemoryService.appendLesson(...)` which bumps `version`, audits with `trigger='mcp_update'`, and does NOT reset the cadence counter.

**A06 â€” soft boundary-rule filter** â€” every audit row carries `boundary_flags: string[]` populated by `detectBoundaryViolations()` against the new body. Flags: `item_id` (matches `epic_â€¦|story_â€¦|sub-task_â€¦|sub-bug_â€¦|bug_â€¦|task_â€¦`), `agent_id` (`agent-*`), `project_id` (`proj_â€¦|project_â€¦`), `run_id` (UUID). Soft â€” memory still persists (Owner's choice); the Memory tab renders an amber "BOUNDARY" chip on non-empty rows so drift is visible. Heuristic only â€” no DB-side reject.

### IMemoryRegeneration (Theme 08 audit log)

**Why this entity exists**: The Memory tab shows a sparkline of when memory shifted and by how much. The audit row captures every regen â€” trigger source, version delta, byte-diff metrics â€” so the Owner can tell at a glance whether the agent is learning healthily (regular cadence rows + occasional high-signal) or stuck (no rows in weeks despite many runs).

Fields: `id, agent_id, run_id, trigger, prev_version, new_version, prev_body_hash, new_body_hash, chars_added, chars_removed, boundary_flags, created_at`

- `trigger` âˆˆ `manual | cadence | high_signal | mcp_update` (CHECK constraint)
- `run_id` is nullable â€” manual regens have no run; `mcp_update` rows may carry the run id of the agent's session
- `prev_body_hash` / `new_body_hash` are sha256 hex; `chars_added` / `chars_removed` approximate the diff via longest-common-prefix (metric-only for the sparkline, not a structural diff)
- **A06 â€” `boundary_flags` JSONB** array of `'item_id' | 'agent_id' | 'project_id' | 'run_id'` slugs detected in the new body. Empty when clean. Migration `023_memory_boundary_flags.ts`.

### ICommitVerification (Theme 11)

**Why this entity exists**: One commit per chore is a discipline rule the agent must self-enforce, but a rule with no audit is a suggestion. After every issue-attached agent run, the verifier in `services/commit-verifier.ts` shells out to `git log --since <run.started_at>` in the project's cwd, parses every commit subject against the Conventional-Commit pattern, and persists the classification (`compliant` | `partial` | `silent` | `clean`). The Agent Detail Overview tab renders the last 10 as colored dots â€” the Owner sees at a glance whether the agent is following discipline.

Fields: `id, run_id, item_id, agent_id, result, commit_count, problems, checked_at`

- `result` âˆˆ `compliant | partial | silent | clean` (CHECK constraint). Verifier classification:
    - **`clean`** â€” no commits made AND no dirty modifications (legitimate read-only run, or non-git cwd).
    - **`silent`** â€” files modified during the run but never committed (the worst result; flagged with a system comment on the item).
    - **`partial`** â€” at least one commit but some commit had problems (missing `Refs:` line, non-Conventional subject, unknown type, summary > 60 chars).
    - **`compliant`** â€” every commit in the window parsed cleanly with a valid `Refs:` line.
- `commit_count` â€” total commits found in the window.
- `problems` JSONB â€” array of `{ commit_sha?: string; reason: string }`. Reasons: `subject-not-conventional`, `unknown-type:<x>`, `summary-too-long`, `refs-missing`.
- `run_id` / `item_id` carry the audit forward without an FK so historical rows survive run/item purging.

Verifier emits SSE `commit_verification { agentId, runId, commitVerificationResult }` after every audit. Non-clean results also append a system comment to the item so the activity feed surfaces the audit.

Migration 013. Index: `idx_commit_verifications_agent_checked` on `(agent_id, checked_at DESC)` so the Overview tile fetches the agent's last 10 quickly.

### Theme 09 â€” autonomous-agent fleet columns

Two columns on `agents` for the autonomous fleet (and any future custom agents):

- **`kind_slug` TEXT NOT NULL DEFAULT 'custom'** â€” archetype tag. Fixed slugs for the 4 seeded agents (`ai-news` | `market-research` | `regulations` | `jira-to-epic`); `custom` for everything else. No CHECK constraint â€” Owner-created kinds can carry their own slugs.
- **`settings_json` JSONB NOT NULL DEFAULT '{}'** â€” per-archetype config. Schema depends on `kind_slug`; validated at the route boundary via the Zod schemas in `@atlas/shared/agents/settings-schemas.ts`. `custom` agents pass through (`.passthrough()`).

Migration 011. Index: `idx_agents_kind_slug` on `agents(kind_slug)`.

The autonomous catalog entries (`agent-ai-news`, `agent-market-research`, `agent-regulations`, `agent-jira-to-epic`, `agent-ai-readiness`, `agent-knowledge-base`) ship `status: 'inactive'`. They have no cadence of their own: a `trigger='schedule'` workflow with `input_kind='none'` runs them. The prompt builder renders `{{ key }}` placeholders against `settings_json` so prompts can reference their config (`{{ topic }}`, `{{ competitors }}`, etc.); missing keys render as `(unset)`.

**Installable agents** come from `packages/api/src/marketplace/catalog/*/{manifest.json,prompt.md,checklists.json}` (synced into `marketplace_agents` by `runSeed`): 10 SDLC agents (PO Writer, PO Reviewer, Architect, Architect Reviewer, Coder, Code Reviewer, QA Writer, QA Reviewer, Automation Engineer, Automation Reviewer) + 6 autonomous agents. The starter workflows that wire them live in `packages/api/src/marketplace/workflows/*.json` — see `swarm-architecture.md`.

### IProject
**Why this entity exists**: Projects are the top-level work container â€” every issue tunnels through `project_id`. They're modeled as one cloned git repo because agents operate on code, and `git_path` is the working directory each spawned subprocess inherits. Holding `credential_id` here (vs. inferring per clone) lets the Owner rotate credentials without re-attaching them to every project.

A cloned git repo under the workspace.

Fields: `id, name, git_path, git_url, credential_id, default_branch, clone_status, description, status, guardrails_md, created_at, updated_at`

- `clone_status` âˆˆ `pending | cloning | cloned | error | deleting`
- `credential_id` FK to `credentials.id`; nullable for public repos
- `guardrails_md` is free-form markdown (project guardrails are a separate table â€” see below)

### IEpic
**Why this entity exists**: Epics are the unit at which the Owner decides whether work is worth doing. They sit above implementation (no `in_spec`/`in_dev` states) because their job is intent + scope, not delivery. Distinct from Story because epics decompose into multiple stories; collapsing the two would force every "should we do this" decision down to per-story granularity, drowning the Owner in approvals.

Top-level work unit, scoped to a project.

Fields: `id, project_id, title, description, status, assignee_agent_id, reporter_agent_id, priority, created_at, updated_at`

- `priority` âˆˆ `low | normal | high | urgent`
- `assignee_agent_id` / `reporter_agent_id` are nullable (null = Owner)

> **A03 â€” proposed-plan retired.** The `proposed_plan_md` / `proposed_plan_author_id` / `proposed_plan_updated_at` trio that previously lived on every issue type was dropped by migration `021_drop_proposed_plan_columns.ts`. Agent narrative now flows through the comments thread: `agent-runner` posts one system-generated comment per agent persona at the end of each run (one for the performer leg, one for the reviewer leg of the same agent). The `PATCH /api/{kind}/:id/plan` endpoints + the `setProposedPlan` MCP tool are gone.

> **All issue types carry a nullable `reporter_agent_id`** referencing `agents.id`. Auto-created sub-items stamp the creating agent as reporter; UI-created items stamp `null`, which the detail-page rail and Issues list render as Owner.

> **All issue types also carry `workflow_id` and `created_by_workflow_run_id`** (migration 035, ADR 0014). `workflow_id` (FK → `workflows`, SET NULL) is the workflow the item is queued for; `created_by_workflow_run_id` (FK → `workflow_runs`, SET NULL) is the run that created it.

### IStory
**Why this entity exists**: Stories are the unit of implementation â€” one PR per story is the target. They carry `spec_md` + `acceptance_criteria` + `pr_url` because those are what a Coder agent needs to start and what a QA agent needs to verify. Distinct from Epic because epics span multiple stories; distinct from SubTask because stories cross the full state machine including the spec/review phases that sub-tasks skip.

A child of an Epic.

Fields: `id, epic_id, title, description, status, assignee_agent_id, spec_md, pr_url, points, acceptance_criteria, created_at, updated_at`

### ISubTask
**Why this entity exists**: Sub-tasks are the smallest unit of execution under a story â€” typically one focused commit or one tightly-scoped agent run. They share the unified 6-state issue status machine (below). Distinct from Story to keep the story-level spec single-authoritative; recursive stories would make AC and PR linkage ambiguous.

A child of a Story. Shares the unified 6-state status machine with the other issue types.

Fields: `id, story_id, title, description, status, assignee_agent_id, acceptance_criteria, started_at, created_at, updated_at`

### ISubBug
**Why this entity exists**: Defects discovered mid-implementation belong with the story that surfaced them â€” losing that link makes the defect look like a top-level bug and orphans the repro context. Modeled as a sibling of SubTask under the same Story so the parent's "sub-items" card can render both kinds. Distinct from Bug because Bugs are reported standalone (no implementation work in progress); SubBugs always have an implementation context.

A child of a Story (defect found while working on it).

Fields: same shape as ISubTask plus bug-specific fields (`steps_to_reproduce`, `expected`, `actual`, `frequency`, `failure_scope`) and detection metadata (`detected_at`, `occurrence_count`, `occurrence_total`).

### IBug
**Why this entity exists**: Standalone defects are reported against an epic before (or independently of) any story implementation begins â€” e.g., "production is breaking, file a bug under this epic". Nesting under epic rather than story preserves the ability to file bugs against epics that haven't decomposed into stories yet. Same body shape as SubBug because triage data (repro, expected, actual, frequency) is identical; only the parent FK differs.

A standalone bug, child of an Epic (`epic_id` FK).

Fields: same bug-body shape as `ISubBug` plus `epic_id` instead of `story_id`.

### IComment
**Why this entity exists**: Discussion threads on issues are polymorphic by design â€” the same conversation table works for every issue type so the unified `IssueDetailShell` can render a comment thread without per-type branches. Distinct from IIssueEvent because comments are free-form human/agent prose, whereas events are structured state transitions. Both feed the merged activity stream so the Owner reads one timeline.

Threaded comments on any issue.

Fields: `id, issue_type, issue_id, author, body, created_at` â€” `issue_type` âˆˆ `epic | story | sub_task | sub_bug | bug` and `author` âˆˆ `'owner' | 'agent'` (`agent` rows include `agent_id`).

**Agent attribution is resolved at write time, not read time.** There is no denormalized author name: the UI looks `agent_id` up in the agents list (`ActivityCard.tsx`) and falls back to the literal string `"Agent"` when it is null. Three writers reach `commentsService.create` - `POST /api/comments`, `POST /api/issues/:type/:id/reply`, and the MCP `update_item({action:'add_comment'})` - and only the middle one enforces `agent_id` (`ReplyToItemSchema` refines it; `CreateCommentSchema` defaults it to null). The MCP path has no bound identity at all: `resolveAgentId` reads `ATLAS_AGENT_ID`, which nothing sets and nothing usefully can, because `plugins/mcp-host.ts` serves one in-process MCP on a shared loopback port for every agent (`boundAgentId: ''`) - so identity came down to an optional tool argument the model often omitted.

Since 2026-09-12 `create()` resolves a missing `agent_id` from the item's live run (`agent_runs` where `status IN ('queued','in_progress')`), which migration `003_active_run_invariant.ts` constrains to at most one row per item via a partial UNIQUE index. `create()` mirrors the resolved id into the `comment_added` event's `actor_agent_id`, so the same fix stops the activity feed attributing agent actions to the Owner. Rows written before the fix are repaired by migration `031_backfill_agent_comment_attribution.ts`; a comment with no run covering its timestamp stays null and still renders as `"Agent"` - deliberately, since guessing would put a wrong name in an audit trail.

`comments_agent_id_fkey` is `ON DELETE SET NULL`, so deleting an agent still erases its name from every comment it ever wrote. A denormalized `author_name` column is the only durable answer (`counts.ts` / `routes/analytics.ts` already denormalize `a.name as agent_name` for the dashboard); not shipped - it needs a migration + backfill of its own.

**Owner reply resumes a parked workflow run (ADR 0014).** When the Owner comments on an item whose workflow run is `waiting_for_owner`, `create()` claims the run inside the comment's transaction (run → `running`, item → `in_progress`, `status_changed` event with `detail='resumed_by_owner_reply'`), broadcasts `counts_changed` after commit, and calls `workflow-engine.continueResumedRun` in the background: a run parked on an Owner node follows its pass connection; a run parked on an agent node re-runs that step with `loop_count` reset. Agent comments never trigger it; an item without a parked run is left alone.

### IItemExternalLink
Off-platform URL attached to an item (today only `link_kind='pull_request'`). Table `item_external_links` (migration 020), UNIQUE `(item_id, url)`, cascades on item delete.

Fields: `id, item_id, link_kind, url, title, external_ref, created_at, created_by_run_id, pr_state`.

- `pr_state` ∈ `'open' | 'merged' | 'closed' | null` (migration 033, CHECK constraint) — last GitHub state observed for a PR link; null until the first successful lookup, and forever on a project with no credential.
- `pr_state_checked_at` (DB only, not on the wire) — stamped on every lookup attempt, success or failure. Reading the links (`GET …/external-links`, every `/full` envelope) refreshes PR links older than 5 min in the background; `POST /api/issues/:type/:id/external-links/refresh` refreshes synchronously.

### IIssueEvent (audit log)
**Why this entity exists**: Status and assignment changes need an audit trail the UI can render alongside comments â€” otherwise the Owner sees "this is in_dev" but can't tell who moved it there or when. Structured fields (event_type, field, from_value, to_value) make events queryable and machine-renderable in a way that free-text comments can't be. Kept distinct from IComment so the activity feed can render status pills differently from quoted text.

Persistent audit record for any non-comment activity on an issue. Backed by the `issue_events` table (defined in the consolidated baseline `001_initial.sql`). Comments stay in `comments`; the activity feed merges both streams ordered by `created_at`.

Fields: `id, issue_type, issue_id, event_type, actor_agent_id, field, from_value, to_value, detail, created_at`

- `event_type` âˆˆ `'created' | 'status_changed' | 'assigned' | 'field_updated' | 'comment_added' | 'link_created' | 'link_deleted' | 'deleted' | 'unblocked'`
- `field` âˆˆ `'status' | 'assignee' | 'title' | 'description' | 'reporter' | 'spec_md' | 'pr_url' | 'points' | 'acceptance_criteria' | 'priority' | 'steps_to_reproduce' | 'expected' | 'actual' | 'frequency' | 'failure_scope' | 'link'` or `NULL` for `created` / `deleted`
- `actor_agent_id` is `NULL` when the Owner (or the API) was the actor
- `link_created` / `link_deleted` events are emitted on BOTH endpoints of the link (so each item's activity tab shows the change). `to_value` holds the other item's id; `detail` encodes direction + relation_type like `depends_on â†’ ATL-3` (outgoing) or `depends_on â† ATL-2` (incoming).
- `deleted` is emitted by each entity service's `delete()` immediately before the underlying item row is removed. The event row survives the cascade because `issue_events.item_id` has no FK; the deleted item's history stays queryable.

Read via `GET /api/issues/:type/:id/activity`, which returns a merged `IActivityItem[]` (each item is either `{ kind: 'comment', data: IComment }` or `{ kind: 'event', data: IIssueEvent }`).

### IGuardrailRule (global)
**Why this entity exists**: Agents need a binding constitution that travels with every prompt â€” "do not delete the main branch", "ask before touching secrets". Modeling rules as structured rows (category + severity) lets the prompt-builder render them deterministically and lets the UI group them by risk surface. Distinct from IProjectGuardrail because workspace rules apply to every agent on every project; project rules layer narrower constraints on top.

A workspace-wide safety rule.

Fields: `id, category, body, detail, severity, enabled, sort_order, created_at, updated_at`

- `category` âˆˆ `file_system | secrets_credentials | git_branches | side_effects_network | escalation_scope`
- `severity` âˆˆ `block | ask_owner | warn`

### IProjectGuardrail (per-project)
**Why this entity exists**: Some constraints only apply to one repo (e.g., "don't run migrations against the staging DB in this project"); modeling them at the project level keeps the global guardrail set from bloating with repo-specific quirks. Lighter shape than IGuardrailRule (no severity enum, no category) because per-project rules are usually plain "do/don't" statements without the full risk taxonomy.

Lighter-weight per-project rules surfaced in the Project Guard-rails tab.

Fields: `id, project_id, title, body_md, applies_to, icon, enabled, sort_order, created_at, updated_at`

### INotification
**Why this entity exists**: Out-of-band signal delivery (external notification pings, in-app alerts) needs its own queue so the Owner can retry transient failures and so quiet-hours batching has somewhere to defer rows to. Modeling it as a persisted queue (vs. fire-and-forget) preserves the audit trail and lets the Notifications page show what was attempted, when, and why it failed.

Delivery queue for external notification + in-app notifications.

Fields: `id, kind, issue_type, issue_id, message, event_type, agent_id, external_status, failure_reason, scheduled_for, sent_at, created_at`

- `kind` âˆˆ `needs_you | update | system`
- `external_status` âˆˆ `pending | sent | failed | cancelled`
- `event_type` âˆˆ external notification event keys (see below)

### IAgentRun
**Why this entity exists**: Every agent invocation produces an auditable run row â€” without it, the Owner can't tell why an epic transitioned (which agent, what version of the prompt, when it succeeded/failed). The Queue page, dashboard "in motion" panel, and per-agent Runs tab all consume the same row shape. Cancellation as an explicit terminal state (vs. delete) preserves history for runs that were intentionally aborted.

A spawned subprocess invocation.

Fields: `id, agent_id, issue_type, issue_id, project_id, status, started_at, ended_at, error, output_summary, created_at`

**Three lifecycle shapes** (ADR 0014):
- **Workflow step on an item** (dominant) — `item_id` + `workflow_run_id` + `node_id` set, `project_id` null. Spawned by the engine in the workflow run's shared worktree.
- **Workflow step at project level** — `item_id` null, `project_id` + `workflow_run_id` set. Runs an `input_kind='none'` workflow (AI Readiness scaffold, knowledge base, scheduled scouts); the prompt-builder renders `# Project Context` (or `# Project-level Run` for a project-less workflow). Items the agent creates are stamped `created_by_workflow_run_id`.
- **Ad-hoc** — `workflow_run_id` and `item_id` null, `project_id` optional. `POST /api/run` from the Run-now dialog; runs in a temp dir and never routes. Rows with `item_id` set and no `workflow_run_id` are pre-ADR-0014 history.

`project_id` has no FK so historical rows survive `DELETE FROM projects`. A partial index (`idx_agent_runs_project_id WHERE project_id IS NOT NULL`) keeps lookups cheap when most rows are item-attached.

- `status` ∈ `queued | in_progress | completed | error | cancelled | setup_failed` — matches `RunStatus` in `@atlas/shared` and the `agent_runs_status_check` CHECK. (The doc previously named `running` and `failed`, which have never existed, and omitted `in_progress`, `error` and `setup_failed`, which do.)
- **The live set is `queued` + `in_progress`**, which is what the partial unique index `agent_runs_one_live_per_item` (migration `003`) constrains to one row per `item_id`. `setup_failed` sits deliberately outside it so a retry isn't blocked (see migration `005`'s header).
- **Promotion is guarded, not unconditional.** `spawnAgentRun` flips `queued → in_progress` from a 200ms `setTimeout`, and by the time that timer fires the row may have left the live set (Owner cancelled, `failOrphanedRuns` swept it, the item was deleted) with a replacement run already holding the slot. So the UPDATE carries `WHERE status = 'queued'` and checks `numUpdatedRows`: zero rows means the run is no longer ours to start, and the runner returns instead of spawning. Without the predicate the stale row re-entered the live set behind the replacement's back and raised 23505 as an unhandled rejection — the run silently never started and the reason lived only in the API log. Its regression test (`agent-dispatcher.integration.test.ts`) was deleted with the dispatcher; nothing asserts this against the real index today.

**Two-persona columns:** `persona`, `review_outcome` and `review_reason` were removed with the in-agent reviewer persona; only `parent_run_id` (self-FK, ON DELETE CASCADE) remains.

**Workflow + config snapshot columns (migration 035):** `workflow_run_id` (FK → `workflow_runs`, ON DELETE SET NULL) and `node_id` tie a run to a workflow step. `cli`, `model`, `effort`, `prompt_version` record the agent config the run spawned with. `spawnAgentRun` writes them on both write paths. `IAgentRun` exposes `workflow_run_id` + `node_id` (`GET /api/run/:id`, `GET /api/run`, `GET /api/agents/:id/runs`); `cli` / `model` reach the web through `IWorkflowRunStep`, and `effort` / `prompt_version` are DB-only.

**Outcome columns** (`outcome_kind`, `outcome_summary`, `outcome_reason`, `outcome_checklist`) are persisted by `completeRun` for every run shape; the engine routes on them.

### ICliSession (Terminal v1+v2)
**Why this entity exists**: The Terminal page hosts long-lived, interactive CLI sessions (Claude Code, GitHub Copilot CLI, or Claude Code-on-Ollama) inside Atlas so the Owner can drive a scoped worktree from the same UI as the rest of the app. Sessions are first-class rows — not ephemeral process handles — because we need cross-restart resume (`claude --resume <sid>` / `copilot --resume <sid>`), idle-notification deep links, per-(project, branch) uniqueness, and an audit trail of which branch went where. The PTY itself lives in-memory in `services/cli-session-host.ts`; the row carries everything else.

Fields: `id, project_id, title, status, cli, worktree_path, worktree_branch, credential_id, claude_session_id, model, initial_prompt, created_at, updated_at, last_active_at, closed_at, finalize_pr_url, item_id, transcript_jsonl, transcript_ingested_at`

**Two kinds share this table** (migration 030). `project_id IS NULL` marks a **standalone** session — a PTY the Owner opened directly on a folder of their choosing, with no project, no worktree and no `.atlas/` staging. It is the sole discriminator; `routes/cli-sessions.ts` gates every branch on `isStandalone()`. See [`26-terminal-standalone`](pages/26-terminal-standalone.md).

- `worktree_path` means **the session's cwd**, not "a worktree". For a project session that is the Atlas-provisioned worktree; for a standalone session it is the Owner's folder. Storing the folder here is deliberate: `cli-transcript-ingest` resolves `~/.claude/projects/<encodeClaudeProjectDir(worktree_path)>/<claude_session_id>.jsonl` from it, so spend tracking, the transcript column and the history page all work for standalone sessions with no extra code.
- `worktree_branch IS NOT NULL` is what means **Atlas created and owns that directory**. The finalize path must key its teardown off this, never off `worktree_path` — `cleanupWorktreeAfterPush` deletes the directory it is handed, and for a standalone session that is a real repository.
- `credential_id` (migration 030, FK → `credentials`, ON DELETE SET NULL) is the Owner's explicit per-session pick. Project sessions leave it null and resolve `projects.credential_id`; resume and finalize both read `session.credential_id ?? project.credential_id` so an explicit pick is never silently replaced by a project default.

- `cli` ∈ `claude | copilot | ollama`. Migration 017 added the column; 029 widened it for `ollama`. Existing rows default to `claude`. All three accept `--session-id <uuid>` on start and `--resume <uuid>` on rejoin, so Pause/Resume work identically — trivially so for `ollama`, which spawns the same `claude` binary.
- `status` ∈ `active | paused | closed | errored`. Lifecycle: active → paused (manual Pause OR PTY exit) → active (Resume) → closed (Stop pushes + tears down worktree). `errored` is terminal-on-spawn-failure.
- `claude_session_id` — Atlas-minted UUID we pass via `--session-id`. Column name predates copilot support; semantically it's "the session id the CLI knows this run by" for either CLI.
- `worktree_branch` participates in a unique partial index `cli_sessions_one_active_per_project_branch` covering `(project_id, worktree_branch) WHERE status IN ('active','paused') AND worktree_branch IS NOT NULL` — same invariant as `agent_runs_one_live_per_item` so worktree-authoring paths can't collide. The `IS NOT NULL` clause is why standalone rows need no index change: they carry a null branch and so can never collide with each other or with a worktree, and multiple standalone sessions on one folder are allowed.
- `item_id` is the optional Atlas item anchor. When set, the create flow stages `.atlas/current-task.md` (orchestrator-style item snapshot) into the worktree. The user's optional `initial_prompt` is appended to the same file as a `## User's initial prompt` section. The PTY auto-types a single pointer line (`Read \`.atlas/current-task.md\` for the full task context, then begin.`) so the CLI picks it up on its first turn.
- All worktree staging (constitution, templates, `.claude/commands/atlas-*.md`, `.github/prompts/atlas-*.prompt.md`, current-task.md) is owned by the shared `stageCliWorktree` helper at `services/worktree-stage.ts`, which is also the call site used by `agent-runner.spawnAgentRun`. The terminal route skips the helper's `includeOutcome` and `activeRunCopilotAgent` flags — those are agent-run-only.
- Idle-notification stream: when a session has no PTY output AND no user keystrokes for `settings.terminal_idle_notify_seconds` (default 300), the host fires a `terminal.waiting_for_input` notification with `link_url: /terminal/<id>`. The host fires once per idle stretch; refreshing the page does NOT re-arm it because the attach replay is a serialized screen snapshot (per-session `@xterm/headless` mirror in `services/terminal-screen-state.ts`) that contains no DSR queries for xterm.js to auto-answer — every inbound byte after attach really is a user keystroke. The snapshot design also means reconnects never render mid-escape-sequence "zombie" characters the way the old byte-ring backlog replay did.
- `transcript_jsonl` / `transcript_ingested_at` (migration 018) — populated when a session reaches `closed`/`errored`. Service `cli-transcript-ingest.ts` reads the CLI's own on-disk JSONL (`~/.claude/projects/<encoded-cwd>/<sid>.jsonl` or `~/.copilot/session-state/<id>/events.jsonl`) and writes it into the column. `GET /api/cli/sessions/:id/transcript` returns these for terminal-state rows (409 for active/paused) and lazy-ingests when the column is still NULL. Active/paused sessions never carry transcript content because history is only meaningful for finished sessions.

### ICredential
**Why this entity exists**: Cloning private repos needs tokens; storing them on the project row would leak secrets into list queries and force re-entry per project. Modeling credentials as a separate, encrypted-at-rest entity lets one credential serve many projects and lets the GET list response omit the plaintext (only fingerprint + metadata leaves the server). The fingerprint is the human-checkable identifier so the Owner can disambiguate without exposing the secret.

Encrypted git credential.

Fields: `id, label, host, kind, token_fingerprint, scope, expires_at, last_used_at, created_at, updated_at`

- `kind` âˆˆ `pat | ssh | app_password` â€” only `pat` is implemented today
- Token stored encrypted (AES-256-GCM). `token_fingerprint` is the SHA-256 hash of the plaintext, exposed in the UI for identification.
- `human_name` / `human_email` (migration 026) are valid on **both** kinds and mean different things by kind. On `github_app` the human is a **co-author**: the bot is the primary author (`[user]` = `<app_slug>[bot]`) and the human is credited via a `Co-Authored-By` trailer written by the `prepare-commit-msg` hook. On `pat` the human is the **author** — a PAT has no identity of its own, so `buildGitAuth` writes these straight into the session's `[user]` block. Both must be set for that block to appear; with neither (or only one) commits fall back to the host machine's `~/.gitconfig`, which is the pre-existing behaviour.
- `human_gh_login` stays `github_app`-only — it feeds `gh pr create --assignee` and the `Requested-By: @<login>` PR-body prefix, neither of which any PAT flow reaches. The service rejects it on a PAT patch.

### ISettings
**Why this entity exists**: Workspace-level config (owner profile, External Notification Channel, env, notification routing, onboarding state) lives in one row because there's only one Owner and one workspace. Modeled as a row rather than scattered key/value pairs so PATCHing multiple fields (e.g., accent + workspace) stays atomic and readable. `onboarding_complete` lives here because the route guard reads it on every request.

Single-row settings table.

Fields: `owner_name, accent_color, workspace_path, onboarding_complete, external_notification_token (encrypted), external_notification_chat_id, external_notification_endpoint_label, external_notification_last_test_ok, external_notification_event_toggles (JSON), quiet_hours_from, quiet_hours_to, quiet_hours_timezone, constitution_md, ...`

### ICliModel
**Why this entity exists**: CLIs ship new model names faster than the app releases; modeling the registry as user-editable data means the Owner can add tomorrow's model without a code change. Pre-validating model names through the registry also prevents the agent picker from offering values that would spawn a failing CLI invocation.

Per-CLI model registry; controls what shows up in the Add Agent dialog and per-agent model dropdowns.

Fields: `id, cli, model_name, note, created_at`

### IWorkflow (ADR 0014)
**Why this entity exists**: Orchestration moved off agents. A workflow is the Owner-designed graph that decides which agents run, in what order, and how the work is delivered (worktree, push, PR, child workflow). Agents stay reusable across many workflows because they carry no routing or schedule state. Types, Zod schemas and the validator live in `packages/shared/src/workflows/index.ts`.

Fields: `id, project_id, name, description, status, graph, input_kind, trigger, use_worktree, push_code, raises_pr, max_loops, schedule_preset, schedule_time_of_day, schedule_weekday, cron_expr, next_run_at, last_run_at, created_at, updated_at`

- `graph` JSONB: `{ nodes: [{id, type: start|agent|owner|end, agent_id?, child_workflow_id?, position}], edges: [{id, source, target, kind: pass|fail}] }` (≤100 nodes, ≤300 edges). `validateWorkflowGraph` rules: unique node ids; exactly one Start with nothing connecting into it; at least one End with no outgoing edges; edges point at existing nodes; `agent_id` only (and required) on agent nodes; `child_workflow_id` only on End; every non-End node has exactly one pass edge; only agent nodes have a fail edge (at most one); every node reachable from Start; pass edges acyclic (loops only through fail edges, so `loop_count` bounds them). Saving also checks every `agent_id` exists.
- `input_kind` ∈ `item | none`. `item`: one run per item queued via `items.workflow_id`. `none`: a project-level run.
- `trigger` ∈ `manual | schedule | item_ready`. `item_ready`: the dispatch tick starts the oldest `ready` queued item whenever no run of this workflow is `running`. `schedule`: fires on `cron_expr` (materialised from `schedule_preset` ∈ `hourly | every_4h | daily | weekly | custom` + `schedule_time_of_day` + `schedule_weekday`, same `materializeCron` as `IProjectSchedule`, evaluated in `settings.quiet_hours_timezone`).
- `use_worktree` / `push_code` / `raises_pr` (defaults true) — End delivery. `max_loops` 1–20, default 3: fail-edge traversals allowed before the run parks.
- `project_id` (FK CASCADE) may be null only when `input_kind = 'none'` and `use_worktree = false` (`workflows_project_required_check`).
- **Templates** (`IWorkflowTemplate`, `packages/api/src/marketplace/workflows/*.json`): `dev`, `planning`, `qa`, `ai-readiness`. Agent nodes reference catalog agent ids; an End may name a child as `template:<id>`, resolved at create time.

### IWorkflowRun (ADR 0014)
**Why this entity exists**: One execution of a workflow over one item (or the project). It owns the worktree and branch for its whole life, so consecutive agent steps share state with no push or re-provision between them, and it holds the item while no step is live.

Fields: `id, workflow_id, item_id, project_id, status, graph_snapshot, current_node_id, parked_node_id, park_reason, loop_count, branch, worktree_path, setup_done, pr_url, started_at, updated_at, finished_at`

- `status` ∈ `running | waiting_for_owner | completed | cancelled | error`. `running` → `waiting_for_owner` (park) → `running` (Owner reply or resume) → `completed` (End) / `cancelled` (stop). The engine never writes `error`; a failed step parks instead.
- `graph_snapshot` is the graph frozen at start; later edits to the workflow don't affect a live run.
- `branch` = the item's valid `worktree_branch` ?? `atlas/wf/<itemId>`, or `atlas/wf/<runId8>` for project-level runs; null when `!use_worktree`. `worktree_path` lives only here, never on `items.worktree_path`, so the orphan reaper can't push or delete it.
- `setup_done` flips after the first completed step so later steps skip the project setup script.
- `workflow_runs_one_live_per_item` allows one `running` or `waiting_for_owner` run per item. It covers the gaps between steps and the End push, where no `agent_runs` row is live. Only `running` locks item status / assignee writes (`workflow-lock.ts`); only `running` blocks the workflow's queue.
- Each step is an ordinary `agent_runs` row with `workflow_run_id` + `node_id` set.
- `items.created_by_workflow_run_id` is stamped when a step's agent creates an item (matched by `reporter_agent_id` against the agent's live step); End routes those items, plus children of the run's item created since `started_at`, to `child.workflow_id ?? End.child_workflow_id` as `ready`.

### IProjectSchedule
**Why this entity exists**: Different repos have different staleness tolerances (a documentation repo can fetch daily; a hot product repo wants every 15 minutes). Modeling schedules per-project rather than globally lets each repo carry its own cadence. The dirty / idle / agents guards live here because skipping a fetch is more situational than skipping a project â€” the policy needs to read the repo's live state at fire time.

Auto-fetch cron schedule per project.

Fields: `id, project_id, enabled, cron_expr, conflict_policy, dirty_guard, idle_guard, agents_guard, last_run_at, next_run_at, created_at, updated_at`

### IEnvVar (settings row helper, not a table)
**Why this shape exists**: Env vars need richer per-row metadata than a flat key/value map can carry â€” `secret` controls UI masking, `restart_required` triggers the restart-confirm dialog, `description` is the on-screen help. Modeling them as structured rows lets the Environment tab render them as a typed list rather than a textarea, which is what would happen with a raw `.env` file.

Each row has: `key, value, secret, restart_required, description`. The full set is mirrored to a `.env` file on save (services/env-file.ts).

---

## Relationships

```
            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
            â”‚ Settings â”‚  (single row, owner profile)
            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜

   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” 1     n â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚  Credential  â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚   Project   â”‚
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜         â””â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜
                                  â”‚ 1
                       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                       â”‚ n        â”‚ n        â”‚ n               â”‚ n
                  â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â” â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â”  â”Œâ”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”  â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”
                  â”‚  Epic  â”‚ â”‚  Bug   â”‚  â”‚ Project- â”‚  â”‚   Project-   â”‚
                  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚ Schedule â”‚  â”‚  Guardrail   â”‚
                       â”‚ 1                â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                       â”‚ n
                  â”Œâ”€â”€â”€â”€â–¼â”€â”€â”€â”€â”
                  â”‚  Story  â”‚
                  â””â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”˜
                       â”‚ 1
              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”
              â”‚ n      â”‚ n
        â”Œâ”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â” â”Œâ”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”
        â”‚ SubTask  â”‚ â”‚ SubBug   â”‚
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜


   Workflow 1 --- n WorkflowRun 1 --- n AgentRun n --- 1 Agent
      |  graph.nodes[].agent_id -----------------------> Agent (no FK; delete guard)
      |  graph.nodes[End].child_workflow_id ----------> Workflow
      n
   Project (FK CASCADE; nullable for no-item, no-worktree workflows)

   Item.workflow_id --------------> Workflow     (queued for)
   Item.created_by_workflow_run_id -> WorkflowRun (created during)
   WorkflowRun.item_id -----------> Item          (one live run per item)
   AgentRun.item_id --------------> Item
   Agent 1 --- n AgentChecklist / AgentPromptVersion; 1 --- 1 AgentMemory

   Comments  â”€â”€â”€â”€â”€ polymorphic by (issue_type, issue_id)
   Notifications  â”€â”€â”€â”€â”€ polymorphic by (issue_type, issue_id)
   Guardrails (global) â”€â”€â”€â”€â”€ workspace-wide, not project-linked
```

---

## Status machine

Source: `packages/shared/src/status-machine/index.ts`. Use `getValidNextStatuses(entityType, currentStatus)` and `isValidTransition(entityType, from, to)`. **Never hardcode status lists in components or routes.**

### Issue statuses (all item types — unified 6-state machine)

```
draft → ready → in_progress → in_review → done
                   │   ▲           │
                   ▼   │           ▼
                 ready │      in_progress
                       │
 any non-done ─▶ waiting_for_info ─▶ ready | in_progress
```

`FORWARD` in `packages/shared/src/status-machine/index.ts`: `draft→ready`, `ready→in_progress`, `in_progress→in_review|ready`, `waiting_for_info→ready|in_progress`, `in_review→done|in_progress`, `done` terminal; every non-`done` status may also move to `waiting_for_info`. The retired 10-state chain (`ready_for_po`, `in_spec`, `ready_for_dev`, …) and the 4-state sub-task machine no longer exist.

### `waiting_for_info` override

From any non-terminal state on Story/Bug/Epic/SubBug, status can move to `waiting_for_info` (typically a workflow run parking with the Owner). From `waiting_for_info` it moves to `ready` or `in_progress` (no prior-state memory).

### Transitions written by the workflow engine

`agent-runner.ts` no longer writes item status. `packages/api/src/services/workflow-engine.ts` writes it directly (`setItemStatus`, with a `status_changed` event and `counts_changed` SSE), without going through `isValidTransition` — `in_progress → done` is not a status-machine edge, and the status machine is unchanged:

| When | To | Assignee | Event `detail` |
|---|---|---|---|
| Run start (`startWorkflowRun`) | `in_progress` | unchanged | `workflow_run_started: <name>` |
| Each agent step spawns (`spawnNode`) | unchanged | the node's agent | — |
| Park (question, missing outcome, no pass/fail edge, loop limit, Owner node, step error / setup failure, missing agent, worktree failure, reconcile) | `waiting_for_info` | null | `workflow_parked: <reason>` |
| Owner reply claims the parked run (`comments.ts`) / `POST /api/workflow-runs/:id/resume` | `in_progress` | unchanged | `resumed_by_owner_reply` / `workflow_resumed` |
| End (`finishRun`) | `in_review` when a PR opened, else `done` | null | `workflow_completed: <name>` |
| Stop (`cancelWorkflowRun`) | `waiting_for_info` | null | `workflow_run_cancelled` |
| End routes a child item (`routeChildren`) | `ready` (+ `workflow_id`) | unchanged | `queued_for_workflow: <workflowId>` |

While a workflow run is `running`, `PATCH …/status` and `…/assign` on its item return 409 (`workflow-lock.ts`). A parked run doesn't lock, so the Owner can move a `waiting_for_info` item by hand.

### Workflow dispatch

No agent auto-dispatch exists. `tickWorkflowDispatch` (one-minute tick in `agent-schedule-registry.ts`, plus a kick at every End / stop) starts runs for active `item_ready` workflows (oldest `ready` item with that `workflow_id`, only while the workflow has no `running` run) and `schedule` workflows (when `next_run_at` is due). Setting an item `ready` without a `workflow_id` starts nothing. Within a run, steps chain immediately on `onStepFinished` with no tick wait. See `api-surface.md` (`services/agent-schedule-registry.ts`).

---

## Where the model touches each part of the codebase

| Concern | File |
|---|---|
| TypeScript interfaces | `packages/shared/src/types/index.ts` |
| Constants (categories, labels, accent colors) | `packages/shared/src/constants/index.ts` |
| Status transitions | `packages/shared/src/status-machine/index.ts` |
| Zod schemas (Create*, Update*) | `packages/shared/src/schemas/index.ts` |
| SQL schema | `packages/api/src/db/migrations/*.sql` |
| Workflow types, graph schema + validator | `packages/shared/src/workflows/index.ts` |
| Marketplace catalog sync (agents are installed, not seeded) | `packages/api/src/db/seed.ts`, `packages/api/src/marketplace/catalog/` |
| Workflow starter templates | `packages/api/src/marketplace/workflows/*.json` |
| Web hook layer | `packages/web/src/hooks/*` |
| Web type-safe fetch | `packages/web/src/api/api.ts` |
