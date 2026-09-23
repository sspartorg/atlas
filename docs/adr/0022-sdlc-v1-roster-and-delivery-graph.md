# 0022. SDLC v1 — the shipped roster and the delivery graph

**Date:** 2026-09-24
**Status:** Accepted

## Context

Atlas ships one delivery workflow and a fleet of agents to every install. That
chain is the product's first impression: a customer files a Task and should get
back a merge-ready PR.

The chain as it stood covered scoping, design, build, test planning and test
automation. It did not cover documentation, performance, coverage, visual
correctness, or anyone reading the finished change as a whole. Those gaps were
not oversights so much as accumulation — each pair was added when it was needed,
and nobody had asked what the full set should be.

ADR 0021 added the `gate` node, which changes the calculus: a check that an exit
code can express no longer needs an agent, so the question "what should the
roster be" separates cleanly into "what needs judgement" and "what needs a
script".

## Decision

### Sub-tasks stay capability-sliced, and carry a layer label

The Owner asked for BE / FE / QA / DOC sub-task types. Taken literally that
means splitting every capability into a backend half and a frontend half, which
multiplies runs and strands an FE sub-task behind a BE contract that is usually
already there.

So: a dev sub-task remains **one end-to-end shippable capability**, and carries
exactly one of `be` / `fe` / `fullstack` alongside `dev`. The label picks the
specialist; it does not split the work. PO Writer splits BE from FE **only when
the frontend has nothing to call until the backend exists** — a new endpoint, a
new field, a changed response shape — and then links them `depends_on` so they
build in order.

Every dev sub-task gets a `[QA]` twin (as before) and now a `[DOC]` twin. The
DOC twin is joined by title and label, not by a typed link: `item_links`
supports `relates_to | depends_on | tested_by`, and inventing a
`documented_by` relation would mean a shared type change and a CHECK constraint
to express something the title convention already says unambiguously.

### The roster: judgement keeps an LLM reviewer, exit codes do not

Six performer/reviewer pairs, four gate+fixer pairs, one final reviewer.

| Pair | Reviewed by | Why |
|---|---|---|
| PO Writer | PO Reviewer | Was the Task understood? Not checkable. |
| Architect | Architect Reviewer | Is the spec coherent and complete? Not checkable. |
| Coder | Code Reviewer | Does the diff meet its contract? Partly checkable, but the contract is prose. |
| QA Writer | QA Reviewer | Does the plan cover the criteria? Not checkable. |
| Automation | Automation Reviewer | Are the tests real, or assertion-free? Not checkable. |
| Doc Writer | Doc Reviewer | Is the documentation *true*? Not checkable. |
| hygiene / coverage / perf / visual fixers | **their gate** | Entirely checkable. |

The visual one is the interesting case. Its gate can diff against a baseline,
but a screen with no baseline has nothing to diff — so the judgement is "does
this look right", which needs eyes. It is an agent, and its gate is still the
arbiter once a baseline exists.

### Release Reviewer

Every other reviewer judges one piece. Sub-tasks are built one at a time and
reviewed one at a time, so the defects that survive are the ones *between* them:
two sub-tasks that solved the same problem differently, a helper duplicated
because the second author did not see the first, an interface one half changed
and the other still calls the old way.

The Release Reviewer is the only step that reads the branch as one change
against the Task the Owner actually filed. It deliberately does **not** re-run
the gates — they ran, their verdicts are rows — and it rejects on scope creep or
a safety problem regardless of how green they are.

### `max_loops` on the template

One `loop_count` is shared by every fail edge in a run. The v2 graph has six
reviewer pairs, four gates and a release reviewer; the DB default of 3 would
park a Task that simply took two rounds in two different places. Templates could
not express a loop budget, so `IWorkflowTemplate` gains an optional `max_loops`
and Delivery declares 12 — roughly one retry per failable step.

## Consequences

- A customer files a Task and gets a PR that is typechecked, linted,
  secret-scanned, covered, within budget, visually checked and documented.
- The token cost of quality becomes proportional to how much is actually wrong:
  a clean branch pays for the judgement steps and nothing else.
- The roster is 23 catalog agents, which is a lot to maintain. The scorecard
  (`evals/`) is the cull list — any agent whose pass@1 and gate catches do not
  justify its cost gets merged or dropped, and that is now a measurement rather
  than an argument.
- `build` stays **unlabelled** on purpose: it is the catch-all, so a sub-task
  that arrives with no label is still built rather than stranding the run.
- The Release Reviewer's rejection routes to an Owner node that re-enters at the
  build step, so a gap it found is closed by a sub-task and everything
  downstream re-verifies.
