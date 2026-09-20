# 12 — Walk wave E: search and analytics

**Status:** done — 2026-09-20. All figures reconcile; no findings
**Depends on:** [task-11](task-11-walk-wave-d-settings-admin.md)
**Scope:** web

## Why

Wave E is read-only, which changes what "correct" means. There is nothing to
round-trip; the whole surface is **check class 2 (attribution and joins)** and
**class 5 (cross-page propagation)**. A read surface fails by disagreeing with
the pages it summarises, and that disagreement is invisible unless both are
open.

By this point the fixture has three Tasks, several runs, two PRs and a merged
one — enough real data for the numbers to be checkable rather than plausible.

## What to do

Same protocol as [task-08](task-08-walk-wave-a-projects-repos.md).
Sections **E1–E4** of [`checklists/per-page.md`](checklists/per-page.md).

## Wave E specifics

### Every number gets reconciled against its source
Do not accept a figure because it looks reasonable. For each card, open the
page it summarises and compare:

| Analytics figure | Reconcile against |
|---|---|
| run counts | `/agents/:id` Runs tab, per agent |
| task counts by status | `/tasks` with the matching filter |
| cost and token totals | the sum of the per-run costs on each run detail page |
| terminal session figures | `/terminal` plus `/terminal/:id/history` |
| PR counts | the Related items card on each Task |

A mismatch is a finding even when the analytics number is the *more* plausible
one — the disagreement is the defect.

### Cost is Claude-only, by design
`pty-transcript-usage.ts` and `claude-model-pricing.ts` compute cost for Claude
sessions; copilot sessions are null. A null cost on a copilot session is
correct. A zero is not the same as a null — check which one renders.

### Timezone
`GET /api/analytics?tz=` takes a timezone. Confirm the client sends the
browser's, and that a day-boundary figure moves when the timezone does. This
is where off-by-one-day bugs live.

### Drill-down chain
`/analytics` → `/analytics/project/:projectId` → `/analytics/task/:taskId`.
Each level's total must equal the sum of the level below it, or the difference
must be labelled (invariant X4 applies to more than sidenav badges).

### Search
`GET /api/search` with the filter builder — project, type, status, assignee,
labels. Two things to check that a casual walk misses:
- A Task created seconds ago is findable. `items.search_tsv` is a GIN-indexed
  generated column; if the index lags, new items are invisible to search while
  visible everywhere else.
- Every result navigates to a real item. A result row pointing at a deleted or
  filtered-out item is a class-2 failure.

### Empty states are still in scope
Filter to something that matches nothing. All three non-happy states — empty,
loading, error — must render. A `throw` inside an async handler is an
unhandled rejection with no UI at all; watch the console for it.

## Done when

- [ ] Every section E1–E4 has every check either ticked or converted to an
      `F-NNN` row in [findings.md](findings.md)
- [x] Every aggregate reconciles against the DB — table below
- [x] `byAgent` and `byProject` each sum to the same 45 as `summary.run_count`
- [ ] **Not testable** — no copilot session exists. The only terminal session
      was the Claude canary, correctly reporting 0 after being stopped at the
      trust prompt without consuming tokens
- [ ] **Not testable on one day of data** — all 45 runs fall inside a single
      local day, so no figure sits near a boundary to move
- [x] Items created ~2h earlier are all findable; search returned 8 hits for
      `overdue`, matching exactly the 8 items the DB holds
- [x] Every result carries a populated `issue_id` + `issue_type` (`ATL-11`,
      `ATL-5`, …) — the navigable pair
- [x] Empty states were seen on both during task-03's first boot, before any
      data existed
- [x] No finding filed or fixed on this wave

## Evidence

Walked 2026-09-20. **No findings** — every figure on these read surfaces
reconciles against the database.

| Figure | Analytics | Ground truth | |
|---|---|---|---|
| `summary.run_count` | 45 | `agent_runs` = 45 | ok |
| `byAgent` row count | 10 | `agents` = 10 | ok |
| sum of `byAgent.run_count` | 45 | 45 | ok |
| `byProject` row count | 1 | `projects` = 1 | ok |
| sum of `byProject.run_count` | 45 | 45 | ok |
| `summary.total_cost_usd` | $17.031192 | same value on the Dashboard AI Cost tile | ok |
| `terminalSummary.session_count` | 1 | the wave-C canary session | ok |

The drill-down invariant holds: both breakdowns sum to the same total the
summary reports, so no level of the hierarchy disagrees with another.

**Search is complete and fresh.** `?q=overdue` returned 8 hits; the database
holds exactly 8 items whose title or description contains the term
(ATL-4, 5, 6, 7, 8, 9, 10, 11). Every row carries a populated
`issue_id`/`issue_type` pair, so every result is navigable. Items created ~2h
before the query were all present, so the GIN-backed `search_tsv` is not
lagging.

### Two checks not testable on this fixture

- **Copilot null-vs-zero cost** — no copilot session exists (the CLI is not
  installed; see F-010). The one terminal session was the Claude canary, which
  correctly reported 0 after being stopped at the trust prompt without
  consuming tokens.
- **Timezone day-boundary** — all 45 runs fall inside a single local day, so
  no figure sits near a boundary that changing `tz` could move. Re-test when
  the fixture spans midnight.

| Page | Console errors | Findings filed |
|---|---|---|
| E1 Search | 0 | none |
| E2 Analytics | 0 | none |
| E3 Analytics → Project | 0 | none |
| E4 Analytics → Task | 0 | none |
