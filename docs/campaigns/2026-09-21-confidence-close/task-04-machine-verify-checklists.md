# 04 — Machine-verify the reviewer checklist gates

**Status:** todo
**Depends on:** task-01
**Scope:** api

## Why

G-004, and the deepest change on this board.

The predecessor's F-012 found that every reviewer agent shipped an empty
`checklists.json`, and that `agent-runner-outcome-routing.ts:72` treats an empty
required checklist as an automatic pass. The agents whose entire job is
verification had no gate. ATL-5 shipped two PRs with red suites while every
reviewer reported green.

It fixed that by populating the checklists. That closes the symptom. The root
cause is the second half of its own finding, which it recorded and left open:

> Checklist results are **self-reported** — `if (item.passed)` reads the agent's
> own `atlas-outcome` block. Nothing machine-verifies them, so even the Coder's
> required *"Project test suite clean"* is an unchecked assertion.

An agent that claims a red suite is green is still believed today.

The machinery to do better already exists and is unused. Guardrail script
`coder-tests-green` runs the declared `test` script when passed `--run-tests`,
and `agent-code-reviewer/prompt.md:34` instructs the agent explicitly: *"You are
the only step that runs the full test suite, so never skip `test` when it is
declared."* The prompt is right. Nothing enforces it, and the script's exit code
is never consulted by the router.

## What to do

1. Read `services/agent-runner-outcome-routing.ts:72-88` end to end before
   editing, and find every caller. The router decides `apply_on_pass` versus the
   fail edge for **every** workflow step, not just reviewers.
2. For a checklist item **backed by a guardrail script**, resolve the verdict
   from that script's **exit code**, not from `item.passed`.
3. For an item with **no backing script**, keep today's behaviour. This adds a
   gate where evidence exists; it does not rewrite the outcome protocol.
4. Decide, and write down, what an empty required checklist now means. "Empty
   means pass" is the exact hole F-012 fell through; "empty means fail" may
   strand legitimate agents. Whichever is chosen, state the reason in the code
   as a WHY comment.
5. Update `.agents/` in the same commit — this board has no docs backstop task.

## Traps

- **Blast radius is every workflow run.** This ships alone, in its own commit,
  with nothing else riding along.
- Scripts can fail for reasons that are not the agent's fault — a missing
  binary, a timeout. A non-zero exit that means "could not run" is not the same
  as "the suite is red", and conflating them turns an unenforced gate into a
  gate that blocks everything. Distinguish them.
- Do not consult exit codes for items whose script was never invoked in that
  run; absence of evidence is not a failure.

## Done when

- [ ] Script-backed checklist items resolve from exit code, not self-report
- [ ] Unbacked items behave exactly as before, with a test proving it
- [ ] The empty-checklist semantics are decided, commented and tested
- [ ] **Mutation proof**: restoring the `if (item.passed)` path fails the new test
- [ ] "Could not run" is distinguished from "failed", with a test
- [ ] `pnpm -F @atlas/api test` green
- [ ] `.agents/` updated in the same commit
- [ ] G-004 flipped in `findings.md`, board row flipped

## Evidence

_Written after execution._
