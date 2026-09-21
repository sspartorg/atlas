# 0020. Atlas Runs the Verification Gate

**Date:** 2026-09-21
**Status:** Accepted

## Context

ADR 0014 made workflows the only router: agents never assign, change status, push
or open PRs. Every agent ends with an `atlas-outcome` block and the graph decides
the next step. The decision function is
`packages/api/src/services/agent-runner-outcome-routing.ts`, a pure function whose
contract is stated in its own header — no DB, no SSE, no side effects — called
once from `packages/api/src/services/workflow-engine.ts:548`.

That design has a hole, and it shipped bad code through it. The router resolves
each required checklist item from the agent's own report:

```ts
for (const item of outcome.checklist) {
    if (item.passed) passedIds.add(item.id);
}
```

Nothing verifies the claim. During the 2026-09-20 fresh-install regression
campaign (finding F-012) item ATL-5 opened two pull requests whose test suites
were red — 58/59 and 34/35 — while every reviewer agent reported green. The same
finding recorded a second fact: all five reviewer agents shipped an empty
`checklists.json`, and an empty required checklist returns `apply_on_pass`. The
agents whose entire job is verification had no gate at all. That half was fixed
by populating the catalog; all five reviewers now carry four or five required
items, confirmed 2026-09-21.

The self-report half was left open with a proposed remedy: consult the exit code
of guardrail script `coder-tests-green`, which runs the project's declared `test`
script under `--run-tests` and which `agent-code-reviewer/prompt.md:34` already
instructs the reviewer to run. **That remedy is not implementable as written,
because no exit code exists.** `packages/api/src/services/constitution-assembler.ts:84-90`
writes each guardrail script into the worktree at `.atlas/scripts/bash/check-<id>.sh`
with mode `0755` and stops there. Atlas has never executed one. The scripts are
material handed to the agent, and the agent grades its own homework.

Nor is there any structure joining a checklist item to the script that would
prove it. `agent_checklists` is `(id, agent_id, label, sort_order, required)`.
The only trace of the linkage is prose inside a label:
`"Full project test suite green — ran check-coder-tests-green.sh <itemId> --run-tests"`.

Two alternatives were considered and rejected. **Adding `script_id` to
`agent_checklists`** (a migration plus a catalog change across all sixteen agents)
is the most honest data model and remains the right move if per-item verdicts are
ever needed; it was rejected as disproportionate to the one guarantee actually
broken. **Parsing the script name out of the label** needs no schema change and
was rejected outright: a regex over prose would decide whether a pull request with
a failing suite ships.

## Decision

Atlas runs the verification gate itself. After an agent step reports
`outcome.kind = 'done'` on a step whose flags include `push_code` or `raises_pr`,
the workflow engine executes the project's own typecheck/lint/test gate in the
run's worktree and routes on **that** exit code. The agent's self-report becomes
advisory: it is still recorded and still shown, but it no longer decides the edge.

`decideRunRouting` stays pure. The gate runs in the caller and its verdict is
passed in as an input, so the router remains a table-driven function that can be
tested without a worktree, a database or a subprocess. Execution reuses the
contracts already established by
`packages/api/src/services/project-setup-runner.ts`: `execFile` with a timeout, a
bounded `maxBuffer`, and mask-redaction of every known secret value before any
output is stored.

A gate that **cannot run** — a missing script, an absent binary, a timeout, a
worktree already torn down — parks the run with the Owner. It is never a fail.

## Consequences

- An agent can no longer ship a pull request by asserting that a red suite is
  green. The guarantee ADR 0014 implies — that the graph, not the agent, decides
  — now holds for verification as well as routing.
- Steps that push code or raise a PR get slower by the cost of one real
  typecheck/lint/test cycle. This is the intended trade: the gate is placed
  exactly where a wrong "green" has consequences, and nowhere else. A research or
  spec-writing step pays nothing.
- **"Could not run" is deliberately not a failure.** Treating missing evidence as
  a red result would convert an unenforced gate into one that blocks every run —
  a worse failure than the one being fixed. The cost is that a silently
  misconfigured project degrades to Owner escalation rather than to a hard stop.
- The blast radius is every workflow run, so this ships in its own commit with a
  mutation-proved test: restoring the self-report path must fail it.
- Per-item machine verification is still not possible, because no column links a
  checklist item to a script. Items remain self-reported *individually*; what is
  now machine-checked is the one claim that matters — that the project's own gate
  passes. Adding `script_id` to `agent_checklists` remains the upgrade path if
  per-item verdicts are ever needed.
- The guardrail scripts keep their existing role as material staged into the
  worktree for the agent to run. This ADR adds a second consumer, it does not
  retire the first.
