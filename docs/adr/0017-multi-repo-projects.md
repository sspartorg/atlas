# 0017. Multi-repo Projects and Tasks

**Date:** 2026-09-19
**Status:** Accepted. Amends [0015](0015-one-task-one-pr.md): one Task is still one run and one branch, but it opens one PR **per repo it changed**. Amends [0016](0016-jira-bridge.md): the Jira bridge now reads one JQL per repo (sources).

## Context

A Project used to be exactly one git repo: `projects.git_path / git_url / credential_id / default_branch`. The Owner's products span several GitHub repos, for example an API, a web client and an engine. A single requirement often touches more than one of them, such as a new endpoint together with the client that calls it.

Splitting that work into separate Tasks (one per repo) loses the point: no agent sees both sides of the change, and the Owner has several unrelated PRs to line up.

The Owner's decisions:
- **A Project holds several repos.**
- **A Task picks one or more of them.** The Task is worked in one workflow run, with the repos side by side.
- **The Jira bridge reads one JQL per repo.**

## Decision

### Data
- **The project's own git columns stay as its primary repo.** Its id is the project id, so its worktree paths, git-lock key, clone/reclone/auto-fetch, terminals and every existing test are unchanged.
- **Extra repos live in `project_repos`** (migration 043). Each row holds `name` (a slug, unique per project, used as the folder name), URL, path, credential, default branch, clone status and its own setup scripts. `projectReposService.list(projectId)` returns the primary (as a virtual repo) followed by the extras.
- **`items.repo_ids`** (jsonb, ordered) lists a Task's repos. `[]` means the primary only.
  - The order matters: the first repo holds Task-wide files such as specs and QA CSVs.
  - The list is validated against the Task's project.
  - Changing it while a workflow run holds the Task returns 409.
  - Sub-tasks inherit their Task's repos.
- **API:** `GET/POST/PATCH/DELETE /api/projects/:id/repos`.
  - POST either clones a repo into the workspace (reusing the clone runner through an on-cloned hook) or connects a local clone (the `/connect` checks, now shared).
  - DELETE unregisters the repo; its folder stays on disk. It also drops the repo from the project's Tasks.

### Runtime
- **Single-repo Task (including a Task on one extra repo):** unchanged. The checkout is the canonical sibling worktree and is the agents' cwd.
- **Multi-repo Task:**
  - The run's `worktree_path` is a **workspace** folder, `<primary parent>/worktrees/<projectId>/ws/<branch>/`, holding **one real git worktree per repo**, named by repo. It is not a symlinked folder: Claude treats a path through a symlink as outside its cwd, and Windows junctions are unsafe to delete.
  - The workspace is the agents' cwd.
  - `runRepos(run)` (`services/run-repos.ts`) resolves the repos and paths for any run, including a sub-task run.
- **Preparing a run:** `ensureWorktree` (with a `path` override) is called once per repo, each with that repo's credential and default branch.
- **Staging:**
  - `.atlas/` is staged at the workspace root and in every repo, because checklist scripts expect a repo at their cwd.
  - `.atlas/current-task.md` gets a **Repositories** section: folders, remotes, base branches, commit inside each repo, run the checks inside every repo you changed, and put Task-wide files in the first repo.
- **Setup:** setup scripts run once per repo, in order (extra repos use their own script bodies). The commit verifier checks each repo. The run row is touched after each repo so the 10-minute reconciler doesn't park a slow multi-repo setup.
- **Delivery at End:**
  - Leftovers are committed in every repo.
  - A repo with no changes beyond atlas's `.gitignore` commit is skipped. Its PR would be empty, and `gh pr create` would fail.
  - Every changed repo pushes the same branch and gets one PR.
  - A second pass rewrites each PR body to list its siblings. The existing "PR already exists → edit body" path handles this, so re-running is safe.
  - Every PR gets an `item_external_links` row; `items.pr_url` is the first PR.
  - Worktrees are cleaned up per repo only when every delivery step succeeded. Otherwise the run parks at End with everything kept, as before.
- **Merge:** the Task closes when the **last** of its PRs merges (`external-links.ts`). Each PR's state is read with the credential of the repo whose remote it belongs to.

### Jira
Sources replace the single JQL plus label rules. Each source is `{repo_id, jql, workflow_id?}`. An issue matching several repos' queries becomes one Task spanning those repos (see ADR 0016 and `jira-sync.ts`).

## Consequences

- The primary repo can't be removed or swapped. A later migration can move it into `project_repos` if that ever matters.
- **Pushes across repos aren't atomic.** A failure partway parks the run at End. Resuming retries every repo; a push that is already up to date counts as success.
- The upstream branch of a repo that ended up unchanged is left on the remote (it was pushed when the worktree was created).
- **Terminals, auto-fetch and reclone still work on the primary repo only.** `ensureWorktree` fetches every repo at the start of each run anyway.
- Agents get one `GH_TOKEN`: the project's primary credential. Pushes and PRs use each repo's own credential, because the engine does them.
- **Fix made along the way:** the scheduled "drain Tasks ready at the fire" comparison now uses the database clock on both sides (`last_run_at = now()`), which removed a test flake caused by the Postgres VM clock running a few ms ahead of the host's.
