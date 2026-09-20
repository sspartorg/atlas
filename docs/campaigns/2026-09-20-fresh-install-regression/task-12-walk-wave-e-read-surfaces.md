# 12 — Walk wave E: search and analytics

**Status:** todo
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
- [ ] Every analytics figure is reconciled against its source page — paste the
      comparison table with both numbers per row
- [ ] The drill-down totals add up across all three levels, or the difference
      is labelled in the UI
- [ ] A copilot session renders a null cost, not a zero
- [ ] Changing the timezone moves a day-boundary figure
- [ ] A Task created during this task is findable in search within seconds
- [ ] Every search result navigates to a live item
- [ ] Empty, loading and error states render on both search and analytics
- [ ] Console error count per page recorded; no finding fixed during this task

## Evidence

*(filled during execution)*

| Page | Console errors | Findings filed |
|---|---|---|
| E1 Search | | |
| E2 Analytics | | |
| E3 Analytics → Project | | |
| E4 Analytics → Task | | |
