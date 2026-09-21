# 06 — `@atlas/web` coverage to 95 on all four metrics

**Status:** todo
**Depends on:** task-01
**Scope:** web

## Why

G-003, and ruling E-2. Same argument as [task-05](task-05-api-coverage-95.md),
different package and a smaller gap.

Measured 2026-09-21 from vitest's own summary:

| metric | measured | to 95 |
|---|---|---|
| lines | 95.42% (9955/10432) | already there |
| statements | 94.19% (11020/11699) | +0.81 |
| functions | 91.60% (3537/3861) | +3.40 |
| branches | 90.49% (8943/9882) | +4.51 |

**Note a discrepancy to resolve here:** ADR 0009's amended table records web as
`95.40 / 94.14 / 91.58 / 90.53` under a lines/statements/branches/functions
heading, which puts branches at 91.58 and functions at 90.53. Vitest reports the
opposite — branches 90.49, functions 91.60. Either the ADR's column order is
transposed or the numbers drifted. Settle it against `vitest.config.ts`'s actual
threshold keys and correct whichever is wrong; a floor table nobody can read in
the right order is how a gate passes while the thing it gates regresses.

## The biggest gaps

From the baseline run, worst-first by uncovered surface:

| file | stmts | branches | funcs |
|---|---|---|---|
| `workflows/WorkflowRunsTab.tsx` | 13.33 | 0 | 0 |
| `workflows/*Inspector.tsx` (two files) | 38–44 | 25–50 | 35–44 |
| `workflows/WorkflowCanvas.tsx` | 33.33 | 87.5 | 50 |
| `workflows/NodePalette.tsx` | 71.42 | 50 | 75 |
| `workflows/WorkflowBuilder.tsx` | 73.75 | 65.06 | 70 |
| `workflows/WorkflowRunDetail.tsx` | 78 | 67.1 | 71.42 |

The workflow builder surface dominates, which is consistent with the route
inventory: `/workflows/:id` and `/workflows/:id/runs/:runId` have no
interaction-level e2e spec either. This is the one genuinely under-tested area
of the product, not a rounding problem.

## Also fix here

**G-008** — `hooks/useGlobalShortcuts.ts:10` maps the `g`-then-`d` shortcut to
`/dashboard`, which is not a declared route. It only appears to work because the
`*` catch-all redirects to `/`. Point it at `/` and add the assertion that was
missing; it is a one-line fix that belongs with the web test work rather than in
a commit of its own.

## Traps

- Runs **serially** with task-05 — see that file's note on the shared test DB.
- Testing a canvas/drag surface through the DOM is where this row can sink.
  Prefer testing the graph reducers and inspector state transitions directly
  over simulating drags; `workflows/graph.ts` is already at 96/80.76 and is the
  right seam.
- The same honest-caveat rule as task-05 applies: report a real ceiling rather
  than padding it.

## Done when

- [ ] `pnpm -F @atlas/web test:coverage` ≥ 95 on lines, statements, functions, branches
- [ ] Thresholds raised to measured; ADR 0009 amended, column order corrected
- [ ] The ADR-vs-vitest transposition is resolved and written up
- [ ] G-008 fixed with a test asserting the destination
- [ ] No test deleted
- [ ] G-003 flipped for `web`, G-008 flipped, in `findings.md`

## Evidence

_Written after execution._
