# 08 — Walk wave A: onboarding, dashboard, scratch pad, projects, repos

**Status:** todo
**Depends on:** [task-07](task-07-sample-tasks-small-medium-large.md)
**Scope:** web

## Why

Wave A covers the surfaces a new adopter meets first and the ones that own the
most destructive actions — clone, re-clone, delete, purge. Getting these wrong
costs data, so they are walked before anything else.

## What to do

Drive the browser with Claude for Chrome against `http://localhost:4000`.
Work section by section through **A1–A6** of
[`checklists/per-page.md`](checklists/per-page.md), in order.

For every page:

1. **Read the section first.** Its Actions table is the inventory — every row
   gets exercised, not just the happy ones.
2. **Keep DevTools open.** Console errors and failed network requests are
   findings in their own right, filed against the page that produced them,
   regardless of whether the UI looked fine.
3. **Work the six check classes** listed in the section. `n/a` entries are
   skipped, not re-derived.
4. **Triage before filing.** `.agents/coming-soon.md` first — eleven controls
   toast or sit disabled on purpose. Then the page doc. A stub is not a bug.
5. **Log, do not fix** (ruling D-9). Every finding goes into
   [findings.md](findings.md) with an `F-NNN` id, a severity from the rubric,
   and evidence that is a `file:line` or pasted output — never a screenshot,
   which AGENTS.md hard rule 6 keeps out of the repo.
6. **Hard-reload between write and read.** A round-trip check that only
   survives a cache-warm re-render has proved nothing.

## Wave A specifics

- **Onboarding is already complete**, so `/onboarding` redirects to `/`. Its
  wizard was walked in [task-03](task-03-first-boot-onboarding.md); re-check
  only the guard behaviour here.
- **The dashboard now has data** — three Tasks, runs, PRs. Its empty state was
  seen in task-03; assert the populated state agrees with `/tasks` and the
  sidenav badges (invariant X4: a badge count agrees with the page it links
  to, or the difference is labelled).
- **Projects and Project Detail carry the destructive actions.** Exercise
  Delete Project in **`unregister` mode only** — a `purge` would destroy the
  fixture the later waves need. Record `purge` as deferred to
  [task-13](task-13-cross-dependency-sweep.md), which tests it on a
  disposable project it creates for the purpose.
- **Re-clone is safe to exercise** on one repo and worth doing: it stashes
  local work, requires the original credential, and streams redacted SSE.
- **The Setup tab is per-repo.** Confirm the repo picker switches bodies and
  that saving one repo's script does not touch the other's.

## Done when

- [ ] Every section A1–A6 has every check either ticked or converted to an
      `F-NNN` row in [findings.md](findings.md)
- [ ] The console was captured on every page; the error count per page is
      recorded below (zero is the expected value)
- [ ] No finding was fixed during this task — `git diff` against the campaign
      branch shows changes to `findings.md` only
- [ ] Delete Project was exercised in `unregister` mode; `purge` is recorded as
      deferred to task-13
- [ ] The fixture survives: project `atlas-demo`, both repos, and all three
      sample Tasks are intact at the end

## Evidence

*(filled during execution)*

| Page | Console errors | Findings filed |
|---|---|---|
| A1 Onboarding guard | | |
| A2 Dashboard | | |
| A3 Scratch pad | | |
| A4 Projects | | |
| A5 Project Detail | | |
| A6 Project Guard-rails | | |
