# Projects

**Route:** `/projects` • **Component:** `packages/web/src/pages/Projects.tsx` • **Slug:** `projects` + `proj-creds`

## Purpose
List all projects with cards or table view; create new ones (name + key + description — repos are added on Project Detail's Repos tab) and delete them.

## States
- **Loading**: `paged.isPending` → 60vh flex box with `<BrandedFallback />`
- **Load error**: `paged.isError` with no data → `ApiErrorAlert` "Could not load projects — …" with a **Retry** button (refetches the page). A failed load never reads as "No projects yet."
- **Empty**: `totalProjects === 0 && allProjectsForEmpty.length === 0` → `ProjectsEmptyState`. The fallback `useProjects()` call guards against an empty current page when other pages still hold projects.
- **Populated**: header + filters + view toggle + cards/table + pagination footer

## UI elements
**Header**
- "Projects" heading + stats line (projects · tasks · sub-tasks; sub-tasks summed from each Task's `sub_task_count`)
- **View toggle** Cards ↔ Table (`ViewToggle`)
- **New Project** button → opens `NewProjectModal`

**Filter chips (`ProjectFilterChips`)** — All / My queue / Software dev queue / Marketing queue / Content queue / Design queue. Every chip's count is over the **full** project list (`useProjects()`), so "All N" matches the subtitle's server total. A category chip filters the full list too and hides the pagination footer; All / My queue show the current page.

**Card grid (`ProjectCard`)** — for each project:
- Folder icon + name + schedule indicator (`ProjectCard:120-133` shows when auto-fetch is configured)
- Display ID chip (e.g., `ATL`) — taken straight from `p.issue_key_prefix`, the prefix picked at project-create time, NOT derived from creation order. This is what keeps the project tag aligned with the issue ids it produces (ATL-1, ATL-2, …).
- **Repos** — every repo the project holds, by name (`repoNames`, ProjectCard). A project holds 0..N equal repos (ADR 0018), so the card names them all instead of printing repos[0]'s remote as if it were the project's one repo. `No repos` when it has none.
- Counters: tasks, sub-tasks
- Last activity timestamp
- **Open →** link → `RouterLink` to `/projects/:id`
- **Menu** button → opens `ProjectRowMenu`

**Project row menu (`ProjectRowMenu`)** — **ADR 0018:** reveal, re-clone and auto-fetch are per repo and moved to Project Detail's **Repos** tab.
- ~~**Copy repo URL**~~ — **removed.** It copied repos[0]'s `git_url`, which is wrong for every project with more than one repo. Per-repo copy belongs on Project Detail's **Repos** tab, which owns every repo action. The menu now holds only **Delete project…**.
- **Delete** → opens `DeleteProjectModal` (its chip lists every repo folder, or "No repos")

**Table view (`ProjectsTable`)** — columns ID, Project, **Repos** (every repo name, comma-joined; "No repos"), Tasks, Sub-tasks, Last Activity, Owner, actions. Sortable headers are `TableSortLabel` buttons; the active one carries `aria-sort`. Row click navigates to `/projects/:id`; the project name is a real link to the same place, which is the keyboard path.

**Pagination footer** — renders only when `totalProjects > limit` and no category chip is active:
- Range label: `Showing {(page-1)*limit + 1}–{min(page*limit, total)} of {total}` (mono caption).
- **Rows-per-page Select** — values `[10, 20, 50, 100]`. Changing the limit resets `page` to 1.
- **MuiPagination** — `showFirstButton` / `showLastButton`, rounded shape, primary color. Drives `page` state.
- Both controls hydrate the `useProjectsPaged({ page, limit })` query — the visible card grid is page-local; the totals strip (`{totalProjects} projects · …`) reads the server total.

**Empty state (`ProjectsEmptyState`)** — "No projects yet." / "A project holds your Tasks and the repos they work on. Create one, then add its repos — Atlas clones each into your workspace folder in the background." Action card "Add your first project" / "Give it a name and a 3-letter issue key. You'll add its repos next." + **New Project**. While no credential exists: "Cloning a private repo? Add a credential in Settings → Credentials before you add the repo. …" (a real `RouterLink`).

**Mobile FAB (`PageFab`)** — replaces the header "+ New Project" button below the MUI `md` breakpoint; positioned above the bottom nav and opens `NewProjectModal` on tap.

## Why these affordances exist
- **New Project** — Projects are the only top-level container; header-pinned create-path.
- **View toggle (Cards/Table)** — Cards for small sets, table for keyboard scanning past ~10 projects; same data both sides.
- **Project row menu** — Delete is destructive; a menu (not an inline button) prevents fat-finger deletes. Repo actions (reveal, re-clone, auto-fetch) live on Project Detail's Repos tab.

## Modals / drawers
- `NewProjectModal` — **Name**, **Issue key prefix**, **Description**. Nothing about repos: a project is a wrapper, and repos are added afterwards from Project Detail's **Repos** tab. Calls `POST /api/projects`, then navigates to `/projects/:id?tab=repos`. The prefix follows the name until the Owner types their own (it can't be changed later — item ids are `{PREFIX}-N`) and is probed against `GET /api/projects/prefix-available` on a 350 ms debounce; **Create project** stays disabled until it comes back available. If the probe fails or takes over 8 s the helper says "Couldn't check availability. Create still refuses a prefix that's taken." and Create is allowed (the POST is the real check). A 409 mentioning the prefix re-marks it as taken (another tab claimed it mid-flight). When the team config role is **publisher**, an **Include in team config** checkbox (ticked by default) follows; ticked, the modal `PATCH`es `team_managed: true` right after the create (`CreateProjectSchema` doesn't take it). If that PATCH fails the modal stays open with "The project was created, but adding it to the team config failed: …"; pressing **Create project** again retries only the PATCH (the created id is kept), never a second POST.

  Previously this modal was 1479 lines: a Clone-fresh / Use-existing-folder toggle, a repo URL, a credential picker, a folder picker, a default branch, a clone-destination preview and a live clone terminal, posting to `POST /api/projects/clone` or `/connect`. Both endpoints are **gone** — `POST /api/projects/:id/repos` (`mode: 'clone' | 'connect'`, driving `AddRepoDialog`) already did exactly that job per repo.
- `DeleteProjectModal` — `POST /api/projects/:id/delete` (delete-runner)

Both modals are rendered outside the empty/populated branches so they don't unmount during state changes. (Re-clone and auto-fetch moved to Project Detail's Repos tab.)

## Hooks used
- `useProjectsPaged({ page, limit })` — paged project fetch; `rows` populates the visible grid/table and `total` drives the footer + empty-vs-populated branch.
- `useProjects()` — full unpaged list: the empty-state fallback, the chip counts and the category filters.
- `useTasks`, `useAgents`, `useSettings`
- `useAllRepos()` — every repo of every project in ONE `GET /api/repos`, grouped by `project_id` (ADR 0018). A per-card fetch would be an N+1 and trips `e2e/no-dup-fetches.spec.ts`. Cards show `No repos` / `1 repo` / `N repos` plus every repo's name; the table's Repos column lists the same names.
- `useEnabledSchedules()` — map of **repoId** → schedule info; the card's calendar indicator lights when any repo of the project is scheduled
- `useIsMobile()` — flips the layout to single-column cards + the `PageFab`.

## API endpoints touched
- `GET /api/projects/paged`, `GET /api/projects`, `GET /api/repos`, `GET /api/tasks`, `GET /api/agents`, `GET /api/settings`, `GET /api/schedules`, `GET /api/credentials` (empty state)
- `POST /api/projects` + `PATCH /api/projects/:id` (via `NewProjectModal`), `GET /api/projects/prefix-available`
- `POST /api/projects/:id/delete` (via `DeleteProjectModal`)

## Permissions / guards
- Post-onboarding only.
- Filter `mine` == `all` because the app is single-owner; "My queue" is provided for UI parity.

## Edge cases / quirks
- Per-project counts come from the one `GET /api/tasks` list: Tasks by `project_id`, sub-tasks as the sum of `sub_task_count` . The category filter chips join agent categories through Task assignees.
- Display IDs come from `p.issue_key_prefix`, NOT creation order — they're picked at project-create time and stay aligned with the issue keys the project will mint.
- Modals must stay mounted across state transitions — don't move them inside conditional blocks.
- Pagination state (`page`, `limit`) is local React `useState`; not URL-controlled. Hard refresh resets to page 1, limit 20.

## Connectivity
- **Pages**: [Project Detail](03-project-detail.md) — card/row click target; [Credentials](20-credentials.md) — empty-state alert links here so a private repo's clone can pick a credential; [Dashboard](01-dashboard.md) — its empty state opens this page's NewProjectModal.
- **Routes**: `POST /api/projects` is a plain create — no clone, so it returns immediately (it broadcasts `counts_changed`). Cloning happens per repo from the Repos tab (`POST /api/projects/:id/repos`), which emits `clone_status` / `clone_output`; reveal lives there too (ADR 0018) because a project has no folder of its own — its repos do.
- **Entities**: `project`, `credential` (for the picker), `project_schedule` (auto-fetch indicator).

## Coming soon on this page
- (none)
