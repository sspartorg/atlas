# Analytics

**Route:** `/analytics`  •  **Component:** `packages/web/src/pages/Analytics.tsx`

## Purpose
Workspace-wide AI spend, throughput and cache efficiency for the current month,
combining autonomous agent runs with manual terminal sessions.

## States
- Loading: stacked `<Skeleton>` blocks (`:289`), plus a per-chart `<Suspense>` skeleton since every chart is `lazy()`-loaded (`:16`–`:22`).
- Error / empty: panels render their own empty copy; there is no single page-level error screen.
- Populated: headline insight → KPI tiles → the chart stack.

## UI elements

**Header**
- `{todayLabel} · {clockLabel} {tzShort}` (`:536`) — wall clock in the **viewer's** timezone.
- Subtitle states the month and repeats the timezone (`:561`). That sentence matters — see Edge cases.

**Headline insight** (`:381`) — one computed sentence, picked in priority order:
1. **Month-over-month** — spend delta vs last month
2. **Cache leverage** — `cacheEfficiency` as a share of input context
3. **Workload concentration** — top agent's share of agent spend
4. **Activity** — sessions / runs / active days / projects, plus avg cost per session

**KPI tiles** (`:715`) — Avg cost / session, Avg tokens / session, Cost / 1M tokens, Cache hit rate.

**Chart stack** — each in its own `<Suspense>`:
`AgenticDailyCard`, `TerminalDailyCard`, `MonthlyLadder`, `SpendByAgentCard`,
`ProjectCostBars`, `TopRunsTable`, `TerminalSessionsCard`.

## Modals / drawers
None.

## Hooks used
- `useQuery(['analytics'])` → `api.analytics.get(tz)`, where `tz` defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone` (`api.ts:227`). The timezone is a **query parameter**, not a display-only concern.

## API endpoints touched
- `GET /api/analytics?tz=<IANA zone>` — month summary, daily series, by-agent, by-project, top runs, terminal sessions

## Permissions / guards
- Auth: post-onboarding only. Read-only.

## Edge cases / quirks
- **The month boundary is local, and the timestamp column is UTC.** This looks like a bug from a SQL prompt and is not. During the 2026-09-12 sweep, all-time project cost read `$8.12` while the September figure read `$2.28` / 5 runs; the five runs completed 18:32–20:32Z on Aug 31, i.e. Sept 1 00:02–02:02 in Asia/Calcutta. A UTC-midnight comparison "disagrees" with the page and the page is right. The UI states the timezone for exactly this reason — **verify against the same `tz` the page sent before filing anything.**
- Charts are `lazy()` for bundle budget (`bundle:check` in `pnpm gate`). Keep new charts lazy.
- Agent names come from the denormalized `agent_name` the API joins (`routes/analytics.ts:185`), not from a client-side agent lookup — so a deleted agent's historical spend still carries a name.

## Related pages
- [`31-analytics-project.md`](31-analytics-project.md), [`32-analytics-task.md`](32-analytics-task.md) — drill-downs
- [`01-dashboard.md`](01-dashboard.md) — the KPI strip that must agree with this page

## Coming soon on this page
- None.
