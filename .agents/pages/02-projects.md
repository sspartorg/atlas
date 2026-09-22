# Projects

**Route:** `/projects` • **Component:** `packages/web/src/pages/Projects.tsx` • **Slug:** `projects` + `proj-creds`

## Purpose
List all projects with cards or table view; create new ones (name + key + description — repos are added on Project Detail's Repos tab) and delete them.

## States
- **Loading**: `paged.isPending` → 60vh flex box with `<BrandedFallback />` (Projects.tsx:195-201)
- **Empty**: `totalProjects === 0 && allProjectsForEmpty.length === 0` → `ProjectsEmptyState` (Projects.tsx:266-268). The fallback `useProjects()` call (line 65) guards against an empty current page when other pages still hold projects.
- **Populated**: header + filters + view toggle + cards/table + pagination footer (Projects.tsx:269-451)

## UI elements
**Header**
- "Projects" heading + stats line (projects · tasks · sub-tasks; sub-tasks summed from each Task's `sub_task_count`)
- **View toggle** Cards ↔ Table (`ViewToggle`, line 287)
- **New Project** button (lines 288-296) → opens `NewProjectModal`

**Filter chips (`ProjectFilterChips`)** — All / Assigned to me / software-dev / marketing / content / design (line 54).

**Card grid (`ProjectCard`)** — for each project:
- Folder icon + name + schedule indicator (`ProjectCard:120-133` shows when auto-fetch is configured)
- Display ID chip (e.g., `ATL`) — taken straight from `p.issue_key_prefix` (Projects.tsx:86-92), the prefix picked at project-create time, NOT derived from creation order. This is what keeps the project tag aligned with the issue ids it produces (ATL-1, ATL-2, …).
- **Repos** — every repo the project holds, by name (`repoNames`, ProjectCard). A project holds 0..N equal repos (ADR 0018), so the card names them all instead of printing repos[0]'s remote as if it were the project's one repo. `No repos` when it has none.
- Counters: tasks, sub-tasks
- Last activity timestamp
- **Open →** link → `RouterLink` to `/projects/:id`
- **Menu** button → opens `ProjectRowMenu`

**Project row menu (`ProjectRowMenu`)** — **ADR 0018:** reveal, re-clone and auto-fetch are per repo and moved to Project Detail's **Repos** tab.
- ~~**Copy repo URL**~~ — **removed.** It copied repos[0]'s `git_url`, which is wrong for every project with more than one repo. Per-repo copy belongs on Project Detail's **Repos** tab, which owns every repo action. The menu now holds only **Delete project…**.
- **Delete** → opens `DeleteProjectModal` (its chip lists every repo folder, or "No repos")

**Table view (`ProjectsTable`)** — same actions, plus row-click navigates to `/projects/:id`.

**Pagination footer (Projects.tsx:398-450)** — renders only when `totalProjects > limit`:
- Range label: `Showing {(page-1)*limit + 1}–{min(page*limit, total)} of {total}` (mono caption, lines 410-419).
- **Rows-per-page Select** — values `[10, 20, 50, 100]` (lines 421-438). Changing the limit resets `page` to 1.
- **MuiPagination** — `showFirstButton` / `showLastButton`, rounded shape, primary color (lines 439-447). Drives `page` state.
- Both controls hydrate the `useProjectsPaged({ page, limit })` query — the visible card grid is page-local; the totals strip (`{totalProjects} projects · …`) reads the server total.

**Mobile FAB (`PageFab`, line 461)** — replaces the header "+ New Project" button below the MUI `md` breakpoint; positioned above the bottom nav and opens `NewProjectModal` on tap.

## Why these affordances exist
- **New Project** — Projects are the only top-level container; header-pinned create-path because cloning is the most frequent action.
- **View toggle (Cards/Table)** — Cards for small sets, table for keyboard scanning past ~10 projects; same data both sides.
- **Project row menu** — Reveal / Reclone / Schedule / Delete are destructive or filesystem-touching; menu (not inline buttons) prevents fat-finger clones.
- **Reclone** — Credentials rotate; reclone with the new credential is faster than walking through Settings + re-clone manually. Mobile-hidden because phones lack a local worktree.
- **Schedule fetch** — Background `git fetch` keeps remote refs fresh so the Owner doesn't have to pull manually before each session.

## Modals / drawers
- `NewProjectModal` — **Name**, **Issue key prefix**, **Description**. Nothing about repos: a project is a wrapper, and repos are added afterwards from Project Detail's **Repos** tab. Calls `POST /api/projects`, then navigates to `/projects/:id?tab=repos`. The prefix follows the name until the Owner types their own (it can't be changed later — item ids are `{PREFIX}-N`) and is probed against `GET /api/projects/prefix-available` on a 350 ms debounce; **Create project** stays disabled until it comes back available. A 400 mentioning the prefix re-marks it as taken (another tab claimed it mid-flight).

  Previously this modal was 1479 lines: a Clone-fresh / Use-existing-folder toggle, a repo URL, a credential picker, a folder picker, a default branch, a clone-destination preview and a live clone terminal, posting to `POST /api/projects/clone` or `/connect`. Both endpoints are **gone** — `POST /api/projects/:id/repos` (`mode: 'clone' | 'connect'`, driving `AddRepoDialog`) already did exactly that job per repo.
- `DeleteProjectModal` — confirms `DELETE /api/projects/:id` (delete-runner)
- `RecloneProjectModal` — confirms `POST /api/projects/:id/reclone`
- `AutoFetchScheduleModal` — `PUT /api/projects/:id/schedule` (cron + guards)

These four modals are rendered outside the empty/populated branches (Projects.tsx:245 comment) so they don't unmount during state changes.

## Hooks used
- `useProjectsPaged({ page, limit })` (Projects.tsx:58) — paged project fetch; `rows` populates the visible grid/table and `total` drives the footer + empty-vs-populated branch.
- `useProjects()` (line 65) — full unpaged list, kept as a fallback so the empty-state branch can tell "no projects on this page" from "no projects anywhere".
- `useTasks`, `useAgents`, `useSettings`, `useToast`
- `useAllRepos()` — every repo of every project in ONE `GET /api/repos`, grouped by `project_id` (ADR 0018). A per-card fetch would be an N+1 and trips `e2e/no-dup-fetches.spec.ts`. Cards show `No repos` / `1 repo` / `N repos` plus every repo's name; the table's Repos column lists the same names.
- `useEnabledSchedules()` — map of **repoId** → schedule info; the card's calendar indicator lights when any repo of the project is scheduled
- `useIsMobile()` — flips the layout to single-column cards + the `PageFab`.

## API endpoints touched
- `GET /api/projects`, `GET /api/repos`, `GET /api/tasks`, `GET /api/agents`, `GET /api/settings`
- `POST /api/projects` (via `NewProjectModal`), `GET /api/projects/prefix-available`
- `DELETE /api/projects/:id` (via `DeleteProjectModal`)

## Permissions / guards
- Post-onboarding only.
- Filter `mine` == `all` because the app is single-owner; "mine" is provided for UI parity (line 121).

## Edge cases / quirks
- Per-project counts come from the one `GET /api/tasks` list: Tasks by `project_id`, sub-tasks as the sum of `sub_task_count` (`Projects.tsx:117-129`). The category filter chips join agent categories through Task assignees.
- Display IDs come from `p.issue_key_prefix` (Projects.tsx:86-92), NOT creation order — they're picked at project-create time and stay aligned with the issue keys the project will mint.
- Modals must stay mounted across state transitions (see Projects.tsx:258-261 comment) — don't move them inside conditional blocks.
- Pagination state (`page`, `limit`) is local React `useState` (Projects.tsx:56-57); not URL-controlled. Hard refresh resets to page 1, limit 20.

## Connectivity
- **Pages**: [Project Detail](03-project-detail.md) — card/row click target; [Credentials](20-credentials.md) — empty-state alert deep-links here so first-clone can pick a credential; [Dashboard](01-dashboard.md) — its empty state opens this page's NewProjectModal.
- **Routes**: `POST /api/projects` is a plain create — no clone, no SSE, so it returns immediately. Cloning happens per repo from the Repos tab (`POST /api/projects/:id/repos`), which emits `clone_status` / `clone_output`; reveal lives there too (ADR 0018) because a project has no folder of its own — its repos do.
- **Entities**: `project`, `credential` (for the picker), `project_schedule` (auto-fetch indicator).

## Coming soon on this page
- (none)
