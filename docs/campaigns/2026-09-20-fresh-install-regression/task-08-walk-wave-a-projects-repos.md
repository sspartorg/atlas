# 08 — Walk wave A: onboarding, dashboard, scratch pad, projects, repos

**Status:** done — 2026-09-20. A1-A6 walked; 3 findings
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

Walked 2026-09-20 against the fixture built by tasks 6-7 (1 project, 2 repos,
3 Tasks, 8 sub-tasks, 45 agent runs, 3 PRs).

| Page | Console errors | Findings filed |
|---|---|---|
| A1 Onboarding guard | 0 | F-001 (confirmed), F-006 — both in task-03 |
| A2 Dashboard | 0 | none — all rendered KPIs reconcile |
| A3 Scratch pad | 0 | **F-015** |
| A4 Projects | 0 | F-007 (from task-06) |
| A5 Project Detail | 0 | F-008, F-009 (from task-06) |
| A6 Project Guard-rails | 0 | **F-014** (reproduced here) |

### A2 — Dashboard: every rendered KPI reconciles

| KPI | Dashboard | Ground truth | |
|---|---|---|---|
| Projects | 1 | `projects` = 1 | ok |
| Awaiting You | 11 | `items.status='in_review'` = 11 | ok |
| In Motion | 0 | `items.status='in_progress'` = 0 | ok |
| Agent tiles (4 categories) | 0 live | `agent_runs.status='in_progress'` = 0 | ok |
| AI Cost (September) | $17.03 · 45 runs | 45 `agent_runs` | ok |

**The checklist's own trap note prevented a false positive.** The payload
carries `tasksInProgress: 3` while zero items are `in_progress` — but that
field is never rendered (`01-dashboard.md:58`), so it is not a finding. Written
into the section before the walk, it did its job.

**Class 2 (attribution) passes** — the Today's Pass payload resolves every run
to a real agent name and accent colour (`Automation Reviewer`, `QA Writer`,
`Coder`, …). No literal "Agent" anywhere.

Cost note for the campaign record: the three sample Tasks of task-07 cost
**$17.03** across 45 runs — 553 input tokens, 306,672 output, 15.9M cache read,
1.28M cache creation.

### A3 — Scratch pad: F-015

Empty state renders correctly. A tile created, typed into, and confirmed
persisted in `scratch_pad.body_md` — the round-trip itself works. The defect is
the indicator: it says "Not saved yet" forever because each autosave's query
invalidation gives the effect a new `tile` identity, which resets the timestamp
the save just set.

### Positive confirmation, not a finding

**The draft guard works.** Navigating away from `/tasks/new` with text in the
Title raised the browser's "Leave site?" dialog and blocked the navigation
(`useDraftGuard`, `TaskNew.tsx:115`). Clearing the field released it.

### A5 — the secrets round-trip passes in full

This is the check that matters most on this page: it is the exact shape of the
2026-09-12 defect, where an eye icon toggled an input's `type` over a field the
API always nulled. All six parts pass now:

| Step | Result |
|---|---|
| Write `CK_TOKEN=s3cr3t-alpha` through the UI | saved, "1 unsaved change" tracked, Save enabled only when dirty |
| Hard-reload the page and re-open the modal | row present, value masked |
| Click Reveal | returns `s3cr3t-alpha` — the real stored plaintext |
| `GET /api/projects/:id/env` | metadata only: `key`, `updated_at`, `has_value`. No plaintext anywhere in the payload |
| Reveal route | `GET /api/projects/:id/env/:key/value`, gated by `requireMcpToken` |
| Audit | 3 `{tag:'secret_reveal'}` log lines for 3 reveal clicks |

⚠️ The checklist had the reveal route as `…/env/:key`; the real route is
`…/env/:key/value` (`routes/projects.ts:537-540`). Corrected in
`checklists/per-page.md` so the next walker is not misled.

### A6 — round-trip passes, and F-014 reproduced here

A guard-rail was created through the dialog, persisted a hard reload, and the
header moved to "Rules 1 · 1 active". `/projects/:id/guard-rails` redirects into
`?tab=guardrails` as documented.

The valuable part was accidental: typing the rule body reproduced **F-014**,
which task-08 had filed as unreproduced and TaskNew-specific. It is neither —
see the finding for the controlled comparison between the dialog's single-line
Title (clean) and its `multiline` Rule (three dropped characters plus the
exception).

### Not walked, deferred with reason

A4 and A5 had their **write** paths exercised by task-06 — clone, add repo,
prefix guard, Setup tab per repo. Their remaining read-side controls are not
yet walked: re-clone, auto-fetch schedule, the repo row menu's Open folder and
Remove, Delete Project in `unregister` mode, the grid/table view toggle, filter
chips and pagination. `purge` stays deferred to
[task-13](task-13-cross-dependency-sweep.md), which builds a disposable project
for it rather than destroying the fixture the later waves need.
