# 05 — `@atlas/api` coverage to 95 on all four metrics

**Status:** todo
**Depends on:** task-01
**Scope:** api

## Why

G-003, and ruling E-2. The Owner's brief said 95% coverage. `@atlas/api`
measures 94.81 lines / 93.77 statements / 94.55 functions / **86.63 branches**,
and `pnpm -w run gate` passes anyway because the predecessor rebaselined ADR
0009's floors down to the measured values (94.3 / 93.2 / 94 / 86.1 at
`packages/api/vitest.config.ts:436`). The gate went green because the bar moved.

The predecessor was right that the floors were stale and right to make them a
one-way ratchet. It was wrong to leave them as the answer to a question about
coverage.

## What to do

1. Measure first. Take vitest's own summary as truth, not ADR 0009's table.
2. Rank uncovered files by **absolute uncovered branch count**, not by
   percentage — a 60%-covered 400-line service is worth more than a 0%-covered
   12-line helper.
3. Write tests against the biggest few. Re-measure after each batch.
4. Raise the thresholds in `packages/api/vitest.config.ts` to the new measured
   values and amend ADR 0009 in the same commit.

## Measured 2026-09-21 (task-01 baseline)

| metric | measured | to 95 |
|---|---|---|
| statements | 93.77% (7406/7898) | +1.23 |
| branches | **86.63%** (4615/5327) | **+8.37** |
| functions | 94.55% (1371/1450) | +0.45 |
| lines | 94.81% (6692/7058) | +0.19 |

Branches is the whole job: **712 uncovered branches**. The other three are
rounding.

### Worst-first by branch coverage

| file | % branch | % stmts | note |
|---|---|---|---|
| `services/history-prune.ts` | **0** | 11.11 | entirely untested, lines 29-77. The single biggest win on the list. |
| `routes/credentials.ts` | 26.31 | 57.81 | lines 94-97, 116-162 |
| `services/github-app-tokens.ts` | 40 | 61.44 | the GitHub App token path — and this is the module task-02 also touches |
| `services/project-env-file.ts` | 50 | 91.3 | lines 52-58 |
| `services/sse-hub.ts` | 54.16 | 84 | lines 102, 118, 180-185 |
| `services/schedule-registry.ts` | 62.5 | 86.56 | |
| `routes/workflows.ts` | 67.5 | 89.65 | |
| `routes/settings.ts` | 68.18 | 83.72 | |
| `services/workflow-engine.ts` | 76.48 | 88.79 | **largest absolute count** — 76% of a ~1300-line file leaves more uncovered branches than anything above it |
| `services/jira-sync.ts` | 76.38 | 90.83 | task-08 will exercise this live; sequence the two |

Rank by **absolute uncovered branches**, not by the percentage column — that is
why `workflow-engine.ts` outranks `history-prune.ts` on value even though
`history-prune.ts` looks worse. Start with `history-prune.ts` anyway: it is 48
lines with no test at all, so it is the cheapest real coverage in the package.

## The honest caveat

Branches needs roughly **+8.4 percentage points**, which is by far the largest
single cost on this board. Branch coverage above about 90% tends to buy error
paths that `pnpm e2e` already walks end to end. The Owner chose 95-on-all-four
knowingly (E-2) and it will be delivered — but if the last couple of points can
only be reached by tests that assert nothing real, this row **stops and reports
that** rather than padding the number. A test written to move a percentage is a
maintenance cost with no defect-catching power, and the predecessor's task-16 is
the precedent: seven index gaps were "obvious", exactly one was real, and the
other six would have been permanent write cost bought with nothing.

## Traps

- The api suite is `singleFork` against **one shared `atlas_test` database**.
  Task 05 and task 06 run **serially**, never concurrently, and never alongside
  anything else touching that DB.
- `packages/api/vitest.config.ts` has an explicit `include:` allowlist. A new
  test file that is not listed there silently does not run.
- Deleting a test to raise a percentage is the one move that is never allowed;
  the floors ratchet one way and the gate enforces it.
- The suite runs with a 12 GB heap for a reason. Watch for OOM rather than
  assuming a hang.

## Done when

- [ ] `pnpm -F @atlas/api test:coverage` ≥ 95 on lines, statements, functions, branches
- [ ] Thresholds in `vitest.config.ts` raised to the measured values
- [ ] ADR 0009 amended with the real numbers and the date
- [ ] No test deleted; no `include:` entry removed
- [ ] If 95 branches proved unreachable honestly, that is written up here with
      the measured ceiling and the reason — and the board row says so plainly
- [ ] G-003 flipped for `api` in `findings.md`

## Evidence

_In progress._

### G-009 first, because it was free

`history-prune.test.ts` was committed but missing from
`packages/api/vitest.config.ts`'s explicit `include:` allowlist, so its 7 tests
had never run and `services/history-prune.ts` sat at **0% branches / 11.11%
statements** — the worst file in the package. Adding one line to the allowlist
was the whole fix, and **one of the seven tests then failed**: it asserted ISO
strings against the `Date` objects node-postgres actually returns. A test that
never runs is not a test; it is a file that looks like one.

### The allowlist is the hazard, and it has outlived its purpose

Having fixed the symptom, the cause is worth removing. Measured after the fix:

```
listed: 155 | on disk (src+tests): 155
on disk NOT listed: none
listed NOT on disk: none
```

The 155-entry allowlist is now **exactly equivalent** to
`src/**/*.test.ts` + `tests/**/*.test.ts`. Its own header explains why it
exists — *"Migrated tests use the PG fixture in `tests/_pg-db.ts`"* — it was a
migration ledger, added to file by file as tests moved to the Postgres fixture.
That migration is complete. What remains is ~110 lines of configuration whose
only measurable effects have been one silently-skipped test file and one stale
entry pointing at a file that no longer exists.

Every other package (`web`, `mcp`, `shared`) already uses a glob, which is why
this bug class exists in `api` alone. Replacing the list with the same glob
deletes the configuration, runs exactly the same 155 files today, and makes the
failure permanently impossible rather than merely fixed once.

### Sequencing note

The allowlist change is deliberately held until the in-flight coverage
measurement completes, so the baseline is measured against the configuration
that produced it rather than one edited underneath it.
