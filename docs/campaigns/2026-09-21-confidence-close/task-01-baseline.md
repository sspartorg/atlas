# 01 — Baseline: re-run every gate, record the numbers

**Status:** in progress — 2026-09-21
**Depends on:** nothing — blocks every other row
**Scope:** infra

## Why

G-003 exists because the coverage bar moved. G-004 exists because a fix was
believed rather than proved. Both are failures of the same kind: a claim
recorded without a number beside it. This row refuses to repeat that. Nothing
else on this board starts until the current state is measured and pasted here.

The predecessor closed with `pnpm -w run gate` **red** at `knip` and at the
`api` / `web` coverage thresholds. Four PRs have landed since — #12 (`clear the
last gate failure`, `rebaseline ADR 0009 floors as a ratchet`), #13 (`serialise
test:coverage so api isn't starved`), #14 (`run api and e2e on every PR`) and
#15 (a Jira copy fix). Two of them claim to have fixed the gate. Nobody has run
it since.

## What to do

1. `pnpm -w run gate` — typecheck, knip, per-package coverage, build, bundle budget.
2. `pnpm e2e` — 86 specs.
3. `pnpm audit`.
4. Record every number verbatim below. Not "green" — the numbers.
5. Spot-check the six riskiest predecessor claims in live code rather than
   trusting the record (ruling E-3):

   | claim | what to verify |
   |---|---|
   | F-012 | reviewer `checklists.json` are non-empty — and note that this is the symptom, not G-004's root cause |
   | F-020 | the 18 security floors are in `pnpm-workspace.yaml`, not `package.json` (pnpm 11 reads overrides there) |
   | F-021 | `main.ts` mints `ATLAS_MCP_TOKEN` when empty, and `mcp-auth.ts` reads it per request rather than at module load |
   | F-022 | `envFilePath()` resolves the repo root, and `packages/api/.env` is gone |
   | F-009 | `projectReposService.repoFolderName` skips the prefix on a slug boundary |
   | F-018 | `workflow_runs.pr_urls` exists and `deliver` records every opened URL |

## Traps

- `.env` has drifted to ports **4100/4101**; the documented pair is 4000/4001.
  Expect it, do not "fix" it — `mcp-auth-coverage.test.ts` was broken once
  already by pinning a port (predecessor F-016).
- `db-up.ts` reuses an existing container, so the stack comes up without
  touching Docker. Ruling E-1 means no reset, so leave `atlas-postgres` alone.
- The api suite is `singleFork` against one shared `atlas_test` database. Do
  not run it concurrently with anything else that touches that DB.
- ~209 e2e skips are the `PERF` / `FORENSIC` / `FUNCTIONAL` /
  `STATE_TRANSITIONS` gates plus one known scheduler flake. Skips are not
  failures; count them, do not chase them.

## Done when

- [ ] `pnpm -w run gate` run to completion and its exit code recorded
- [ ] `pnpm e2e` run and passed/skipped/failed counts recorded
- [ ] `pnpm audit` recorded
- [ ] All four packages' coverage numbers recorded from vitest's own output
- [ ] Six spot-checks done, each with a `file:line` or a paste
- [ ] Any new defect filed as a `G-0NN` row in `findings.md`

## Evidence

_Written as the run completes._
