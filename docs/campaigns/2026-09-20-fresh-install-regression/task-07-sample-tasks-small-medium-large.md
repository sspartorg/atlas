# 07 — Run three graded sample Tasks: small, medium, large

**Status:** done — 2026-09-20. All three delivered; two P1 findings from L
**Depends on:** [task-06](task-06-project-two-repos-setup-secrets.md)
**Scope:** infra

## Why

The Owner wants to see how well Atlas decomposes work into sub-tasks and
carries it through. Three sizes, graded deliberately, so a failure is
attributable: if the small one fails the orchestration is broken; if only the
large one fails, the multi-repo path is.

The large task **must** span both repos (ruling D-8). Otherwise the `ws/`
workspace, the per-repo setup loop, and one-Task-many-PRs all go untested —
and those are the newest and least-exercised paths in the product
(ADR 0017, ADR 0018).

## The graded set

> **Reworked 2026-09-20.** The original set was written against
> `atlas-demo-api` / `atlas-demo-web` and a shared `src/contract.ts`, none of
> which exist — ruling D-2 was amended to reuse the sandbox pair instead
> ([task-05](task-05-seed-throwaway-repos.md)). The set below is grounded in
> what those two repos actually contain.

The pair is already a matched design. `atlas-sdlc-sandbox` is a todo CLI
(`src/todo.js`, `src/cli.js`); `atlas-sdlc-sandbox-web` describes itself as a
*"Tiny web view of the atlas-sdlc-sandbox todo list, used to test multi-repo
Atlas Tasks"* and mirrors the CLI's model in `src/todos.js` with the same
priority ordering.

That mirroring is where the large task lives: the CLI's `list` supports
`{ all, overdue, tag }`, but the web's `visibleTodos` supports only
`{ all, tag }`. The `overdue` filter is a real, natural gap across the two
repos.

### S — one repo, one file
> **Add a `--version` flag to the todo CLI.** Print the `version` field from
> package.json and exit 0. `src/cli.js` plus one test.

`repo_ids = [atlas-sdlc-sandbox]`. One worktree. Expect few or no sub-tasks —
a workflow that shreds this into six steps is over-decomposing, which is itself
worth recording.

### M — one repo, several files, real tests
> **Add a `todo stats` command.** Counts of open / done / overdue, broken down
> by priority, reusing the existing `localToday` overdue rule rather than
> re-deriving it. `src/todo.js` + `src/cli.js` + tests.

`repo_ids = [atlas-sdlc-sandbox]`. Exercises the Sub-tasks steps of the
`delivery` template running `build` and `test` one at a time on the Task's
branch.

### L — both repos, one behaviour
> **Bring the web view's filtering up to parity with the CLI.** The web's
> `visibleTodos` gains an `overdue` option matching the CLI's semantics
> (local-calendar date, not UTC — `todo.js` has a comment explaining why), the
> render layer shows an overdue badge, and the CLI's overdue predicate is
> factored so both repos agree rather than drifting.

`repo_ids = [atlas-sdlc-sandbox, atlas-sdlc-sandbox-web]`. **This is the one
that matters** — it forces the `ws/` workspace, the per-repo setup loop, and
one Task producing two PRs.

## What to do

1. **Create S through the UI** at `/tasks/new`. Note the repo picker
   (`components/RepoSelect.tsx`) — a multi-repo project requires an explicit
   pick; it does not silently default. Save as draft first, confirm the draft
   guard prompts on navigate-away, then submit to `ready`.

2. **Confirm that creating the Task provisioned nothing.** No worktree, no
   branch, no setup run. `items.worktree_path` is null. This is the chain most
   often assumed rather than checked — see
   [X-1](checklists/cross-cutting.md#x-1--repo--worktree).

3. **Queue S on the `delivery` workflow and start the run.** Watch the chain:
   branch chosen → worktree → `.atlas` staged → setup script → CLI spawn.
   Record wall-clock for each stage; the setup script has a 5-minute budget
   (`ATLAS_SETUP_TIMEOUT_MS`).

4. **Record the decomposition.** How many sub-tasks did the workflow create,
   what were they, and did they run one at a time on the Task's branch? Judge
   it: under-decomposed (one giant step) and over-decomposed (ceremony around a
   one-line change) are both findings, filed as P3 with the sub-task list as
   evidence.

5. **Let S deliver.** Expect one branch, one PR, title `[ATL-1] …`, and
   `items.pr_url` set. Then the worktree is removed and
   `items.worktree_path` nulled — cleanup runs only when
   `push_code && !failure`.

6. **Repeat for M.** Additionally check that the setup script ran **once per
   workflow run**, not once per agent step — `workflow_runs.setup_done` guards
   the later steps.

7. **Run L, and watch the multi-repo specifics.**
   - The run's `worktree_path` points at
     `worktrees/<projectId>/ws/<branch-with-slashes-escaped>/`, **not** at
     either repo's own worktree.
   - That workspace holds one checkout per repo, named by `repo.name`.
   - `.atlas/current-task.md` carries the `repositoriesMarkdown()` block from
     `run-repos.ts` listing both.
   - Both repos' setup scripts ran, in `position` order.
   - On delivery: **two PRs, one Task, one branch name**. The first PR URL
     lands on `items.pr_url`; both appear as `item_external_links` rows with
     real fetched titles; a second pass edits each PR body to cross-link its
     sibling.

8. **Prove the empty-repo skip.** Create a fourth throwaway Task spanning both
   repos but whose work only touches one. The untouched repo's diff against
   `origin/<base>` is nothing but `.gitignore`, and it must be **skipped** —
   no empty PR.

9. **Exercise the lock.** While a run is live, try changing the Task's status
   and assignee from the UI. Both must return **409**
   (`services/workflow-lock.ts`) and the UI must say why, not fail silently.

10. **Merge one PR** and confirm the state chip flips to Merged on the next
    minute tick (`externalLinks.syncReviewedTaskPrs()`).

11. **Keep everything.** These Tasks, runs and PRs are the fixture waves A–E
    walk against. Do not clean up.

## Done when

- [ ] All three Tasks exist with ids `ATL-1`, `ATL-2`, `ATL-3` (or as
      allocated) and the correct `repo_ids`
- [ ] Task creation provisioned no worktree — paste `items.worktree_path` null
      before the run
- [ ] Each run's sub-task decomposition is recorded below, with a judgement
- [ ] S and M each produced exactly one PR
- [ ] **L produced two PRs under one Task and one branch** — paste both URLs
- [ ] L's `worktree_path` is the `ws/` workspace — paste the path and an `ls`
      of it showing both checkouts
- [ ] Both repos' setup scripts ran for L, in order, once per run — paste the
      two `setup_output_text` heads
- [ ] `.atlas/current-task.md` in L's workspace lists both repositories
- [ ] Both L PR bodies cross-link each other
- [ ] The repo untouched by the fourth Task got **no** PR
- [ ] Status and assign PATCHes during a live run return 409 with a visible
      reason
- [ ] After each successful run the worktree is gone and
      `items.worktree_path` is null
- [ ] A merged PR shows a Merged chip within ~1 minute

## Evidence

Executed 2026-09-20.

### S — ATL-1, delivered

**PR:** https://github.com/sspartorg/atlas-sdlc-sandbox/pull/17 · branch
`atlas/wf/ATL-1` · author `app/sspart-bot` · title `[ATL-1] Add a --version
flag to the todo CLI` · body opens with `Requested-By: @sspartorg` and names
the workflow run.

**13 agent runs, all completed:** po-writer ×2 (side of a park/resume),
po-reviewer, architect, architect-reviewer, coder, code-reviewer, qa-writer ×2,
qa-reviewer ×2, automation, automation-reviewer.

**Decomposition: 2 sub-tasks** — ATL-2 (dev) and ATL-3 (`[QA]` suffix, which is
how the Test sub-workflow's `label: "qa"` node selects it). Proportionate for a
one-file change: not shredded into ceremony, not collapsed into one. Each
carried Given/When/Then acceptance criteria written by the PO Writer.

⚠️ **The task was mis-specified by the campaign, not by Atlas.** `--version`
and `-v` **already existed** in `origin/main:src/cli.js:5,9-12`, added by a
previous Atlas run (the existing tests are labelled "SDB-28"). The sandbox repo
was not read closely enough before the task was written.

**The agents handled it well, which is a better signal than a correct task
would have given.** The Coder did not fabricate a change to look busy. It
reviewed the file, confirmed ACs 1, 2 and 4 were already satisfied, identified
that AC3 (`todo add --version` must not print the version) had no coverage, and
added exactly that one test:

> *"Identified that Scenario 3 (AC3) had no test — the three existing "Version
> flag tests (SDB-28)" covered `--version`, `-v`, and the usage string, but not
> subcommand non-interference."*

The one criticism: neither the PO Writer nor the Coder escalated *"this feature
already exists"* back to the Owner. Adding the missing AC3 test is a defensible
reading, but a 13-run delivery chain executed for what amounted to one test
case. Worth knowing as a cost characteristic, not filed as a defect.

### Chains confirmed by this run

| Chain | Evidence |
|---|---|
| **X-1** repo → worktree | Task creation provisioned nothing (`worktree_path` null, rail read *not provisioned*). The run then created branch `atlas/wf/ATL-1` — the `atlas/wf/<item-id>` fallback — and one plain worktree, correctly **not** a `ws/` workspace for a single repo. `current-task.md` carried no Repositories block, the expected single-repo baseline |
| **X-2** setup script | Ran inside the worktree (`.atlas-setup-ran` written), full `.atlas` staging present (constitution, current-task, outcome, self-memory, scripts, templates), no `atlas-setup-*` tmpfile inside the worktree |
| **X-3** run end → push → PR | One branch, one PR, `items.pr_url` set, `worktree_path` nulled, `worktree_branch` **preserved** as `atlas/wf/ATL-1` (step 7c), worktree removed from disk |
| **X-12** dispatch | `item_ready` fired 80s after queueing, with no manual trigger |
| **X3** attribution | Every agent comment carries a real `agent_id` (`agent-po-writer`, `agent-coder`, …), never the literal "Agent" |
| **ADR 0014 escalation** | PO Writer asked three clarifying questions, parked the run (`waiting_for_owner` / item `waiting_for_info`), and resumed to completion on the Owner's reply |
| **ADR 0015 sub-tasks** | Three `workflow_runs`: one parent and two children both carrying `parent_workflow_run_id = 39085d8b`, run one at a time on the Task's branch |
| **Bot identity** | Commit `df04405` — author `sspart-bot[bot] <4332243+sspart-bot[bot]@users.noreply.github.com>`, trailer `Co-Authored-By: sspart`. Closes the check deferred from tasks 04 and 06 |
| **F-010 patch was load-bearing** | `agent-coder` and `agent-code-reviewer` both ran. Had they stayed on the absent `copilot` CLI, the run would have died at the Build step |

**F-011 proven end to end:** the PR's file list includes `.atlas-setup-ran` —
the campaign's own setup-script marker, swept into the Owner's repo by
`commitPending`'s `git add -A` and shipped in the pull request.

### M — ATL-4, delivered

**PR:** https://github.com/sspartorg/atlas-sdlc-sandbox/pull/18 · branch
`atlas/wf/ATL-4` · author `app/sspart-bot`. 13 agent runs, same shape as S.

**Decomposition: 2 sub-tasks** — ATL-6 (dev), ATL-7 (`[QA]`). Consistent with S,
so the workflow's decomposition is stable across sizes rather than scaling with
them.

**This is the run that shows Atlas working properly**, because unlike S there
was real work to do:

```
+482 -3
  src/todo.js                          +22/-0    the stats computation
  src/cli.js                           +12/-2    subcommand wiring
  test/todo.test.js                   +244/-1    20 new tests
  specs/6-add-a-todo-stats-command/…   +91/-0    Architect's spec
  tests/qa/ATL-7.csv                  +113/-0    QA matrix
  .atlas-setup-ran                      +0/-0    F-011 again
```

Verified by checking out the branch and running it:

```
# tests 63   # pass 63   # fail 0        (was 43 before the change)

$ node src/cli.js stats
Todo stats (overdue is a subset of open, not an additional category):
         high  normal  low
open       0       0    0
done       0       0    0
overdue    0       0    0
```

**It honoured all five Owner answers precisely**, including the subtle one —
the header states that overdue is a subset of open so the rows are not misread
as summing to a total, which is what was asked for in answer 2. Empty state is
zeros with exit 0 (answer 5); no `--json` (1); no `--tag` (4).

### L — ATL-5, delivered as TWO PRs

**The multi-repo path works.** One Task, one branch, two pull requests:

| Repo | PR | Diff | Files |
|---|---|---|---|
| `atlas-sdlc-sandbox` | [#19](https://github.com/sspartorg/atlas-sdlc-sandbox/pull/19) | +724/-2 | `src/todo.js`, tests, spec, both QA CSVs |
| `atlas-sdlc-sandbox-web` | [#2](https://github.com/sspartorg/atlas-sdlc-sandbox-web/pull/2) | +329/-3 | `src/todos.js`, `src/render.js`, `src/server.js`, `test/server.test.js` |

Both on branch `atlas/wf/ATL-5`. `items.pr_url` holds the first; both appear as
`item_external_links` rows. **The file split is correct** — web changes landed
in the web repo, the shared predicate and Task-wide artifacts in the first
repo, exactly as `current-task.md` instructed.

**Cross-linking works.** PR #19's body links `atlas-sdlc-sandbox-web/pull/2`;
PR #2's links `atlas-sdlc-sandbox/pull/19`. The second delivery pass that edits
each body ran.

**Decomposition: 4 sub-tasks** (ATL-8..ATL-11) versus 2 for S and M — so the
workflow does scale decomposition with scope, which the first two runs could
not show. 19 agent runs for this Task; 45 across all three.

**The multi-repo workspace is exactly as ADR 0017 documents.** Provisioned at
`worktrees/<projectId>/ws/<branch-escaped>/` — note **projectId** and the `ws/`
segment, where the single-repo runs used `worktrees/<repoId>/<branch>`:

```
worktrees/c4cf4b2b-.../ws/atlas__wf__ATL-5/
  atlas-sdlc-sandbox
  atlas-sdlc-sandbox-web
```

`current-task.md` carries the `repositoriesMarkdown()` block absent from the
single-repo runs, naming both remotes and base branches and telling the agent
that the workspace root is not a git repo, that Task-wide files go in the first
repo, and that Atlas opens one PR per changed repo.

**Both setup scripts ran, one per repo** — `.atlas-setup-ran` is present in
each of the two checkouts. That is the per-repo setup loop of X-2 confirmed.

### ⚠️ Both delivered PRs contain failing tests — F-012 and F-013

This is the campaign's most consequential result so far, and it only surfaced
because the delivered branches were checked out and actually run.

```
                        main (before)      delivered branch
atlas-sdlc-sandbox      43/43 pass         58/59 pass, 1 FAIL
atlas-sdlc-sandbox-web  10/10 pass         34/35 pass, 1 FAIL
```

Both repos are green on `main`, so both failures are regressions shipped by the
delivery.

**The CLI failure (F-013)** is `test/atl11-web.test.js`, which imports the
sibling repo by relative path:

```js
// line 2, the agent's own justification:
// Imports cross-repo via relative path (both repos share the same worktree parent directory).
import { createApp } from '../../atlas-sdlc-sandbox-web/src/server.js';
```

That parent directory is `worktrees/<projectId>/ws/<branch>/`, which teardown
deletes. Outside the run the import throws `ERR_MODULE_NOT_FOUND`. The test can
never pass in CI, in a fresh clone, or after merge.

**The web failure** is a plain assertion — *"Done CSS class still renders on
completed todos after overdue addition"* expects `class="…done…"` and gets
`<li class="empty">Nothing to do.</li>`. Environment-independent: it fails
inside the workspace too.

**Why nothing caught it (F-012).** The reviewers state their own scope:

> QA Reviewer: *"Validator green (**structural checks only**)."*
> Automation Reviewer: *"Ran `node --check test/todo.atl-10.test.js` — syntax
> clean; no typecheck/lint scripts configured."*

`node --check` parses a file without executing it. The review chain verifies
CSV row shape, verbatim test-name matching against the CSV, `tested_by` link
structure, and anti-patterns — a genuinely thorough traceability audit. **It
never runs the test suite.** No node in the Delivery graph does.

That is a systemic gap, not a one-off: any Task whose code is wrong in a way
that only execution reveals will ship green.

### A workflow characteristic worth knowing

The PO Writer brainstormed and **parked for Owner answers on every one of the
three Tasks**. It is designed behaviour and the questions were good ones — five
genuinely scope-changing questions on ATL-4 — but it means no Task reaches a
Coder without one human round-trip. Anyone expecting unattended operation
should know this before they queue a backlog.
