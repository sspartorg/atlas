# 10 — Final regression and the written confidence verdict

**Status:** done — 2026-09-21
**Depends on:** every other row
**Scope:** all

## Why

The Owner's question was *"is it all completed, are you 100% confident?"* This
row answers it in writing, with numbers, and names whatever is still not true.

The predecessor's closing section is the model to follow — and the reason this
board exists is that it was honest. It said the gate was red, that twelve
screenshots were stale, that "0 vulns" had not been achieved, and that three of
its own assumptions had been contradicted by evidence. That honesty is what
made the remaining work findable. Repeat it.

## Done when

- [x] `pnpm -w run gate` green, exit code and summary pasted
- [x] `pnpm e2e` — passed/skipped/failed pasted
- [x] `pnpm -F @atlas/api test` green against `atlas_test`
- [x] `pnpm audit` → 0, pasted
- [x] `api` and `web` coverage pasted — **or the ceiling stated**
- [x] `rg` sweeps from task-02 returning 0, pasted
- [x] Task-04's mutation proof demonstrated
- [x] Every `findings.md` row is `fixed`, `withdrawn`, or `open` with a reason
- [x] `index.md` closing section written
- [x] The Owner's question answered in one paragraph, without hedging

## Evidence

### The gates

**`pnpm -w run gate` — GREEN, exit 0.** Typecheck, knip, per-package coverage
against the newly ratcheted thresholds, build, bundle budget.

```
@atlas/shared   6 files    249 tests   100 / 100 / 100 / 100
@atlas/mcp     12 files    167 tests   100 / 100 / 100 / 100
@atlas/web    335 files  4,358 tests   96.19 / 92.51 / 95.08 / 97.31
@atlas/api    155 files  2,713 tests   95.10 / 87.84 / 96.69 / 96.09
                        ─────────────
                         7,487 tests, all passing

Initial chunk total: 256.4 KB gz (budget 264.0 KB)
Total app size:      856.0 KB gz (budget 880.0 KB)
Bundle budget OK.
```

**`pnpm e2e` — 224 passed, 323 skipped, 0 failed, exit 0**, 6.0m.

The skip count moved 315 → 323 because task-07 added eight `GUIDE=1` captures
to the same gated family as `PERF` / `FORENSIC` / `FUNCTIONAL`. Passing count is
unchanged at 224, which is the number that matters.

**`pnpm audit` — `No known vulnerabilities found`.** Peer resolution clean.

### Coverage — measured, not asserted

| package | statements | branches | functions | lines |
|---|---|---|---|---|
| `@atlas/shared` | 100% | 100% | 100% | 100% |
| `@atlas/mcp` | 100% | 100% | 100% | 100% |
| `@atlas/api` | **95.10%** ✅ | 87.84% | **96.69%** ✅ | **96.09%** ✅ |
| `@atlas/web` | **96.19%** ✅ | 92.51% | **95.08%** ✅ | **97.31%** ✅ |

**7,210 → 7,487 tests.** Six of the eight non-branch metrics on `api` and `web`
are at or above the Owner's 95% bar; at the start of this board, one was.

### The name sweep

```
git grep -in 'sunny|isw-cdm|cdmnext|insightsoftware'   → 0
git grep -nE '/Users/[a-z]+|C:\\Users\\'               → 0 (only /Users/you-style doc examples)
git grep -in 'dhequest|neel-postgres|shopping-site'    → 0 outside this board's own trail
sspart.org@gmail.com still present in HelpAboutTab.tsx → 2 (E-6, must NOT be swept)
```

### Task-04's mutation proof

Deleting the verification-gate block from `deliver()`:

```
FAIL  does not push when the gate fails, even though every agent reported done
FAIL  retries the gate on resume and delivers once it passes
FAIL  parks — and does NOT fail — when the gate could not run at all
FAIL  runs the gate in the repo being pushed, before the push
Tests  4 failed | 43 passed (47)
```

Exactly the four gate tests; the other 43 unchanged.

### Findings

**15 rows. All 15 fixed.** G-013 and G-015 were filed for an Owner ruling and then ruled on: *fix them*. Both are closed, mutation-proved, and described below.

## The answer

**No — not 100% confident. Nobody honestly can be, and specifically: five real
defects were sitting in this codebase this morning, which is itself the
strongest evidence against anyone's confidence, including the previous
campaign's.**

What can be said instead, with numbers behind it: Atlas's gate is green, 7,487
tests pass, 224 e2e specs pass, the dependency audit is clean, six of eight
non-branch coverage metrics are at or above 95%, the Jira bridge has now
actually been run against a live site, and the one path that could ship a red
test suite into a merged PR is closed by machinery rather than by an agent's
promise. That is a materially stronger position than the one this board opened
on, and every claim in it is pasted above rather than asserted.

What stops it being "yes" is named below, not buried.

## What is still not true

- **Git history carries the old third-party names.** Ruling E-5 — working tree
  and docs only, no rewrite. The repo is public and those commits remain
  readable. That was the Owner's call, and it is a real residue, not a closed
  item.
- **Branch coverage is not 95%** — `api` 87.84, `web` 92.51 — and reaching it
  would mean writing tests that assert nothing. The ceiling and its arithmetic
  are in tasks 05 and 06.
- **The install, onboarding and sample-Task steps were not re-run** (E-1). They
  rest on the 2026-09-20 record. That record is good — two resets, identical
  seed counts, 45 agent runs, four PRs — but it is inherited, not re-proved.
- **A clean `pnpm audit` is not "0 vulnerabilities."** It means no advisory
  currently in the registry matches a version currently in this lockfile. It is
  not a reachability analysis, it says nothing about Atlas's own code, and it is
  true today only. The brief asked for "0 vulnerabilities so companies can adopt
  this"; what can honestly be handed to such a company is a clean dependency
  audit, 18 pinned security floors, a closed-by-default MCP write gate, and
  these limits stated rather than glossed.
- **Two chains from the predecessor's sweep are still partial**, and the Jira
  status-sync hop was deliberately not exercised against a real board.
- **The Jira API token used for X-8 was shared in conversation** and must be
  revoked and reissued. It never reached the repo — `git grep` returns nothing —
  but it is in a transcript.

## The two that were escalated, then fixed

G-013 and G-015 were filed rather than fixed because both changed behaviour a
document called intentional. The Owner ruled: fix them.

**G-013 — the Jira bridge was a write action.** Enabling it and matching an
issue posted a comment within one tick, before anything was approved. Fixed
with a rule rather than a toggle: **Atlas writes to Jira when it acts, not when
it merely looks.** A `draft` Task is not a milestone. No migration, no new
config field, no import-only mode to explain — and the suppressed comment
carried no information anyway, since it said Atlas was *not* doing anything.
Atlas still comments at each real milestone, so the settings copy now says so
outright.

**G-015 — 152 icon spans leaked their glyph into accessible names.** Fixed
across 73 files. The half nobody should skip: hiding a glyph turns an icon-only
button from badly-named into **unnamed**, so three buttons needed a real
`aria-label` as a direct consequence. `RefreshButton` was the trap — it looked
safe because a `<Tooltip>` wraps it, but the Tooltip wraps a `<span>` and MUI
names only its immediate child, so it was left nameless. A failing
`ProjectDetail` test caught it, not the fix's own reasoning.

Both now have a source-level invariant test. That test was itself **silently
vacuous** on its first version — its tag parser stopped at the `>` inside
`onClick={(e) => …}`, and a glob that matched nothing would have passed every
assertion under it. It now asserts its own scan finds >100 files, and refuses
to accept a wrapping Tooltip as a name.

## What the evidence contradicted

Four times this board's own plan was wrong, and those are the most useful
results in it.

1. **G-004's fix did not exist.** The finding said to consult the guardrail
   script's exit code. Nothing in Atlas has ever executed a guardrail script —
   `constitution-assembler.ts` writes them into the worktree and stops. There
   was no exit code to consult, and `agent_checklists` has no column linking an
   item to a script. Closing it needed a new execution stage, and ruling E-8.
2. **E-8's placement was impossible.** It said to gate "steps with `push_code`
   or `raises_pr`". Those are columns on `workflows`; `IWorkflowNode` carries no
   flags. The gate went into `deliver()`, per repo, before each push — which is
   both cheaper and the point where a wrong "green" actually costs something.
3. **G-007 was overstated.** It claimed the route still answers 200 on an
   unrecognised body. It has not since the predecessor's task-15 — which fixed
   it at the route and said in a comment that `.strict()` was the fix it wanted
   but could not make under hard rule 1. The rule worked. The waiver bought a
   better error, not a behaviour change.
4. **The screenshot generator produced six images of the wrong page.** Clearing
   onboarding made `RouteGuard` redirect every subsequent capture, so Settings,
   Analytics and Guard-rails were all pictures of the welcome card. Five green
   ticks, six plausible PNGs, and a file listing that gave no hint. Caught only
   by opening one and looking at it.

A fifth, smaller: a test written to force a coverage branch by removing a
script's execute bit passed for the wrong reason, because `bash <path>` ignores
the mode. That is the padding risk the coverage ceiling argument rests on,
demonstrated rather than theorised.

## What needed no fixing

Worth recording so the next reader does not re-open them. All six of the
predecessor's riskiest "fixed" claims were spot-checked in live code and **none
was overstated** — F-009, F-012, F-018, F-020, F-021 and F-022 all verified.
Its `pnpm e2e` figure (224/315) reproduced exactly. And the gate it reported red
at close is green, because PRs #12 and #13 did what they said.
