# Analytics

**Route:** `/analytics`  •  **Component:** `packages/web/src/pages/Analytics.tsx` (shell) + `pages/analytics/{Overview,Delivery,Workflows,Spend}Tab.tsx`

## Purpose
What shipped, how fast work moves, how the workflows and agents ran, and what it all cost — over a window the Owner picks, in the Owner's timezone.

## States
- Loading: `TabSkeleton` (`_chrome.tsx`) while the active tab's chunk or data loads.
- Error: `Alert severity="error"` "Could not load … : <message>" for the active tab only.
- Empty: each card has its own honest empty copy ("Nothing shipped in this window", "No workflow runs in this window", "No Tasks are in progress, waiting or in review right now."). The Overview insight reads "Nothing shipped, ran or spent in this window yet." when all three are zero.

## UI elements

**Header** — `PageHeader` (`analytics` icon). Subtitle: "What shipped, how fast, how the workflows ran and what it cost, for {October 2026 | the last N days}. Times are in {viewer tz}."
- **Window** `ToggleButtonGroup` (header actions): `7 days` · `30 days` · `90 days` · `This month`. URL `?window=7d|30d|90d`; `month` (default) clears the param so the first load matches the Dashboard's month spend.

**Tabs** (scrollable, `aria-label="Analytics sections"`) — `?tab=overview|delivery|workflows|spend` via `useTabParam`; `overview` clears the param. Each tab is a `lazyNamed` chunk and calls only its own hooks, so a tab never opened never fetches.

**Every metric states its definition**: tiles are `StatTile` with an info button (`aria-label="How {label} is measured"`) whose tooltip is the definition; charts state theirs in the `ChartTitle` sub line. Deltas (`Delta`) compare with the previous window ("vs the 7 days before" / "vs the same days last month"), green when the move is good news, red when not; rates move in points (`pts`).

### Overview
- **Hero** (`_chrome.tsx` `Hero`, tinted `accentSoft` surface — the sidenav active-row family, so it follows light and dark) carrying one computed insight (`_insight.ts` `pickInsight`), in priority order: share of shipped Tasks' time spent **waiting on you** (≥30%, ≥3 shipped) → **cycle time** swing (≥25%) → **throughput** swing (≥25%) → **aging work** (oldest WIP id) → **spend** swing → **cache leverage** → plain activity.
- Six tiles: Tasks shipped · Median cycle time · PRs merged · Workflow success rate · Spend · Cost per shipped Task (spend ÷ Tasks shipped).
- **Shipped and spent, per day|week** — two charts on one time axis (`syncId`), each with its own y-axis (never a dual axis): Tasks shipped bars, then agent-run + terminal spend stacked.

### Delivery (`GET /api/analytics/delivery`)
- Tiles: Tasks shipped (+sub-tasks), Lead time p50 (p90), Cycle time p50 (p90), Work in progress (aging count), Waiting on you (total, parks, median, still waiting), Reopen rate, PRs merged (merge rate), Time to PR.
- Charts: Throughput (Tasks/sub-tasks stacked), Cycle time trend (per-bucket median; gaps = nothing shipped), Cycle time distribution (histogram), Where shipped work waited (avg time per status; Waiting for info emphasised), Cycle time by priority, Where shipped Tasks came from (Atlas vs Jira).
- **Oldest work in progress** — 10 oldest WIP Tasks, id links to `/tasks/:id`, "aging" past 7 days.
- **By project** table (`aria-label="Delivery by project"`, scrolls sideways on a phone) — row/name → `/analytics/project/:id`.

### Workflows & agents (`GET /api/analytics/workflows`)
- Tiles: Success rate, Workflow runs, Gate pass rate, Retries.
- How runs ended (status colours with labels) and Gate verdicts stacked on the left, **Why runs stopped for you** beside them (parks grouped by `park_kind`, labels from `WORKFLOW_PARK_KIND_LABELS`; a sub-task that waits holds its Task too and counts once), then Cost per run full width.
- **Workflows** table — runs, success, median duration, loops/run, gate rounds/run, cost/run; row → `/workflows/:id`.
- **Agents** table — the fleet page's `shapeAgent` rows, **agent tests left out**, **in name order, no ranking** (ADR 0023; "Sent back" is never the failure colour); row → `/agents/:id?tab=performance`; **Fleet performance** button → `/agents/performance`. The First attempt colour key (Applied · Sent back · Asked you) sits above the table, not inside its header.

### Spend (`GET /api/analytics?window=`)
- Tiles: Spend, Cost per shipped Task, Cache savings ($, with unpriced cached tokens stated), Cache hit rate.
- Agent runs vs terminal sessions, Cost by model (model · CLI · runs/sessions), Spend per day|week (stacked), Tokens per day|week (input/output/cache reads).
- Existing cards, now over the window: Spend by agent, Cost per project, Owner-driven runs (terminal sessions), Trailing 12 months (single axis — the run-count overlay was dropped), Top runs by cost.

## Modals / drawers
None.

## Hooks used
- `useAnalyticsSpend(window)` → `['analytics', window]`, `useAnalyticsDelivery(window)` → `['analytics','delivery',window]`, `useAnalyticsWorkflows(window)` → `['analytics','workflows',window]` (`hooks/useAnalytics.ts`, 30 s stale). The viewer tz is sent as `?tz=` by `api.analytics.*`.

## API endpoints touched
- `GET /api/analytics?tz&window`, `GET /api/analytics/delivery?tz&window`, `GET /api/analytics/workflows?tz&window` — see `api-surface.md`.

## Permissions / guards
- Post-onboarding only. Read-only.

## Edge cases / quirks
- **The month boundary is local, and the timestamp column is UTC.** On 2026-09-12, all-time project cost read `$8.12` while September read `$2.28`; five runs completed 18:32–20:32Z on Aug 31, i.e. Sept 1 in Asia/Calcutta. Verify against the same `tz` the page sent before filing a mismatch.
- `window=month` is the month start in the viewer's zone. The Dashboard sends the same zone (`GET /api/dashboard?tz=`) and resolves the month with the same `resolveWindow`, so its "this month" spend equals this page's month Spend to the cent (`routes/analytics.test.ts` "the Dashboard month agrees with Analytics"). Before 2026-10-16 the Dashboard used the server's local month start and could disagree across a month boundary.
- 90 days buckets by Monday weeks (`date_trunc('week')`); the web rolls daily spend into the same weeks (`mondayOf`).
- Agent-test items (`items.is_test`) are left out of delivery and workflow numbers **and of the Agents rows** (`exclude_test_items`). The Fleet performance page still counts them in its agent rows — its documented scope.
- **Spend leaves agent tests out too** (2026-10-16, `notTestRun` in `services/analytics-window.ts`): every agent-run spend figure — summary, daily, by agent, by project, by model, top runs, the 12-month ladder and the previous-window delta — skips runs whose item is `is_test`. A run with no item (a standalone agent run) is real spend and stays. **Decision:** an agent test is a qualification probe on a throwaway item, not work; counting it made "Cost per shipped Task" charge test probes to shipped work and put a spend bar under a project no Task shipped from. The Dashboard's month spend leaves them out the same way so the two still agree. Their cost stays visible where it belongs: the agent's Tests tab (`TestsTabContent`). The drill-downs (`/analytics/project/:id`, `/analytics/task/:id`) are all-time per item and unchanged: the agent-test sandbox project's own page still shows what its probes cost.
- Park reasons are exact: the engine writes `workflow_run_events.park_kind` at each park site (migration 014; see `data-model.md`). Parks from before 014 were backfilled from their prose; what could not be classified reads "Other".
- **Realistic-data check**: `e2e/pages/analytics-real.spec.ts` seeds ~6 months of work (`e2e/fixtures/analytics-seed.ts`, `pnpm e2e:seed:analytics` for a hand look) and asserts, for every window, that Tasks shipped, median cycle time, workflow success rate, spend, reopen rate and every park-kind bar equal plain SQL over the seed; it also walks both drill-downs (paging, rows per page, kind filter, links).
- Chart colours come from `CHART_PALETTE` (`theme/tokens.ts`, `--atlas-chart-1..8` in `theme-vars.css`), validated for colour-blind separation in both modes.
- Agent names come from the API (`agent_name` join), so a deleted agent's spend keeps its name.

## Related pages
- [`31-analytics-project.md`](31-analytics-project.md), [`32-analytics-task.md`](32-analytics-task.md) — drill-downs (same themed `Hero`)
- [`36-fleet-performance.md`](36-fleet-performance.md) — the agent comparison the Workflows tab links to
- [`01-dashboard.md`](01-dashboard.md) — the month-spend figure that must agree with this page

## Coming soon on this page
- None.
