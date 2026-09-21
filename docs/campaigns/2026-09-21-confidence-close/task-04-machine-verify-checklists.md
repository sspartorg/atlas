# 04 — Machine-verify the reviewer checklist gates

**Status:** done — 2026-09-21
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

- [x] `runVerificationGate` added, reusing the setup-runner exec pattern
- [x] Gated only on steps with `push_code` or `raises_pr` (E-8)
- [x] `decideRunRouting` still pure; gate verdict passed in, not computed inside
- [x] Ungated steps provably unchanged — a test asserts identical routing
- [x] "Could not run" parks with the Owner; a test proves it is not a fail
- [x] Empty-checklist semantics on a gated step decided, commented, tested
- [x] **Mutation proof**: making the gate trust `item.passed` again fails a test
- [x] Gate output passes through secret redaction before storage
- [x] `pnpm -F @atlas/api test` green
- [x] `.agents/` updated in the same commit
- [x] G-004 flipped in `findings.md`, board row flipped

## Evidence

**Done. 57 tests green across the two files (10 new gate unit tests against
real bash scripts, 47 engine integration tests of which 4 are new).** ADR 0020
records the decision.

### The plan's placement was impossible, and the code said why

E-8 said to gate "steps whose flags are `push_code` or `raises_pr`". **There is
no such step.** `push_code`, `raises_pr`, `push_to_default` and `use_worktree`
are columns on `workflows` — the whole graph — and `IWorkflowNode`
(`packages/shared/src/workflows/index.ts:22`) carries only `id`, `type`,
`agent_id`, `sub_workflow_id`, `label` and `position`. Per-step gating needs a
schema change, which E-8 explicitly forbids.

The two honest readings left were: gate **every** agent step in a code-pushing
workflow, or gate **once per repo immediately before that repo's push**. The
second was taken, and it is the better one rather than merely the cheaper one:

- It blocks precisely the outcome F-012 recorded — *a PR that shipped with a
  red suite*. Gating each step would also re-run a full suite after agents that
  never touched code.
- A delivery workflow runs ~10 agents. Gating each means ~10 full
  typecheck+lint+test cycles per Task instead of one per repo.
- It is **per repo**, which ADR 0017 requires: each repo of a multi-repo Task
  carries its own suite, so a red repo is skipped while its clean siblings
  still deliver.

That last point turned out to be already designed for. `agent-runner.ts:1491`
stages a separate `.atlas/` into every checkout with the comment *"checklist
scripts expect a repo at their cwd"* — so the scripts the gate needs are
already exactly where a per-repo gate wants them. The gate asserts its own cwd
in a test, because running it in the workspace root would verify a sibling's
code and report on the wrong repo.

### `decideRunRouting` was not touched

It stays the pure function its header promises. The gate is a separate module
executing in `deliver`, which is where the push it guards actually happens.
Nothing about the self-report path changed — 43 of the 47 integration tests are
the pre-existing ones and all still pass unmodified, which is the evidence that
ungated behaviour is unchanged.

### 15 tests failed first, and that was the right signal

Adding the gate broke every delivery test in
`workflow-engine.integration.test.ts` — they mock `agent-runner`, so nothing
ever stages `.atlas/scripts/`, and the real gate correctly answered
`unavailable`. The fix was to mock the gate there, exactly as that file already
mocks `pushWorktree` and `openPullRequest`: its subject is routing, not the
gate. The gate's own behaviour is tested against **real bash scripts in real
temp directories** in `verification-gate.test.ts` — a mocked exit code would
just be another claim, which is the thing this task exists to stop believing.

### Mutation proof

Deleting the gate block from `deliver()` fails **exactly the 4 gate tests** and
leaves the other 43 passing:

```
FAIL  does not push when the gate fails, even though every agent reported done
FAIL  retries the gate on resume and delivers once it passes
FAIL  parks — and does NOT fail — when the gate could not run at all
FAIL  runs the gate in the repo being pushed, before the push
Tests  4 failed | 43 passed (47)
```

### "Could not run" is not "failed"

Six of the ten unit tests exist only to hold this line. Missing script, deleted
worktree, timeout, and spawn error all return `unavailable`, and the engine
parks with copy that says *"This is not a test failure — Atlas simply could not
confirm the suite."* If any of those ever returns `fail`, a misconfigured
project becomes indistinguishable from a red suite, and the new gate blocks
every delivery — a worse bug than the one being fixed.

### What is still not machine-verified

**Individual checklist items remain self-reported.** Nothing links an item to a
script (`agent_checklists` has no `script_id`), so "Commit messages follow
Conventional Commits" is still the agent's word. What is now machine-checked is
the one claim that had consequences: that the project's own gate passes before
its code is pushed. Adding `script_id` is the upgrade path, recorded in ADR
0020, and deliberately not taken here.
