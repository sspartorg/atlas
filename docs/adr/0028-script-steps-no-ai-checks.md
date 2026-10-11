# 0028. Script Steps: the Owner Types the Check, Atlas Runs It

**Date:** 2026-10-11
**Status:** Accepted
**Supersedes:** the checker-agent half of ADR 0024 (who names the command) and the "user types no command" half of ADR 0027 (the Check label). ADR 0020's rule that Atlas runs the verdict and the one-failure rule of ADR 0027 both stand.

## Context

A Check (`gate`) step in a workflow did not run a command the user gave it. A Haiku checker agent read the repo, decided whether the concern applied, and named the command. Atlas then ran that command with no AI and routed on its exit code. This had three costs the Owner could see:

- Every check spent an AI call before any real work, on a decision the Owner could have made once.
- The command could not be pinned. `npm run build` could not be written down; it could only be hoped for.
- A passing run's output lived only in a 4000-character tail in `run_gate_results`. No later agent could open it, so a fixer could only see what the item comment carried.

Verification also had a second, hidden path: `project_repos.verify_command`, one line per repo, run before every push, filled in by a checker. Two places decided "is it green", and the one the Owner could type into was a single line that gated every push in the repo.

## Decision

A **Script** step (`script`) replaces the Check step.

- The Owner types the command on the step. It can be multi-line (up to 4000 characters). No agent is attached and none is dispatched.
- Atlas runs it in every repo of the Task (`runRepos`), through the existing `runNamedCommand` runner: allowlist environment, secret redaction, 0600 tmpfile, verdicts `pass | fail | skipped | needs_review | unavailable`.
- Exit 0 takes the pass edge. Any other exit takes the fail edge, which the fixer is dispatched on. Timeouts and spawn failures park, as before. A step saved with **no command parks**; it never passes silently.
- The full redacted output of every run is written to `.atlas/checks/<step>[-<repo>].log`, replacing the previous run's file. `.atlas/checks/index.md` gets one line per run, so a loop reads top to bottom. The item comment carries only the tail, and it names the log path. A fixer reads the log on demand rather than having it pasted into its prompt.
- Passing output is now redacted before it is stored. It was returned raw before, so a passing command that printed a secret would have written it into the log.
- `project_repos.verify_command` is removed, with its Setup-tab field and its pre-push gate in `deliver()`. Verification is the workflow's Script steps. **A workflow with no Script step pushes what its agents reported.** Templates ship the Lint, Build and Tests steps empty, so a new project has to type its commands before a run can verify anything.
- The four checker agents (`agent-hygiene-check`, `agent-tests-check`, `agent-perf-check`, `agent-visual-check`) leave the catalog. The fixers and reviewers stay, and they read `.atlas/checks/` instead of a pasted command.
- Migration 006 rewrites every saved `gate` node in `workflows.graph` and `workflow_runs.graph_snapshot` to a `script` node with an empty command, keeping its label and edges. In-flight runs reaching one park with "has no command", which is the honest state. Old bundles are upgraded the same way on import.
- `run_gate_results` gains `log_path`. `script_id` keeps its column name and now holds the step's node id.

## Consequences

- Each Script step costs no AI call to run. A red one costs one fixer and one reviewer, as before, and the fixer reads the log instead of a tail.
- The run page shows the step's name and the path of its full output.
- `delivery` (`version: 3`, Lint → Build → Tests with fail edges to fixers, perf and visual dropped from the starter) and `quick` (`version: 3`, Tests) move to the new shape so pulled copies get it.
- The Owner has one more step to fill in per project. That is the point.
- Lost safety: the pre-push verify gate was the one place a repo could not be pushed red without any workflow change. A workflow without Script steps now pushes unverified. The Owner accepted this on the plan.
- Multi-repo Tasks run one command in every repo. A mixed-stack Task that needs a different command per repo has to split into two Script steps or wait for a per-repo command. This is the same limit the shared gate command had before.
