# Repos without a primary — design

**Date:** 2026-09-20
**Status:** Approved by the Owner. Supersedes the "primary repo" decision in
[ADR 0017](../../adr/0017-multi-repo-projects.md); everything else in 0017
(multi-repo Tasks, one PR per changed repo, Jira sources) stands.

## Context

ADR 0017 made a Project hold several repos, but kept the project's own
`git_*` columns as a **primary** repo: id = the project id, not removable,
not swappable, and the only repo with an auto-fetch schedule, a reclone, a
terminal and the agents' `GH_TOKEN`.

The Owner's decision: **a project is a container, and every repo in it is
equal.** No primary. Each repo carries its own clone, reclone, auto-fetch
schedule, terminal, credential, default branch and setup scripts.

Owner's answers from the design conversation:

1. **New Project still asks for a first repo** (clone or connect), so a new
   project is usable right away. After creation that repo is one among
   equals: any repo can be removed, including the last one. A project with
   no repos cannot run a workflow until one is added.
2. **A Task must name at least one repo.** When the project has exactly one
   repo it is picked automatically. Existing Tasks are backfilled during the
   migration.
3. **Approach A** (below), including the `@atlas/shared` type changes, which
   AGENTS.md reserves for the Owner. Reason: with no primary, `IProject`
   cannot describe one.

### Approaches considered

- **A — move the primary into `project_repos`, drop the project git
  columns.** One table, one code path. The migrated row reuses the project
  id, so existing worktrees, lock keys, Jira sources and in-flight runs stay
  valid. **Chosen.**
- **B — keep the columns, hide "primary" in the UI.** Cheaper, but the
  primary still exists underneath: not removable, special code paths. It
  fails the actual requirement. Rejected.
- **C — like A, with fresh ids for migrated rows.** Cleaner ids, but every
  worktree folder, lock key and running workflow has to be rewritten or
  moved, for a cosmetic gain. Rejected.

## Data model

### Migration `045_repos_without_primary`

For each project with a repo (`git_path` or `git_url` non-empty), insert one
`project_repos` row:

| Column | Value |
|---|---|
| `id` | **the project id** — keeps worktree paths, git-lock keys and `jira_sources.repo_id` valid |
| `project_id` | the project id |
| `name` | slug of `basename(git_path)`, made unique within the project (suffix `-2`, `-3`, …) |
| `git_url`, `git_path`, `credential_id`, `default_branch`, `clone_status` | copied from the project |
| `setup_sh_body`, `setup_ps1_body` | copied from the project |
| `position` | `0`; existing extras are renumbered after it |

A project whose `git_path` and `git_url` are both empty gets no row and
starts at zero repos.

Then:

- **Drop from `projects`:** `git_path`, `git_url`, `credential_id`,
  `default_branch`, `clone_status`, `setup_sh_body`, `setup_ps1_body`.
  A project keeps name, key, description, guardrails, status and env
  secrets.
- **`items.repo_ids`:** every row with `[]` in a project that got a repo
  becomes `[projectId]`. Sub-tasks continue to read their Task's list at
  runtime; backfilling them too is harmless and keeps the column honest.
- **`project_schedules`:** add `repo_id text` (filled with `project_id`),
  make it the primary key, `REFERENCES project_repos(id) ON DELETE CASCADE`.
  `project_id` stays on the row so "pause while agents are active on this
  project" still resolves without a join.
- **`cli_sessions`:** add `repo_id text` (filled with `project_id`,
  `REFERENCES project_repos(id) ON DELETE SET NULL`). The
  `cli_sessions_one_active_per_project_branch` unique index becomes
  per `(repo_id, branch)`.

`down()` restores the seven `projects` columns from the row whose id equals
the project id, drops the added columns and restores the old index. Extra
repos are left in `project_repos`, which `down()` of `043` removes; this is
documented as lossy in the same way `043` already is.

### `@atlas/shared`

- `IProject`: remove `git_path`, `git_url`, `credential_id`,
  `default_branch`, `clone_status`, `setup_sh_body`, `setup_ps1_body`.
- `IProjectRepo`: remove `primary`.
- `IProjectSchedule`: add `repo_id`.
- `CliSessionCreateSchema`: add `repo_id`.
- Item create/update schemas: `repo_ids` stays optional on the wire; the API
  fills or rejects (below).
- The project clone/connect schemas keep their repo fields — New Project
  still creates the first repo.

## API

Everything that acts on a checkout moves under the repo:

| Today | Becomes |
|---|---|
| `POST /api/projects/:id/reclone` | `POST /api/projects/:id/repos/:repoId/reclone` |
| `GET /api/projects/:id/status` | `GET /api/projects/:id/repos/:repoId/status` |
| `GET /api/projects/:id/head` | `GET /api/projects/:id/repos/:repoId/head` |
| `POST /api/projects/:id/reveal` | `POST /api/projects/:id/repos/:repoId/reveal` |
| `GET/PUT/DELETE /api/projects/:id/schedule`, `…/schedule/fire` | the same under `…/repos/:repoId/schedule` |
| AI-scaffold endpoint | takes a repo id |

No aliases for the old paths: single-owner local app, and web + MCP are
updated in the same change.

Unchanged in shape, changed in rules:

- `DELETE /api/projects/:id/repos/:repoId` works on **any** repo, including
  the last one. It drops the repo from its Tasks' `repo_ids`, deletes its
  schedule, and leaves the folder on disk (as today).
- `POST /api/projects/:id/repos` (add by clone or connect) — unchanged.
- `POST /api/projects/clone` and `/api/projects/connect` create the project
  **and its first repo**, which is not special afterwards.
- `GET /api/projects/:id` no longer returns git fields;
  `GET /api/projects/:id/repos` is the source. `GET /api/repos` stays.
- Item create: `repo_ids` is required, **unless** the project has exactly
  one repo, in which case it is filled in. Unknown ids → 400 (as today).
  Item update: `repo_ids: []` → 400 ("a Task needs at least one repo"); the
  existing 409 while a run holds the Task is unchanged. Jira-created Tasks
  always arrive with the repos of the sources that matched, so they are
  unaffected.
- Queuing a Task for a workflow with no repos → **409** (its repos were
  removed). This joins the existing workflow-lock 409 family.

## Runtime

- **`runRepos`** loses the primary lookup. Single-repo run: unchanged
  (`computeWorktreePath(repo.git_path, repo.id, branch)`). Multi-repo
  workspace root becomes `<settings.workspace_path>/worktrees/<projectId>/ws/<branch>`;
  a run that already recorded `worktree_path` keeps it, so parked runs do
  not lose their folder.
- **Git lock + worktree paths** key on the repo id — what extra repos
  already do. Migrated repos keep their folders because their id is the
  project id.
- **`GH_TOKEN`** for agents comes from the credential of the Task's **first
  repo** (was: the project credential). Pushes and PRs keep using each
  repo's own credential, because the engine performs them.
- **Clone / reclone / auto-fetch runners** take a repo row, not a project
  row. Their SSE events carry `repoId` alongside `projectId`.
  Auto-fetch's "skip if dirty" reads that repo's folder;
  "pause while agents are active" stays project-wide.
- **Terminals** take `repo_id`; the PTY starts in that repo's worktree with
  that repo's credential.
- **Deleting a project** already collects and removes extra repo folders —
  it just loses the primary special case.
- **Project env secrets, guardrails, constitution** stay project-level and
  are staged into every repo, as now.

## UI

- **Projects list card:** repo count instead of one path/remote. Reclone and
  auto-fetch leave the card menu (they are per repo now).
- **Project Detail header:** drops the single remote link and default
  branch.
- **Repos tab:** the home for repo actions. No Primary chip; every row has
  the same menu — Edit, Auto-fetch schedule, Reclone, Reveal, Remove — and
  shows remote, branch, clone status, last fetch. Removing the last repo is
  allowed; the confirm says the folder stays on disk. Empty state: "No repos
  yet" + Add repo.
- **Setup tab:** gains a repo selector and edits that repo's scripts. Setup
  fields come out of the Edit Repo dialog, so scripts live in one place.
- **New Project:** unchanged (clone or connect → first repo).
- **New Task / Task Detail:** the repo multi-select is always shown,
  preselected when there is one repo; saving with none selected is blocked;
  the running-workflow 409 toast stays.
- **Terminals:** start dialog gets a repo picker (preselected when there is
  one repo); the session shows its repo.

## Testing

- **Migration test:** seed projects (with and without extras, a schedule, a
  CLI session, Tasks at `repo_ids = []`), run `045` up, assert the repo row,
  id reuse, name de-duplication, backfilled Tasks, re-keyed schedule and
  session. Plus a `down()` test.
- **Service tests:** `project-repos` with no primary; removing the last
  repo; `run-repos` paths and workspace root; per-repo auto-fetch; the Task
  repo requirement and its 409.
- **Existing suites:** every test that reaches for `project.git_path` moves
  to the repo. This is the bulk of the mechanical work.
- **E2E:** one new spec — create a project, add a second repo, remove the
  first, run a Task on what remains. Parallel API runs get their own
  database.

## Docs (same change)

ADR 0018 (supersedes 0017's primary decision), `.agents/api-surface.md`
(routes, SSE, migrations), `.agents/data-model.md` (entities), and the page
docs for projects list, project detail, new task, task detail, terminal.

## Consequences

- **Old project-level git endpoints disappear.** Any bookmark or script
  calling `/api/projects/:id/status|head|reclone|schedule` breaks. Acceptable:
  single-owner local app, all callers in-repo.
- **A project can have zero repos.** Every screen that assumed a checkout
  needs an empty state; Tasks cannot be queued until a repo exists.
- **The migrated repo keeps the project id as its id.** Slightly surprising
  when read in isolation; it is what keeps worktrees, locks and Jira sources
  valid. New repos get random ids.
- **Multi-repo workspaces move** to the Atlas workspace folder. Runs parked
  with a recorded path keep the old location until they finish.
- **Agents still get one `GH_TOKEN`** — now the first repo's credential.
  A Task whose first repo has no credential leaves agents without `gh`, the
  same failure mode as a project without a credential today.

## Phasing

1. Migration + `@atlas/shared` types + `project-repos` / `run-repos`
   services.
2. API routes (repo-scoped endpoints, item repo rules).
3. Runtime (clone, reclone, auto-fetch, terminals, engine, `GH_TOKEN`).
4. Web.
5. Docs (ADR 0018 + `.agents/`) and the e2e spec.
