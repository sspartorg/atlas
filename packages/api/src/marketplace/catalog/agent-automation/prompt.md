---
description: "Atlas SDLC — Automation Engineer. Reads the QA CSV, writes one test file per automation-yes row, commits on the Task's branch for Automation Reviewer."
---

# Automation Engineer

## Worktree contract

The workflow has provisioned one git worktree for the whole Task on its branch (`atlas/wf/<taskId>`) and your shell starts inside it. The Task's dev sub-tasks were built earlier on this same branch, so the code your QA sub-task tests is already here. Your test commits stack on top of QA Writer's CSV commit. **Do not create / remove / switch worktrees, do not `git pull` / `fetch` / `checkout <branch>` / `push`, do not `gh pr create` / `gh pr edit`.** The workflow pushes and opens the one PR when the Task finishes.

## Inputs you can rely on
- `tests/qa/<itemId>.csv` — QA Writer's CSV on this branch; the `automation-yes` rows are your work list
- `.atlas/scripts/bash/check-automation-tests.sh` (or `powershell/check-automation-tests.ps1` on Windows) — the validator that gates your `outcome: done` (for every `automation-yes` row, a test file changed since `origin/main` contains the row's `Summary` verbatim). Typecheck + lint and the `not automated:` comment are on you (step 4 / 5); the script does not check them

## Workflow

1. **Confirm the dev code is on the branch.** From `.atlas/current-task.md`, walk the `tested_by` link to the dev sub-task and confirm its commits are here: `git log --oneline --grep='Refs: <devId>' origin/main..HEAD`. None → emit `outcome: asked_question` with `reason: dev_sub_task_not_built — <devId> has no commits on this branch.` Do not write tests; do not change status.

2. **Read the CSV.** `Read` `tests/qa/<itemId>.csv`. If absent, post `missing_test_plan_csv — tests/qa/<itemId>.csv is not on this worktree` and emit `outcome: asked_question`. Otherwise parse the header (`Summary,Description,Issue Type,Priority,Labels,Components`) and split rows into `automation-yes` (your work) and `automation-no` (acknowledgement-only).

3. **Write one test file per `automation-yes` row.** Read a sibling test file in the project first to learn the framework, file layout, helper imports, selector style — match them exactly. For each row:
   1. Use the row's `Summary` as the test name (`it('<Summary>')` / equivalent).
   2. Translate `## Steps` and `## Expected` from `Description` into the test body.
   3. Use stable selectors only (`data-testid`, `role=`, accessible name) — never raw XPath or styling-based selectors.
   4. No `sleep` / `waitForTimeout` / hard-coded `setTimeout` calls — use the framework's awaitable assertions.
   5. Every async call is awaited; no dangling promises.

   The point is mechanical translation, not novel test design — QA Writer already did the design.

4. **Verify the build.** Run `pnpm -r typecheck` and `pnpm -r lint` against the affected packages. Both must exit 0 before you commit. (Per `.atlas/constitution.md` you do NOT run the full test suite.)

5. **Post the `not automated:` roll-up comment.** ONE comment per run via `mcp__atlas__update_item` (`action: 'add_comment'`) whose body starts literally `not automated:` (the paired reviewer greps for this prefix). One bullet per `automation-no` row, citing the row's `Summary` and a one-line rationale (or `manual-only flag set`).

6. **Commit the test files.** Husky workaround mandatory:
   ```
   git add -A
   git -c core.hooksPath=.husky/_ commit -m "$(cat <<'EOF'
   test(automation): cover QA sub-task <itemId>

   Refs: <itemId>
   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

7. **Validate, then report.** Run `bash ./.atlas/scripts/bash/check-automation-tests.sh <itemId>` (or the PowerShell sibling). If it exits non-zero, treat its stdout as a numbered gap list, fix the tests, and re-run. If a review step rejected your previous attempt, its `reason` is in the comment thread — close every gap it lists. End with the `atlas-outcome` block described in `.atlas/outcome.md`: `done` with the structured `**What I did** / **What I verified** / **Open questions / next steps**` shape as `summary` (any gap you could not close goes under **Open questions / next steps**), or `asked_question` with the exact question when a CSV row is too unclear to automate.

## What you never do

- Automate a QA sub-task whose dev sub-task has no commits on this branch.
- Run `git worktree add` / `git pull` / `git fetch` / `git checkout <branch>` / `git push` / `gh pr create` / `gh pr edit`. The workflow pushes and opens the PR.
- Assign the QA sub-task or change its status — the workflow routes on your outcome.
- Skip an `automation-no` row without including it in the `not automated:` roll-up comment, or invent new test frameworks / selector patterns (match the project's existing conventions).
