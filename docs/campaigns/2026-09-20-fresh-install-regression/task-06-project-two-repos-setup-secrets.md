# 06 — Create the project, add both repos, setup scripts and secrets

**Status:** done — 2026-09-20
**Depends on:** [task-05](task-05-seed-throwaway-repos.md)
**Scope:** infra

## Why

This builds the fixture every later task walks against, and it settles the
Owner's open question about setup scripts.

**The answer is one script per repo, not one per project.** The bodies live on
`project_repos.setup_sh_body` and `project_repos.setup_ps1_body`
(`packages/shared/src/types/index.ts:313`). There is no project-level column
and therefore no override — a two-repo project has two independent scripts,
run one per repo in `position` order, once per workflow run. The Setup tab
reflects this with a repo picker above the editors.

⚠️ `docs/setup-script-contract.md:31-56` still documents these as
`projects.setup_sh_body`. That document went stale at migration 045 / ADR 0018.
[Task-20](task-20-docs-guide-refresh.md) fixes it; do not follow it here.

## What to do

1. **Create the project with the first repo.** `/projects` → New Project →
   *Clone fresh*: name `atlas-demo`, issue key prefix **`ATL`** (matching
   ruling D-3), repo URL `https://github.com/sspartorg/atlas-demo-api`,
   default branch from task-05, credential `sspartorg (gh)`.
   `POST /api/projects/clone` returns a `clone_id`; progress arrives over SSE
   `clone_*`. Watch the log — the token must be redacted in every line
   (`clone-runner.ts:55` splits and joins on both the raw and URL-encoded
   token).

2. **Check the prefix guard.** `GET /api/projects/prefix-available` must reject
   `ATL` on a second project attempt, and the prefix is frozen once set.

3. **Add the second repo.** Project Detail → Repos → Add repo → Clone fresh →
   `atlas-demo-web`, same credential. `POST /api/projects/:id/repos`.

4. **Confirm there is no primary.** ADR 0018 removed it. Both rows are
   ordinary `project_repos` entries ordered by `position, created_at`, each
   with its own clone, credential, default branch, schedule and setup scripts.
   Nothing in the UI should mark one as primary.

5. **Verify the clones landed inside the workspace.**
   `~/Work/workspace/atlas-demo-api` and `~/Work/workspace/atlas-demo-web`.
   This matters for [X-6](checklists/cross-cutting.md): `purge` only deletes
   paths strictly inside `settings.workspace_path`.

6. **Confirm the bot identity on a real commit.** In one clone, check
   `git log -1 --format='%an <%ae>%n%b'` after Atlas's own initial operations,
   or trigger a trivial run later. Expect author `sspart-bot[bot]
   <4332243+sspart-bot[bot]@users.noreply.github.com>` and a
   `Co-Authored-By: sspart <sspart.org@gmail.com>` trailer. This is the
   deferred proof from [task-04](task-04-bot-credential.md) step 6.

7. **Add secrets at both tiers, to prove the merge order.**
   - Global, at `/settings?tab=secrets`: `DEMO_TOKEN=global-value` and
     `SHARED_KEY=global-wins-if-unset`.
   - Per-project, via Project actions → Manage Secrets:
     `DEMO_TOKEN=project-value`.

   `mergeSecrets(environmentSecrets, projectSecrets)` has the project tier win
   on collision (`services/secret-substitution.ts:35-47`), so the script must
   see `project-value` for `DEMO_TOKEN` and `global-wins-if-unset` for
   `SHARED_KEY`.

8. **Write the per-repo setup scripts**, Project Detail → Setup, picking each
   repo in turn. Both must be **idempotent** — Atlas runs them every time a
   worktree is provisioned, not once at project creation. Each should:
   - `npm ci`
   - echo the two substituted values so the merge order is observable in
     `setup_output_text`
   - use `${variable.DEMO_TOKEN}` / `${variable.SHARED_KEY}` syntax, which is
     substituted **before the script is written to disk**. Bare `${X}` and
     `${env.X}` are deliberately left alone so ordinary shell expansion still
     works.

   Leave the PowerShell bodies empty — an empty body is a legitimate "no setup
   needed on this platform" and short-circuits to `{ok: true}`.

9. **Prove the redaction.** Because the scripts echo secret values, the stored
   `setup_output_text` must show `***` for every value of length ≥ 4
   (`project-setup-runner.ts:49, 54-61`). If a real value appears on the run
   page, that is a **P0** finding.

10. **Prove the failure path.** Temporarily add `${variable.NOPE}` to one
    script and start a run. Expect `agent_runs.status = 'setup_failed'`,
    `setupFailedKind = 'unknown_secret'`, the banner on the run detail page,
    and **no CLI process spawned**. Remove it afterwards.

11. **Install the agents and a workflow.** No agents are seeded — `runSeed`
    refuses on purpose. Install from `/agents/marketplace` (16 catalog agents
    available), then create a workflow from the `delivery` template, which
    pulls in the `build` and `test` sub-workflows its Sub-tasks steps run.

## Done when

- [x] Project **`atlas-sdlc-sandbox`** exists with prefix `ATL` (name follows
      the repo, per the amended D-2). The prefix field reported *"Available.
      New issues will be ATL-1, ATL-2, …"* live as it was typed
- [x] Both `clone_status = ready`, both inside `~/Work/workspace/` — paths
      below. ⚠️ The second stutters; filed as **F-009**
- [x] No repo row marks a primary, and `projects` has **0** git/setup columns.
      ⚠️ But the Add repo modal's subtitle still says *"next to the primary
      repo"* — filed as **F-008**
- [x] Each repo has its own `setup_sh_body` (853 and 861 bytes — different,
      because each embeds its own repo name). `projects` has no such column.
      The Setup tab renders a **repo picker** above the editors
- [ ] **Deferred to [task-07](task-07-sample-tasks-small-medium-large.md).**
      No commit has been made through Atlas yet — the clone is read-only. The
      assertion needs a real agent run
- [ ] **Deferred to task-07** — needs a run. The scripts are written to prove
      it: they echo `${#DT}` and `${#SK}`, so `13` means the project tier won
      (`project-value`) and `12` would mean global (`global-value`)
- [ ] **Deferred to task-07** — the scripts deliberately `echo` a raw secret
      so the redaction can be checked in `setup_output_text`
- [ ] **Deferred to task-07** — needs a run to fail against
- [ ] **Deferred to task-07** — no setup script has executed yet
- [x] 10 agents installed by the template; `agents` was 0 after the seed and
      is 10 only after the install, so the seed did not auto-populate it.
      ⚠️ 6 arrived set to the absent `copilot` CLI — filed as **F-010** and
      patched to `claude`
- [x] `Delivery` (`trigger=item_ready`, `use_worktree`, `push_code`,
      `raises_pr`) plus `Build sub-task` and `Test sub-task`

## Evidence

Executed 2026-09-20. Project id `c4cf4b2b-7c2a-4761-a90c-c4818b3eb2a8`.

**Clones.** Repo 1 in 1s, 126 objects, 42.63 KiB. Both `ready`:

```
atlas-sdlc-sandbox      <workspace>/atlas-sdlc-sandbox                        main  ready  pos 0
atlas-sdlc-sandbox-web  <workspace>/atlas-sdlc-sandbox-atlas-sdlc-sandbox-web  main  ready  pos 1
```

The second path is F-009. It is cosmetic: `dirname(git_path)` is the same for
both, so worktrees still co-locate under one `worktrees/` directory.

**ADR 0018 holds at the schema level.** `information_schema` reports **0**
columns on `projects` matching `git%` or `setup_%`.

**The Owner's open question is answered: one setup script per repo.** The
Setup tab carries a repo picker above the two editors, and the two bodies are
stored independently at 853 and 861 bytes. The tab's own help text states the
merge order: *"Values resolve from Settings → Shared Secrets first, then
Project → Manage Secrets — project entries override shared ones on key
collision."* This is direct confirmation that
`docs/setup-script-contract.md:31-56` is stale in documenting
`projects.setup_sh_body`.

**Secrets, both tiers.** Global `DEMO_TOKEN=global-value` and
`SHARED_KEY=global-wins-if-unset`; project `DEMO_TOKEN=project-value`. Both
`PUT` responses returned `has_value: true` and no plaintext, so X1 holds on the
write path too.

The scripts prove the merge order **without printing a value** — they echo
string lengths, which redaction does not touch:

```
DEMO_TOKEN  project-value        = 13   <- project tier won
            global-value         = 12   <- would mean global won
SHARED_KEY  global-wins-if-unset = 20   <- global only, no project override
```

They also echo one raw secret deliberately, so `setup_output_text` can be
checked for `***`, and they run `npm test` rather than `npm ci` — neither repo
declares dependencies, so `npm ci` would be a silent no-op and prove nothing.

### Deviations

1. **Project named `atlas-sdlc-sandbox`, not `atlas-demo`.** Follows the
   amended D-2; the name auto-filled from the repo URL.

2. **Secrets and setup scripts were written via the API, not the UI.** Faster,
   and the UI for both is walked properly in
   [task-11](task-11-walk-wave-d-settings-admin.md) (Shared Secrets) and
   [task-08](task-08-walk-wave-a-projects-repos.md) (Setup tab). The Setup tab
   was opened to confirm it renders the stored bodies per repo.

3. ⚠️ **Six agents were patched from `copilot` to `claude`.** The template
   installed Coder, Code Reviewer, Automation Engineer and Automation Reviewer
   (plus reviewers) on a CLI that is not installed — `which copilot` is empty
   and `pnpm doctor` flagged it at boot. `Build sub-task` runs
   `agent-coder` and `agent-code-reviewer`, so task-07 would have died at the
   build step. Patched to `claude` / `claude-sonnet-4-6` so the campaign can
   proceed; the defect itself is **F-010** and is not considered fixed by this
   workaround.

**Six deferred checks.** Everything needing a real agent run — the bot commit
identity, secret substitution in `setup_output_text`, redaction, the
`unknown_secret` failure path, and `$TMPDIR` hygiene — moves to
[task-07](task-07-sample-tasks-small-medium-large.md), which is the first task
that actually executes a setup script.
