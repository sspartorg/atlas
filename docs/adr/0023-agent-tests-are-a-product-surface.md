# ADR 0023 — Agent tests are a product surface, not a repo-local dev tool

**Status:** proposed
**Date:** 2026-09-24

## Context

Atlas ships a fleet of agents and lets customers install more, edit them and
write their own. It has no way for anyone to find out whether an agent works.

The measurement that exists is `evals/`: twelve fixture Tasks in the repo, a CLI
runner, a CLI scorer, and a markdown scorecard written to a gitignored
directory. It has proven its worth — six shipped defects came out of it in two
days, including an unescaped value reaching rendered HTML and a gate that
silently checked nothing. But every part of it is ours and local:

| | Today |
|---|---|
| Fixtures | `evals/golden/*.json`, in the repo |
| Running a set | `pnpm eval:run --execute`, a terminal |
| Scorecard | `evals/results/*.md`, gitignored JSON |
| Agent history | **515 `agent_runs` rows exist** and are never aggregated |
| Tests as a concept | **no table, no route, no page** |

The `Test Run` tab on an agent fires one ad-hoc prompt through `startDryRun`,
streams the output, and keeps nothing. No expectation, no verdict, no history.

So a customer installing an agent from the marketplace does it on trust, and a
customer writing their own has no way to qualify it — or to show anyone else
that it works. For a product whose premise is "give it a Task and get a
merge-ready PR", that is the wrong thing to be missing.

The original plan scoped `evals/` with an explicit **non-goal: no new product
surface**. That was right while the question was "can we measure this at all".
It stopped being right the moment the measurements started changing what ships.

## Decision

**Agent tests become product data, with a UI, on the agent page.**

### One primitive, two ways to run it

The obvious move is two features — "test my agent" for customers and "golden
set" for us. That is wrong, because of what an agent needs in order to do
anything at all.

A PO Writer refuses anything that is not a Task (its kind guard). A Coder needs
a sub-task, a repo and a spec. A Release Reviewer needs a whole branch. **A bare
prompt cannot exercise any of them** — which is exactly why the `Test Run` tab
has never been usable as a test.

So an agent test needs a realistic input item and a repo. That is precisely what
a golden fixture already is. One primitive:

> **A fixture** = an input item + a repo + expectations.
>
> Run it through **one agent** → qualification. Seconds, cents.
> Run it through **a workflow** → end-to-end eval. What `evals/` does now.

Same table, same expectations, same verdict. Building these as two features
would duplicate all three.

### Expectations assert what already exists

Nothing new has to be invented to judge a run. Every routed agent ends with an
`atlas-outcome` block, and `decideRunRouting` — the pure function the engine
itself routes on — already turns that into a verdict. A fixture's expectations
are therefore:

- the outcome kind (`done` / `rejected` / `asked_question`)
- every **required** checklist row reported passed
- the summary contains / does not contain given text
- cost and duration ceilings

`asked_question` as a *pass* matters as much as `done`: the
`ambiguous-must-escalate` fixture exists because a PO Writer that invents a
feature from an unanswerable Task has failed, and one that asks has succeeded.
A test framework that can only assert success cannot express that.

### Spend is shown before it happens

Running a test costs real money. The UI shows an estimate from that agent's
historical cost per run — which is already in `agent_runs` — and runs on
confirm. An agent test is cents; a workflow eval is dollars, and the difference
should be visible before the click, not after.

### Fixtures live in the database

Not in the repo. A customer cannot edit a file in our repo, and a fixture that
only we can write is not a product feature. Our twelve golden fixtures become
seeded rows like the marketplace catalog, with the same consequence: **a change
to a shipped fixture needs a version bump**, or existing installs never see it
(the lesson of ATL-138's sibling, `catalog.lock.json`).

## Phasing

Each phase ships something usable on its own.

**1 — Agent tests.** `agent_tests` and `agent_test_runs`. A Tests tab on the
agent page: write a test, run it, see pass or fail and why, see the history.
Reuses `startDryRun` and `agent_runs`. This is the phase that answers "how does
a customer qualify an agent they just wrote".

**2 — Agent performance.** The agent page shows what its runs already prove:
pass rate over time, cost per run, loops, escalations, and `gate_catch` — the
one signal an agent cannot author about itself. The numbers are computed today
by `eval-score.ts`; they need a route and a view, not new maths.

**3 — Workflow evals.** Fixture sets, run from the UI, with history and
before/after across fleet versions. This is `evals/` promoted into the product,
and it is last because it is the most expensive to run and the least often
needed.

## Consequences

- A customer can qualify an agent before trusting it, and can show others that
  it works. That is what makes an agent marketplace mean anything.
- Our golden set stops being a thing only this repo can run.
- `pass@1` must not be shown as a bare ranking. On the v4 set
  `agent-release-reviewer` scored 64% because it rejected four times, and those
  four rejections were the most valuable thing in the run. A reviewer's
  rejections are its product. Any page that ranks agents has to make that
  legible to someone who does not already know it.
- A test is only as honest as its fixture. A fixture pointing at a moving repo
  gives different answers over time, which is why a test owns a throwaway item
  and names its repo explicitly.
- This is more surface to maintain, and some of it duplicates what the CLI does.
  The CLI stays: it is what CI runs, and `pnpm eval:contract` must keep working
  without a database full of product data.
