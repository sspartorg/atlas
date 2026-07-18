# Projects

**Route:** `/projects` • **Component:** `packages/web/src/pages/Projects.tsx` • **Slug:** `projects` + `proj-creds`

## Purpose
List all projects with cards or table view; create new ones; trigger reclone, delete, schedule auto-fetch, open in OS file manager.

## States
- **Loading**: `paged.isPending` → 60vh flex box with `<BrandedFallback />` (Projects.tsx:195-201)
- **Empty**: `totalProjects === 0 && allProjectsForEmpty.length === 0` → `ProjectsEmptyState` (Projects.tsx:266-268). The fallback `useProjects()` call (line 65) guards against an empty current page when other pages still hold projects.
- **Populated**: header + filters + view toggle + cards/table + pagination footer (Projects.tsx:269-451)

## UI elements
**Header**
- "Projects" heading + stats line (projects · epics · stories) (lines 262-284)
- **View toggle** Cards ↔ Table (`ViewToggle`, line 287)
- **New Project** button (lines 288-296) → opens `NewProjectModal`

**Filter chips (`ProjectFilterChips`)** — All / Assigned to me / software-dev / marketing / content / design (line 54).

**Card grid (`ProjectCard`)** — for each project:
- Folder icon + name + schedule indicator (`ProjectCard:120-133` shows when auto-fetch is configured)
- Display ID chip (e.g., `CER`) — taken straight from `p.issue_key_prefix` (Projects.tsx:86-92), the prefix picked at project-create time, NOT derived from creation order. This is what keeps the project tag aligned with the issue ids it produces (CER-1, CER-2, …).
- **Repo URL** link — `git_url`, opens externally (ProjectCard:161-181)
- Counters: epics, stories
- Last activity timestamp
- **Open →** link → `RouterLink` to `/projects/:id`
- **Menu** button → opens `ProjectRowMenu`

**Project row menu (`ProjectRowMenu`)**
- **Open project** → `POST /projects/:id/reveal` (reveals folder in OS file manager) — *hidden below md, no local file system on mobile*
- **Copy repo URL** → `navigator.clipboard.writeText(git_url)`
- **Reclone** → opens `RecloneProjectModal` — *hidden below md, requires a local workstation*
- **Schedule fetch** → opens `AutoFetchScheduleModal`
- **Delete** → opens `DeleteProjectModal`

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
- `NewProjectModal` — credential picker + URL + path; calls `POST /api/projects/clone`
- `DeleteProjectModal` — confirms `DELETE /api/projects/:id` (delete-runner)
- `RecloneProjectModal` — confirms `POST /api/projects/:id/reclone`
- `AutoFetchScheduleModal` — `PUT /api/projects/:id/schedule` (cron + guards)

These four modals are rendered outside the empty/populated branches (Projects.tsx:245 comment) so they don't unmount during state changes.

## Hooks used
- `useProjectsPaged({ page, limit })` (Projects.tsx:58) — paged project fetch; `rows` populates the visible grid/table and `total` drives the footer + empty-vs-populated branch.
- `useProjects()` (line 65) — full unpaged list, kept as a fallback so the empty-state branch can tell "no projects on this page" from "no projects anywhere".
- `useEpics`, `useStories`, `useAgents`, `useSettings`, `useToast`
- `useEnabledSchedules()` — map of projectId → schedule info (for the calendar indicator)
- `useIsMobile()` — flips the layout to single-column cards + the `PageFab`.

## API endpoints touched
- `GET /api/projects`, `GET /api/epics`, `GET /api/stories`, `GET /api/agents`, `GET /api/settings`
- `POST /api/projects/:id/reveal`
- `POST /api/projects/clone` (via `NewProjectModal`)
- `POST /api/projects/:id/reclone` (via `RecloneProjectModal`)
- `DELETE /api/projects/:id` (via `DeleteProjectModal`)
- `PUT /api/projects/:id/schedule` (via `AutoFetchScheduleModal`)

## Permissions / guards
- Post-onboarding only.
- Filter `mine` == `all` because the app is single-owner; "mine" is provided for UI parity (line 121).

## Edge cases / quirks
- Story-per-project counts are computed via the epic→project map because stories don't have a direct `project_id` (Projects.tsx:125-134).
- Display IDs come from `p.issue_key_prefix` (Projects.tsx:86-92), NOT creation order — they're picked at project-create time and stay aligned with the issue keys the project will mint.
- Modals must stay mounted across state transitions (see Projects.tsx:258-261 comment) — don't move them inside conditional blocks.
- Pagination state (`page`, `limit`) is local React `useState` (Projects.tsx:56-57); not URL-controlled. Hard refresh resets to page 1, limit 20.

## Connectivity
- **Pages**: [Project Detail](03-project-detail.md) — card/row click target; [Credentials](20-credentials.md) — empty-state alert deep-links here so first-clone can pick a credential; [Dashboard](01-dashboard.md) — its empty state opens this page's NewProjectModal.
- **Routes**: `POST /api/projects/clone` — long-running, emits `clone_status`/`clone_output` SSE so the card reflects clone progress instead of hanging; `POST /api/projects/:id/reveal` — OS-only desktop affordance; hidden on mobile because phones don't have a local file manager.
- **Entities**: `project`, `credential` (for the picker), `project_schedule` (auto-fetch indicator).

## Coming soon on this page
- (none)
