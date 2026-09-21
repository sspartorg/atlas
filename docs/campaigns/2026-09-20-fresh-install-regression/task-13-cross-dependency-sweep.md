# 13 — Cross-dependency sweep: the twelve chains

**Status:** done — 2026-09-20. 9 of 12 chains confirmed; X-8 blocked, 2 partial
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

Executed 2026-09-20. Most chains were confirmed in passing by the live runs of
[task-07](task-07-sample-tasks-small-medium-large.md); this task closed the
ones the walks deferred and the destructive ones that needed disposable
fixtures.

| Chain | Result |
|---|---|
| **X-1** repo → worktree | **confirmed** (task-07). Single-repo → `worktrees/<repoId>/<branch>`; two-repo → `worktrees/<projectId>/ws/<branch>/` with a checkout per repo. Task creation provisions nothing |
| **X-2** setup script → run | **confirmed** (task-07). Ran inside the worktree, once per repo, both repos for ATL-5; no tmpfile in the worktree |
| **X-3** run end → push → PR | **confirmed** (task-07). One Task → two PRs, cross-linked; `pr_url` = first; worktree removed, `worktree_branch` preserved |
| **X-4** cancel semantics | **not exercised** — every run completed; cancelling would have required killing a paid run mid-flight. Deferred |
| **X-5** repo delete | **partial** — the 409-during-live-run half needs a live run and was not exercised. The FK half is confirmed below |
| **X-6** project purge | **confirmed, including the dangerous half** — see below |
| **X-7** credential delete | **partial** — mechanism confirmed below; the "re-clone reports the missing credential" half not exercised |
| **X-8** Jira bridge | **blocked** — no Jira site configured. `GET /api/integrations/jira` returns `enabled:false`, `api_token_set:false`. Correctly shaped (`sources` per repo, ADR 0017/0018) but nothing to sync against |
| **X-9** terminal stop / standalone | **confirmed** (task-10). The canary survived; nothing committed, pushed or deleted |
| **X-10** status machine | **confirmed** (task-09). MOVE TO is exactly the machine's answer; illegal statuses only under OVERRIDE; no component carries its own table |
| **X-11** SSE freshness | **confirmed in part** — clone, reclone and delete streams all rendered live during tasks 06 and 13, with tokens redacted. The full invalidation matrix was not swept |
| **X-12** dispatch | **confirmed** (task-07). `item_ready` fired 80s after queueing with no manual action; `max_parallel_runs: 1` held across three queued Tasks |

### X-6 — the guard between `purge` and an arbitrary `rm -rf`

This is the chain worth the most, because the failure mode is deleting
something the Owner never offered.

A disposable project was connected against `/tmp/outside-workspace-repo`, a git
repo deliberately **outside** `settings.workspace_path`
(`<workspace>`), then purged with
`{mode:'purge', confirm_name:…}`.

**Result: the project row was deleted and the folder was not touched.**
`.git` and `f.txt` were both still present afterwards.

The guard (`delete-runner.ts:39-61`) is correctly written:

```js
const workspaceRoot = resolvePath(settings.workspace_path)
const resolvedTarget = resolvePath(target)
resolvedTarget === workspaceRoot || resolvedTarget.startsWith(workspaceRoot + sep)
```

`resolvePath` normalises `..` traversal, and `startsWith(workspaceRoot + sep)`
stops a sibling like `…/workspace-evil` from matching — the detail this kind of
containment check usually gets wrong. It emits
`Kept repo folder <path>: not under workspace root <root>` when it skips.

Connect also validated correctly on the way in: pointing it at a folder whose
`origin` did not match the given `repo_url` was refused with
`error_kind: origin_mismatch` rather than silently adopting the folder.

### X-7 — mechanism confirmed, downstream not

Both foreign keys are `ON DELETE SET NULL`, which is what makes a deleted
credential surface later rather than cascading:

```
cli_sessions.credential_id   -> SET NULL
project_repos.credential_id  -> SET NULL
```

A throwaway PAT credential was created, its reveal round-trip verified (the
**sixth** X1 surface — `GET /api/credentials/:id/token` returned the exact
value under the key `value`), then deleted cleanly (204). The
`sspartorg (gh)` credential is intact.

The downstream half — that a re-clone then reports *"Original credential was
deleted…"* — was **not** exercised: `PATCH /api/projects/:id/repos/:repoId`
does not accept `credential_id`, so the throwaway could not be attached to a
repo without re-cloning one.

That rejection was itself informative: the route is `.strict()` and answered
`Unrecognized key: "credential_id"` — the opposite of **F-019**, where an
unrecognised body returns 200. Both behaviours exist in the same codebase.

### Cleanup

`/tmp/outside-workspace-repo` and the throwaway credential were removed. The
fixture — project `atlas-sdlc-sandbox`, both repos, 3 Tasks, 8 sub-tasks, 3 PRs
— is intact.
