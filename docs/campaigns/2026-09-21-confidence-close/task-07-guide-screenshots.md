# 07 — Recapture the twelve stale guide screenshots

**Status:** done — 2026-09-21
**Depends on:** task-02
**Scope:** docs

## Why

G-005. `docs/guide/README.md` documents fifteen sections against fifteen images.
Only `doc-13`, `doc-14` and `doc-15` were captured after the factory reset;
`doc-01` through `doc-12` predate it and show the retired sandbox project under
its old issue-key prefix. A sixteenth problem: `doc-02-dashboard-empty.png` is
tracked but referenced nowhere.

The predecessor's task-20 is the most honest row on its board — it rewrote the
guide's prose, kept the stale images rather than shipping a guide with no
pictures, and left its own screenshot checkbox unticked with the reason written
down. This row finishes it.

Depends on task-02 because a screenshot taken before the name sweep would
capture the old names into a binary that the sweep cannot grep.

## What to do

1. **Revisit the generator decision.** The predecessor rejected adapting
   `e2e/forensic/walkthrough.spec.ts` because it writes to gitignored
   `e2e-logs/`. That spec already screenshots every route in both themes, and
   it honours an `OUT_DIR` override. A one-off override pointed at
   `docs/guide/images/` is cheaper than twelve manual captures and makes the
   next refresh free. If it genuinely cannot produce guide-quality framing,
   capture by hand and record *why* so the next person does not re-litigate it.
2. Recapture `doc-01` … `doc-12` against the current build.
3. Resolve `doc-02` — reference it from the README or delete it.
4. Fix `README.md:463-464`, which describes a repo directory as a "Confluence
   page [that] carries the same content with screenshots". No such page exists.

## Traps

- **Hard rule 6.** `docs/guide/images/` is the *only* tracked image path.
  Nothing from `e2e-logs/`, `docs/visual-audit/`, `test-results/` or any
  `*-screenshots/` directory gets committed, whatever the generator writes.
  Eyeball staged and untracked entries before `git add`.
- Screenshots taken on a machine with real credentials can capture a token, a
  repo URL or a path. Check each image before staging — this is the same class
  of problem as G-001 and the repo is still public.
- The app is on ports **4100/4101** here, not the documented 4000/4001.

## Done when

- [x] `doc-01` … `doc-12` recaptured against the current build
- [x] Every image referenced by `README.md` resolves; no orphans remain
- [x] No image shows a retired project name, a token, or an absolute home path
- [x] `README.md:463-464` corrected
- [x] The generator decision is recorded either way
- [x] Nothing outside `docs/guide/images/` was staged
- [x] G-005 flipped in `findings.md`, board row flipped

## Evidence

**All eleven stale images recaptured, the orphan deleted, and the guide now
has a generator it never had.** `GUIDE=1 pnpm e2e --grep @guide` → 8 passed.

### The generator decision, revisited and reversed

The predecessor rejected adapting `e2e/forensic/walkthrough.spec.ts` because it
writes to gitignored `e2e-logs/`. That reasoning was sound but incomplete: the
deeper blocker is that the forensic walker only visits top-level routes and
never opens a modal, so it **cannot** produce `doc-11-new-project` at all. Its
full-page captures are also the wrong shape for a figure read inline in a
README at text width.

So a separate spec, `e2e/guide/capture-guide-screenshots.spec.ts`, gated behind
`GUIDE=1` exactly like `PERF` / `FORENSIC` / `FUNCTIONAL`. `pnpm e2e` stays a
test run and never rewrites tracked binaries as a side effect. The next refresh
is now one command instead of eleven manual captures.

### It got the images wrong the first time, and they looked fine

This is the part worth recording. The first run reported 5 passed / 2 failed
and wrote six images. Every one of them was **the onboarding screen**.

`doc-01` calls the API's `clear-onboarding` escape hatch to reach the first-run
page. `RouteGuard` then redirects *every* route to `/onboarding` until the
workspace is set up again — so `doc-06-settings.png`, `doc-09-analytics.png`,
`doc-05-guardrails.png` and three others were all captures of the welcome card.
A green tick on five tests, six plausible-looking PNGs, and a file listing that
gave no hint. It was caught only by opening one and looking at it.

Two changes came out of that: the onboarding capture runs **last**, and
`assertNotOnboarding` now fails any capture whose URL landed on the redirect.
The guard is the load-bearing part — ordering alone would have been a comment
that a future edit could silently violate, and the failure mode here is a
wrong image rather than an error.

`test.describe.configure({ mode: 'serial' })` was also dropped: the second run
aborted six captures because one failed. Ordering already holds from the
config's single worker.

### One more wrong assumption

`doc-10` first tried to reach an agent by clicking `a[href^="/agents/"]`. The
roster renders MUI Cards with `onClick` handlers, not anchors, so there was no
link to click and the test burned a 60s timeout. It now asks
`GET /api/agents` which agent the seed installed and navigates directly —
robust against both the missing anchor and a catalog change that would
otherwise produce a 404 screenshot.

### Captured against the e2e stack, deliberately

The alternative was the live dev stack, which has real cloned repos, real
paths and a real credential. On a **public** repo that is the G-001 hazard
again, in binary form where no `rg` sweep would ever find it. The e2e stack is
dropped and rebuilt per run, carries only seed data, and holds no secrets.

The cost is visible and worth stating: the figures show `/tmp/atlas-e2e` as
the workspace folder and carry the amber **SIMULATED** badge, because
`ATLAS_AI_ENABLED` is off in that stack. They are honest pictures of a real
Atlas, just not of a production one.

### The orphan and the bad pointer

`doc-02-dashboard-empty.png` was tracked and referenced nowhere. Deleted
rather than re-shot — an empty-dashboard figure would need a projectless
workspace, and the guide never asked for one.

`README.md:463` described a repo directory as *"The Confluence page … carries
the same content with screenshots"*. There is no such page. It now points at
`docs/guide/README.md`, which does.
