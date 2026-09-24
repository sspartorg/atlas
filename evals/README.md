# Agent evals

Atlas ships a fleet of agents and one delivery workflow to every install. Until
now nothing measured them: `agent_runs` has snapshotted `cli`, `model`, `effort`,
`prompt_version`, token counts and `total_cost_usd` on every step since ADR 0014
— explicitly so agent configurations could be compared — and nothing read it. So
every prompt and model change shipped on judgement.

This directory is the measurement. It has two tiers.

## Tier 1 — the contract (free, seconds, runs in CI)

```bash
pnpm eval:contract
```

Shape assertions over every catalog bundle and every shipped workflow template,
in `packages/api/src/marketplace/catalog-contract.test.ts` and
`reviewer-checklists.test.ts`. It catches the failures that would otherwise
surface as an opaque 500 at install time or a parked run on first dispatch:

- the manifest parses against the same Zod schema the zip importer uses —
  `loadCatalog()` itself only casts
- `(cli, model)` is in the `cli_models` registry, so the composite FK on
  `agents` cannot reject the install
- `role_id` resolves to a real `roles` row (five `SdlcRole` slugs are type-level
  only and return `400 ROLE_NOT_IN_CATALOG`)
- every routed agent's prompt reaches the `atlas-outcome` contract, without
  which the engine parks the run
- every reviewer ships at least one **required** checklist row — an empty one is
  an automatic pass (`agent-runner-outcome-routing.ts`), which is how campaign
  finding F-012 happened
- every template graph passes `validateWorkflowGraph`, and names only agents and
  sub-workflows that actually ship

This tier is free and has no opinion about quality. It asserts what an agent
**is**, before any run starts.

## Tier 2 — the golden set (paid, hours, run deliberately)

What an agent **does**. Twelve fixture Tasks in `golden/`, filed against the
sandbox repos and run through the real delivery workflow by the real agents.

```bash
pnpm eval:run                                      # dry run: validate + print the plan
pnpm eval:run -- --project ATL --execute           # the real thing
pnpm eval:run -- --project ATL --execute --only ambiguous-must-escalate
pnpm eval:score -- --label before-prompt-diet      # score whatever is in the DB
```

**`--execute` spends real money.** One delivery run over two capabilities is
roughly 25–30 agent dispatches. Budget on the order of $5–12 and 30–60 minutes
per fixture. `--dry-run` is the default for a reason.

The runner does not execute agents itself. It creates each Task and queues it;
the API process's own dispatch tick picks it up a minute later. So the dev API
must be running — and because **any edit under `packages/api/src` restarts it and
cancels a run mid-resume**, no API edits may land while a golden set is in
flight.

### What the fixtures probe

Each one is chosen so that a plausible-but-wrong agent behaviour fails it.

| Fixture | The trap it sets |
|---|---|
| `greenfield-feature` | The full chain on a new capability across both repos |
| `backend-only` | No UI surface at all — should be labelled `be`, visual gate finds nothing |
| `frontend-only` | Pure presentation — the one fixture where the visual gate has real work |
| `contract-split` | BE genuinely must land before FE; a lazy PO merges them and the FE half has nothing to call |
| `bugfix-root-cause` | The same bug on two surfaces. Patching only the one the ticket names is the failure |
| `refactor-no-behaviour-change` | Restraint: nothing user-visible may change and existing tests must pass unedited |
| `docs-only` | No production code to write. A chain that insists on a code change is over-reaching |
| `ambiguous-must-escalate` | **`completed` is a failing result.** A good PO asks; a bad one invents a feature |
| `failing-test-first` | Small enough that skipping the red step is tempting |
| `perf-regression` | A cache that never invalidates passes a naive benchmark and breaks the product |
| `input-validation` | Trust-boundary work, the one class that must never be simplified away |
| `multi-repo-contract` | One Task, two repos, one branch, one PR each (ADR 0015 / 0017) |

Adding one is a JSON file whose `id` matches its filename. `eval-run.ts`
validates every fixture against the live project **before** creating anything,
so a typo in the twelfth does not leave eleven Tasks queued.

## The scorecard

`eval-score.ts` reads whatever runs are already in the database, so it can
baseline today's fleet before anything changes and re-score after. Routing is
**recomputed, not guessed**: it replays `decideRunRouting` — the same pure
function the engine routes on — over each run's `outcome_kind`,
`outcome_checklist` and the agent's required checklist.

Per agent:

| Metric | What it tells you |
|---|---|
| `pass@1` | Share of step positions whose **first** dispatch routed pass. The headline |
| `loops` | Dispatches beyond the first on the same step — the price of getting it wrong |
| `escalations` | Dispatches that parked the run with the Owner |
| **`gate_catch`** | Deterministic gate failures that landed after this agent was the last to report `done` |
| `$`, `$/step` | Cost, and cost per useful step |
| `cache read %` | How much of the input was served from cache |
| models, efforts | Which `(model, effort)` the number was measured at |

`gate_catch` is the one number an agent cannot author about itself. Everything
in the `atlas-outcome` block is self-reported; ADR 0020 exists because reviewers
reported green on red suites. A gate verdict is an exit code, and migration 011
(`run_gate_results`) is what makes it queryable instead of prose buried in
`workflow_runs.park_reason`.

## The full set on v4 (2026-09-24) — the before/after

All 12 fixtures, delivery v4: **257 dispatches, $129.30, 327 minutes, 1 of 91
gate verdicts red.** Every fixture met its `expect` block. Scorecard:
`evals/results/2026-09-24T12-13-49-520Z-v4-full-12.md`.

| | v1/v2 | v4 |
|---|---|---|
| Dispatches | 203 | 257 |
| Cost | $94.23 | $129.30 |
| Ran to a PR | 6 | **11** |
| Parked on a defect | **5** | **0** |
| Cost per delivered PR | $15.71 | **$11.75** |

v4 costs 37% more per run and delivers 83% more PRs, so a merge-ready PR got a
quarter cheaper. The five v2 runs that parked on defects were valuable as
findings and worthless as delivery.

**Read "1 of 91 red" with ATL-149 in hand.** On the sandbox repos `gate-coverage`
skips (no coverage script declared) and `gate-visual` skips (`@playwright/test`
not installed), and a skip and a pass are the same exit code. Two of four gates
cannot run, so the chain verified less than the number implies. The one time a
red suite survived to the end of a run, the **Release Reviewer** caught it, not
a gate.

**The Release Reviewer is 27% of the bill** ($35.34, $3.21/step) and earned it:
four rejections, none of which woke the Owner, including an unescaped value
reaching rendered HTML that the Architect's spec had ruled out of scope. Both of
its best catches were cross-sub-task defects that no per-sub-task reviewer could
have seen.

**The harness cannot score a fixture's actual trap.** `expect` checks terminal
status, sub-task count and PR existence. It cannot check that `contract-split`
split the contract — that was verified out-of-band by reading the `depends_on`
edges (three fixtures produced correct ones unprompted). ATL-138 should take a
per-fixture assertion hook rather than three fixed fields.

## What the v4 slice found (2026-09-24)

Three fixtures on delivery v4 — `frontend-only`, `perf-regression`,
`ambiguous-must-escalate` — chosen to exercise what PRs #45/#46 changed:
**56 dispatches, $27.05, 70 minutes, 0 of 14 gate verdicts red.** All three
reached their expected terminal state. Scorecard:
`evals/results/2026-09-24T09-40-23-368Z-v4-slice.md`.

1. **The install was on v2 and nothing said so.** 17 agents at
   `marketplace_pulled_version: 1`, `upgrade_available: 0`, because
   `upgrade_available` is `installed_version < catalogVersion` and no manifest
   version had been bumped in three PRs. The run would have measured v1 prompts
   and called them v4. Fixed in #47 (`catalog.lock.json` + contract test).
   **Before any eval run, check the install is actually on the version you mean
   to measure.**

2. **The Release Reviewer's v4 routing closed an XSS without waking the Owner.**
   It overruled the Architect's "pre-existing and unchanged, out of scope" on an
   unescaped `${t.id}`, on the grounds that the branch added the route that made
   it reachable — filed the fix sub-task itself, and the chain built, tested and
   re-verified it. Under v2 that parked.

3. **`gate-visual` skipped `frontend-only`**, the fixture that exists to
   exercise it, because its UI detection was an extension list and the sandbox
   is a server-rendered Express app. Every server-rendered app had no visual
   checking at all. Now also triggered by markup added in the diff.

**`pass@1` mis-scores a correct rejection** — `agent-release-reviewer` reads 50%
for the best call in the run. For reviewers, read `gate_catch` and read what the
rejections actually were.

## What the first full run found (2026-09-24)

All 12 fixtures, on delivery v2: **203 dispatches, $94.23, 245 minutes, 2 of 49
gate verdicts red.** Six ran to a PR; one parked exactly as designed; five
parked on defects the set existed to find.

`evals/results/2026-09-24-v1-full-golden-set.md` is the scorecard. The findings
mattered more than the totals:

1. **`gate-hygiene` called a CLI's own stdout "debug residue".** `console.log`
   is residue in a library and the *product* in a command-line tool. The
   Hygiene Fixer refused to rewrite spec-mandated output as
   `process.stdout.write` to make the gate green, and escalated instead. The
   check is now skipped for entry points (package.json `bin`, `bin/`, `*cli.*`).

2. **`agent-qa-writer` could not honestly tick its own checklist.** Two of its
   four required rows said a scenario "exists **and passes**" — but QA Writer
   *plans* tests; `agent-automation` runs them. It parked rather than claim a
   pass it had not observed. The rows now describe planning.

3. **A documentation sub-task could not clear the code gates.**
   `coder-tests-green` demanded a changed test file and the Coder's checklist
   demanded a new unit test, neither of which a README-only diff can supply.
   The Coder asked rather than inventing a throwaway test. Both now exempt
   documentation-only diffs, as they already did for `specs/` and `tests/qa/`.

4. **The Release Reviewer earned its place twice.** On two independent fixtures
   it caught tests that pass on the branch and fail after merge — one
   hard-coding `origin/main`'s current HEAD as a "legacy" commit, another
   asserting `git diff` over three files is empty, which silently forbids anyone
   from ever editing them again. Every gate was green on both. No exit code
   could have found either.

5. **PO Writer refused a false premise.** The `bugfix-root-cause` fixture
   describes a bug that no longer exists; it read the code, said so, and asked
   whether to rescope before slicing anything.

The two fixtures that probe judgement rather than mechanism both behaved:
`ambiguous-must-escalate` parked with six questions grounded in what the repos
actually contain, and `contract-split` produced a `be` sub-task and an `fe` one
linked `depends_on`, in that order.

## Output

`results/` holds one pair per scoring run:

- `<timestamp>-<label>.md` — the scorecard. **Tracked**, because it is the prose
  artifact that explains a change.
- `<timestamp>-<label>.json` — the raw per-run telemetry. **Gitignored**, per
  AGENTS.md rule 6: raw evidence stays local.
