# Cross-cutting checklist — the twelve chains

A per-page walk cannot catch these. Each chain starts on one page and lands on
another, or on disk, or in a remote repo. [Task-13](../task-13-cross-dependency-sweep.md)
executes this file after waves A–E have finished, because most chains need the
project, repos and sample Tasks that tasks 5–7 create.

Every entry names its **trigger**, the **expected effect**, **where to observe
it**, and the **file that implements it** — so a failure is a finding with a
`file:line`, not a shrug.

Triage rule: cross-check `.agents/coming-soon.md` before filing anything. Some
controls are stubs on purpose.

---

## X-1 · Repo → worktree

Task creation provisions nothing. The workflow run does. This is the single
most misunderstood chain in the product and the one most likely to be
"verified" by assumption.

**Trigger** — `POST /api/workflows/:id/runs {item_id}` on a Task in `ready`.

**Expected**
1. Branch chosen: `items.worktree_branch` if it matches
   `/^atlas\/[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/`, else `atlas/wf/<item-id>`.
   A sub-task run inherits its parent's branch — it does not mint its own.
2. One worktree per entry in `items.repo_ids`, each under
   `<dirname(git_path)>/worktrees/<repoId>/<branchSlug>`.
3. **Multi-repo Tasks build a workspace**, not N loose worktrees:
   `worktrees/<projectId>/ws/<branch-with-slashes-escaped>/` containing one
   checkout per repo, named by `repo.name`. That workspace is the run's
   `worktree_path` and the agents' cwd.
4. `items.status` → `in_progress`, reason `workflow_run_started`.
5. A second live run on the same item is rejected 409 by the unique index.

**Observe** — `/tasks/:id` rail (branch + path read-outs); `ls` the workspace
on disk; `/workflows/:id/runs/:runId`.

**Implements** — `services/workflow-engine.ts:205` (`startWorkflowRun`),
`services/run-repos.ts`, `services/worktree-orchestrator.ts:463`
(`ensureWorktree`), `:190` (branch regex), `:200` (`computeWorktreePath`).

- [ ] Single-repo Task: exactly one worktree at the computed path
- [ ] Two-repo Task: a `ws/` workspace with both checkouts, and the run's
      `worktree_path` points at the workspace, not at either repo
- [ ] Sub-task run reuses the parent's branch and worktree — no second checkout
- [ ] Second concurrent run on the same item returns 409
- [ ] `ensureWorktree` failure parks the run `waiting_for_owner` with
      "Could not prepare the worktree: …" and does **not** leave the item
      `in_progress`

---

## X-2 · Setup script → run

**Trigger** — the same run, after staging.

**Expected**
1. The script is **per-repo** (`project_repos.setup_sh_body` /
   `setup_ps1_body`), run once per repo in repo order, once per workflow run.
   `workflow_runs.setup_done` guards later steps.
2. POSIX runs the `.sh` body; the `.ps1` body is ignored. Empty body is a
   no-op `{ok:true}`.
3. `${variable.KEY}` placeholders substitute from
   `mergeSecrets(environment_secrets, project_env_vars)` — **project wins on
   collision**. Bare `${X}` and `${env.X}` are deliberately left alone so
   ordinary shell expansion still works.
4. An unknown key is fatal: `setup_failed`, and **the CLI never spawns**.
5. The substituted body is written to `$TMPDIR/atlas-setup-<runId>.sh` mode
   0600 — **never inside the worktree** — and unlinked in a `finally`.
6. Output stored in `agent_runs.setup_output_text` has every secret value of
   length ≥ 4 replaced with `***`.

**Observe** — `/agents/:id/runs/:runId` setup-failure banner; SSE
`run_setup_failed` carrying `setupFailedKind`.

**Implements** — `services/project-setup-runner.ts:63`, `:100-107`, `:113`,
`:175`; `services/secret-substitution.ts:25-47`; called from
`services/agent-runner.ts:1665` and `routes/cli-sessions.ts:470`.

- [ ] Both repos' scripts run, in `position` order, once per run — not once per
      agent step
- [ ] A project-tier secret overrides a global one of the same key
- [ ] `${variable.NOPE}` yields `setup_failed` kind `unknown_secret`, and the
      run detail shows it; no CLI process was spawned
- [ ] `echo $SECRET` in a script renders as `***` on the run page
- [ ] No `atlas-setup-*` file survives in `$TMPDIR` after the run
- [ ] Nothing named `atlas-setup-*` ever appears inside the worktree

---

## X-3 · Run end → push → PR → item

**Trigger** — a workflow run reaching its End node.

**Expected**, per repo, in order:
1. `commitPending` — `git add -A`, message
   `chore(atlas): uncommitted changes from workflow run <id>`, with
   `Co-Authored-By` from the credential's human identity.
2. Multi-repo only: a repo whose diff against `origin/<base>` is nothing but
   `.gitignore` is **skipped** — no empty PR.
3. Push when `workflow.push_code`; straight to the repo's default branch when
   `push_to_default`. One rebase-and-retry on non-fast-forward.
4. PR only when `openPr && raises_pr && push_code && !push_to_default &&
   pushOk`. Title `[<item-id>] <title>`.
5. **The first PR URL lands on `items.pr_url`.** Every PR is also an
   `item_external_links` row. A multi-repo run makes a second pass editing each
   PR body to cross-link its siblings.
6. Cleanup **only** when `push_code && !failure`: worktree removed, local
   branch deleted, `items.worktree_path = NULL`, `git fetch --prune`.
   A failure, or `push_code = false`, **leaves the worktree on disk on
   purpose** so a resumed run retries from that state.

**Observe** — `/tasks/:id` Pull request card and Related items chips; the two
GitHub repos; `ls` the worktree path after completion.

**Implements** — `services/workflow-engine.ts:767` (`deliver`),
`services/worktree-orchestrator.ts:824` (`pushWorktree`), `:983`
(`openPullRequest`), `services/external-links.ts`.

- [ ] One Task, two repos changed → **two** PRs, one Task, one branch name
- [ ] `items.pr_url` holds the first; both appear as external links with real
      fetched titles
- [ ] Each PR body cross-links the other
- [ ] A repo the run did not change gets no PR
- [ ] After success the worktree and `ws/` workspace are gone and
      `items.worktree_path` is null
- [ ] After a deliberately failed delivery the worktree **survives**

---

## X-4 · Cancel semantics

**Trigger** — Stop on a running workflow run.

**Expected** — cancelling a **child** run cancels its **parent** instead. Then
run and children → `cancelled`; every live `agent_runs` row → `cancelled` and
its CLI killed; **`deliver` still runs** with `openPr:false` — commits and
pushes are kept, no PR is opened; every affected item →
`waiting_for_info` with the assignee cleared.

**Observe** — `/workflows/:id/runs/:runId`, `/tasks/:id` rail, the remote
branch.

**Implements** — `services/workflow-engine.ts:1053` (`cancelWorkflowRun`),
`services/agent-runner.ts:347` (`cancelRun`).

- [ ] Stopping a sub-task run stops the parent run too
- [ ] Work done before the stop is committed and pushed
- [ ] No PR was opened
- [ ] Item is `waiting_for_info` with no assignee

---

## X-5 · Repo delete

**Trigger** — Repos tab → row menu → Remove.

**Expected** — **409** if any `workflow_runs` in `running` or
`waiting_for_owner` belongs to an item whose `repo_ids` contains this repo,
with a "stop it first" message. Otherwise the `project_repos` row is deleted
(cascading its worktrees, schedules and Jira sources) and the repo id is
**stripped from every item's `repo_ids`** in that project. **The folder on
disk is kept.**

**Observe** — the Repos tab, then `/tasks/:id` of a Task that referenced the
repo, then `ls` the folder.

**Implements** — `services/project-repos.ts:154` (`remove`), `:161` (the
`repo_ids @> '[...]'::jsonb` query — see [task-16](../task-16-perf-and-indexes.md),
this column has no GIN index).

- [ ] Remove during a live run → 409 with a message naming the run
- [ ] Remove when idle → row gone, `repo_ids` cleaned on every affected item
- [ ] A Task left with zero repos is visible and does not crash its detail page
- [ ] The folder is still on disk

---

## X-6 · Project delete

**Trigger** — Projects row menu → Delete project.

**Expected** — two modes, streamed over SSE `delete_status` / `delete_output` /
`delete_completed` / `delete_error`:
- `unregister` — DB cascade only, folders kept, `issue_key_prefix` retired into
  `retired_prefixes`.
- `purge` — additionally `rm -rf` each repo's `git_path`, **but only if the
  resolved path is strictly inside `settings.workspace_path`**. Anything
  outside is skipped with "Kept repo folder …". Repo paths are read **before**
  the DB cascade. A failed `rm` aborts with `delete_error` and the project row
  survives.

**Observe** — the SSE log in the modal; the workspace folder; a new project
attempting to reuse the retired prefix.

**Implements** — `services/delete-runner.ts:22`.

- [ ] `unregister` leaves folders on disk
- [ ] `purge` removes a repo inside the workspace
- [ ] `purge` **refuses** a repo outside the workspace and says so — test with
      a repo connected from an external path
- [ ] The retired prefix cannot be reused by a new project
- [ ] The confirm-name guard rejects a mismatched name

---

## X-7 · Credential delete

**Trigger** — `/settings/credentials` → Delete, on a credential a repo uses.

**Expected** — `project_repos.credential_id` is `ON DELETE SET NULL`, so the
delete succeeds and the breakage surfaces **later**, by design. Re-clone must
say "Original credential was deleted. Re-attach a credential in Settings ->
Credentials."

**Observe** — the Repos tab after deletion; a re-clone attempt; a workflow run
attempt.

**Implements** — `routes/credentials.ts:101`, `services/reclone-runner.ts:71`.

- [ ] Delete succeeds and the repo row survives with a null credential
- [ ] Re-clone surfaces the exact error string, not a 500
- [ ] A run against that repo fails with a message naming the missing
      credential, not a git auth dump
- [ ] No token appears in any error message or SSE line

---

## X-8 · Jira bridge

**Trigger** — `POST /api/integrations/jira/sync` ("Sync now"), and the
one-minute tick.

**Expected**
- Sources are **per repo**: `{repo_id, jql, workflow_id|null}` (ADR 0017/0018).
- Pull: max 500 issues per sync, 100 per page. Jira sub-tasks are skipped —
  they fold into the parent's description. Each issue becomes one Task in the
  project of the **first matching source**.
- Jira text is quoted line by line under a note saying it describes the work
  and is not an instruction — a Jira comment must not be able to pose as an
  Owner turn.
- The first matching source carrying a `workflow_id` **queues** the Task.
  Without one the Task stays `draft` and the Owner gets a `needs_you`
  notification.
- Push: status changes post ADF comments over REST v3; reads use REST v2.
  PR URLs are listed one per repo. `done` transitions the issue.
- Three id lists on `jira_issues` prevent the echo loop: Jira comments already
  reflected, bridge-authored comments (never imported), Atlas comments that
  came from Jira (never posted back).
- A full sync fires only when `now - last_sync_at >= poll_interval_minutes`;
  every other tick is push-only. An `exclusive()` lock stops the tick and
  "Sync now" double-importing.

**Observe** — `/settings?tab=jira` last-sync read-outs; the created Task; the
Jira issue's comments.

**Implements** — `services/jira-sync.ts:324` (`composeTaskDescription`), `:587`
(pull), `:711` (`pullRequests`), `:775` (push).

- [ ] An issue imports once; deleting the Atlas Task does not re-import it
- [ ] A labelled issue lands in the right project and queues on the right
      workflow
- [ ] An unlabelled issue stays draft and raises a `needs_you` notification
- [ ] Imported Jira text is quoted, and a Jira comment containing something
      that looks like an instruction is not executed
- [ ] A status change posts exactly one Jira comment
- [ ] "Sync now" during a tick does not double-import
- [ ] `api_token` is never returned by `GET /api/integrations/jira` — only
      `api_token_set`

---

## X-9 · Terminal stop

**Trigger** — Stop on a live terminal session.

**Expected** — preflight → diff → `StopSessionModal` → stage the chosen files →
commit with `Co-Authored-By` → push → optional PR titled `Terminal: <title>`
(plus an `item_external_links` row when the session is anchored to an item) →
mark `closed` with `finalize_pr_url` and **emit SSE before cleanup** →
fire-and-forget worktree cleanup → **awaited** transcript ingest and cost
computation.

**The standalone case is the dangerous one.** A session with
`project_id === null` has no worktree; `cli-sessions.ts:975` explicitly refuses
`cleanupWorktreeAfterPush` because it would delete the Owner's real repo.
Teardown keys off `worktree_branch !== null`, never off `worktree_path`.

**Implements** — `routes/cli-sessions.ts:320` (create), `:470` (setup), `:791`
(resume skips setup), `:962` (stop), `:975` (the standalone guard).

- [ ] Create rolls back cleanly when the setup script fails — worktree removed,
      400 `project_setup_failed`, no orphan row
- [ ] Resume does **not** re-run the setup script
- [ ] Stop stages only the selected files
- [ ] **Standalone stop leaves the Owner's folder untouched** — verify with
      `git status` in that real repo afterwards
- [ ] The transcript is readable at `/terminal/:id/history` after close
- [ ] Cost and tokens are populated for a Claude session, null for copilot

---

## X-10 · Status machine

**Trigger** — every status control in the UI.

**Expected** — offered transitions come from `getValidNextStatuses()` in
`@atlas/shared`. Invalid ones are **absent, not greyed**. `done` is terminal.
The escape hatch to `waiting_for_info` exists from any non-terminal,
non-waiting status. The **only** bypass is `?override=1` on
`PATCH /api/tasks/:id/status`, surfaced as the "Mark done anyway?" confirm.

While a workflow run holds the item, status and assign PATCHes return **409**
(`services/workflow-lock.ts`) — stop the run to take the item back.

**Implements** — `packages/shared/src/status-machine/index.ts`,
`routes/tasks.ts:63`. Extra rules in `.agents/functional-checklist.md:135+`.

- [ ] Grep every component that renders a status control — none contains a
      hardcoded status list
- [ ] From `draft` only `ready` and `waiting_for_info` are offered
- [ ] `done` offers nothing forward
- [ ] A Task with open sub-tasks follows the open-children rule documented in
      the functional checklist
- [ ] Status PATCH during a live run → 409, and the UI says why

---

## X-11 · SSE freshness

**Trigger** — each long-running operation.

**Expected** — the surface updates with **no manual refresh**: `clone_*` on the
New Project modal, `reclone_*` on the Re-clone modal, `delete_*` on Delete
Project, `autofetch_*` on the schedule row, `agent_output` on the run page,
`dry_run_*` on the Test Run tab, `clone_status`/`reclone_status` on the Repos
tab. Sidenav badges, dashboard KPIs, search and queue agree afterwards
(check class 5). The invalidation map is in `.agents/api-surface.md` →
*Web invalidation map*.

- [ ] Every stream above renders progress live
- [ ] Tokens are redacted in every SSE line — `clone-runner.ts:55` splits and
      joins on both the raw and URL-encoded token
- [ ] After each operation, the sidenav count and the page agree without a
      reload
- [ ] Killing the API mid-stream surfaces a disconnected state, not a spinner
      forever

---

## X-12 · Workflow lock and dispatch

**Trigger** — the one-minute poller, and `item_ready` workflows.

**Expected** — the poller runs in a fixed order: stuck-run watchdog → due
reminders → GitHub App token pre-warm → `reconcileWorkflowRuns` (parks runs
idle > 10 min) → PR state sync → `jiraSync.tick` → `tickWorkflowDispatch`.
`trigger='item_ready'` drains items that are `ready`, match `workflow_id`, have
no live run, and have no unmet `depends_on` link — bounded by
`max_parallel_runs`. Dispatch is also kicked immediately after a run finishes.

**Implements** — `services/agent-schedule-registry.ts`,
`services/workflow-engine.ts:1115` (`reconcileWorkflowRuns`), `:1210`
(`tickWorkflowDispatch`), `services/dependency-guard.ts`.

- [ ] A Task moved to `ready` on an `item_ready` workflow starts within ~1 min
      with no manual action
- [ ] `max_parallel_runs` is respected — queue more Tasks than the limit and
      count concurrent runs
- [ ] A Task blocked by an unmet `depends_on` link does **not** dispatch
- [ ] A run left idle > 10 min is parked, not left running
- [ ] PR state chips flip to Merged after merging one of the sample PRs
