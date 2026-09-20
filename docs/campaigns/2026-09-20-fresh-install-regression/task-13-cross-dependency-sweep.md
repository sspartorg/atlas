# 13 — Cross-dependency sweep: the twelve chains

**Status:** todo
**Depends on:** [task-12](task-12-walk-wave-e-read-surfaces.md)
**Scope:** api · web

## Why

A page-by-page walk cannot catch a chain. Everything in waves A–E asked "does
this page do what it claims"; this task asks "does the thing this page starts
actually finish, somewhere else". Repo → worktree, run end → PR → item, cancel
semantics, project purge, the Jira echo loop — all of them cross a page
boundary, and several cross onto disk or into a remote repo.

It runs last among the verification tasks because most chains need the
fixture that tasks 5–7 built and waves A–E left intact.

## What to do

Execute [`checklists/cross-cutting.md`](checklists/cross-cutting.md) in order,
**X-1 through X-12**. Each entry names its trigger, expected effect, where to
observe it, and the file that implements it — a failure is a finding with a
`file:line`, not a shrug.

Same logging discipline as the walks: log, do not fix (ruling D-9).

## The chains that need fixture built for them

Most chains run against what already exists. Four do not:

1. **X-6 project purge** was deferred from
   [task-08](task-08-walk-wave-a-projects-repos.md) because a purge would
   destroy the fixture. Build a disposable project here: clone one of the
   throwaway repos a second time under a different project name and prefix,
   then purge it. Additionally, connect a repo from a path **outside**
   `settings.workspace_path` and confirm purge **refuses** it with
   "Kept repo folder …" — that guard is the only thing standing between a
   purge and an arbitrary `rm -rf`.

2. **X-5 repo delete during a live run** needs a run in flight. Start one on a
   disposable Task, then attempt the delete, expect 409, stop the run, retry,
   expect success plus `repo_ids` cleaned on every affected item.

3. **X-7 credential delete** needs a throwaway credential attached to a
   throwaway repo — never the `sspartorg (gh)` row the rest of the campaign
   depends on.

4. **X-8 Jira** needs a reachable Jira site, a scoped JQL and a label. Keep the
   JQL narrow enough that it can only match issues created for this test; a
   broad JQL imports a team's real backlog into Atlas as Tasks. If no Jira site
   is available, mark X-8 `blocked — no Jira site` on the board rather than
   skipping it silently.

## Order matters

Run X-1 → X-3 before the destructive chains. X-4 (cancel) leaves items in
`waiting_for_info`; X-5 and X-6 delete things. Finishing the constructive
chains first means a failure in one of them is diagnosed against an intact
fixture.

X-9's standalone guard was already proved in
[task-10](task-10-walk-wave-c-terminals-agents.md) against
`/tmp/standalone-canary`. Re-assert it here only if that canary was deleted.

## Done when

- [ ] All twelve chains are executed in order, and every checkbox in
      `checklists/cross-cutting.md` is either ticked with evidence or
      converted to an `F-NNN` row
- [ ] **X-1:** a two-repo Task produced a `ws/` workspace, a single-repo Task
      did not — paste both `worktree_path` values
- [ ] **X-2:** project-tier secret beat global; unknown key produced
      `setup_failed` with no CLI spawn
- [ ] **X-3:** two PRs under one Task, cross-linked, `items.pr_url` set to the
      first; worktree survived a deliberately failed delivery
- [ ] **X-4:** cancelling a child cancelled the parent; work was pushed; no PR
- [ ] **X-5:** 409 during a live run; `repo_ids` cleaned after; folder kept
- [ ] **X-6:** purge deleted inside the workspace and **refused** outside it —
      paste the "Kept repo folder" line
- [ ] **X-7:** re-clone after credential delete gave the documented message,
      not a 500, and leaked no token
- [ ] **X-8:** executed against a narrowly scoped JQL, or marked
      `blocked — no Jira site` with the board row updated
- [ ] **X-9:** the standalone canary folder is intact
- [ ] **X-10:** no component carries its own status list; 409 surfaces visibly
- [ ] **X-11:** every SSE stream rendered live and redacted its tokens
- [ ] **X-12:** an `item_ready` Task dispatched within ~1 min;
      `max_parallel_runs` held; a blocked dependency did not dispatch
- [ ] Every disposable artifact created by this task is cleaned up, and the
      original fixture is intact

## Evidence

*(filled during execution)*
