# Agent Detail

**Route:** `/agents/:id` • **Component:** `packages/web/src/pages/AgentDetail.tsx` • **Slug:** `agents`

## Purpose
Edit an agent's configuration, prompt, quality checklist, procedural memory, and inspect its runs and a test-run sandbox. 5 tabs via `?tab=` query param. Schedules, handoff rules, round caps and git-delivery flags moved to workflows (ADR 0014) — agents no longer carry them. Per-agent Allowed Tools picker was removed by B14 (`d3cc9bf`) — spawned CLIs inherit Owner's user-level MCP config; the constitution carries `FORBIDDEN_TOOLS_SECTION` as the safety net.

## States
- **Loading**: centered spinner
- **Not found**: message
- **Populated**: Breadcrumbs + `AgentHero` + tabs + `AgentSidebar`

## Hero (`AgentHero`)
- Inline-editable name (click → text field; Enter / blur saves via `PATCH /agents/:id { name }`); a `designation · category` subtitle line below (category alone when designation is empty, via `agentSubtitle()` in `agentViewModel.ts`).
- **Run now** → opens `RunNowDialog` — a project-level run with **no item** (item-attached ad-hoc runs were removed by ADR 0014; items run through their workflow). Two actions:
  - **Run now** → `POST /api/run` `{ agent_id, issue_type: null, issue_id: null }` → navigates to `/agents/:id/runs/:runId`.
  - **Preview prompt** → `POST /api/agents/:id/compile-prompt` with no item → opens `PromptPreviewDialog` showing the exact markdown that would be piped to the CLI on Run; offers **Copy** + **Download .md**. No spawn, no DB write — for inspection before committing to a real run.
- **Queue: N items** — ready + in-progress Tasks and sub-tasks assigned to this agent, (`useQueueDepthByAgent()` → `countQueueDepthByAgent()` in `pages/agents/agentViewModel.ts`, over the `useTasks` / `useAllSubTasks` cache). Until 2026-09-14 it counted only `queued` / `in_progress` agent runs, so an agent with Ready items but no runs showed "Queue: 0 items".
- **Status label + dot** — same `resolveAgentStatusLabel()` as the Agents card, fed `queuedCount + queueDepth` so Ready items with no run read **Queued**, not **Idle**. Colour from `agentStatusColor()`: a **Failed** label now has an `error` dot (it was green).
- **CLI not installed** warning — `CliUnavailableAlert` (MUI `Alert severity="warning"`) spans the hero when `GET /api/cli/availability` says the agent's CLI binary is missing: "`<binary>` is not installed on this machine — runs will fail until it is, or switch the agent to `<available cli>`." Renders nothing while availability is loading/unknown.
- **Pause/Resume** → `handlePauseToggle()` → `PATCH /agents/:id`
- `AgentCardMenu` (more actions) — Duplicate (opens modal), Delete (mutation)

## Why these affordances exist
- **5 tabs (Overview / Prompt / Test Run / Runs / Memory)** — Each tab is a distinct authoring lifecycle (config vs. prompt vs. validation vs. observability vs. self-corrections); tabs let each own its full width. The Handoffs tab was removed by ADR 0014; routing lives in the workflow graph.
- **Memory tab** — Procedural memory captures "what went wrong last time" without polluting the prompt body. Splitting it out means the Owner can correct a regression in seconds (edit one paragraph in memory.md) instead of bumping the prompt version. Server-side storage means the corrections survive across machines, unlike the localStorage-only prompt history.
- **Run now dialog** — Starts a no-item run straight from the agent page; the success navigation drops directly into the run detail. The dialog's **Preview prompt** sibling answers "what is the agent actually being told?" without burning a real run — the same `buildPrompt()` call the runner makes, rendered + downloadable as `.md`.
- **Pause/Resume in hero** — Pausing without leaving the page prevents wasted runs while the prompt is being re-drafted.
- **Prompt version history** — Prompt edits regress agent behavior often; a localStorage trail is the cheapest "undo" pathway, with "Make active" for one-click revert.
- **Quality checklist** — The agent reports each check in its `atlas-outcome`; a failed required check sends the work down the workflow's fail edge, so the Owner decides what failure means before runs hit it.
- **Test Run tab** — Validates the CLI wiring (binary on PATH, credentials valid, model accepted, output streams) before any real issue is queued. Sends a one-line ping ("reply with the single word OK") to the configured CLI + model; the verdict line ("[test] connection ok · 2.3s") is composed server-side. The constitution and any agent prompt are deliberately NOT included — this is a connection test, not a prompt-assembly smoke test.

## Marketplace upgrade banner

When the agent has a marketplace source and a newer version is available, `MarketplaceUpgradeBanner` (`AgentDetail.tsx:30`) renders above the tabs with an "Upgrade now" CTA that opens a diff modal showing the marketplace catalog version's prompt vs the installed version. Owner-only — silent for agents installed without a marketplace source.

## Tabs

Tab switching is plain `useTabParam(tabSlug)`. (The legacy `LinearProgress` mid-flight indicator + `useTransition` wrapper were removed — `AgentDetail.tsx:70-73` carries the inline removal note.) A `RefreshButton` sits in the breadcrumb row to manually re-fetch when the SSE channel is missed.

### Overview (`OverviewTab`)
- **Edit description** → inline edit; Save calls `PATCH /agents/:id` with `{ description }`; the local toast confirms server persistence.
- **CLI** dropdown — `claude` / `copilot` / `ollama` (full-width, matches Model). Switching CLI auto-selects the new CLI's registry default (first `cli_models` row by `sort_order`, then name — `modelsForCli()` in `ModelSelect.tsx`); switching back restores the saved model. Walkthrough: copilot→claude used to leave "claude-sonnet-4.6 (not in registry)".
- A `CliUnavailableAlert` sits at the top of **Configuration** for the *draft* CLI, so picking an uninstalled CLI warns before Save.
- **Model** dropdown — backed by `cli_models`
- **Effort** dropdown — `none` … `max`.
- **Save changes** → `handleSaveConfig()` → `PATCH /agents/:id` with `{ cli, model, effort }`; `isDirty` tracks those three fields.
- **Discard** → revert local state
- **Role section** — Designation, Memory cadence; **Save role** → `PATCH /agents/:id` `{ designation, memory_cadence }`.
- **Quality checklist** card (`QualityChecklistCard`, between Role and Commit discipline) — loads `GET /agents/:id/checklists`; rows are editable labels with a delete icon (opens a confirm dialog, local until saved); **Add check**; **Save checklist** → `PUT /agents/:id/checklists` `{ items: [{ label, sort_order, required }] }`. Copy: failed required checks send the work down the workflow's fail path. (Moved here from the removed Handoffs tab; formerly "Pre-handoff checklist".)
- **Commit discipline** tile — last 10 commit verifications as coloured dots.
- Removed by ADR 0014: Schedule presets / cron / Next pass preview, Concurrent runs, Max rounds, Item required, Requires worktree, Push code, Raises PR.

### Prompt (`PromptTab`)
- Guardrails-style **Edit / Split / Preview** view-mode toggle on the editor card. The editor pane is a plain `<textarea>` (mono font); the preview pane renders via the shared `MarkdownPreview` component. Header shows `Active prompt · v{n}` and the slugified file name; footer shows saved-status + line count + Save / Discard.
- Save calls `PATCH /agents/:id` with `{ prompt_md }`. The service increments `prompt_version` and inserts a row into `agent_prompt_versions` in the same transaction.
- **No reviewer prompt editor.** The two-persona model (`reviewer_prompt_md`, `submit_review`) was removed; reviewers are separate agents (e.g. Code Reviewer) with their own Prompt tab. (2026-09-14 doc correction.)
- **Two version history tables** — one per kind. `GET /agents/:id/prompt-versions?kind=performer` and `?kind=reviewer` (both default to performer when the param is omitted). Revert is `POST /agents/:id/prompt-versions/:version/revert?kind=...`; both fire through the shared `useRevertAgentPrompt` mutation hook.
- **Version history table** below the editor reads from `GET /agents/:id/prompt-versions`. The list is scrollable (`max-height: 360px`); the page never expands beyond the card. Rows show version / created / edited-by / status / action.
- **Revert** action per non-active row → `POST /agents/:id/prompt-versions/:version/revert`. The server appends a new active version whose body equals the source and whose `reverted_from` points back. The active row shows `current` (italic) instead of an action.

### Test Run (`TestRunTab`)
Live CLI connection test, not a real `agent_runs` row. **Run test** → `POST /api/agents/:id/dry-run` (route name kept for back-compat) with the optional extra-prompt line; the API spawns the agent's configured CLI (`agent.cli`) with `--print --model {agent.model}` and pipes a one-line ping prompt via stdin (`"Reply with the single word OK and nothing else."`). stdout/stderr stream into the dark terminal panel via the `dry_run_*` SSE events (filtered by `dryRunId`). On close the server emits a verdict line `[test] connection ok · 2.3s` (or `connection failed · exit=N · 2.3s`) as the final event output; the UI prints it in green/orange. **Stop** closes the SSE locally (server may still finish). **Copy log** copies the timestamped output. No DB writes, no constitution, no agent prompt, no MCP, no issue context — this only verifies the CLI binary, credentials, and model can complete an LLM round-trip.

### Runs (`RunsTab`)
No-runs hero with **Run now**. Recent 50 runs table (status / issue id / relative time / run id). Rows are clickable — they navigate to `/agents/:id/runs/:runId` for the full run detail (log viewer + Re-run / Copy log / Download log).

### Memory (`MemoryTab`)
Procedural-memory editor backed by the `agent_memory` table.
- Info banner explains the model (auto-rewritten after each run; Owner edits kept).
- Header row: source label (AI-generated vs Manual edit), updated-relative time, last_run_id short, `Regenerate from runs` button.
- File chip: `{slug}.memory.md` · `version {n}.0` · `AI-GEN` / `MANUAL` badge.
- Body: `EditableMarkdownCard` (`GET /api/agents/:id/memory` on read; `PUT /api/agents/:id/memory` on Save).
- Regenerate: `POST /api/agents/:id/memory/regenerate`. Mirrors `agent-runner`'s gating — real CLI when `ATLAS_AI_ENABLED=true`, simulated body otherwise. The simulated body is intentional, not a stub.
- **Regeneration history** (Theme 08 + A06): list of recent `memory_regenerations` rows, newest first. Each row: trigger badge (manual / cadence / high_signal / mcp_update), an amber **BOUNDARY** chip when `boundary_flags.length > 0` (tooltip lists the detected flag slugs), version delta `vN → vM`, char-diff (`+added`, `−removed`), relative time. The chip is informational — the row's body still persisted (soft filter). See `detectBoundaryViolations()` in `services/agent-memory.ts` for the heuristic.

## Sidebar (`AgentSidebar`)
- **Identity** panel — Role, Color (clickable → `EditAgentColorModal`), Glyph (clickable → `GlyphPickerModal`). Slug is intentionally hidden (internal identifier).
- **Telemetry · 30 d** panel — Total runs. (p50 duration was removed; we don't have the calculation pipeline yet.)

## Modals / drawers
- `DuplicateAgentModal` — open/close at page level.
- `RunNowDialog` — opens from the hero "Run now" button. No pickers: Cancel / Preview prompt / Run now for a no-item run → `POST /api/run` → navigates to the new run's detail page. Shows the same `CliUnavailableAlert` as the hero.
- `EditAgentColorModal` — opens from the sidebar Color row. Wraps the shared `AccentColorPicker` and saves via `PATCH /agents/:id` with `{ accent_color }`.
- `GlyphPickerModal` — opens from the sidebar Glyph row. 16-icon Material Symbols grid; saves via `PATCH /agents/:id` with `{ glyph }`.
- `DeleteAgentModal` — opens from the ⋯ menu's Delete. Custom MUI Dialog (replaces the old `window.confirm`); calls `DELETE /agents/:id` on confirm.

## Hooks used
- `useAgent(id)`, `useUpdateAgent`
- `useAgentMemory(id)`, `useSetAgentMemory`, `useRegenerateAgentMemory` (Memory tab)
- `useAgentChecklists(id)` (Quality checklist card)
- `useCliAvailability` / `useMissingCli` (hero, Configuration, RunNowDialog warnings), `useCliModels` (CLI switch → default model)
- `useQuery(['runs', agentId])` and per-tab hooks

## API endpoints touched
- `GET /api/agents/:id`, `PATCH /api/agents/:id`
- `GET /api/agents/:id/checklists`, `PUT /api/agents/:id/checklists` (Quality checklist card)
- `GET /api/agents/:id/memory`, `PUT /api/agents/:id/memory`, `POST /api/agents/:id/memory/regenerate`
- `GET /api/run?agent_id=…`, `POST /api/run` (Run now dialog)
- `GET /api/cli/availability` (CLI not-installed warnings)
- `POST /api/agents/:id/compile-prompt` (Run now dialog — Preview prompt button)
- `POST /api/agents/:id/dry-run` (Test Run tab — live CLI smoke-test)
- `POST /api/agents/:id/duplicate`, `DELETE /api/agents/:id`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Prompt version history is **localStorage only** today; reloading on a different machine loses history.
- Test Run **does** exercise the real CLI now (via `POST /api/agents/:id/dry-run`), but it deliberately ships **only** the workspace constitution + verification ask — no agent prompt, no MCP, no issue context. So a successful dry-run proves "CLI + model + guardrails fetch wired correctly", not "this agent will produce useful output on a Task".
- Test Run **never** writes to `agent_runs`. Closing the panel / navigating away does not abort the server-side CLI process — only the client SSE stream stops.
- Description save is local-only.

## Connectivity
- **Pages**: [Agents](15-agents.md) — list / card entry; [Queue](13-queue.md) — Full-trace target.
- **Routes**: `PUT /agents/:id/checklists` — replaces the whole checklist because rows are read and ordered together.
- **Entities**: `agent`, `agent_checklist_item`, `agent_run`, `cli_model`.

## Coming soon on this page
- Save as run, formatting toolbar wiring — see [coming-soon.md](../coming-soon.md). (Test Run real execution shipped 2026-05-18 as a guardrails-only smoke-test — full prompt in sandboxed mode still pending.)
