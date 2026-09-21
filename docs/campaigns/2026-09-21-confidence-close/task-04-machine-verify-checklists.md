# 04 — Machine-verify the reviewer checklist gates

**Status:** todo — design settled by ruling E-8
**Depends on:** task-01
**Scope:** api

## Why

G-004, and the deepest change on this board.

The predecessor's F-012 found that every reviewer agent shipped an empty
`checklists.json`, and that `agent-runner-outcome-routing.ts:72` treats an empty
required checklist as an automatic pass. The agents whose entire job is
verification had no gate. ATL-5 shipped two PRs with red suites while every
reviewer reported green.

It fixed that by populating the checklists — verified in task-01, all five
reviewers now carry 4–5 required items. That closes the symptom. The root cause
is the second half of its own finding, which it recorded and left open:

> Checklist results are **self-reported** — `if (item.passed)` reads the agent's
> own `atlas-outcome` block. Nothing machine-verifies them, so even the Coder's
> required *"Project test suite clean"* is an unchecked assertion.

An agent that claims a red suite is green is still believed today.

## What task-01 found, and why the plan changed

The finding's proposed remedy — "consult the guardrail script's exit code" —
**cannot be implemented as written, because no exit code exists anywhere in the
system.**

- `services/constitution-assembler.ts:84-90` writes each guardrail script into
  the worktree at `.atlas/scripts/bash/check-<id>.sh`, mode `0755`, and stops.
  **Atlas never executes any of them.** The agent is asked to run the script by
  its prompt (`agent-code-reviewer/prompt.md:34` is explicit and correct) and
  then reports the result itself.
- `agent_checklists` is `(id, agent_id, label, sort_order, required)`. There is
  no `script_id`, no arguments column, nothing joining an item to the script
  that would prove it. The only trace is prose inside the label:
  `"Full project test suite green — ran check-coder-tests-green.sh <itemId> --run-tests"`.

So this is a new execution stage, not a rewiring. **Ruling E-8** settles the
shape: Atlas runs the gate itself, routes on that exit code, and the agent's
self-report becomes advisory. No schema change, and no regex over prose deciding
whether a PR ships.

## The shape

```
workflow-engine.ts, after a step completes with outcome.kind === 'done':

  step flags include push_code or raises_pr ?
    no  → decideRunRouting(...) exactly as today
    yes → runVerificationGate(worktreePath, itemId)
            execFile .atlas/scripts/bash/check-coder-tests-green.sh <itemId> --run-tests
            ├─ exit 0        → decideRunRouting(..., verified: true)  → pass edge
            ├─ exit non-zero → apply_on_fail, detail 'gate_failed: <first lines>'
            └─ could not run → park with the Owner, NOT a fail
```

`decideRunRouting` stays a **pure function** — that is its documented contract
(`agent-runner-outcome-routing.ts:11`) and the reason it is testable. The gate
result is computed by the caller and passed in as an input. No DB, no exec, no
SSE inside the router.

Reuse `services/project-setup-runner.ts` as the execution pattern. It already
solves every problem this needs solved: `execFile` with a timeout, a bounded
`maxBuffer`, secret-value redaction over captured output, and a `finally` that
cleans up. Do not write a second spawn helper.

## What to do

1. Read `decideRunRouting` end to end and find every caller —
   `workflow-engine.ts:548` is the only one, and it routes **every** agent step,
   not just reviewers. Understand that before touching it.
2. Add `runVerificationGate` beside the setup runner, following its contracts.
3. Extend `DecideRunRoutingInput` with the gate verdict. Absent verdict ⇒
   today's behaviour exactly, so unflagged steps are provably unchanged.
4. Decide, and write down as a WHY comment, what an empty required checklist now
   means on a gated step. "Empty means pass" is the exact hole F-012 fell
   through.
5. Update `.agents/api-surface.md` and `.agents/architecture.md` in the same
   commit — this board has no docs backstop task.

## Traps

- **Blast radius is every workflow run.** This ships alone, in its own commit,
  with nothing else riding along.
- **"Could not run" is not "failed."** A missing binary, an absent script, a
  timeout, or a worktree that was already torn down are all *no evidence* — they
  must park with the Owner, never take the fail edge. Conflating them turns an
  unenforced gate into a gate that blocks everything, which is a worse failure
  than the one being fixed.
- The gate runs the project's real test suite. It needs the timeout and
  `maxBuffer` the setup runner already uses, and its output must go through the
  same secret redaction before it is stored — a failing test can print an env
  var.
- Do not run the gate on a step that never provisioned a worktree.

## Done when

- [ ] `runVerificationGate` added, reusing the setup-runner exec pattern
- [ ] Gated only on steps with `push_code` or `raises_pr` (E-8)
- [ ] `decideRunRouting` still pure; gate verdict passed in, not computed inside
- [ ] Ungated steps provably unchanged — a test asserts identical routing
- [ ] "Could not run" parks with the Owner; a test proves it is not a fail
- [ ] Empty-checklist semantics on a gated step decided, commented, tested
- [ ] **Mutation proof**: making the gate trust `item.passed` again fails a test
- [ ] Gate output passes through secret redaction before storage
- [ ] `pnpm -F @atlas/api test` green
- [ ] `.agents/` updated in the same commit
- [ ] G-004 flipped in `findings.md`, board row flipped

## Evidence

_Written after execution._
