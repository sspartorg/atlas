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

_Written after execution._
