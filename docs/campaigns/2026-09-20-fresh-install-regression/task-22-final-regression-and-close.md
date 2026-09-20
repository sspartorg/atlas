# 22 — Final regression and close the campaign

**Status:** todo
**Depends on:** [task-21](task-21-agents-sync-and-adrs.md)
**Scope:** all

## Why

Everything up to here changed something. This task proves the changes did not
break what already worked, and that the claim the campaign was opened to make
— *Atlas installs from nothing and works* — is true a second time, on a
machine that has been reset once already.

A campaign that closes without re-running the reset has only proved that Atlas
works after being carefully nursed through a reset. Doing it twice, the second
time against the fixed code, is what makes the claim real.

## What to do

### 1. Run the gates against the current state
```
pnpm -w run gate      # typecheck, knip, per-package coverage floors, build, bundle budget
pnpm e2e              # 86 specs
```
Both must be green, and both tails get pasted. Note that ~209 e2e tests skip
by default behind the `PERF`, `FORENSIC`, `FUNCTIONAL` and `STATE_TRANSITIONS`
flags — those skips are **gates, not failures**. Record the skip count so a
future reader does not mistake it for breakage. There is one known scheduler
flake; if it appears, name it rather than re-running until it passes.

### 2. Run the flagged suites explicitly
```
pnpm e2e:functional          # every button labelled, every link has a real href
pnpm e2e:state-transitions
pnpm e2e:perf                # against scripts/check-perf-floors.mjs
pnpm e2e:forensic
```
These are the suites that would have caught several of this campaign's
findings if they had been run routinely. Record which ones now catch a finding
that the walk found by hand — that is the argument for wiring them into CI,
and it belongs in the campaign's closing note.

### 3. Do the reset again, from the top
This is the real test. Execute
[`checklists/reset-inventory.md`](checklists/reset-inventory.md) a second time,
then `pnpm dev`, then onboard. It must work **without** any of the manual
nursing the first pass needed. Every step that required a workaround in
[task-03](task-03-first-boot-onboarding.md) and was not fixed is a finding
that should have been filed.

Re-verify the seed table from task-03 step 5 against the new baseline plus
migration `002`.

### 4. Exercise the in-app reset
`POST /api/settings/reset` was deliberately not executed in
[task-11](task-11-walk-wave-d-settings-admin.md) because it would have
destroyed the fixture. Run it now, against the disposable second install, and
confirm it does exactly what its copy claims — including that it does **not**
touch disk, `project_repos`, `workflows`, `cli_sessions`,
`environment_secrets` or `project_env_vars`. `ResetWorkspaceModal.tsx:129-132`
names "saved schedule", which is not in the truncate list; confirm whether the
`projects` cascade covers it, and fix the copy if not.

### 5. Close the board
- Every row in [index.md](index.md) is `done`, or `blocked` with a reason and
  an Owner ruling. No row is left `todo`.
- Every task file's `**Status:**` line matches its board row.
- [findings.md](findings.md) has no `open` rows.
- Replace the index's status banner with the closing state and date.

### 6. Write the closing note in `index.md`
One dense paragraph of real figures — not adjectives. How many findings by
severity, how many were docs versus code, which suites now catch what the walk
caught by hand, the final coverage numbers per package, and the measured
before/after on any index that was added. Numbers are real measured figures,
never round.

### 7. Open the PR
One PR from `campaign/fresh-install-regression` into `main`. Before `git add`,
eyeball staged and untracked entries against AGENTS.md hard rule 6's forbidden
list — `e2e-logs/**`, `docs/visual-audit/**`, `.atlas/**`,
`playwright-forensic-report/**`, `test-results/**`, `verification-*.png`,
loose `findings-*.md`, any `*-screenshots/`. The campaign's own
`findings.md` is tracked deliberately and is not one of these; it carries
prose and `file:line` evidence, not raw artifacts.

## Done when

- [ ] `pnpm -w run gate` green — tail pasted
- [ ] `pnpm e2e` green — tail pasted, with the skip count recorded and
      explained
- [ ] All four flagged suites run; results pasted; any that now catches a
      hand-found finding is named
- [ ] **The reset ran a second time and `pnpm dev` came up clean with no manual
      intervention** — paste the sequence
- [ ] Seed reference-data counts match after the second reset, including
      migration `002`
- [ ] `POST /api/settings/reset` behaves exactly as its modal copy claims, or
      the copy is fixed
- [ ] Every board row is `done` or `blocked` with a ruling; no `todo` remains
- [ ] Every task file's `**Status:**` matches its board row
- [ ] `findings.md` has no `open` rows
- [ ] The closing note is written with real figures
- [ ] The PR is open, and `git log --name-only` on the branch shows no
      forbidden artifact path
- [ ] The three sample Tasks' PRs on the throwaway repos are closed or merged,
      and the throwaway repos are left in a known state

## Evidence

*(filled during execution)*

Findings by severity: P0 ____ · P1 ____ · P2 ____ · P3 ____
Docs-only findings: ____ of ____
e2e skip count: ____
Final coverage — shared ____ · mcp ____ · api ____ · web ____
