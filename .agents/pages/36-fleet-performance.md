# Fleet performance

**Route:** `/agents/performance` • **Component:** `packages/web/src/pages/FleetPerformance.tsx` • **Slug:** `agents`

## Purpose
Every agent that took a workflow step in the window, side by side, plus what the fleet delivered: PRs merged, cost per merged PR, time to PR and how often a Task needed the Owner. The per-agent numbers are the Performance tab's ([Agent Detail](16-agent-detail.md)), computed by the same code (`shapeAgent` in `services/agent-scorecard.ts`).

**A comparison, not a leaderboard.** ADR 0023 rules out ranking agents on first-attempt success: a reviewer whose job is to send work back sorts worst on any such number. Rows are sorted by agent name (server-side), no pass rate appears anywhere, and **Sent back** is the same brand blue as on the tab — never the error colour.

## States
- **Loading**: two rounded skeletons (tiles, table).
- **Error**: `Alert severity="error"` with the API message.
- **Empty** (no agent rows AND no delivery runs): dashed `EmptyState` "Nothing to compare yet" — "No workflow runs in the last {N} days. Agents appear here once a workflow step runs."
- **Deliveries but no agent rows**: tiles render, the table box reads "No agent took a workflow step in this window."
- **Populated**: tiles, then the table.

## UI elements
**Header**
- Breadcrumb `Agents / Fleet performance` (→ `/agents`).
- H1 **Fleet performance**; metadata subtitle "Workflow steps and deliveries over the last {N} days. Ad-hoc runs are not counted, and agent tests are left out of deliveries."
- **Window** toggle (mode tier): `30 days` / `90 days` (default 90). Stored in the URL as `?days=30` (90 clears the param); pressing the selected button keeps it.

**Delivery tiles** (`KpiTile` ×4)
- **PRs merged** — `prs_merged`, caption `of {prs_opened} opened`. Merged = the PR link's last polled GitHub state.
- **Cost per merged PR** — `cost_per_merged_pr_usd` or `—`; caption "every step, failed ones too" (tooltip explains: the merged runs' every step, Task run and sub-task runs, failed ones included, ÷ PRs merged).
- **Median time to PR** — `median_s_to_pr` as `45s` / `12m` / `1.5h` / `3.0d`, or `—`; caption "from run start".
- **Owner interventions per Task** — `per_task` to one decimal, or `—`; caption `{parked} over {tasks} Tasks since {date}` where the date is when park history began (migration 024), or "not recorded yet". Runs that started before that date are left out rather than counted as zero.

**Comparison table** (`aria-label="Agents compared"`, horizontally scrollable)
- Columns: **Agent** (accent dot + name) · **Steps** · **First attempt** (header legend Applied / Sent back / Asked you with their colours; cell = shared `OutcomeBar` + `applied · sent back · asked` counts, tooltip names them) · **Loops** · **Gate catches** · **Cost / step** (`—` when no steps) · **p95** · **Steps by week** (`TrendSparkline`; "no weeks yet" / "one week so far" below two weeks).
- Row click → `/agents/:id?tab=performance`.

## Why these affordances exist
- **No sort controls** — the only sensible default orders are name or volume; a clickable First-attempt sort would be the leaderboard the ADR forbids.
- **Interventions state their start date** — `park_reason` was nulled on every resume, so nothing before migration 024 survived. A silent zero would read as "the fleet never needed you".
- **Cost includes failed steps and sub-task runs** — a failed dispatch was still paid for; leaving it out would flatter the fleet.

## Hooks used
- `useFleetPerformance(days)` (`hooks/useAgentTests.ts`) — `['fleet-performance', days]`.

## API endpoints touched
- `GET /api/agents/performance?days=30|90` — see `api-surface.md`.

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Agent-test items (`items.is_test`) are excluded from the delivery tiles but not from the agent rows — the same scope as the Performance tab, which counts any workflow step.
- `pr_state` is whatever the PR poller last saw; a merge GitHub has not been asked about yet counts as opened, not merged.
- No sidenav entry: the page sits under **Agents**, which stays highlighted (`/agents/…` prefix match).

## Connectivity
- **Pages**: [Agents](15-agents.md) — header **Fleet performance** button; [Agent Detail](16-agent-detail.md) — row click target (Performance tab).
- **Entities**: `agent_run`, `workflow_run`, `workflow_run_event`, `item_external_link`.
