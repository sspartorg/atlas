# 0021. Gate nodes run deterministic checks

**Date:** 2026-09-24
**Status:** Accepted

## Context

Every check in an Atlas workflow was an agent step. Coverage, lint, security,
performance and visual correctness all had the same shape as product work: spawn
a CLI, give it a prompt, read the `atlas-outcome` block it emits, route on what
it claims.

Two things are wrong with that.

**It is expensive.** The PR1 eval baseline measured 18,254,556 cache-read tokens
against 550 uncached input tokens across 38 dispatches — roughly 480,000 cached
tokens per dispatch, almost all of it the repository being pulled into context.
Dispatching an agent to run `pnpm lint` and report the exit code costs a full
dispatch to learn something `bash` already knew in under a second.

**It is unverified.** ADR 0020 exists because of campaign finding F-012: two PRs
shipped with red test suites while every reviewer agent reported green. Its fix
was narrow on purpose — Atlas runs the project's own typecheck/lint/test script
itself before a push, and believes the exit code rather than the agent. But that
covers exactly one check at exactly one point in the graph. Every other quality
dimension was still self-reported, and `agent-runner-outcome-routing.ts` treats
an empty required checklist as an automatic pass.

## Decision

A workflow graph gains a **`gate` node type**. A gate carries a `script_id` into
`guardrail_scripts` (project override first, the same precedence
`verification-gate.ts` already uses), runs that script once per repo the Task
touches, and routes on the exit code. No agent is spawned. No tokens are spent.

A gate may carry a **fail edge**, which is where the LLM finally enters: a
specialist fixer agent, dispatched with the script's own output as its contract.
The fixer's pass edge goes back to the gate, so the verdict on its work is the
script re-running — not the fixer's opinion of itself.

```
[gate] hygiene ──pass──▶ [gate] coverage ──pass──▶ …
     │ fail                    │ fail
     ▼                         ▼
hygiene-fixer ──┐        coverage-fixer ──┐
     ▲──────────┘              ▲──────────┘
   (re-runs the gate)
```

Three verdicts, plus one:

- **exit 0** → pass edge.
- **non-zero** → fail edge, `loop_count` incremented so `max_loops` bounds the
  cycle, and the output posted on the item so the fixer reads it from
  `.atlas/current-task.md` the way a Coder reads a rejecting reviewer's reason.
- **could not run at all** → the run parks with the Owner. ADR 0020's rule
  carries over unchanged: absence of evidence is not evidence, and treating a
  missing script as red would convert an unenforced gate into one that blocks
  every delivery.
- **`needs_review`** → the fail edge, but recorded distinctly. A script opts in
  by printing `ATLAS_GATE_NEEDS_REVIEW` on a line of its own. The visual gate
  uses it: a screen with no committed baseline is not breakage, it is a screen
  nobody has looked at yet, and it should route to the reviewer that can look.

Every verdict is written to `run_gate_results` (migration 011), so "a machine
check went red after an agent reported done" is a query rather than an
archaeology exercise through `park_reason` prose.

### Why a sentinel and not a reserved exit code

The first cut gave exit 2 the `needs_review` meaning. That is wrong: 2 is a
generic failure for a great many tools — a usage error, a config error, a parse
failure — and reading those as "a human should look at this" routes real
breakage to a reviewer instead of a fixer. An explicit sentinel is opt-in, and a
script that never prints it never produces that verdict.

### Why the scripts delegate

Every shipped gate script discovers the project's own tooling from
`package.json` and the lockfile, runs what is declared, and **skips what is
not** with exit 0 and a `skipped:` line. Atlas does not ship its own linter,
coverage tool or screenshot runner, and a gate that demanded one would be a tax
on every project that has made a different choice. A project that wants
different behaviour overrides the script body in `project_guardrail_scripts`,
which is the mechanism that already existed.

## Consequences

- A green branch spends **zero tokens** on hygiene, coverage, performance and
  visual checking. The LLM cost of quality becomes proportional to how much is
  actually wrong.
- A fixer cannot talk its way past its own gate. Re-running a script is
  deterministic and free, which makes it a strictly better reviewer than a
  second agent for anything an exit code can express.
- `packages/shared/src/workflows/index.ts` changed, which is a hard rule
  (AGENTS.md #1). The Owner instructed it explicitly with the reason recorded
  above. The diff is confined to the node-type union, one optional field, and
  three validator rules.
- `findPassLoop` was checked, not assumed: it walks pass edges only, so
  `gate --fail--> fixer --pass--> gate` is a legal cycle whose every traversal
  increments `loop_count`.
- Judgement work keeps its LLM reviewer. A gate can tell you the suite is green;
  it cannot tell you the Task was understood, the spec is coherent, or the
  documentation is true. Those pairs are unchanged.
- The gate runs per repo and stops at the first failure, so a fixer gets one
  problem rather than a pile.
