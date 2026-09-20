# 07 — Run three graded sample Tasks: small, medium, large

**Status:** todo
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

*(filled during execution)*

S decomposition: ____ sub-tasks — judgement: ____
M decomposition: ____ sub-tasks — judgement: ____
L decomposition: ____ sub-tasks — judgement: ____
