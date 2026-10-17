# Coverage contract: Projects and Tasks

Every finite thing the Projects area (`/projects`, `/projects/:id` and its seven
tabs, the header and its actions menu, Manage Secrets, the right rail, the
global `/guardrails`) and the Tasks area (`/tasks` table and Kanban,
`/tasks/new`, `/tasks/:id`, `/sub-tasks/:id`) can show or do, and the test that
proves it. A change that adds a row here (a control, a state, an error path, a
copy change) adds its test in the same change. Strings are quoted from source
on `fix/verify-projects-tasks` (2026-10-17). "Before" is the value the two
audit drafts gave the row (`yes` = e2e, `partial`, `unit only`, `gap`, `new`).

"After" is the state at the end of `fix/projects-tasks-open-items`: `e2e`
(Playwright only), `unit+e2e`, or `unit only —` with the reason an e2e adds
nothing. The fake GitHub (`e2e/helpers/fake-github.ts`: git `insteadOf` →
local bare repos) and fake `gh` (`e2e/fixtures/fake-gh`, on the e2e API's
PATH) let clone, connect, ls-remote, fetch, push and "open a PR" run offline.

Test kinds: **e2e** = Playwright against the real e2e API (`e2e/global-setup.ts`;
rows in `atlas_e2e` via `e2e/helpers/db.ts`); *routed* = the row is proven by a
`page.route` fault (500 / 409 / held request). **unit** = Vitest. Paths are
relative to the repo root.

| Key | File |
|---|---|
| PF | `e2e/flows/projects-full.spec.ts` |
| PTF | `e2e/flows/project-tabs-full.spec.ts` |
| PSF | `e2e/flows/project-secrets-full.spec.ts` |
| TF | `e2e/flows/tasks-full.spec.ts` |
| TDF | `e2e/flows/task-detail-full.spec.ts` |
| PTM | `e2e/flows/projects-tasks-mobile.spec.ts` (`@mobile` 390 + 360px, `@ipad` 834px) |
| A11 | `e2e/a11y/projects-tasks.spec.ts` |
| PS | `e2e/pages/projects.spec.ts` |
| PD | `e2e/tabs/project-detail.spec.ts` |
| ST | `e2e/pages/setup-tab.spec.ts` |
| JB / JM | `e2e/flows/jira-bridge.spec.ts` / `e2e/flows/jira-status-mapping.spec.ts` |
| RWP / MR | `e2e/flows/repos-without-primary.spec.ts` / `e2e/flows/multi-repo.spec.ts` |
| TC | `e2e/flows/team-config.spec.ts` |
| NPM, DPM, RNM, GAS, RCM, AFM, PEM, SCM, GRM | `e2e/modals/{new-project,delete-project,rename-project,generate-ai-scaffold-dialog,reclone-project,auto-fetch,project-env-secrets,script,guardrail}-modal.spec.ts` |
| GR / GT | `e2e/pages/guardrails.spec.ts` / `e2e/tabs/guardrails-tabs.spec.ts` |
| TS / KB / TNs / TDs / SDs | `e2e/pages/{tasks,kanban,task-new,task-detail,sub-task-detail}.spec.ts` |
| LPd / PRd / CDd | `e2e/modals/{link-picker-dialog,add-pr-link-dialog,confirm-delete-modal}.spec.ts` |
| WP / WD / ND | `e2e/flows/task-workflow-panel.spec.ts` / `e2e/flows/walk-detail-pages.spec.ts` / `e2e/no-dup-fetches.spec.ts` |
| SA | `e2e/a11y/settings-a11y.spec.ts` |
| PLM | `e2e/flows/projects-list-more.spec.ts` (URL paging, New project keyboard / reset / failures, names) |
| PRG | `e2e/flows/project-repos-github.spec.ts` (Add repo clone / connect, pull, auto-fetch run-now, repo edit, AI scaffold — against the fake GitHub) |
| PTX | `e2e/flows/projects-tasks-more.spec.ts` (Tasks loading / failures, shell title, headings, live run refresh, Setup tab, setup scripts) |
| PTS | `e2e/flows/projects-tasks-states.spec.ts` (rows that were unit-only: states, failures, rail, Kanban, create form, detail cards) |
| GG | `e2e/flows/guardrails-global.spec.ts` (global `/guardrails` rules, Save bar, scripts, keyboard) |
| A11D | `e2e/a11y/projects-tasks-dialogs.spec.ts` (every status chip, unfiltered contrast; 15 dialogs × light / dark) |
| u:Name | the `Name.test.tsx` beside the component in `packages/web/src` (`u:Projects`, `u:ProjectDetail`, `u:TaskTable`, …) |
| u:PDdel | `packages/web/src/pages/ProjectDetail.delete.test.tsx` (new) |
| u:api-P / u:api-T / u:api-ST / u:api-C | `packages/api/src/routes/{projects,tasks,sub-tasks,comments}.test.ts` |
| u:api-G / u:api-GS / u:api-S / u:api-J | `packages/api/src/routes/{project-guardrails,project-guardrail-scripts,schedules,jira}.test.ts` |
| u:RR / u:DR / u:PEF | `packages/api/src/services/{reclone-runner,delete-runner,project-env-file}.test.ts` |

Status machine (`packages/shared/src/status-machine/index.ts`; Task and Sub-task share it):

| From | Offered under "Move to" (and as a legal Kanban drop) | Under "Override" |
|---|---|---|
| Draft | Ready, Waiting for Info | In Progress, In Review, Done |
| Ready | In Progress, Waiting for Info | Draft, In Review, Done |
| In Progress | In Review, Ready, Waiting for Info | Draft, Done |
| Waiting for Info | Ready, In Progress | Draft, In Review, Done |
| In Review | Done, In Progress, Waiting for Info | Draft, Ready |
| Done | — (terminal) | every other status |

TDF "the status menu offers exactly…" asserts the menu equals `getValidNextStatuses` + the rest, for Draft, In Progress, In Review and Done, on both kinds.

## 1. `/projects` list

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| P1 | Route, h1 "Projects", sidenav | `useSetPageTitle('Projects')` | PS; `navigate-sidenav.spec.ts`; PF | yes | e2e |
| P2 | Fetches once on mount | `/projects/paged`, `/projects`, `/repos`, `/tasks`, `/agents`, `/settings`, `/schedules` | ND | yes | e2e |
| P3 | Paged clamping `page ≥ 1`, `1 ≤ limit ≤ 100`, `created_at desc` |  | u:api-P; PTS "loading shows the branded fallback…; the API clamps page and limit" | unit only | unit+e2e |
| P4 | Loading | `BrandedFallback`, never the empty state | u:Projects; PTS "loading shows the branded fallback, never the empty state…" *(held request)* | unit only | unit+e2e |
| P5 | Load error | "Could not load projects — Something went wrong" + API message + **Retry** (not "No projects yet.") | PF "a failed load says so with Retry…" *(routed)*; u:Projects | gap | unit+e2e |
| P6 | Empty-state branch | only when the paged total and the full list are both 0 | PF "no projects at all → the empty hero…" *(routed)*; u:Projects | unit only | unit+e2e |
| P7 | Live refresh | `counts_changed` / `clone_completed` invalidate `['projects']`; a create shows without reload | PF "New project creates it end to end…" (back via sidenav, no reload) | unit only | e2e |
| P10–P11 | Header icon, subtitle "{N} project(s) · {T} task(s) · {S} sub-task(s)" (singular at 1) | N = server total | PF (subtitle before/after a create) | unit only | e2e |
| P12 | Singular forms "1 project" / "1 task" / "1 sub-task" |  | u:Projects; PTS "the subtitle uses singular forms at one" *(routed)* | gap | unit+e2e |
| P13 | Header actions hidden below md; FAB "New Project" instead |  | PTM "projects list…", "New Project and New task open from their FABs…" | partial | e2e |
| P14 | **New Project** (desktop) opens the modal |  | NPM; PF | yes | e2e |
| P20–P22 | View toggle Cards (default) / Table (`aria-pressed`); re-click is a no-op |  | PF "Cards ↔ Table…"; u:ViewToggle | unit only | unit+e2e |
| P23 | Phones always show cards |  | u:Projects; PTM | unit only | unit+e2e |
| P24 | View resets to Cards on reload |  | PF "Cards ↔ Table… the toggle resets on reload" | gap | e2e |
| P30–P32 | Chips "All", "My queue", "Software dev queue", "Marketing queue", "Content queue", "Design queue" with counts; All = My queue = every project |  | PF "queue chips count every project…" | unit only | e2e |
| P33 | Category chip keeps projects with a Task on an agent of that category |  | PF (Task assigned to the installed agent, SQL count) | unit only | e2e |
| P34 | Chip counts and category filters read **every** project, not the page (paging footer hides under a category) |  | PF; u:Projects | gap (was page-only) | unit+e2e |
| P35 | Chips are `role=button`, Enter / Space select |  | PF; A11 "Projects: chips by Enter / Space…" | unit only | e2e |
| P36, P37 | Phone chip row scrolls; dark legibility |  | PTM; A11 (dark, axe) | gap | e2e |
| P40–P48 | Card: grid columns, name `h2`, key chip, repo line / "No repos" / "N repos", counters "{n} tasks" / "{n} sub-tasks", auto-fetch icon + tooltip |  | PF (name, key, "No repos", "1 tasks"); u:ProjectCard; PLM "special characters and a very long name round-trip and stay inside their card at 390px" | unit only | unit+e2e |
| P49 | "Last activity {relative}" |  | u:ProjectCard; PTS "a card says when the project last moved" | gap | unit+e2e |
| P50 | **Open →** link → `/projects/:id` |  | PTM (on screen, clickable); u:ProjectCard | partial | unit+e2e |
| P52 | "No projects match this filter." |  | PF (an empty category) | unit only | e2e |
| P60–P62 | Row menu "Project actions" → "Delete project…" → DeleteProjectModal |  | DPM; PLM "deleting the only project on the last page…" | yes | e2e |
| P63 | Menu Escape / arrows |  | A11 "Project actions: Enter opens, arrows…" (detail page menu) | gap | e2e |
| P70 | Table headers "ID", "Project", "Repos", "Tasks", "Sub-tasks", "Last Activity", "Owner" | header was "Repo URL" in the draft | PF "Cards ↔ Table…" | unit only | e2e |
| P71–P72 | Default Last Activity desc; header click sorts (`aria-sort`) |  | PF (sort by Project); u:ProjectsTable | unit only | unit+e2e |
| P75 | Repos cell: names, "—" when none (the card says "No repos") |  | PF | unit only | e2e |
| P79 | Row click → project |  | PF | unit only | e2e |
| P90–P93 | Footer only past `limit`: "Showing a–b of N", Rows 10/20/50/100, pagination |  | PF "paging: past 20 projects…" (page 2, `?page=2&limit=20`, Rows 50); PLM "page 2 is in the URL…" | unit only | e2e |
| P94–P95 | Page / rows in the URL (`?page=2&limit=50`, defaults left out, replace navigation); junk → 1 / 20; past the end → last page | fixed this branch (`pages/Projects.tsx`) | PLM "page 2 is in the URL; a reload and a shared link keep it; Rows changes the URL; Back skips the paging steps"; PLM "junk page / limit fall back to 1 / 20; a page past the end moves to the last page"; PLM "deleting the only project on the last page moves the list to the page before"; u:Projects | gap | unit+e2e |
| P100–P103 | Empty hero "No projects yet." / "A project holds your Tasks and the repos they work on…" / card "Add your first project" + **New Project**; hint "Cloning a private repo?" with a real "Settings → Credentials" link while no credential exists |  | PF "no projects at all…" *(routed)*; u:ProjectsEmptyState | unit only | unit+e2e |
| P110–P115 | FAB on phones; padding; no sideways scroll at 390/360/834; axe light + dark |  | PTM; A11; PTM "Projects dialogs @mobile / @ipad" (9 dialogs fit) | partial | e2e |

### 1.1 New project modal

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| P120–P121 | "New project" + "A project holds your Tasks and its repos. You'll add repos next."; fields Name / Issue key prefix / Description only |  | NPM | yes | e2e |
| P122–P123 | Prefix follows the name ("Quokka Web" → "QUO") until typed over; A–Z only, 3 max |  | PF; u:NewProjectModal; PLM "Enter in a field does not submit…" (typed over, the key stops following) | unit only | unit+e2e |
| P124–P129 | Helper: "Item ids … become {PREFIX}-1…", "Exactly 3 uppercase letters.", "Checking availability…", "Available. New items will be QUO-1, QUO-2, …", `Already used by "<name>"`, invalid |  | PF (Available, taken by the project just made); u:NewProjectModal; PLM "a short or non-letter key is refused locally…" | unit only | unit+e2e |
| P130 | Probe fails / times out → "Couldn't check availability. Create still refuses a prefix that's taken." and Create stays usable |  | u:NewProjectModal; PLM "a short or non-letter key is refused locally; a failed probe still lets Create through, and a taken key 409s in the dialog" *(routed probe)* | gap (was a hang) | unit+e2e |
| P131 | Create enabled only with a name and an ok (or unverified) prefix |  | NPM; PF; PLM | yes | e2e |
| P132 | Publisher checkbox "Include in team config — …" |  | u:NewProjectModal; TC | unit only | unit+e2e |
| P133–P134 | **Create project** → `POST /api/projects` → `/projects/:id?tab=repos`; the list shows it without a reload |  | PF "New project creates it end to end…" | unit only / gap | e2e |
| P135–P137 | Server error / 409 / Zod 400 in the Alert, modal stays |  | u:NewProjectModal; u:api-P; PLM "a server error on Create stays in the dialog with its message; the next Create works" *(routed 500)*; PLM "…a taken key 409s in the dialog" (real 409); PLM "the API refuses a malformed key with 400" | unit only | unit+e2e |
| P138–P140 | Cancel, Close (`aria-label="Close"`), Escape |  | NPM; PF; A11 (Escape returns focus to **New Project**); PLM "Enter in a field does not submit…" (Cancel, Close) | yes | e2e |
| P141–P142 | Enter does not submit; reopen resets |  | PLM "Enter in a field does not submit; Cancel and reopen start blank with the key following the name again"; u:NewProjectModal | gap | unit+e2e |

### 1.2 Delete project (from the list or the detail page)

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| P150–P152 / PX61–PX69 | "Delete project?" + "Choose what to remove. This cannot be undone."; project chip with every repo folder (or "No repos"); "Remove from Atlas only" (default) / "Delete project and content" + type-the-name |  | DPM; PF (repo folder in the chip); u:DeleteProjectModal; A11D "Delete project (light / dark)" | partial | unit+e2e |
| P153 / PX70 / PX73–PX77 | Submit → `POST /api/projects/:id/delete {mode, delete_id}` → "Deleting project…" / "Deleting in the background." + "Step n of 1" (unregister) / "of 2" (purge, "Remove repo folders" first) + live output |  | PF; u:DeleteProjectModal | unit only | unit+e2e |
| P154 / PX80–PX83 | "Project deleted" + "Unregistered from Atlas. Workspace folder kept on disk."; **Back to projects →** → `/projects` without the project; DB rows gone; `GET` 404 | from the detail page this view now survives the project's own 404 (fixed this pass) | PF "Delete in "Remove from Atlas only" mode…"; u:PDdel; u:DR | gap | unit+e2e |
| P155 / PX84–PX85 | Error view "Delete failed" / "A delete step failed." + Close / Try again |  | u:DeleteProjectModal; PTS "a purge whose folder cannot be removed ends in "Delete failed" with Try again…" (real: read-only parent in the workspace) | unit only | unit+e2e |
| P156 / PX72 | Cancel / Escape, blocked while deleting |  | DPM; A11D (Escape, focus back to Project actions) | yes | e2e |
| PX79 | Purge keeps a folder outside the workspace root |  | u:DR; PTS "a purge … a folder outside the workspace is kept" (real purge, file still on disk) | gap | unit+e2e |

## 2. `/projects/:id` — shell, header, actions menu

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| PX1–PX3 | Route; one fetch each of project, repos, agents, settings, counts, tree |  | WD; PD; ND | yes | e2e |
| PX4 | Loading skeletons |  | u:ProjectDetail; PTS "skeletons while the project loads; a 404 says "Project not found"…" *(held request)* | gap | unit+e2e |
| PX5 | 404 → "Project not found" + **Back to Projects** |  | u:ProjectDetail; PTS "skeletons while the project loads; a 404 says "Project not found" with Back to Projects" (real 404) | unit only | unit+e2e |
| PX6 | 500 / network → "Could not load this project — …" + Retry (not "Project not found") |  | u:ProjectDetail; PTS "a 500 says "Could not load this project" with Retry (not "not found"); Retry recovers" *(routed)* | gap | unit+e2e |
| PX7 | Mobile app-bar title = project name, subtitle "Project" |  | PTM (header fits); PLM "special characters and a very long name…" (390px: the name is the page h1, sr-only beside the app bar) | gap | e2e |
| PX8–PX9 | **Refresh project data** |  | u:ProjectDetail; PTS "Refresh project data refetches: a change made elsewhere shows without a reload" | unit only | unit+e2e |
| PX10–PX13 | Seven tabs Overview, "Tasks  N", Guard-rails, Repos, Jira, Setup, History; `?tab=` deep link; arrows move between tabs |  | PTF (each tab's deep link + `aria-selected`); PTM "the project tab strip scrolls to every tab at 360px"; A11 (ArrowRight → Tasks, Enter) | partial | e2e |
| PX14 | Right rail hidden on Guard-rails |  | u:ProjectDetail; PTS "the rail hides on Guard-rails; "Edit guard-rails" opens that tab; rules drive the header pill and rail" | unit only | unit+e2e |
| PX15 | Overview "Full history →" → `?tab=history` |  | PTF "the three tiles equal the database…" | unit only | e2e |
| PX16 | `/projects/:id/guard-rails` and `/guardrails` redirect to `?tab=guardrails` |  | u:ProjectGuardrails; ND | yes | unit+e2e |
| PX18 | No sideways scroll on every tab at 390 / 360 / 834 / 1440 |  | PTM; A11 | yes (iPad overview only) | e2e |
| PX20–PX25 | Breadcrumb, h1, key, repo-count pill ("Add a repo" / "1 repo" / "N repos" → Repos tab), "Guard-rails active" pill (now driven by the project's **active rule rows**), "Last activity" |  | u:ProjectHeader; PF (h1); PTS (Guard-rails active pill on / off); PRG (repo-count pill "2 repos") | unit only | unit+e2e |
| PX30–PX31 | **Project actions** (`aria-label`) → groups "Edit" / "Workspace" (`ListSubheader`, flat children so arrows work) |  | A11 "Project actions: Enter opens, arrows walk the items…" | partial | e2e |
| PX32 | "Rename project…" |  | PF | unit only | e2e |
| PX33 | "Edit guard-rails" → `?tab=guardrails` |  | u:ProjectActionsMenu; PTS "the rail hides on Guard-rails; "Edit guard-rails" opens that tab…" | unit only | unit+e2e |
| PX34 | "Manage Secrets" → Project Secrets |  | PEM; PSF; A11 (opened by Enter) | yes | e2e |
| PX35–PX36 | "Generate AI scaffold…" enabled with a ready repo; disabled otherwise with the inline reason "Needs a cloned repo first" |  | PF "Generate AI scaffold is disabled with its reason…"; u:ProjectActionsMenu; PRG "Generate starts the AI Readiness run…"; GAS | unit only | unit+e2e |
| PX37 | "Delete project…" |  | PF | unit only | e2e |
| PX38–PX39 | Escape / backdrop close; ArrowUp/Down walk items; focus returns to the trigger |  | A11 | gap | e2e |
| PX40–PX48 | Rename: "Rename project", "Project name" prefilled, Save disabled blank/unchanged, `PATCH` → toast "Renamed to {name}", Enter saves, persisted across reload |  | PF "Rename saves, shows the new name, and survives a reload"; RNM; A11D "Rename project (light / dark)" | partial | e2e |
| PX47 | Rename error Alert |  | u:RenameProjectModal; PTS "Rename: a failed save shows its message in the dialog and keeps it open" *(routed)* | partial | unit+e2e |
| PX49 | Duplicate names allowed |  | PLM "two projects may share a name; each keeps its own key and page" (UI create + API rename) | gap | e2e |
| PX50–PX58 | Generate AI scaffold dialog: body names repo + path and the run's own `atlas/wf/…` branch, Generate → `POST …/generate-ai-scaffold {repo_id}` → run page; errors toast |  | u:GenerateAiScaffoldDialog; GAS (still looks on the Setup tab); PRG "Generate starts the AI Readiness run on the picked repo; it pushes its atlas/wf/… branch to GitHub and opens a PR" (real run: `repo_ids`, push to the fake GitHub, fake `gh pr create`, workflow reused on a 2nd Generate); PRG "a repo without a credential or not cloned is refused with the reason"; GAS "opens from Project actions…", "Generate on a repo with no credential toasts the refusal…" | unit only | unit+e2e |
| PRR1–PRR10 | Rail "Health · 30 d": PRs merged, Specs accepted first try, Median time to PR, Tasks that needed you, caption |  | u:ProjectRightRail; A11 (renders, axe) | unit only | unit+e2e |
| PRR11–PRR15 | "Active agents" + "All →", running / idle |  | u:ProjectRightRail; PTS "Active agents lists agents on open Tasks, idle or running, and links to /agents" | gap | unit+e2e |
| PRR16–PRR21 | Rail "Guard-rails" + **Edit →**, now listing the active rule titles |  | u:ProjectRightRail; PTS "the rail hides on Guard-rails…" (active titles, Edit →, paused rule drops out) | unit only | unit+e2e |
| PRR22–PRR29 | Team card switch / subscriber warning |  | TC; u:ProjectTeamCard | yes | unit+e2e |

## 3. Overview, Tasks and History tabs

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| PO1–PO2 | Overview default; `?tab=overview` |  | PD; PTF | yes | e2e |
| PO3 | Skeleton while counts load |  | u:OverviewTab; PTS "Overview: skeleton while counts load…" *(held request)* | unit only | unit+e2e |
| PO4 | Counts error → "Could not load the overview — …" + Retry |  | PTF "a failed overview, tasks or history load…" *(routed)*; u:ProjectDetail | gap | unit+e2e |
| PO7–PO9 | "Open tasks" = Tasks not done; caption "{n} awaiting pickup" / "all picked up" |  | PTF "the three tiles equal the database…" (SQL) | unit only | e2e |
| PO10–PO13 | "Tasks in flight" = in progress + in review; "{n} waiting info" / "queue is empty" / "none waiting on you" |  | PTF (SQL) | unit only | e2e |
| PO14–PO18 | "AI Cost ({Month})" = completed runs + closed sessions this month, `$x.xx`; caption title "Completed agent runs and closed terminal sessions this month: N runs · M sessions · T tokens (input, output, cache read and write)" | tokens now include cache writes | PTF (55 runs, SQL sum) | unit only | e2e |
| PO20 | Every tile carries a caption title |  | PTF (title of tile 3) | gap | e2e |
| PO21 | Tiles agree with other surfaces |  | PTF (SQL = same rule as `/api/counts`) | gap | e2e |
| PO22–PO25 | "Recent activity" newest 5, empty "No recent activity yet" |  | PTF (5 rows, newest first); u:OverviewTabContent; PTX "History and Recent activity show a new run and its finish without a reload" | unit only | unit+e2e |
| PO26 | Runs error → "Could not load recent activity — …" + Retry |  | u:OverviewTabContent; PTS "Overview: … a failed runs load says "Could not load recent activity" with Retry" *(routed)* | gap | unit+e2e |
| PO28–PO32 | Row: agent chip, item link, run-status pill, **View run** → `/agents/:a/runs/:r`, time |  | PTF (href of the newest); u:OverviewTabContent; A11D "project overview" (all run-status pills, axe light / dark) | partial / gap | unit+e2e |
| PO34 / PH18 | Runs refresh on run SSE (`['runs','project',id]`, `['runs','item',id]` under `['runs']`) | fixed this branch (`hooks/useAgents.ts`) | PTX "History and Recent activity show a new run and its finish without a reload" (real `POST /api/run`, SSE); PTX "a Task page refetches its runs when a workflow run works it"; u:useSSE | gap | unit+e2e |
| PT1–PT2 | "Tasks  N" tab, deep link |  | PTF "the Tasks tab lists exactly this project's Tasks…" | unit only | e2e |
| PT4 | Tree error → "Could not load tasks — …" + Retry |  | PTF *(routed)* | gap | e2e |
| PT5–PT6 | "Showing **N** tasks in this project"; **Open in Tasks** → `/tasks?project=<name>` and that page scopes to it |  | PTF | unit only | e2e |
| PT7 | A Task made on `/tasks/new` appears here |  | TF "Submit with no workflow lands Ready…" | gap | e2e |
| PT8–PT22 | TaskTable inside the tab (headers, sort buttons, rows, footer) | see §6 | TF (same component on `/tasks`); u:TaskTable; A11D "project tasks tab" (every status chip) | unit only | unit+e2e |
| PT23–PT28 | Phone list, paging, fit |  | PTM "project tasks…"; u:MobileTaskList | partial | unit+e2e |
| PH1–PH4 | History tab, skeletons |  | PD; PTF | yes | e2e |
| PH5 | Runs error → "Could not load agent activity — …" + Retry |  | PTF *(routed)* | gap | e2e |
| PH6–PH7 | "Agent activity · N · $x.xx total" |  | PTF "lists every run with its total…" (SQL) | unit only | e2e |
| PH8 | Empty "No agent activity yet for this project." |  | A11 (seed project has none); u:HistoryTabContent; PTX (empty state before the first run) | unit only | unit+e2e |
| PH10–PH14 | Row: item link, status pill, **View run**, cost, time |  | PTF (hrefs); u:HistoryTabContent; A11D "project history" (all six run statuses, axe light / dark) | unit only / gap | unit+e2e |
| PH16 | 50 a page, "Show K more of R" |  | PTF (55 runs → 50 → 55) | gap | e2e |

## 4. Guard-rails tab (project) and `/guardrails`

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| PG1–PG5 | Redirect routes, deep link, tab, Suspense fallback |  | u:ProjectGuardrails; PTF; ND | partial | unit+e2e |
| PG10–PG12 | Sub-tabs "Rules  N" / "Scripts  N" (local state) |  | PTF (counts follow add / delete) | unit only | e2e |
| PG13 | Rules / scripts load error → "Could not load this project's rules — …" / "Could not load scripts — …" + Retry |  | PTF "a failed rules load says so with Retry" *(routed)*; u:ProjectGuardrailScriptsTab | gap | unit+e2e |
| PG14 | "Rules every agent must respect inside this project · {n} active" |  | PTF ("· 0 active" after a pause) | gap | e2e |
| PG16–PG18 | Info card "Guard-rails are active" + "Enabled" + read-only switch, now named "Guard-rails enabled" |  | A11 (axe `label`); u:ProjectGuardrails | gap | unit+e2e |
| PG20 | Empty "No guard-rails yet for this project" + **Add first rule** |  | PTF | unit only | e2e |
| PG24–PG25 | Card "Active" / "Paused"; switch "Pause {title}" / "Resume {title}" → `PATCH …/toggle`, persisted across reload |  | PTF "a rule is added, edited, paused (persisted) and deleted…" | unit only | e2e |
| PG26 | Toggle failure → toast "Could not update guard-rail" |  | u:ProjectGuardrails; PTS "a failed pause toasts "Could not update guard-rail"…" *(routed)* | gap | unit+e2e |
| PG27 | Toggle / PATCH / DELETE under another project id → 404, rule untouched |  | PTF (API, all three); u:api-G | new | unit+e2e |
| PG28 | Edit ("Edit {title}" → "Edit guard-rail" → **Save changes** → "Updated guard-rail — {title}") and delete ("Delete {title}" → "Delete this rule?" / `Removes "{title}" from this project. Agents won't see it on their next run.` → **Delete** → "Deleted guard-rail — {title}") | the draft had no UI for either | PTF | unit only (API) | e2e |
| PG29–PG32 | "Add guard-rail": Title, Rule; **Add rule** disabled until both; toast "Added guard-rail — {title}" |  | PTF; PTX "Add guard-rail has Title and Rule only…" | unit only | e2e |
| PG33 | "Applies to (optional)" field | removed | PTX "Add guard-rail has Title and Rule only — the old "Applies to" field stays gone" (absence + exactly two textboxes) | gap | e2e |
| PG34–PG36 | Submit failure toast; Cancel; Enter |  | u:ProjectGuardrails; PTS "… a failed add toasts its reason and keeps the dialog; Enter in Title does not submit" *(routed)* | gap | unit+e2e |
| PG37–PG41 | Scripts header copy; "Loading…"; empty "No project scripts yet" + **Add first script**; card (name, "check-{id}.sh", description) | mojibake fixed | PTF "a project script is added, edited and deleted…" | unit only | e2e |
| PG42–PG44 | Add → "Project script added"; edit (Slug disabled, **Save changes**) → "Project script updated"; delete now confirms: "Delete this script?" / `Removes "{name}". Agents no longer get it from the next run.` → "Project script deleted" |  | PTF; u:ScriptModal | unit only | unit+e2e |
| PG45–PG47 | Override chips; duplicate slug 409; cross-project 404 |  | u:ProjectGuardrailScriptsTab; u:api-GS; PTS "a project script can override a workspace script by its chip; a duplicate slug 409s; another project 404s" | unit only / new | unit+e2e |
| PG48 | Writes reach `/projects/:id/guardrails` |  | PTF (API read-back after every write) | gap | e2e |
| PG49–PG60 | ScriptModal fields, validation, server error, Cancel / Escape |  | SCM; PTF (fields, Slug disabled in edit); u:ScriptModal; A11D "Add project script (light / dark)" | partial | unit+e2e |
| PG61–PG62 | Header pill and rail now follow active rule rows |  | u:ProjectHeader, u:ProjectRightRail; PTS "the rail hides on Guard-rails…" (pill and rail follow the active rule; pausing drops it) | gap | unit+e2e |
| PG63–PG111 | Global `/guardrails`: header, stats, Rules / Scripts tabs, 5 category cards, rule rows, GuardrailModal add / edit / delete, sticky save bar, scripts tab | unchanged by this pass | GR; GT; GRM; SCM; u:Guardrails & friends; GG "a rule is added with its category and severity, edited, survives a reload, and is deleted after a confirm"; GG "Save Guard-rails stamps the set and resets the counter; Discard only clears the counter"; GG "a blank rule cannot be added; the API refuses a bad category or severity"; GG "keyboard: rows, category chips and severity cards work with Tab, Enter and Space"; GG "a script is added, edited (slug locked) and deleted after a confirm; bad input is refused" | yes / unit only | unit+e2e |
| PG112 | axe + keyboard on the project tab |  | A11 "project guard-rails…" (6 axe runs + Tab walk) | gap | e2e |
| PG113 | Phone / iPad layout of the project tab |  | PTM "project guard-rails…" | partial | e2e |

## 5. Repos, Jira, Setup tabs

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| PR1–PR3 | `?tab=repos`, "Repositories" + helper |  | PTF; RWP | partial | e2e |
| PR6 | Load error → `RetryAlert` "Could not load the repos" + API message + Retry | fixed this branch (`ProjectReposCard.tsx`) | u:ProjectReposCard; PRG "a failed repo load says so with Retry; Retry recovers" *(routed)* | gap | unit+e2e |
| PR7–PR14 | Empty state; rows `repo-row-<name>` with branch chip, clone chip, auto-fetch chip, URL; no primary |  | RWP; MR; PTF | yes | e2e |
| PR10 | Clone chip "Ready" now in `successFg` (AA on its fill) |  | A11 (axe, Repos tab); u:CloneStatusChip | unit only | unit+e2e |
| PR11–PR12 | "Auto-fetch · weekly" chip appears after save and goes after turn-off; tooltip "Next fetch …" |  | PTF "auto-fetch: weekly saves its weekday…"; PRG "the auto-fetch preset and conflict cards work by keyboard…" ("Auto-fetch · every 4h") | unit only / gap | e2e |
| PR20–PR21 | "Actions for {name}" → Edit · Auto-fetch schedule… · **Pull from remote…** · Open folder · Remove |  | PTF; RCM; AFM | yes | e2e |
| PR25–PR26 | Open folder → toast "Opened in {app}" / "Could not open folder" |  | u:ProjectReposCard; PTS "Open folder toasts where it opened, or that it could not" *(routed: a real call would launch the desktop file manager)* | unit only | unit+e2e |
| PR27–PR36 | Remove confirm "Remove {name}?" / "…The folder stays on disk." |  | RWP | yes | e2e |
| PR40–PR45 | Edit: "Edit {name}", "Default branch" → **Save** → "Saved {name}", persisted (reload + API) |  | PTF "Edit saves the default branch…"; PRG "Edit: Cancel and Escape discard…" | unit only | e2e |
| PR46–PR48 | Edit Cancel / Escape; manage link; unchecked branch |  | PRG "Edit: Cancel and Escape discard; the branch is saved unchecked; manage in Settings leaves for Credentials" (no PATCH on Cancel / Escape; a branch the remote lacks is stored as typed — there is no check, by design of the API) | gap | e2e |
| PR50–PR68, PR90–PR108 | Add repo dialog (clone / connect), CredentialSelect, ConnectErrorDetails | runs offline against the fake GitHub | u:ProjectReposCard; u:AddRepoDialog; u:api-P; PRG "a clone runs for real: the folder lands in the workspace, the dialog closes on its SSE with "Repo added — alpha""; PRG "a second repo with the same name is refused in the dialog (409)"; PRG "a clone that fails shows git's error; Edit details returns to the form with the values kept"; PRG "the form refuses a non-GitHub URL and a bad name before posting"; PRG "the Add repo dialog is axe-clean and its controls work by keyboard"; PRG "a folder whose origin is the URL is registered as is…"; PRG "an origin that is not the URL: "Remote URL mismatch"…"; PRG "a remote the credential cannot reach: "Credential cannot reach remote""; PRG "a folder that is not there: "Folder does not exist"; a plain folder: "Folder is not a git repository""; PRG "a folder another project already registered is refused, naming it"; A11D "Add repo"; PTM "Add repo (connect) fits the screen" | unit only | unit+e2e |
| PR120 | Pull from remote = status → stash (dirty) → `fetch --prune` → `pull --ff-only`; nothing re-cloned |  | PTF (real git: local bare origin + clone); PRG "Pull from remote fast-forwards the cloned repo after a push to GitHub" | unit only | e2e |
| PR122–PR123 | "Pull from remote?" / "Pulling from remote…" / "Pulled from remote" / "Pull failed" | renamed from Re-clone | RCM; PTF | yes | e2e |
| PR126–PR127 | Status table: Local HEAD, Remote HEAD, Behind "1 commits", Uncommitted "clean" / "1 modified files" |  | PTF (behind by one, then dirty) | yes | e2e |
| PR128 | Status error "Could not read git status. Is the workspace folder still on disk?"; Pull disabled |  | PTF "Pull from remote on a folder that is gone…" | unit only | e2e |
| PR129 | Dirty: "{n} uncommitted files will be stashed to .git/atlas-stash/ before pulling. Restore them afterwards with git stash pop." | path fixed this pass (said `.atlas/stash/`) | PTF "a dirty tree is named and stashed first"; u:RecloneProjectModal | unit only | unit+e2e |
| PR130 | **Pull** (clean) / **Stash & pull** (dirty) |  | PTF (both, real fast-forward, file lands in the clone) | unit only | e2e |
| PR132 | Credential deleted → "Original credential was deleted" + "Manage credentials →" |  | u:RecloneProjectModal; u:RR; PTS "Pull on a repo with no credential says so with "Manage credentials →"…" | unit only | unit+e2e |
| PR133–PR137 | Steps "Stash local changes" / "Fetch from remote" / "Fast-forward default branch"; success "Fast-forwarded N commit(s)" / "Already up to date" / "Pull complete" + " · n files changed" + stash path; "git · transcript" |  | PTF (success view, stash path under `.git/atlas-stash/`); u:RecloneProjectModal | unit only | unit+e2e |
| PR139 | Error view |  | u:RecloneProjectModal; u:RR; PTS "… a pull whose remote is gone ends in the error view" ("Pull failed") | unit only | unit+e2e |
| PR142 | A failed pull leaves a `reclone_failed` notification "Pull failed on "{repo}": …" |  | PTF (API pull on a missing folder) | gap | e2e |
| PR160–PR166 | Auto-fetch modal load, heading follows the switch ("Auto-fetch schedule" / "Auto-fetch enabled"), presets `aria-pressed` |  | PTF; AFM; A11D "Auto-fetch schedule (light / dark)" | partial | e2e |
| PR167 | Weekly picks Mon by default and saves it; Fri saves 5 |  | PTF (Fri → `weekday: 5`, read back) | unit only | e2e |
| PR174–PR175 | **Save schedule** / **Done** send the switch's state; off + Done stores `enabled=false` | the draft's "switch can't turn it off" is fixed | PTF (API read-back) | unit only | e2e |
| PR177 | Save error box |  | u:AutoFetchScheduleModal; PTS "Auto-fetch: a failed save shows its error in the dialog and keeps it open" *(routed)* | unit only | unit+e2e |
| PR180 | Round trip after reopen (preset + weekday shown) |  | PTF | gap | e2e |
| PR181 | Preset / policy cards (`SelectableCard`) by keyboard | fixed this branch (`components/SchedulePresetFields.tsx`) | PRG "the auto-fetch preset and conflict cards work by keyboard and save what was picked" (Tab, Enter, Space, focus ring, saved `every_4h` + `stash`) | gap | e2e |
| PR190 | Auto-fetch run (`POST …/schedule/fire`): a push to GitHub is fast-forwarded and leaves `autofetch_success`; a fetch that fails leaves `autofetch_failed` "Auto-fetch on "{project}/{repo}": fetch failed…" in the In-App Feed and `last_run_status=failure`; no credential → "Auto-fetch skipped on … no credential attached."; a disabled schedule does nothing | | PRG "a fetch after a push to GitHub fast-forwards the folder and leaves an autofetch_success note"; PRG "a fetch that fails leaves an autofetch_failed notification the Owner sees"; PRG "a repo with no credential is skipped with a note saying so; a disabled schedule does nothing" | new | e2e |
| PJ1–PJ63 | Jira tab: sources card ("Sync now" now syncs only this project, toast "Jira sync for {project}: …"), alerts, source dialog, status mapping |  | JB; JM; SA; u:ProjectJiraCard; u:JiraStatusMapCard; A11 (axe + Tab) | yes / unit only | unit+e2e |
| PS1–PS38 | Setup tab: Default workflow card; repo list with "Edit setup scripts for {repo}" → dialog with ".sh" / ".ps1" editors, discard prompt, secrets help |  | ST (full); u:SetupTab; u:DefaultWorkflowCard; PTM; A11; PTX "a failed workflows load shows Retry instead of a "None" default; the picker waits while loading" *(routed + held)*; A11D "Setup scripts"; PTM "Setup scripts fits the screen" | yes | unit+e2e |
| PS40 | Setup scripts run for real: the `.sh` saved on the Setup tab runs in the new worktree when a terminal session starts, with `${variable.KEY}` from Manage Secrets; a failing script refuses the session (400 `project_setup_failed`, output shown, secrets masked `***`, worktree removed); an unknown `${variable.KEY}` is refused before anything runs | the workflow path (step `setup_failed` → run parks → `workflow_run` notification, event key `workflow.failed`) only runs with the real CLI: `agent-runner.ts:1871` gates setup on `ATLAS_AI_ENABLED=true`, which the e2e API leaves off on purpose and which `/api/settings/env` refuses to change (`routes/settings.ts:27`) | PTX "the .sh saved on the Setup tab runs in the session's worktree with ${variable.KEY} from the project's secrets"; PTX "a failing script refuses the session (400 project_setup_failed) with its output, secrets masked, and leaves no session"; PTX "an unknown ${variable.KEY} is refused before anything runs"; PTX "the API keeps project secrets out of list reads"; u:api `services/workflow-engine.integration.test.ts` "parks when a step errors or its setup fails", `services/project-setup-runner.test.ts`, `routes/cli-sessions.test.ts` "returns 400 and tears down the worktree when the setup script fails" | new | unit+e2e |

## 6. Manage Secrets (`ProjectEnvSecretsModal`)

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| PXS1–PXS5 | Menu → dialog named "Project Secrets" (`aria-labelledby`) |  | PEM; PSF; A11; A11D "Project Secrets (light / dark)" | yes | e2e |
| PXS8–PXS12 | Close / Escape / Cancel discard, no confirm |  | PEM; A11 (Escape) | partial | e2e |
| PXS13–PXS16 | Encryption notice / no-repos warning (Save off) |  | u:ProjectEnvSecretsModal; PTS "a project with no repos warns and keeps Save off; otherwise the encryption notice shows" | unit only | unit+e2e |
| PXS17–PXS19 | Search by key, "No keys match your search." |  | PEM; u:ProjectEnvSecretsModal | yes | unit+e2e |
| PXS20 / PXS55–PXS61 | **Import** a JSON file → merges, NEW chip, "Imported 2 secrets (skipped 1: 1 bad key)" |  | PSF "Import merges a file…" | partial | e2e |
| PXS21–PXS22 / PXS62 | **Export** (off at 0 rows) → `<project>.secrets.json` with every stored value |  | PSF "Export downloads every stored value…"; "add two secrets…" (off when empty) | partial | e2e |
| PXS23–PXS26 | **Reveal all** → **Hide all**; plaintext dropped on hide |  | PSF "add two secrets, save, reload; reveal one, then all, then hide all" | unit only | e2e |
| PXS28 | List returns keys only; rows start masked and empty |  | PSF (after reload) | unit only | e2e |
| PXS29 | Loading spinner; **Save secrets**, **Add variable**, **Import** disabled until the stored set loads |  | PSF "Save, Add variable and Import wait for the stored set…" *(routed: held GET)* | gap | e2e |
| PXS30 | Empty "No secrets yet — click "Add variable" to create one." |  | PSF | unit only | e2e |
| PXS31 | Load error → `role=alert` "Could not load this project's secrets. Close and try again."; Save and Add stay off |  | PSF *(routed)* | gap | e2e |
| PXS33–PXS37 | NEW chip; key upper-cased; "Key required" / "UPPER_SNAKE_CASE only" / "Duplicate key" block Save |  | PSF "a bad, blank or duplicate key blocks Save…" | unit only | e2e |
| PXS39–PXS47 | Row **Reveal** → plaintext + **Hide**; masked placeholder |  | PSF | unit only | e2e |
| PXS48–PXS52 | Copy |  | u:ProjectEnvSecretsModal; PTS "Copy puts the value on the clipboard (a stored row is revealed first)…" (clipboard read back) | unit only | unit+e2e |
| PXS54 | Remove (local until Save) |  | u:ProjectEnvSecretsModal; PTS "… Remove only lands on Save" (API still has it until Save) | unit only | unit+e2e |
| PXS65–PXS68 | "N unsaved change(s)" / "no unsaved changes"; Save off when clean |  | PSF | unit only / gap | e2e |
| PXS70 | Save sends `{ key, keep: originalKey }` for untouched stored rows — no reveal request fires, the value survives |  | PSF "Import merges a file; Save keeps the untouched row without revealing it" (request log + API reveal) | unit only | e2e |
| PXS72–PXS73 | "Project secrets saved" + close / "Could not save secrets" |  | PSF; u:ProjectEnvSecretsModal | unit only | unit+e2e |
| PXS80–PXS84 | PUT 400s (`Invalid key "lower_key" — must be UPPER_SNAKE_CASE`, duplicate, shape) |  | PSF (lowercase key); u:api-P; u:PEF | unit only | unit+e2e |
| PXS75 | Keyboard |  | A11 (opened by Enter from the menu, Escape closes) | partial | e2e |

## 7. `/tasks`

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| T1 | h1 "Tasks" |  | TS; TF | yes | e2e |
| T2–T4 | Subtitle "{N} task(s)[ · {project}][ · {M} ready]" counts the rows on screen (every filter, archived hidden unless shown) | was `stats.total` + global "awaiting pickup" | TF (every filter: project, status, AI, search, archived) | unit only / partial | e2e |
| T5 | "Show archived" → `?include_archived=true` shows Tasks done > 7 days |  | TF "Show archived adds the Task closed 10 days ago…" | unit only | e2e |
| T6 | Table / Kanban toggle, remembered |  | KB; TF (Kanban remembered after reload) | yes | e2e |
| T7 | **New task** (disabled with no projects) | casing now "New task" everywhere | TS; PTM | yes | e2e |
| T8–T9 | Phones: FAB "New task"; Show archived stays |  | PTM "tasks list…", "New Project and New task open from their FABs…" | gap | e2e |
| T10 | "All" / "Assigned to me" / "Assigned to AI" counts and `?filter=` |  | TF (SQL counts, AI filter) | unit only | e2e |
| T11–T12 | "By project:" shows the pick (was stuck on "any"), ✓ on it, "Any" clears; `?project=<name>` |  | TF "By project shows the pick…" | partial / gap | e2e |
| T13 | "Status:" Any, Draft … Done; `?status=` |  | TF; A11 (Enter / Space / arrows) | unit only | e2e |
| T14 | "Search tasks" matches title, description **and id** |  | TF ("WTK-5", "burrow") | unit only | e2e |
| T15 | `/` focuses search |  | TF | unit only | e2e |
| T16 | Filters survive reload |  | TF (status) | gap | e2e |
| T20 | Loading skeletons |  | PTX "skeleton rows show while the Tasks request is in flight, never the empty state" *(held request)* | gap | e2e |
| T21 | No projects: "No projects yet" / "Create a project first, then add tasks." / **Go to Projects** |  | u:Tasks; PTS "no projects at all: "No projects yet" / … / Go to Projects" *(routed)* | unit only | unit+e2e |
| T22–T23 | "No tasks match this view." (+ **New task** on desktop) |  | TF | unit only | e2e |
| T24 | List load error → `RetryAlert` "Could not load tasks" / "Could not load projects" + Retry | fixed this branch (`pages/Tasks.tsx`) | PTX "a failed Tasks load says "Could not load tasks" with Retry, not an empty list; Retry recovers"; PTX "a failed projects load says "Could not load projects" with Retry…"; PTM "a failed Tasks load and its Retry fit the screen @mobile / @ipad" *(routed)*; u:Tasks | gap | unit+e2e |
| T30–T32 | Columns, row content, row (a `role=button`, Enter opens) → `/tasks/:id` |  | TS; TF; A11 (Enter on a row); A11D "tasks table" (every status chip) | yes | e2e |
| T33 | Sort buttons "Sort by ID" / "Task, sorted ascending" …; default Updated desc; ID numeric-aware |  | TF "sort by Task / ID / Updated…" | unit only | e2e |
| T34 | Footer "{N} tasks · page p of n", Rows 20/50/100/all, "First / Previous / Next / Last page" |  | TF | unit only | e2e |
| T35 | Virtualised body ≥ 60 rows on "all" |  | u:TaskTable; PTS "65 Tasks on "all" rows: the table virtualises, and scrolling reaches the last one" | unit only | unit+e2e |
| T40–T42 | Phone list rows, "Show N more of M", order |  | PTM; u:MobileTaskList | unit only / gap | unit+e2e |
| T50 | Kanban columns + counts |  | KB; TF; A11D "tasks kanban" | yes | e2e |
| T51–T53 | Card opens by click / Enter (`role=button`); "Drop here"; column paging |  | u:WorkItemKanban; PTS "Kanban: a card opens by click and by Enter; an empty column says "Drop here"; a full column pages with "Show more"; cards are draggable" | unit only | unit+e2e |
| T54 | Legal drop → `PATCH …/status`, persisted |  | TF "a legal drag moves the Task and persists…" | unit only | e2e |
| T55–T56 | Illegal drop → one toast `Can't move {id} to {Status}` + "From Draft you can go to: Ready, Waiting for Info. To force…" / "Done is terminal…" |  | TF "an illegal drop is refused with one toast…"; u:WorkItemKanban | unit only / gap | unit+e2e |
| T58–T59 | API refusal → exactly one toast: 422 "Cannot close — open children" + "{id} is not done yet." (no second "Couldn't move"); 409 / 400 "Couldn't move {id}" + reason |  | TF "closing a Task with an open sub-task is refused… exactly one toast"; u:useTasks | unit only | unit+e2e |
| T60 | Drag affordance |  | u:WorkItemKanban; PTS "Kanban: …cards are draggable" (`draggable`, cursor `grab`) | unit only | unit+e2e |

## 8. `/tasks/new`

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| TN1–TN3 | "New task", breadcrumb, subtitle and tips (workflow vs none) |  | TNs; u:TaskNew | yes / unit only | unit+e2e |
| TN4–TN5 | Title / Description required |  | TNs; TF | yes | e2e |
| TN6 | Project select; `?project=<id or name>` preselects |  | TF (`?project=<id>`); u:TaskNew | partial | unit+e2e |
| TN7 | Priority Low (default) / Normal / High / Urgent |  | TF (default Low stored `low`; High stored `high`) | yes | e2e |
| TN8–TN9 | Repos: first preselected, add more, order kept; no repos → info alert, buttons off |  | TF; MR; RWP | yes | e2e |
| TN10–TN12 | Workflow / Reporter / Assignee selects |  | u:TaskNew; PTS "/tasks/new: Workflow, Reporter and Assignee are stored; Submit with a workflow says it is starting" | unit only | unit+e2e |
| TN13 | **Save as draft** (phones "Draft") → "Saved as draft — {title}" → Draft |  | TF "Save as draft lands Draft…"; PTM | partial | e2e |
| TN14 | Submit with a workflow → "Submitted — {workflow} is starting" |  | u:TaskNew; WP; PTS "/tasks/new: … Submit with a workflow says it is starting" | unit only | unit+e2e |
| TN15 | Submit, no workflow → Ready + "Submitted — {title}"; a failed transition is toasted by the hook and the Task stays Draft |  | TF "Submit with no workflow lands Ready…" | unit only | e2e |
| TN16–TN17 | Invalid submit; create error toast |  | TNs; u:TaskNew | yes | unit+e2e |
| TN18 | Buttons off while pending / no repo |  | RWP; u:TaskNew | gap | unit+e2e |
| TN19–TN21 | Cancel, draft guard, phone footer |  | TNs; PTM; u:TaskNew | yes / unit only | unit+e2e |
| TN22 | Labels on the create form | not on this form (labels are set on the Task page) | TDF | — | e2e |

## 9. `/tasks/:id` and `/sub-tasks/:id`

| # | Element / state | Expected (current) | Tests | Before | After |
|---|---|---|---|---|---|
| TD1–TD2 / SD1–SD2 | Loading; "Task not found" / "Sub-task not found" + **Back to Tasks** |  | u:TaskDetail; u:SubTaskDetail; PTS ""Task not found" / "Sub-task not found" with Back to Tasks…" (real 404s) | unit only | unit+e2e |
| TD3 / SD3 | Shell title = id, subtitle "Task" / "Sub-task" (`useSetPageTitle` feeds the mobile app bar; `document.title` stays "Atlas") |  | PTX "the shell names the page by its id and kind ("Task" / "Sub-task"); the browser tab stays "Atlas"" (390px app bar) | gap | e2e |
| TD4 / SD4 | Breadcrumb Tasks › (parent) › id |  | TDs; SDs; TDF (clone keeps the parent) | yes | e2e |
| TD5 / SH77 | "Add related item" → "Link an item" / "Add dependency" |  | TDF "Link an item and Add PR link…" | unit only | e2e |
| TD6–TD7 / SD5, SD7 | "Task actions" → "Delete this task…" / "Sub-task actions" → "Clone item…", "Delete this sub-task…"; "Delete this task?" + impact; **Delete task** → `/tasks` (sub-task → its Task) with no 404 refetch |  | TDF "deleting a Task / sub-task navigates away with no 404 refetch"; CDd; A11; A11D "Delete task (light / dark)" | partial / unit only | e2e |
| TD8–TD9 / SD8–SD9 | Description / Acceptance criteria: **Edit** → **Save**; markdown headings are real headings (`#`→h3 … deeper→h6) under h2 card titles; persisted | fixed this branch (`MarkdownBody.tsx`, `EditableMarkdownCard.tsx`, `TaskDetail.tsx`, `ActivityCard.tsx`) | TDF "title, description and acceptance criteria save…" (both kinds); PTX "task detail / sub-task detail: card titles are h2 and markdown headings are h3–h6 under them"; TDF (`##` is an h4) | unit only | e2e |
| TD10–TD11 | Spec card, Pull request card |  | u:TaskDetail; PTS "the Spec and Pull request cards show when the Task has them; the rail lists its details" | unit only | unit+e2e |
| TD12 | Sub-tasks table · n, rows open |  | TDs; TDF (order) | yes | e2e |
| TD13–TD14 | **Reorder** → "Reorder sub-tasks" ("…runs its sub-tasks top to bottom, one at a time, skipping any that are in review or done."), "Move {id} up/down", **Save order** (off until changed) → persisted |  | TDF "Reorder moves a sub-task and the order persists" | unit only | e2e |
| TD15–TD17 | Add sub-task form + draft guard |  | TDs; u:TaskDetail | yes | unit+e2e |
| SD6 | Clone → "Copy of {title}" under the same Task, keeps priority / assignee / labels, `relates_to` the original; failure toasts "Couldn't clone {id}" / "Cloned as …, but couldn't link it…" |  | TDF "Clone item makes "Copy of …"…"; u:SubTaskDetail | unit only | unit+e2e |
| TD18 / SD11 | Rail rows (Project, Task, Repos, Status, Assignee, Reporter, Priority, Labels, AI cost, Created, Last updated, Branch, Path) |  | u:DetailsRailCard; PTS "… the rail lists its details" (labels, Project link, repo) | unit only | unit+e2e |
| TD19 / SD12 | Assign lock follows a **live workflow run** (not `in_progress`): lock icon "Locked while a workflow run works this item" on Status and Assignee, rows not clickable; API 409s meanwhile |  | TDF "the assign lock follows a live workflow run…" | unit only / gap | e2e |
| TD20 / SD13 | Refused status move → toast "Couldn't move {id}" + reason (409 / 400); 422 closure → "Cannot close — open children" + "… not done yet." |  | TDF "a refused save and a refused status move each toast…" *(routed 409)*; TDF "a Task with an open sub-task cannot close…" (real 422) | gap | e2e |
| TD21 / SD13 | Refused save (title / description / priority / labels) → "Couldn't save {id}" + reason, editor stays open; assign → "Couldn't reassign {id}" |  | TDF *(routed 500)*; u:useTasks, u:useSubTasks | gap | unit+e2e |
| SH3–SH4 | Title: click h1 or **Edit title** (shown on keyboard focus too) → Enter saves, Escape cancels, "Save title" / "Cancel title edit" |  | TDF; A11 ("Edit title" visible on focus) | unit only | e2e |
| SH13 / SH20 | Status row (`role=button`) → "Move to" + valid moves, "Override" + the rest |  | TDF (both kinds, four statuses); A11 (Enter / Escape, focus returns) | partial | e2e |
| SH14 | Done guard for unmerged PR links |  | u:DetailsRailCard; PTS "Done with an unmerged PR link asks "Mark done anyway?"; Cancel keeps the status, Mark done closes it" | unit only | unit+e2e |
| SH15 / SH22 | Assignee picker → agent → persisted |  | TDF "priority, labels and assignee persist" | unit only | e2e |
| SH17 / SH21 | Priority picker → persisted |  | TDF | unit only | e2e |
| SH18 | Labels: "Add labels" → "Type a label…" → Enter per label → saved once on blur |  | TDF | unit only | e2e |
| SH23–SH24 | Repos row, Branch / Path copy |  | MR; u:DetailsRailCard | yes | unit+e2e |
| SH60–SH66 | Workflow panel |  | WP; u:ItemWorkflowPanel | yes | unit+e2e |
| SH40–SH42 | Conversation: "Comment on this item…" + **Post**; cleared after |  | TDF "comments post, edit and delete…" (both kinds) | partial | e2e |
| SH45–SH46 | "Edit comment" (shown on hover and focus) → **Save** → "edited" badge |  | TDF | unit only | e2e |
| SH47 | "Delete comment" → "Delete this comment?" → **Delete** → gone (API) |  | TDF | unit only | e2e |
| SH33 | Comment markdown: GFM table → `<table>`, fenced block → `<pre>` that scrolls inside the page (no sideways scroll at 390px); both focusable | focusable since this pass | TDF; A11 (axe `scrollable-region-focusable`); u:MarkdownPreview; PTX (headings) | unit only | unit+e2e |
| SH48 / SH50–SH53 | Paging, activity log |  | u:ActivityCard; PTS "the activity log shows the newest 50 and pages earlier entries" (61 entries) | unit only | unit+e2e |
| SH71 / SH82 | **Add PR link**: bad URL "Enter a GitHub PR URL — …", **Add link** → "PR link added", row "#7" |  | TDF; PRd; A11D "Add PR link" | yes | e2e |
| SH73–SH76 / SH78–SH81 | Relates to / Blocked by / Tests sections; picker "Id or title" → "Linked to {id}" |  | TDF; LPd; A11D "Link an item" | partial | e2e |
| SH70 | Jira section |  | JM | gap | e2e |

## 10. Everywhere (12 routes: `/projects`, the 7 project tabs, `/tasks`, `/tasks/new`, `/tasks/:id`, `/sub-tasks/:id`)

| # | Check | Tests | Before | After |
|---|---|---|---|---|
| E1 | axe WCAG 2.1 A/AA, light and dark, at 390 / 834 / 1440 (12 × 6) | A11; A11D (every status chip on 6 views × light / dark × 1440 / 390, colour contrast unfiltered — the Draft filter is gone; 15 dialogs × light / dark); PRG (Add repo dialog) | gap (only Jira tab in SA) | e2e |
| E2 | No console errors through load | A11 (whole-test listener); `goto()` everywhere | partial | e2e |
| E3 | No sideways page scroll at 390 / 360 / 834 / 1440 | PTM; A11; PTM "Projects dialogs @mobile / @ipad"; PLM (long name at 390) | partial (iPad overview only) | e2e |
| E4 | Tab reaches every visible control on each route | A11 "Tab reaches every control" (12) | gap | e2e |
| E5 | Enter / Space open menus and dialogs; arrows inside menus and tab strips | A11 keyboard tests; GG keyboard; PRG auto-fetch cards; A11D | gap | e2e |
| E6 | Escape closes menus and dialogs; focus returns to the trigger | A11; A11D (Escape closes each dialog, focus back on its trigger); GG (focus back on the rule row) | gap | e2e |
| E7 | Key actions on screen and clickable on a phone (not under the bottom nav / FAB) | PTM (trial clicks) | gap | e2e |

## Fixed in this pass

Earlier passes (`fix/verify-projects-tasks`):

| What | Where | Test |
|---|---|---|
| Deleting a project from its own page lost the success view: the finished delete drops `['projects', id]`, the page fell to its skeleton / "Project not found" branch and unmounted the dialog (and a remount reset it to "Delete project?"), so "Project deleted" and **Back to projects** vanished. The dialog now holds its own copy of the project and renders in the same fragment slot on every branch. | `packages/web/src/pages/ProjectDetail.tsx:64,88,168-185,187,199,215,227` | u:PDdel (fails on the old code); PF "Delete in "Remove from Atlas only" mode…" |
| The dirty-tree warning said files are stashed to `.atlas/stash/`; the runner writes the patch to `.git/atlas-stash/`. | `packages/web/src/pages/projects/RecloneProjectModal.tsx:402` | u:RecloneProjectModal "shows uncommitted warning…"; PTF "a dirty tree is named and stashed first" |
| Fenced code blocks and wide tables scrolled but could not take keyboard focus (axe `scrollable-region-focusable`, WCAG 2.1.1). | `packages/web/src/components/MarkdownBody.tsx:92,133` | u:MarkdownPreview "makes fenced code and tables focusable…"; A11 task detail |
| The always-on guard-rails switch had no accessible name (axe `label`). | `packages/web/src/pages/ProjectGuardrails.tsx:497` | u:ProjectGuardrails "names the always-on guard-rails switch"; A11 project guard-rails |
| Repo clone chip "Ready" was #46A56A on its pale green fill, 2.6:1 (axe `color-contrast`). | `packages/web/src/components/CloneStatusChip.tsx:16-17` | u:CloneStatusChip "writes ready in the dark success tone…"; A11 project repos |
| Keyboard focus was invisible app-wide: CssBaseline set `*:focus-visible { outline: none }` (WCAG 2.4.7). Now a 2px brand-blue ring (theme-aware), on ButtonBase via `.Mui-focusVisible` too, inset on tabs and menu items; mouse focus and text fields unchanged. | `packages/web/src/theme/theme.ts` (`FOCUS_RING`, CssBaseline, MuiButtonBase, MuiTab, MuiMenuItem) | A11 "keyboard focus draws a ring; a mouse press does not" |

This branch (`fix/projects-tasks-open-items`):

| What | Where | Test |
|---|---|---|
| `/tasks` showed an empty list when the Tasks or projects request failed. Now `RetryAlert` "Could not load tasks" / "Could not load projects" + Retry. | `packages/web/src/pages/Tasks.tsx` (`projectsError` / `tasksError` branch) | u:Tasks; PTX "a failed Tasks load…", "a failed projects load…"; PTM "a failed Tasks load and its Retry fit the screen" |
| A failed repo load was a plain Alert; a failed workflows load showed the Default workflow select reading "None" (misstating the saved default). Now `RetryAlert`s; the select is disabled while loading. | `packages/web/src/pages/project/ProjectReposCard.tsx`, `DefaultWorkflowCard.tsx` | u:ProjectReposCard, u:DefaultWorkflowCard; PRG "a failed repo load says so with Retry"; PTX "a failed workflows load shows Retry instead of a "None" default; the picker waits while loading" |
| Projects page / rows were not in the URL; a page emptied by a delete stayed empty. Now `?page=&limit=` (defaults left out, replace navigation), junk → 1 / 20, past the end → last page. | `packages/web/src/pages/Projects.tsx` | u:Projects; PLM (3 tests) |
| History, Recent activity and an item's run list did not refresh on run SSE. Keys moved under `['runs']`. | `packages/web/src/hooks/useAgents.ts` | u:useSSE; PTX "History and Recent activity show a new run…", "a Task page refetches its runs…" |
| Status chip text colours were under 4.5:1 (Draft 3.8:1); the a11y spec filtered the Draft pair. Colours darkened to ≥ 4.6:1; the filter is gone. | `packages/web/src/theme/theme-vars.css`, `runStatusPalette.ts` | u:theme-vars; A11 (unfiltered); A11D "every status chip" (24 views) |
| Markdown headings were styled `<p>`s; card titles were text. Now `#`→h3 … deeper→h6 under h2 card titles (Description, Acceptance criteria, Spec, Pull request, New sub-task, Conversation, Activity log). | `components/MarkdownBody.tsx`, `EditableMarkdownCard.tsx`, `pages/TaskDetail.tsx`, `components/ActivityCard.tsx` | u:MarkdownPreview, u:EditableMarkdownCard, u:ActivityCard; PTX (both kinds); TDF |
| Add repo clone could miss a fast `clone_completed`: the client subscribed after the POST returned. The client now picks `clone_id` and subscribes first; the API accepts it. | `pages/project/AddRepoDialog.tsx`; `api/src/routes/projects.ts`, `services/clone-runner.ts`; `CreateProjectRepoSchema.clone_id` | u:AddRepoDialog, u:api-P, u:clone-runner; PRG "a clone runs for real…" (POST carries the id it subscribed with) |
| `SelectableCard` (auto-fetch presets / policies, workflow inspectors) and global guard-rail rows were not keyboard-operable. Now `ButtonBase`. | `components/SchedulePresetFields.tsx`, `pages/guardrails/GuardrailRuleRow.tsx` | PRG "the auto-fetch preset and conflict cards work by keyboard…"; GG "keyboard: rows, category chips and severity cards…" |
| New project `autoFocus` on Name: works in a production build; on the dev server StrictMode double-runs MUI's focus trap so focus lands on the paper (documented in A11, not a product bug). | `pages/projects/NewProjectModal.tsx` | A11 "Projects: chips by Enter / Space, New Project opens by keyboard…" |
| The Add repo / Edit repo credential picker had no accessible name (axe `aria-input-field-name`), and "manage in Settings" was an `<a>` without `href` — Tab never reached it. Now the select is named "Git credential" and the link is a button. | `packages/web/src/pages/projects/RepoFormParts.tsx:61-68,94` | u:AddRepoDialog "names the credential picker and makes "manage in Settings" a real button"; PRG "the Add repo dialog is axe-clean and its controls work by keyboard" |
| The Generate AI scaffold dialog promised a branch `atlas/ai-readiness`; the run pushes `atlas/wf/<run id 8>` (workflow-engine.ts:286). The copy now names the run's own `atlas/wf/…` branch. | `packages/web/src/pages/projects/GenerateAiScaffoldDialog.tsx:98` | u:GenerateAiScaffoldDialog "names the branch the run really pushes…"; PRG (branch read from `workflow_runs.branch` and found on the fake GitHub) |
| At phone width Project Detail had no heading at all: the h1 was `display:none` (the app bar shows the name as a `<p>`). The h1 is now visually hidden but still read. | `packages/web/src/pages/project/ProjectHeader.tsx:84-90`; `theme/tokens.ts:329` (`VISUALLY_HIDDEN`) | u:ProjectHeader "keeps the project name as the page h1 at every width…" (fails on the old code); PLM (390px) |
| Dialog controls with no accessible name (axe `button-name`, `label`): the × in Rename / Delete project / Auto-fetch / Pull from remote, Delete project's two mode radios (also wired to `onChange` + one `name` so arrows move between them), Auto-fetch's switches and Time of day / Branch fields. Auto-fetch's Save was white on success green, 2.9:1; it now uses the primary-button fill. | `pages/project/RenameProjectModal.tsx:130`; `pages/projects/DeleteProjectModal.tsx:320,378-385,432-439`; `AutoFetchScheduleModal.tsx:122,172,283,312,496`; `RecloneProjectModal.tsx:292` | u:RenameProjectModal, u:DeleteProjectModal, u:AutoFetchScheduleModal, u:RecloneProjectModal ("names its Close button…"); A11D "dialogs" (15 × light / dark) |
| e2e infrastructure: a fake `gh` on the e2e API's PATH answers `pr create` for fake-GitHub repos (logged to `gh-calls.jsonl`) and fails everything else like gh offline, so a workflow's "open a PR" step runs without api.github.com. | `e2e/fixtures/fake-gh/`, `e2e/global-setup.ts`, `e2e/helpers/fake-github.ts` | PRG "Generate starts the AI Readiness run…" |
| `POST` / `PATCH /api/projects` accepted a whitespace-only name (`"   "` → 201); only the UI trimmed. The shared schemas now `.trim()` the name before `min(1)` (owner-approved shared change). | `packages/shared/src/schemas/index.ts` `CreateProjectSchema`, `UpdateProjectSchema` | u:api-P "returns 400 for a whitespace-only name and stores a padded one trimmed" |

## Open

| Row | What | Why it is left |
|---|---|---|
| P75 | Table "Repos" cell says "—" where the card says "No repos". | A copy choice, asserted as is (PF); not a defect. |
| PS40 (workflow path) | Setup failure inside a workflow run (`setup_failed` → park → `workflow.failed` notification) has no e2e. | Only reachable with the real CLI: `agent-runner.ts:1871` runs setup inside the `ATLAS_AI_ENABLED=true` branch; the e2e API runs with AI off (simulated steps) and the flag is deny-listed from `/api/settings/env` (`routes/settings.ts:27`). Unit-tested (`workflow-engine.integration.test.ts` "parks when a step errors or its setup fails"); the terminal-session path of the same runner is e2e (PTX). |
