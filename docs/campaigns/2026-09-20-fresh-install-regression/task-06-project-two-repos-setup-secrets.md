# 06 — Create the project, add both repos, setup scripts and secrets

**Status:** todo
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

- [ ] Project `atlas-demo` exists with prefix `ATL`, and a second project
      cannot claim `ATL`
- [ ] Both repos are `clone_status = ready`, cloned inside
      `~/Work/workspace/` — paste the two paths
- [ ] No UI surface marks either repo as primary
- [ ] Each repo has its **own** `setup_sh_body`; the `projects` table has no
      such column — paste the `\d project_repos` fragment showing both
- [ ] A commit made through Atlas shows the bot as author and the human as a
      `Co-Authored-By` trailer — paste `git log -1`
- [ ] A run's `setup_output_text` shows `project-value` resolved for
      `DEMO_TOKEN` (project tier beat global) — **as `***`**, with the
      resolution proven by a length or hash echo rather than the plaintext
- [ ] No secret value of length ≥ 4 appears unredacted anywhere on the run page
- [ ] `${variable.NOPE}` produces `setup_failed` / `unknown_secret` and no CLI
      spawn — paste the run row
- [ ] No `atlas-setup-*` file is left in `$TMPDIR`, and none ever appeared
      inside either worktree
- [ ] At least the agents referenced by the `delivery` template are installed,
      and `agents` was **not** auto-populated by the seed
- [ ] A `delivery` workflow exists on the project with its `build` and `test`
      sub-workflows

## Evidence

*(filled during execution)*
