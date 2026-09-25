# 0024. The agent decides what to check, Atlas executes it

**Date:** 2026-09-25
**Status:** Accepted
**Supersedes parts of:** [0020](0020-atlas-runs-the-verification-gate.md), [0021](0021-gate-nodes-run-deterministic-checks.md), [0022](0022-sdlc-v1-roster-and-delivery-graph.md)

## Context

ADR 0021 made a `gate` node run a `guardrail_scripts` body and route on its exit
code. The scripts were written to "delegate": discover the project's own tooling
from `package.json` and the lockfile, run what is declared, skip what is not.

Delegation was the intent. Guessing was the implementation. Of the eleven seeded
scripts, five contained assumptions about the customer's project:

| script | the guess |
|---|---|
| `gate-visual` | a UI file-extension allowlist (`tsx\|jsx\|vue\|svelte\|css\|…`), then a markup-sniffing regex over added lines when that failed |
| `gate-coverage` | a **95%** statements floor Atlas chose, ratcheted into `atlas-gate/coverage-floor` |
| `gate-perf` | **100ms** API and **200ms** page budgets, and a fallback probe with three viewports Atlas chose |
| `gate-hygiene` | package-manager detection by lockfile, `has_script` probing, a CLI-entry-point carve-out for `console.log` |
| `coder-tests-green` | the same lockfile detection, plus a test-file extension list (`*.test.*`, `*_test.go`, `test_*.py`) |

Each of those was wrong for somebody, and the record shows it. ADR 0021's own
amendment documents `gate-visual` skipping the one golden-set fixture built to
exercise it, because the sandbox renders HTML from a `.js` file that no
extension in the list matches — so *every* server-rendered app (Express, EJS,
Pug, Rails, PHP, Go templates) had no visual checking at all, silently, while
the gate reported a pass. `gate-coverage` looked for a coverage script, found
none, and skipped the test run too, on a repo that declares `"test": "node
--test"`. Both were then fixed by guessing harder: a wider regex, a second list
of script names.

The Owner's objection is the general form of those two incidents: **Atlas cannot
know what kind of project a customer will point it at.** A product that ships a
file-extension list has decided what a UI is on behalf of every customer who has
not been asked.

The counter-pressure is real and stays: ADR 0020 exists because agents shipped
two pull requests with red suites while every reviewer reported green (campaign
finding F-012). Whatever replaces the scripts cannot go back to believing a
sentence an agent wrote about itself.

## Decision

**The agent decides what to check. Atlas executes it and believes the exit code.**

A `gate` node carries `agent_id` instead of `script_id`: a **checker agent**. It
reads the repository — manifests, tool config, the CI workflow — and answers two
questions in the `atlas-outcome` block it already has to emit:

```atlas-outcome
outcome: done
applies: true
command: pnpm -s vitest run --coverage
summary: |
  vitest.config.ts declares thresholds.lines: 90, so --coverage exits non-zero
  below the project's own number.
```

Atlas then runs that command in each repo the Task touches and routes on the
real exit status. Two new optional keys on an existing contract, not a second
protocol: `packages/api/src/services/gate-check-routing.ts` is the pure function
that turns the answer into one of three outcomes, mirroring
`agent-runner-outcome-routing.ts`.

| the checker said | Atlas does |
|---|---|
| `applies: true` + a command | runs it: exit 0 → pass, non-zero → fail edge, non-zero + `ATLAS_GATE_NEEDS_REVIEW` → `needs_review` |
| `applies: false` + why | records **`skipped`**, takes the pass edge |
| asked a question | parks with the Owner |
| nothing parseable · `applies: true` with no command · no `applies` at all | **parks** — never a pass |

That last row is ADR 0020's rule one level up. A checker that named no proof
produced no evidence, and absence of evidence is not permission to continue.

**Four checker agents, not one parameterised one** — `agent-hygiene-check`,
`agent-tests-check`, `agent-perf-check`, `agent-visual-check`. A `concern` field
on the node would need a new field in protected shared, a new spawn option and a
new prompt path; four catalog directories need no code at all, because
`workflows.ts` and `workflow-bundle.ts` already collect `agent_id` from any node
type. They also get per-concern models, and four rows in the scorecard instead
of one undifferentiated row.

**The pre-push gate keeps its job and loses its hardcoded script.** It runs
`project_repos.verify_command` — Owner-set in the project's Setup tab, or
written back by `agent-tests-check` the first time it names one, never
overwriting an Owner value. A repo with none **parks**; Atlas does not guess a
stack's test command, and it does not push what it could not verify.

**Atlas ships no thresholds.** A coverage floor comes from the project's own
vitest/jest/nyc/coverage config, which the project's own command already
enforces. A perf budget comes from a committed `size-limit`, Lighthouse or
criterion config. A visual baseline comes from the project's own snapshot
directory. Nothing declared means `applies: false`, recorded as `skipped` and
counted as unchecked — not as green.

### Cost

The measured objection to this change, against
`evals/results/2026-09-24T12-13-49-520Z-v4-full-12.md` (12 runs · 257 dispatches
· \$129.30 · 91 gate verdicts):

- A checker reads a manifest and a config and writes nothing. Priced at \$0.20,
  the rate of the cheapest read-only agents in that same table.
- Dispatching on every gate traversal would be +91 dispatches, **+\$1.52/run**.
- The checker's answer is **memoised per (run, node)** — a fixer fixing a lint
  error does not change which command proves coverage — so a repair loop
  re-runs the command with no second dispatch. That is +48 dispatches,
  **+\$0.80/run, +7.4%**.

The memo needs no storage: it is the newest `run_gate_results` row for that node
carrying a command, so the cache *is* the audit trail and the Owner can see what
was re-run.

## Consequences

- **A gate's verdict is still an exit code**, so F-012 holds: an agent cannot
  report green and be believed. What moved is who chooses the command.
- **Atlas ships no opinion about any customer's stack.** Five scripts, two
  probes (`perf-probe.mjs`, `visual-probe.mjs`), `probes-assembler.ts` and the
  `atlas-gate/coverage-floor` ratchet are deleted. The six guardrail scripts
  that remain check **Atlas's own** artifacts — a clean worktree, a spec file's
  headings, the QA CSV schema, a commit trailer, the Task/sub-task label
  contract — and assume nothing about the project.
- **A project with no perf or visual tooling now gets no perf or visual check**,
  and is told so as `skipped`. This is a real loss: on the eval sandboxes the
  deleted probe was the only thing that ever looked at a pixel. "Atlas invents
  nothing" and "every project gets a visual check" cannot both be true, and the
  mitigation is that a skip is loud —`run_gate_results` records it and
  `agent-tests-evaluate.ts` fails an eval where every gate skipped.
- **`applies: false` is a comfortable answer.** A checker that cannot find the
  config gets a clean pass edge for it. Watch the skip rate on the first eval
  after this lands; a fleet that skips more than the old scripts did has traded
  a bad check for no check.
- **A `needs_review` no longer reaches a push.** `deliver()` special-cased
  `fail` and `unavailable` but not `needs_review`, which fell through, logged
  "verification gate passed" and pushed — and stored a null `output_tail`, which
  is why nobody saw it. Both halves are fixed, with the test that would have
  caught it.
- **`agent-tests-check` writes to `project_repos`**, which is a checker with a
  side effect and mildly against the grain of everything else here. It was
  chosen over a fifth dispatch per run: without it, a fresh project parks at its
  first delivery with nothing to verify against.
- **One command per node, run in every repo** — the same limitation the scripts
  had. It will be wrong for the first genuinely mixed-stack multi-repo Task, and
  is marked with a `ponytail:` comment rather than solved.
- **A missing binary is a `fail`, not `unavailable`.** Inside a shell it is exit
  127, a real exit code. Treating every non-zero as "could not check" would
  rebuild the unenforced gate ADR 0020 exists to stop, so the trade is
  deliberate: a checker is told to name only tooling the project already has.
- `packages/shared/src/workflows/index.ts` changed, which is a hard rule
  (AGENTS.md #1). The Owner instructed it explicitly, with the reason recorded
  above. Migration 020 rewrites both `workflows.graph` and
  `workflow_runs.graph_snapshot` — the snapshot too, or a parked run resumes
  into a node with no agent and parks again forever.
