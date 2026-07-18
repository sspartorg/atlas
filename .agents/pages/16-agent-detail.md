# Agent Detail

**Route:** `/agents/:id` • **Component:** `packages/web/src/pages/AgentDetail.tsx` • **Slug:** `agents`

## Purpose
Edit an agent's configuration, prompt (performer + reviewer personas), handoff rules, procedural memory, and inspect its runs and a test-run sandbox. 6 tabs via `?tab=` query param. Per-agent Allowed Tools picker was removed by B14 (`d3cc9bf`) — spawned CLIs inherit Owner's user-level MCP config; the constitution carries `FORBIDDEN_TOOLS_SECTION` as the safety net.

## States
- **Loading**: centered spinner
- **Not found**: message
- **Populated**: Breadcrumbs + `AgentHero` + tabs + `AgentSidebar`

## Hero (`AgentHero`)
- Inline-editable name (click → text field; Enter / blur saves via `PATCH /agents/:id { name }`); a `designation · category` subtitle line below (category alone when designation is empty, via `agentSubtitle()` in `agentViewModel.ts`).
- **Run now** → opens `RunNowDialog` (project / issue-type / issue pickers). Two actions:
  - **Run now** → `POST /api/run` → navigates to `/agents/:id/runs/:runId`.
  - **Preview prompt** → `POST /api/agents/:id/compile-prompt` → opens `PromptPreviewDialog` showing the exact markdown that would be piped to the CLI on Run; offers **Copy** + **Download .md** (filename `prompt-{agentSlug}-{issueType}-{issueId}-{YYYYMMDD-HHMMSS}.md`). No spawn, no DB write — for inspection before committing to a real run.
- **Pause/Resume** → `handlePauseToggle()` → `PATCH /agents/:id`
- `AgentCardMenu` (more actions) — Duplicate (opens modal), Delete (mutation)

## Why these affordances exist
- **6 tabs (Overview / Prompt / Handoffs / Test Run / Runs / Memory)** — Each tab is a distinct authoring lifecycle (config vs. prompt vs. routing vs. validation vs. observability vs. self-corrections); tabs let each own its full width.
- **Memory tab** — Procedural memory captures "what went wrong last time" without polluting the prompt body. Splitting it out means the Owner can correct a regression in seconds (edit one paragraph in memory.md) instead of bumping the prompt version. Server-side storage means the corrections survive across machines, unlike the localStorage-only prompt history.
- **Run now dialog** — The hero CTA is the highest-frequency action when an agent is being tuned: edit prompt → run on a specific story → inspect output. Dialog-based pickers keep the user on the agent page (no context switch to Queue) and the success navigation drops directly into the run detail. The dialog's **Preview prompt** sibling answers "what is the agent actually being told?" without burning a real run — the same `buildPrompt()` call the runner makes, rendered + downloadable as `.md`.
- **Pause/Resume in hero** — Pausing without leaving the page prevents wasted runs while the prompt is being re-drafted.
- **Prompt version history** — Prompt edits regress agent behavior often; a localStorage trail is the cheapest "undo" pathway, with "Make active" for one-click revert.
- **Handoffs all-pass / any-fail routing** — Agent chains depend on deterministic exits; modeling pass-vs-fail explicitly forces the Owner to decide what failure means before runs hit it.
- **Test Run tab** — Validates the CLI wiring (binary on PATH, credentials valid, model accepted, output streams) before any real issue is queued. Sends a one-line ping ("reply with the single word OK") to the configured CLI + model; the verdict line ("[test] connection ok · 2.3s") is composed server-side. The constitution and any agent prompt are deliberately NOT included — this is a connection test, not a prompt-assembly smoke test.

## Marketplace upgrade banner

When the agent has a marketplace source and a newer version is available, `MarketplaceUpgradeBanner` (`AgentDetail.tsx:30`) renders above the tabs with an "Upgrade now" CTA that opens a diff modal showing the marketplace catalog version's prompt vs the installed version. Owner-only — silent for agents installed without a marketplace source.

## Tabs

Tab switching is plain `useTabParam(tabSlug)`. (The legacy `LinearProgress` mid-flight indicator + `useTransition` wrapper were removed — `AgentDetail.tsx:70-73` carries the inline removal note.) A `RefreshButton` sits in the breadcrumb row to manually re-fetch when the SSE channel is missed.

### Overview (`OverviewTab`)
- **Edit description** → inline edit; Save calls `PATCH /agents/:id` with `{ description }`; the local toast confirms server persistence.
- **CLI** dropdown — `claude` / `copilot` (full-width, matches Model)
- **Model** dropdown — backed by `cli_models`
- **Schedule hours** — number input (0.5h step); shows "Next pass" delta on the same row (wraps on mobile)
- **Concurrent runs** +/− (capped at `view.concurrentMax`)
- **Save changes** → `handleSaveConfig()` → `PATCH /agents/:id` with `{ cli, model, schedule_hours, concurrent_runs }`; `isDirty` tracks all four fields.
- **Discard** → revert local state
- **Role section** — Designation, Max rounds, Item required (freedom-mode toggle), Memory cadence. The Kind toggle + Reviewer picker were dropped in Phase 2 of the two-persona refactor; reviewer logic lives entirely on the Prompt tab's *Reviewer prompt* editor. `Max rounds` caps `(item_id, agent_id)` reviewer-persona bounces.

### Prompt (`PromptTab`)
- Guardrails-style **Edit / Split / Preview** view-mode toggle on the editor card. The editor pane is a plain `<textarea>` (mono font); the preview pane renders via the shared `MarkdownPreview` component. Header shows `Active prompt · v{n}` and the slugified file name; footer shows saved-status + line count + Save / Discard.
- Save calls `PATCH /agents/:id` with `{ prompt_md }`. The service increments `prompt_version` and inserts a row into `agent_prompt_versions` in the same transaction.
- **Reviewer prompt editor** (Two-persona model, second card) — same Edit / Split / Preview shape as the active prompt, bound to `agent.reviewer_prompt_md` / `agent.reviewer_prompt_version`. When non-empty, the runner spawns a second CLI invocation after the performer leg completes and routes the item per the reviewer's `submit_review` outcome (pass / fail / needs_info). Empty disables the reviewer leg — the runner falls back to the legacy direct on-pass handoff. Save calls `PATCH /agents/:id` with `{ reviewer_prompt_md }`; the server increments `reviewer_prompt_version` and inserts an `agent_prompt_versions` row with `kind='reviewer'`. Status label flips between "Reviewer persona active" / "disabled" based on whether the saved body is non-empty.
- **Two version history tables** — one per kind. `GET /agents/:id/prompt-versions?kind=performer` and `?kind=reviewer` (both default to performer when the param is omitted). Revert is `POST /agents/:id/prompt-versions/:version/revert?kind=...`; both fire through the shared `useRevertAgentPrompt` mutation hook.
- **Version history table** below the editor reads from `GET /agents/:id/prompt-versions`. The list is scrollable (`max-height: 360px`); the page never expands beyond the card. Rows show version / created / edited-by / status / action.
- **Revert** action per non-active row → `POST /agents/:id/prompt-versions/:version/revert`. The server appends a new active version whose body equals the source and whose `reverted_from` points back. The active row shows `current` (italic) instead of an action.

### Handoffs (`HandoffsTab`)
Handoff prompt textarea + checklist (Add check / delete per row; deleting a row opens `ConfirmRemoveCheckDialog` — local-only change until Save). Two routing branches — **All checks passed** and **Any check failed** — each picks Assign-to agent + Set-status-to. The Assign-to picker lists every agent including the current one, so a self-cycling agent (e.g. a scheduled automation like `cer-weekly-automation`) can hand off back to itself. **Save handoffs** → `POST /agents/:id/handoff-rules`.

### Test Run (`TestRunTab`)
Live CLI connection test, not a real `agent_runs` row. **Run test** → `POST /api/agents/:id/dry-run` (route name kept for back-compat) with the optional extra-prompt line; the API spawns the agent's configured CLI (`agent.cli`) with `--print --model {agent.model}` and pipes a one-line ping prompt via stdin (`"Reply with the single word OK and nothing else."`). stdout/stderr stream into the dark terminal panel via the `dry_run_*` SSE events (filtered by `dryRunId`). On close the server emits a verdict line `[test] connection ok · 2.3s` (or `connection failed · exit=N · 2.3s`) as the final event output; the UI prints it in green/orange. **Stop** closes the SSE locally (server may still finish). **Copy log** copies the timestamped output. No DB writes, no constitution, no agent prompt, no handoffs, no MCP, no issue context — this only verifies the CLI binary, credentials, and model can complete an LLM round-trip.

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
- **Schedule** panel — Cadence, Next pass.
- **Telemetry · 30 d** panel — Total runs. (p50 duration was removed; we don't have the calculation pipeline yet.)

## Modals / drawers
- `DuplicateAgentModal` — open/close at page level.
- `RunNowDialog` — opens from the hero "Run now" button. Pickers (project → issue type → issue) → `POST /api/run` → navigates to the new run's detail page.
- `EditAgentColorModal` — opens from the sidebar Color row. Wraps the shared `AccentColorPicker` and saves via `PATCH /agents/:id` with `{ accent_color }`.
- `GlyphPickerModal` — opens from the sidebar Glyph row. 16-icon Material Symbols grid; saves via `PATCH /agents/:id` with `{ glyph }`.
- `DeleteAgentModal` — opens from the ⋯ menu's Delete. Custom MUI Dialog (replaces the old `window.confirm`); calls `DELETE /agents/:id` on confirm.

## Hooks used
- `useAgent(id)`, `useUpdateAgent`
- `useAgentMemory(id)`, `useSetAgentMemory`, `useRegenerateAgentMemory` (Memory tab)
- `useProjects`, `useEpics`, `useStories`, `useBugs` (RunNowDialog)
- `useQuery(['runs', agentId])` and per-tab hooks

## API endpoints touched
- `GET /api/agents/:id`, `PATCH /api/agents/:id`
- `GET /api/agents/:id/handoff-rules`, `POST /api/agents/:id/handoff-rules`
- `GET /api/agents/:id/memory`, `PUT /api/agents/:id/memory`, `POST /api/agents/:id/memory/regenerate`
- `GET /api/run?agent_id=…`, `POST /api/run` (Run now dialog)
- `POST /api/agents/:id/compile-prompt` (Run now dialog — Preview prompt button)
- `POST /api/agents/:id/dry-run` (Test Run tab — live CLI smoke-test)
- `POST /api/agents/:id/duplicate`, `DELETE /api/agents/:id`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Prompt version history is **localStorage only** today; reloading on a different machine loses history.
- Test Run **does** exercise the real CLI now (via `POST /api/agents/:id/dry-run`), but it deliberately ships **only** the workspace constitution + verification ask — no agent prompt, no handoffs, no MCP, no issue context. So a successful dry-run proves "CLI + model + guardrails fetch wired correctly", not "this agent will produce useful output on a story".
- Test Run **never** writes to `agent_runs`. Closing the panel / navigating away does not abort the server-side CLI process — only the client SSE stream stops.
- Description save is local-only.

## Connectivity
- **Pages**: [Agents](15-agents.md) — list / card entry; [Queue](13-queue.md) — Run-now / Full-trace target.
- **Routes**: `POST /agents/:id/handoff-rules` — single endpoint for the whole rule blob because rules are read together; partial updates would force the Owner to re-load to see the new effective routing.
- **Entities**: `agent`, `agent_handoff_rule`, `agent_run`, `cli_model`.

## Coming soon on this page
- Save as run, formatting toolbar wiring — see [coming-soon.md](../coming-soon.md). (Test Run real execution shipped 2026-05-18 as a guardrails-only smoke-test — full prompt + handoffs in sandboxed mode still pending.)
