# 0018. Repos Without a Primary

**Date:** 2026-09-20
**Status:** Accepted. Supersedes the **primary repo** decision in [0017](0017-multi-repo-projects.md); everything else in 0017 (multi-repo Tasks worked side by side, one PR per changed repo, Jira sources) stands.

## Context

ADR 0017 made a Project hold several repos, but kept the project's own git columns (`git_path`, `git_url`, `credential_id`, `default_branch`, `clone_status`, `setup_sh_body`, `setup_ps1_body`) as a **primary** repo: id = the project id, not removable, not swappable, and the only repo with an auto-fetch schedule, a reclone, a terminal and the agents' `GH_TOKEN`.

That made "a project holds several repos" only half true. The Owner's decision: **a project is a container, and every repo in it is equal.** No primary. Each repo carries its own clone, reclone, auto-fetch schedule, terminal, credential, default branch and setup scripts.

The Owner's answers:
- **New Project still asks for a first repo**, so a new project is usable right away. Afterwards that repo is one among equals, and **any repo can be removed, including the last one** — a project with no repos simply cannot run a workflow until one is added.
- **A Task must name at least one repo.** With exactly one repo in the project it is filled in; with several, not choosing is an error.

## Decision

### Data — migration `045_repos_without_primary`

- Each project's git columns become **one `project_repos` row whose id is the project id**. Worktree folders (`worktrees/<repo id>/`), git-lock keys, `items.repo_ids` and `jira_sources.repo_id` already hold that id, so reusing it migrates the data without moving a folder or rewriting a reference. Repos created afterwards get random ids.
- The seven columns are dropped from `projects`. A project keeps name, key, description, guardrails, status and env secrets.
- `items.repo_ids = []` is backfilled with `[projectId]`: every Task that implied "the primary" now names it.
- `project_schedules` is re-keyed on `repo_id` (PK, `ON DELETE CASCADE`), keeping `project_id` so the "pause while agents are active" guard resolves without a join.
- `cli_sessions` gains `repo_id`, and its one-live-session index becomes per `(repo, branch)`.
- **Ordering is load-bearing:** `projectReposService.list()` returns repos by `position, created_at`. "The Task's first repo" means the first of `items.repo_ids`, and that is what holds Task-wide files, where the multi-repo workspace sits, and whose credential the agents get.

### API

Everything that acts on a checkout moves under the repo: `POST /api/projects/:id/repos/:repoId/{reveal,reclone}`, `GET /api/projects/:id/repos/:repoId/{status,head}`, and `GET/PUT/DELETE …/repos/:repoId/schedule` plus `…/schedule/fire`. The old project-level paths are gone — this is a single-owner local app and every caller lives in this repo.

`DELETE /api/projects/:id/repos/:repoId` works on any repo, including the last; it drops the repo from its Tasks and leaves the folder on disk. Creating a Task fills in the only repo or 400s; queueing a Task whose repos were all removed 409s. `POST /api/cli/sessions` takes `repo_id`, optional only for a single-repo project. The AI-readiness scaffold takes `repo_id`.

### Runtime

- `ensureWorktree` takes a **repo**, not a project; `computeWorktreePath(repoGitPath, repoId, branch)` and the git lock key on the repo id (which the multi-repo path already did).
- The multi-repo workspace sits next to the **Task's first repo** (`<first repo parent>/worktrees/<projectId>/ws/<branch>/`) instead of next to the primary. Every clone lands in the Atlas workspace folder, so in practice that is the same place.
- Agents get one `GH_TOKEN`: the **first repo's** credential. Pushes and PRs still use each repo's own credential, because the engine performs them.
- Clone, reclone and auto-fetch runners take a repo row; their SSE events carry `repoId` alongside `projectId`. Setup scripts are always read from a repo. Deleting a project purges every repo folder it holds.
- Project env secrets, guardrails and the constitution stay project-level and are staged into every repo.

### UI

The projects list shows a repo count (one `GET /api/repos` for the whole page, never per card). Project Detail's **Repos** tab owns every repo action — Edit, Auto-fetch schedule, Re-clone, Open folder, Remove — with no Primary chip and an empty state. The Setup tab picks which repo's scripts it edits. New Task always shows the repo picker, preselecting the first repo. The terminal start dialog picks a repo when there is more than one.

## Consequences

- **Old project-level git endpoints are gone.** Acceptable: single-owner local app, all callers in-repo.
- **A project can have zero repos.** Every screen that assumed a checkout needs an empty state, and Tasks cannot be queued until a repo exists.
- **The migrated repo keeps the project id as its id** — surprising read in isolation, but it is what keeps worktrees, lock keys and Jira sources valid.
- **Multi-repo workspaces can move** for a Task whose first repo is not the old primary and whose clones live in different parents. A run parked mid-flight would be re-provisioned in the new location.
- **Agents still get a single token.** A Task whose first repo has no credential leaves agents without `gh`, the same failure mode as a project without a credential before.
- `items.repo_ids` stays a jsonb list rather than a join table: it is ordered, small, and always read whole.
