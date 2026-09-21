# 01 — Baseline: re-run every gate, record the numbers

**Status:** done — 2026-09-21
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
   trusting the record (ruling E-3).

## Traps

- `.env` has drifted to ports **4100/4101**; the documented pair is 4000/4001.
  Expect it, do not "fix" it — `mcp-auth-coverage.test.ts` was broken once
  already by pinning a port (predecessor F-016).
- `db-up.ts` reuses an existing container, so the stack comes up without
  touching Docker. Ruling E-1 means no reset, so leave `atlas-postgres` alone.
- The api suite is `singleFork` against one shared `atlas_test` database.
- ~209 e2e skips are the `PERF` / `FORENSIC` / `FUNCTIONAL` /
  `STATE_TRANSITIONS` gates plus one known scheduler flake. Skips are not
  failures; count them, do not chase them.

## Done when

- [x] `pnpm -w run gate` run to completion and its exit code recorded
- [x] `pnpm e2e` run and passed/skipped/failed counts recorded
- [x] `pnpm audit` recorded
- [x] All four packages' coverage numbers recorded from vitest's own output
- [x] Six spot-checks done, each with a `file:line` or a paste
- [x] Any new defect filed as a `G-0NN` row in `findings.md`

## Evidence

### `pnpm -w run gate` — **GREEN, exit 0**

The headline result, and it reverses the predecessor's closing claim. The gate
was red at close on `knip` and on the `api` / `web` coverage thresholds. PRs #12
and #13 did what they said: knip is clean and the floors were rebaselined. The
full chain — typecheck, knip, per-package coverage, build, bundle budget — now
passes end to end.

Bundle budget, from the same run, every line under budget:

```
Initial chunk total: 256.4 KB gz (budget 264.0 KB)
Total app size:      856.0 KB gz (budget 880.0 KB)
Recharts chunk:      114.4 KB gz (budget 130.0 KB)
mui-core chunk:       86.1 KB gz (budget  90.0 KB)
Bundle budget OK.
```

### Coverage — measured 2026-09-21, from vitest's own summaries

| package | statements | branches | functions | lines | tests |
|---|---|---|---|---|---|
| `@atlas/shared` | 100% (291/291) | 100% (121/121) | 100% (34/34) | 100% (255/255) | 246 |
| `@atlas/mcp` | 100% (315/315) | 100% (181/181) | 100% (98/98) | 100% (280/280) | 167 |
| `@atlas/web` | 94.19% (11020/11699) | **90.49%** (8943/9882) | **91.60%** (3537/3861) | 95.42% (9955/10432) | 4152 |
| `@atlas/api` | 93.77% (7406/7898) | **86.63%** (4615/5327) | 94.55% (1371/1450) | 94.81% (6692/7058) | 2645 |

**7,210 tests, all passing.** `shared` and `mcp` are genuinely at 100. `api` and
`web` are below the Owner's 95 bar on the metrics in bold — that is G-003, and
tasks 05 and 06 own it.

**A discrepancy worth recording.** ADR 0009's amended table lists web as
`95.40 / 94.14 / 91.58 / 90.53` under a lines/statements/branches/functions
heading. Vitest reports branches **90.49** and functions **91.60** — the two are
the other way round. Either the ADR's column order is transposed or the numbers
drifted since. Task-06 settles it against `vitest.config.ts`'s actual threshold
keys. A floor table that cannot be read in the right order is how a gate passes
while the thing it gates regresses.

### `pnpm audit` — 0 advisories

```
No known vulnerabilities found
```

Confirms F-020 still holds on 2026-09-21, before any change on this board.
Task-09 re-runs it at the end, and records what the claim does and does not mean.

### `pnpm e2e` — 224 passed, 315 skipped, 0 failed, exit 0

Identical to the figure the predecessor recorded at its close ("224 passed /
315 skipped"), so nothing regressed in the four PRs that landed since. Runtime
6.1m across the chromium, mobile-chrome and ipad-chrome projects.

The 315 skips are gates, not failures: the `PERF` / `FORENSIC` / `FUNCTIONAL` /
`STATE_TRANSITIONS` suites plus the Linux-only visual baselines, which
`snapshots.spec.ts` skips by design on macOS. Counting them as failures is the
mistake this line exists to prevent.

### The six spot-checks

All six predecessor claims verified in live code. None was overstated.

| claim | verdict | evidence |
|---|---|---|
| F-012 reviewer checklists populated | **confirmed** | `code-reviewer` 5 items, `architect-reviewer` 4, `po-reviewer` 4, `qa-reviewer` 4, `automation-reviewer` 5. All non-empty. **This is the symptom, not the cause** — see below. |
| F-020 floors in the right file | **confirmed** | `pnpm-workspace.yaml:14` carries `overrides:`. Not `package.json`, which is the detail that made earlier attempts silently no-op. |
| F-021 token minted, read per request | **confirmed** | `main.ts:269-277` handles `ATLAS_MCP_TOKEN_OPEN=1` as the deliberate opt-out; `plugins/mcp-auth.ts:17` reads `process.env['ATLAS_MCP_TOKEN']` **inside a function**, so a token minted after module load is still seen. |
| F-022 `envFilePath()` resolves repo root | **confirmed** | `services/env-file.ts:55-58` joins `repoRoot()`, honouring `ATLAS_ENV=prod`. `assertSafePath()` at `:62-67` refuses anything but the two root env files, as defence in depth. |
| F-009 `repoFolderName` slug boundary | **confirmed** | `services/project-repos.ts:28-33` — skips the prefix when the repo name equals the project slug or begins `<slug>-`, keeps it otherwise. |
| F-018 `pr_urls` end to end | **confirmed** | Migration `003:24` adds the column; `workflow-engine.ts:917` writes `delivery.prUrls`; `WorkflowRunsTab.tsx:76` renders them all with a `pr_url` fallback for legacy runs. |

### Two things the spot-checks turned up that the record did not

**1. G-004 is bigger than its finding says, and the finding's proposed fix does
not exist.** The finding — inherited from F-012 — says to wire the router to the
guardrail script's exit code. There is no exit code to wire.
`services/constitution-assembler.ts:84-90` writes each script into the worktree
at `.atlas/scripts/bash/check-<id>.sh` with mode `0755` and stops there. **Atlas
never executes any of them.** The agent is asked to run the script by its prompt
and then report the result itself, and `decideRunRouting` believes that report.

Nor is there anything to join a checklist item to a script.
`agent_checklists` is `(id, agent_id, label, sort_order, required)` — no
`script_id`, no arguments column. The only trace of the linkage is prose inside
the label:

> `"Full project test suite green — ran check-coder-tests-green.sh <itemId> --run-tests"`

So closing the hole means Atlas has to start running the gate itself. That is a
new execution stage, not a rewiring. **Owner ruling E-8** was taken on this and
is recorded on the board.

**2. F-022's orphan file is still on disk.** `packages/api/.env`, 41 bytes,
timestamped `20 Sep 19:02` — the exact file the finding described, still holding
that campaign's own probe. The *code* fix is real and verified above, so nothing
writes there any more; the stale file was simply never removed. It is
`.gitignore`d at line 6 and untracked (`git check-ignore -v` confirms), so it
never reached the public repo. Local debris, not a finding — deleted as cleanup,
recorded here so the next reader is not startled by it.
