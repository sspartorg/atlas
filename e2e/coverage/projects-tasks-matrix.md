# Coverage contract: Projects and Tasks

Every finite thing the Projects area (`/projects`, `/projects/:id` and its seven
tabs, the header and its actions menu, Manage Secrets, the right rail, the
global `/guardrails`) and the Tasks area (`/tasks` table and Kanban,
`/tasks/new`, `/tasks/:id`, `/sub-tasks/:id`) can show or do, and the test that
proves it. A change that adds a row here (a control, a state, an error path, a
copy change) adds its test in the same change. Strings are quoted from source
on `fix/verify-projects-tasks` (2026-10-17). "Before" is the value the two
audit drafts gave the row (`yes` = e2e, `partial`, `unit only`, `gap`, `new`).

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

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| P1 | Route, h1 "Projects", sidenav | `useSetPageTitle('Projects')` | PS; `navigate-sidenav.spec.ts`; PF | yes |
| P2 | Fetches once on mount | `/projects/paged`, `/projects`, `/repos`, `/tasks`, `/agents`, `/settings`, `/schedules` | ND | yes |
| P3 | Paged clamping `page ≥ 1`, `1 ≤ limit ≤ 100`, `created_at desc` | | u:api-P | unit only |
| P4 | Loading | `BrandedFallback`, never the empty state | u:Projects | unit only |
| P5 | Load error | "Could not load projects — Something went wrong" + API message + **Retry** (not "No projects yet.") | PF "a failed load says so with Retry…" *(routed)*; u:Projects | gap |
| P6 | Empty-state branch | only when the paged total and the full list are both 0 | PF "no projects at all → the empty hero…" *(routed)*; u:Projects | unit only |
| P7 | Live refresh | `counts_changed` / `clone_completed` invalidate `['projects']`; a create shows without reload | PF "New project creates it end to end…" (back via sidenav, no reload) | unit only |
| P10–P11 | Header icon, subtitle "{N} project(s) · {T} task(s) · {S} sub-task(s)" (singular at 1) | N = server total | PF (subtitle before/after a create) | unit only |
| P12 | Singular forms "1 project" / "1 task" / "1 sub-task" | | u:Projects | gap |
| P13 | Header actions hidden below md; FAB "New Project" instead | | PTM "projects list…", "New Project and New task open from their FABs…" | partial |
| P14 | **New Project** (desktop) opens the modal | | NPM; PF | yes |
| P20–P22 | View toggle Cards (default) / Table (`aria-pressed`); re-click is a no-op | | PF "Cards ↔ Table…"; u:ViewToggle | unit only |
| P23 | Phones always show cards | | u:Projects; PTM | unit only |
| P24 | View resets to Cards on reload | | PF "Cards ↔ Table… the toggle resets on reload" | gap |
| P30–P32 | Chips "All", "My queue", "Software dev queue", "Marketing queue", "Content queue", "Design queue" with counts; All = My queue = every project | | PF "queue chips count every project…" | unit only |
| P33 | Category chip keeps projects with a Task on an agent of that category | | PF (Task assigned to the installed agent, SQL count) | unit only |
| P34 | Chip counts and category filters read **every** project, not the page (paging footer hides under a category) | | PF; u:Projects | gap (was page-only) |
| P35 | Chips are `role=button`, Enter / Space select | | PF; A11 "Projects: chips by Enter / Space…" | unit only |
| P36, P37 | Phone chip row scrolls; dark legibility | | PTM; A11 (dark, axe) | gap |
| P40–P48 | Card: grid columns, name `h2`, key chip, repo line / "No repos" / "N repos", counters "{n} tasks" / "{n} sub-tasks", auto-fetch icon + tooltip | | PF (name, key, "No repos", "1 tasks"); u:ProjectCard | unit only |
| P49 | "Last activity {relative}" | | u:ProjectCard | gap |
| P50 | **Open →** link → `/projects/:id` | | PTM (on screen, clickable); u:ProjectCard | partial |
| P52 | "No projects match this filter." | | PF (an empty category) | unit only |
| P60–P62 | Row menu "Project actions" → "Delete project…" → DeleteProjectModal | | DPM | yes |
| P63 | Menu Escape / arrows | | A11 "Project actions: Enter opens, arrows…" (detail page menu) | gap |
| P70 | Table headers "ID", "Project", "Repos", "Tasks", "Sub-tasks", "Last Activity", "Owner" | header was "Repo URL" in the draft | PF "Cards ↔ Table…" | unit only |
| P71–P72 | Default Last Activity desc; header click sorts (`aria-sort`) | | PF (sort by Project); u:ProjectsTable | unit only |
| P75 | Repos cell: names, "—" when none (the card says "No repos") | | PF | unit only |
| P79 | Row click → project | | PF | unit only |
| P90–P93 | Footer only past `limit`: "Showing a–b of N", Rows 10/20/50/100, pagination | | PF "paging: past 20 projects…" (page 2, `?page=2&limit=20`, Rows 50) | unit only |
| P94–P95 | Page/limit not in URL; page past the end after a delete | | — | gap |
| P100–P103 | Empty hero "No projects yet." / "A project holds your Tasks and the repos they work on…" / card "Add your first project" + **New Project**; hint "Cloning a private repo?" with a real "Settings → Credentials" link while no credential exists | | PF "no projects at all…" *(routed)*; u:ProjectsEmptyState | unit only |
| P110–P115 | FAB on phones; padding; no sideways scroll at 390/360/834; axe light + dark | | PTM; A11 | partial |

### 1.1 New project modal

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| P120–P121 | "New project" + "A project holds your Tasks and its repos. You'll add repos next."; fields Name / Issue key prefix / Description only | | NPM | yes |
| P122–P123 | Prefix follows the name ("Quokka Web" → "QUO") until typed over; A–Z only, 3 max | | PF; u:NewProjectModal | unit only |
| P124–P129 | Helper: "Item ids … become {PREFIX}-1…", "Exactly 3 uppercase letters.", "Checking availability…", "Available. New items will be QUO-1, QUO-2, …", `Already used by "<name>"`, invalid | | PF (Available, taken by the project just made); u:NewProjectModal | unit only |
| P130 | Probe fails / times out → "Couldn't check availability. Create still refuses a prefix that's taken." and Create stays usable | | u:NewProjectModal | gap (was a hang) |
| P131 | Create enabled only with a name and an ok (or unverified) prefix | | NPM; PF | yes |
| P132 | Publisher checkbox "Include in team config — …" | | u:NewProjectModal; TC | unit only |
| P133–P134 | **Create project** → `POST /api/projects` → `/projects/:id?tab=repos`; the list shows it without a reload | | PF "New project creates it end to end…" | unit only / gap |
| P135–P137 | Server error / 409 / Zod 400 in the Alert, modal stays | | u:NewProjectModal; u:api-P | unit only |
| P138–P140 | Cancel, Close (`aria-label="Close"`), Escape | | NPM; PF; A11 (Escape returns focus to **New Project**) | yes |
| P141–P142 | Enter does not submit; reopen resets | | — | gap |

### 1.2 Delete project (from the list or the detail page)

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| P150–P152 / PX61–PX69 | "Delete project?" + "Choose what to remove. This cannot be undone."; project chip with every repo folder (or "No repos"); "Remove from Atlas only" (default) / "Delete project and content" + type-the-name | | DPM; PF (repo folder in the chip); u:DeleteProjectModal | partial |
| P153 / PX70 / PX73–PX77 | Submit → `POST /api/projects/:id/delete {mode, delete_id}` → "Deleting project…" / "Deleting in the background." + "Step n of 1" (unregister) / "of 2" (purge, "Remove repo folders" first) + live output | | PF; u:DeleteProjectModal | unit only |
| P154 / PX80–PX83 | "Project deleted" + "Unregistered from Atlas. Workspace folder kept on disk."; **Back to projects →** → `/projects` without the project; DB rows gone; `GET` 404 | from the detail page this view now survives the project's own 404 (fixed this pass) | PF "Delete in "Remove from Atlas only" mode…"; u:PDdel; u:DR | gap |
| P155 / PX84–PX85 | Error view "Delete failed" / "A delete step failed." + Close / Try again | | u:DeleteProjectModal | unit only |
| P156 / PX72 | Cancel / Escape, blocked while deleting | | DPM | yes |
| PX79 | Purge keeps a folder outside the workspace root | | u:DR | gap |

## 2. `/projects/:id` — shell, header, actions menu

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| PX1–PX3 | Route; one fetch each of project, repos, agents, settings, counts, tree | | WD; PD; ND | yes |
| PX4 | Loading skeletons | | u:ProjectDetail | gap |
| PX5 | 404 → "Project not found" + **Back to Projects** | | u:ProjectDetail | unit only |
| PX6 | 500 / network → "Could not load this project — …" + Retry (not "Project not found") | | u:ProjectDetail | gap |
| PX7 | Mobile app-bar title = project name, subtitle "Project" | | PTM (header fits) | gap |
| PX8–PX9 | **Refresh project data** | | u:ProjectDetail | unit only |
| PX10–PX13 | Seven tabs Overview, "Tasks  N", Guard-rails, Repos, Jira, Setup, History; `?tab=` deep link; arrows move between tabs | | PTF (each tab's deep link + `aria-selected`); PTM "the project tab strip scrolls to every tab at 360px"; A11 (ArrowRight → Tasks, Enter) | partial |
| PX14 | Right rail hidden on Guard-rails | | u:ProjectDetail | unit only |
| PX15 | Overview "Full history →" → `?tab=history` | | PTF "the three tiles equal the database…" | unit only |
| PX16 | `/projects/:id/guard-rails` and `/guardrails` redirect to `?tab=guardrails` | | u:ProjectGuardrails; ND | yes |
| PX18 | No sideways scroll on every tab at 390 / 360 / 834 / 1440 | | PTM; A11 | yes (iPad overview only) |
| PX20–PX25 | Breadcrumb, h1, key, repo-count pill ("Add a repo" / "1 repo" / "N repos" → Repos tab), "Guard-rails active" pill (now driven by the project's **active rule rows**), "Last activity" | | u:ProjectHeader; PF (h1) | unit only |
| PX30–PX31 | **Project actions** (`aria-label`) → groups "Edit" / "Workspace" (`ListSubheader`, flat children so arrows work) | | A11 "Project actions: Enter opens, arrows walk the items…" | partial |
| PX32 | "Rename project…" | | PF | unit only |
| PX33 | "Edit guard-rails" → `?tab=guardrails` | | u:ProjectActionsMenu | unit only |
| PX34 | "Manage Secrets" → Project Secrets | | PEM; PSF; A11 (opened by Enter) | yes |
| PX35–PX36 | "Generate AI scaffold…" enabled with a ready repo; disabled otherwise with the inline reason "Needs a cloned repo first" | | PF "Generate AI scaffold is disabled with its reason…"; u:ProjectActionsMenu | unit only |
| PX37 | "Delete project…" | | PF | unit only |
| PX38–PX39 | Escape / backdrop close; ArrowUp/Down walk items; focus returns to the trigger | | A11 | gap |
| PX40–PX48 | Rename: "Rename project", "Project name" prefilled, Save disabled blank/unchanged, `PATCH` → toast "Renamed to {name}", Enter saves, persisted across reload | | PF "Rename saves, shows the new name, and survives a reload"; RNM | partial |
| PX47 | Rename error Alert | | u:RenameProjectModal | partial |
| PX49 | Duplicate names allowed | | — | gap |
| PX50–PX58 | Generate AI scaffold dialog body / picker / Generate / errors | | u:GenerateAiScaffoldDialog; GAS (still looks on the Setup tab) | unit only |
| PRR1–PRR10 | Rail "Health · 30 d": PRs merged, Specs accepted first try, Median time to PR, Tasks that needed you, caption | | u:ProjectRightRail; A11 (renders, axe) | unit only |
| PRR11–PRR15 | "Active agents" + "All →", running / idle | | u:ProjectRightRail | gap |
| PRR16–PRR21 | Rail "Guard-rails" + **Edit →**, now listing the active rule titles | | u:ProjectRightRail | unit only |
| PRR22–PRR29 | Team card switch / subscriber warning | | TC; u:ProjectTeamCard | yes |

## 3. Overview, Tasks and History tabs

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| PO1–PO2 | Overview default; `?tab=overview` | | PD; PTF | yes |
| PO3 | Skeleton while counts load | | u:OverviewTab | unit only |
| PO4 | Counts error → "Could not load the overview — …" + Retry | | PTF "a failed overview, tasks or history load…" *(routed)*; u:ProjectDetail | gap |
| PO7–PO9 | "Open tasks" = Tasks not done; caption "{n} awaiting pickup" / "all picked up" | | PTF "the three tiles equal the database…" (SQL) | unit only |
| PO10–PO13 | "Tasks in flight" = in progress + in review; "{n} waiting info" / "queue is empty" / "none waiting on you" | | PTF (SQL) | unit only |
| PO14–PO18 | "AI Cost ({Month})" = completed runs + closed sessions this month, `$x.xx`; caption title "Completed agent runs and closed terminal sessions this month: N runs · M sessions · T tokens (input, output, cache read and write)" | tokens now include cache writes | PTF (55 runs, SQL sum) | unit only |
| PO20 | Every tile carries a caption title | | PTF (title of tile 3) | gap |
| PO21 | Tiles agree with other surfaces | | PTF (SQL = same rule as `/api/counts`) | gap |
| PO22–PO25 | "Recent activity" newest 5, empty "No recent activity yet" | | PTF (5 rows, newest first); u:OverviewTabContent | unit only |
| PO26 | Runs error → "Could not load recent activity — …" + Retry | | u:OverviewTabContent | gap |
| PO28–PO32 | Row: agent chip, item link, run-status pill, **View run** → `/agents/:a/runs/:r`, time | | PTF (href of the newest); u:OverviewTabContent | partial / gap |
| PO34 / PH18 | Runs refresh on SSE | | — | gap |
| PT1–PT2 | "Tasks  N" tab, deep link | | PTF "the Tasks tab lists exactly this project's Tasks…" | unit only |
| PT4 | Tree error → "Could not load tasks — …" + Retry | | PTF *(routed)* | gap |
| PT5–PT6 | "Showing **N** tasks in this project"; **Open in Tasks** → `/tasks?project=<name>` and that page scopes to it | | PTF | unit only |
| PT7 | A Task made on `/tasks/new` appears here | | TF "Submit with no workflow lands Ready…" | gap |
| PT8–PT22 | TaskTable inside the tab (headers, sort buttons, rows, footer) | see §6 | TF (same component on `/tasks`); u:TaskTable | unit only |
| PT23–PT28 | Phone list, paging, fit | | PTM "project tasks…"; u:MobileTaskList | partial |
| PH1–PH4 | History tab, skeletons | | PD; PTF | yes |
| PH5 | Runs error → "Could not load agent activity — …" + Retry | | PTF *(routed)* | gap |
| PH6–PH7 | "Agent activity · N · $x.xx total" | | PTF "lists every run with its total…" (SQL) | unit only |
| PH8 | Empty "No agent activity yet for this project." | | A11 (seed project has none); u:HistoryTabContent | unit only |
| PH10–PH14 | Row: item link, status pill, **View run**, cost, time | | PTF (hrefs); u:HistoryTabContent | unit only / gap |
| PH16 | 50 a page, "Show K more of R" | | PTF (55 runs → 50 → 55) | gap |

## 4. Guard-rails tab (project) and `/guardrails`

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| PG1–PG5 | Redirect routes, deep link, tab, Suspense fallback | | u:ProjectGuardrails; PTF; ND | partial |
| PG10–PG12 | Sub-tabs "Rules  N" / "Scripts  N" (local state) | | PTF (counts follow add / delete) | unit only |
| PG13 | Rules / scripts load error → "Could not load this project's rules — …" / "Could not load scripts — …" + Retry | | PTF "a failed rules load says so with Retry" *(routed)*; u:ProjectGuardrailScriptsTab | gap |
| PG14 | "Rules every agent must respect inside this project · {n} active" | | PTF ("· 0 active" after a pause) | gap |
| PG16–PG18 | Info card "Guard-rails are active" + "Enabled" + read-only switch, now named "Guard-rails enabled" | | A11 (axe `label`); u:ProjectGuardrails | gap |
| PG20 | Empty "No guard-rails yet for this project" + **Add first rule** | | PTF | unit only |
| PG24–PG25 | Card "Active" / "Paused"; switch "Pause {title}" / "Resume {title}" → `PATCH …/toggle`, persisted across reload | | PTF "a rule is added, edited, paused (persisted) and deleted…" | unit only |
| PG26 | Toggle failure → toast "Could not update guard-rail" | | u:ProjectGuardrails | gap |
| PG27 | Toggle / PATCH / DELETE under another project id → 404, rule untouched | | PTF (API, all three); u:api-G | new |
| PG28 | Edit ("Edit {title}" → "Edit guard-rail" → **Save changes** → "Updated guard-rail — {title}") and delete ("Delete {title}" → "Delete this rule?" / `Removes "{title}" from this project. Agents won't see it on their next run.` → **Delete** → "Deleted guard-rail — {title}") | the draft had no UI for either | PTF | unit only (API) |
| PG29–PG32 | "Add guard-rail": Title, Rule; **Add rule** disabled until both; toast "Added guard-rail — {title}" | | PTF | unit only |
| PG33 | "Applies to (optional)" field | removed | — | gap |
| PG34–PG36 | Submit failure toast; Cancel; Enter | | u:ProjectGuardrails | gap |
| PG37–PG41 | Scripts header copy; "Loading…"; empty "No project scripts yet" + **Add first script**; card (name, "check-{id}.sh", description) | mojibake fixed | PTF "a project script is added, edited and deleted…" | unit only |
| PG42–PG44 | Add → "Project script added"; edit (Slug disabled, **Save changes**) → "Project script updated"; delete now confirms: "Delete this script?" / `Removes "{name}". Agents no longer get it from the next run.` → "Project script deleted" | | PTF; u:ScriptModal | unit only |
| PG45–PG47 | Override chips; duplicate slug 409; cross-project 404 | | u:ProjectGuardrailScriptsTab; u:api-GS | unit only / new |
| PG48 | Writes reach `/projects/:id/guardrails` | | PTF (API read-back after every write) | gap |
| PG49–PG60 | ScriptModal fields, validation, server error, Cancel / Escape | | SCM; PTF (fields, Slug disabled in edit); u:ScriptModal | partial |
| PG61–PG62 | Header pill and rail now follow active rule rows | | u:ProjectHeader, u:ProjectRightRail | gap |
| PG63–PG111 | Global `/guardrails`: header, stats, Rules / Scripts tabs, 5 category cards, rule rows, GuardrailModal add / edit / delete, sticky save bar, scripts tab | unchanged by this pass | GR; GT; GRM; SCM; u:Guardrails & friends | yes / unit only |
| PG112 | axe + keyboard on the project tab | | A11 "project guard-rails…" (6 axe runs + Tab walk) | gap |
| PG113 | Phone / iPad layout of the project tab | | PTM "project guard-rails…" | partial |

## 5. Repos, Jira, Setup tabs

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| PR1–PR3 | `?tab=repos`, "Repositories" + helper | | PTF; RWP | partial |
| PR6 | Load error Alert "Could not load the repos" / API message | | u:ProjectReposCard | gap |
| PR7–PR14 | Empty state; rows `repo-row-<name>` with branch chip, clone chip, auto-fetch chip, URL; no primary | | RWP; MR; PTF | yes |
| PR10 | Clone chip "Ready" now in `successFg` (AA on its fill) | | A11 (axe, Repos tab); u:CloneStatusChip | unit only |
| PR11–PR12 | "Auto-fetch · weekly" chip appears after save and goes after turn-off; tooltip "Next fetch …" | | PTF "auto-fetch: weekly saves its weekday…" | unit only / gap |
| PR20–PR21 | "Actions for {name}" → Edit · Auto-fetch schedule… · **Pull from remote…** · Open folder · Remove | | PTF; RCM; AFM | yes |
| PR25–PR26 | Open folder → toast "Opened in {app}" / "Could not open folder" | | u:ProjectReposCard | unit only |
| PR27–PR36 | Remove confirm "Remove {name}?" / "…The folder stays on disk." | | RWP | yes |
| PR40–PR45 | Edit: "Edit {name}", "Default branch" → **Save** → "Saved {name}", persisted (reload + API) | | PTF "Edit saves the default branch…" | unit only |
| PR46–PR48 | Edit Cancel / Escape; manage link; unchecked branch | | — | gap |
| PR50–PR68, PR90–PR108 | Add repo dialog, CredentialSelect, ConnectErrorDetails | needs GitHub + ls-remote | u:ProjectReposCard; u:AddRepoDialog; u:api-P | unit only |
| PR120 | Pull from remote = status → stash (dirty) → `fetch --prune` → `pull --ff-only`; nothing re-cloned | | PTF (real git: local bare origin + clone) | unit only |
| PR122–PR123 | "Pull from remote?" / "Pulling from remote…" / "Pulled from remote" / "Pull failed" | renamed from Re-clone | RCM; PTF | yes |
| PR126–PR127 | Status table: Local HEAD, Remote HEAD, Behind "1 commits", Uncommitted "clean" / "1 modified files" | | PTF (behind by one, then dirty) | yes |
| PR128 | Status error "Could not read git status. Is the workspace folder still on disk?"; Pull disabled | | PTF "Pull from remote on a folder that is gone…" | unit only |
| PR129 | Dirty: "{n} uncommitted files will be stashed to .git/atlas-stash/ before pulling. Restore them afterwards with git stash pop." | path fixed this pass (said `.atlas/stash/`) | PTF "a dirty tree is named and stashed first"; u:RecloneProjectModal | unit only |
| PR130 | **Pull** (clean) / **Stash & pull** (dirty) | | PTF (both, real fast-forward, file lands in the clone) | unit only |
| PR132 | Credential deleted → "Original credential was deleted" + "Manage credentials →" | | u:RecloneProjectModal; u:RR | unit only |
| PR133–PR137 | Steps "Stash local changes" / "Fetch from remote" / "Fast-forward default branch"; success "Fast-forwarded N commit(s)" / "Already up to date" / "Pull complete" + " · n files changed" + stash path; "git · transcript" | | PTF (success view, stash path under `.git/atlas-stash/`); u:RecloneProjectModal | unit only |
| PR139 | Error view | | u:RecloneProjectModal; u:RR | unit only |
| PR142 | A failed pull leaves a `reclone_failed` notification "Pull failed on "{repo}": …" | | PTF (API pull on a missing folder) | gap |
| PR160–PR166 | Auto-fetch modal load, heading follows the switch ("Auto-fetch schedule" / "Auto-fetch enabled"), presets `aria-pressed` | | PTF; AFM | partial |
| PR167 | Weekly picks Mon by default and saves it; Fri saves 5 | | PTF (Fri → `weekday: 5`, read back) | unit only |
| PR174–PR175 | **Save schedule** / **Done** send the switch's state; off + Done stores `enabled=false` | the draft's "switch can't turn it off" is fixed | PTF (API read-back) | unit only |
| PR177 | Save error box | | u:AutoFetchScheduleModal | unit only |
| PR180 | Round trip after reopen (preset + weekday shown) | | PTF | gap |
| PR181 | Preset / policy cards by keyboard | | — | gap |
| PJ1–PJ63 | Jira tab: sources card ("Sync now" now syncs only this project, toast "Jira sync for {project}: …"), alerts, source dialog, status mapping | | JB; JM; SA; u:ProjectJiraCard; u:JiraStatusMapCard; A11 (axe + Tab) | yes / unit only |
| PS1–PS38 | Setup tab: Default workflow card; repo list with "Edit setup scripts for {repo}" → dialog with ".sh" / ".ps1" editors, discard prompt, secrets help | | ST (full); u:SetupTab; u:DefaultWorkflowCard; PTM; A11 | yes |

## 6. Manage Secrets (`ProjectEnvSecretsModal`)

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| PXS1–PXS5 | Menu → dialog named "Project Secrets" (`aria-labelledby`) | | PEM; PSF; A11 | yes |
| PXS8–PXS12 | Close / Escape / Cancel discard, no confirm | | PEM; A11 (Escape) | partial |
| PXS13–PXS16 | Encryption notice / no-repos warning (Save off) | | u:ProjectEnvSecretsModal | unit only |
| PXS17–PXS19 | Search by key, "No keys match your search." | | PEM; u:ProjectEnvSecretsModal | yes |
| PXS20 / PXS55–PXS61 | **Import** a JSON file → merges, NEW chip, "Imported 2 secrets (skipped 1: 1 bad key)" | | PSF "Import merges a file…" | partial |
| PXS21–PXS22 / PXS62 | **Export** (off at 0 rows) → `<project>.secrets.json` with every stored value | | PSF "Export downloads every stored value…"; "add two secrets…" (off when empty) | partial |
| PXS23–PXS26 | **Reveal all** → **Hide all**; plaintext dropped on hide | | PSF "add two secrets, save, reload; reveal one, then all, then hide all" | unit only |
| PXS28 | List returns keys only; rows start masked and empty | | PSF (after reload) | unit only |
| PXS29 | Loading spinner; **Save secrets**, **Add variable**, **Import** disabled until the stored set loads | | PSF "Save, Add variable and Import wait for the stored set…" *(routed: held GET)* | gap |
| PXS30 | Empty "No secrets yet — click "Add variable" to create one." | | PSF | unit only |
| PXS31 | Load error → `role=alert` "Could not load this project's secrets. Close and try again."; Save and Add stay off | | PSF *(routed)* | gap |
| PXS33–PXS37 | NEW chip; key upper-cased; "Key required" / "UPPER_SNAKE_CASE only" / "Duplicate key" block Save | | PSF "a bad, blank or duplicate key blocks Save…" | unit only |
| PXS39–PXS47 | Row **Reveal** → plaintext + **Hide**; masked placeholder | | PSF | unit only |
| PXS48–PXS52 | Copy | | u:ProjectEnvSecretsModal | unit only |
| PXS54 | Remove (local until Save) | | u:ProjectEnvSecretsModal | unit only |
| PXS65–PXS68 | "N unsaved change(s)" / "no unsaved changes"; Save off when clean | | PSF | unit only / gap |
| PXS70 | Save sends `{ key, keep: originalKey }` for untouched stored rows — no reveal request fires, the value survives | | PSF "Import merges a file; Save keeps the untouched row without revealing it" (request log + API reveal) | unit only |
| PXS72–PXS73 | "Project secrets saved" + close / "Could not save secrets" | | PSF; u:ProjectEnvSecretsModal | unit only |
| PXS80–PXS84 | PUT 400s (`Invalid key "lower_key" — must be UPPER_SNAKE_CASE`, duplicate, shape) | | PSF (lowercase key); u:api-P; u:PEF | unit only |
| PXS75 | Keyboard | | A11 (opened by Enter from the menu, Escape closes) | partial |

## 7. `/tasks`

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| T1 | h1 "Tasks" | | TS; TF | yes |
| T2–T4 | Subtitle "{N} task(s)[ · {project}][ · {M} ready]" counts the rows on screen (every filter, archived hidden unless shown) | was `stats.total` + global "awaiting pickup" | TF (every filter: project, status, AI, search, archived) | unit only / partial |
| T5 | "Show archived" → `?include_archived=true` shows Tasks done > 7 days | | TF "Show archived adds the Task closed 10 days ago…" | unit only |
| T6 | Table / Kanban toggle, remembered | | KB; TF (Kanban remembered after reload) | yes |
| T7 | **New task** (disabled with no projects) | casing now "New task" everywhere | TS; PTM | yes |
| T8–T9 | Phones: FAB "New task"; Show archived stays | | PTM "tasks list…", "New Project and New task open from their FABs…" | gap |
| T10 | "All" / "Assigned to me" / "Assigned to AI" counts and `?filter=` | | TF (SQL counts, AI filter) | unit only |
| T11–T12 | "By project:" shows the pick (was stuck on "any"), ✓ on it, "Any" clears; `?project=<name>` | | TF "By project shows the pick…" | partial / gap |
| T13 | "Status:" Any, Draft … Done; `?status=` | | TF; A11 (Enter / Space / arrows) | unit only |
| T14 | "Search tasks" matches title, description **and id** | | TF ("WTK-5", "burrow") | unit only |
| T15 | `/` focuses search | | TF | unit only |
| T16 | Filters survive reload | | TF (status) | gap |
| T20 | Loading skeletons | | — | gap |
| T21 | No projects: "No projects yet" / "Create a project first, then add tasks." / **Go to Projects** | | u:Tasks | unit only |
| T22–T23 | "No tasks match this view." (+ **New task** on desktop) | | TF | unit only |
| T24 | List load error | still renders as an empty list | — | gap |
| T30–T32 | Columns, row content, row (a `role=button`, Enter opens) → `/tasks/:id` | | TS; TF; A11 (Enter on a row) | yes |
| T33 | Sort buttons "Sort by ID" / "Task, sorted ascending" …; default Updated desc; ID numeric-aware | | TF "sort by Task / ID / Updated…" | unit only |
| T34 | Footer "{N} tasks · page p of n", Rows 20/50/100/all, "First / Previous / Next / Last page" | | TF | unit only |
| T35 | Virtualised body ≥ 60 rows on "all" | | u:TaskTable | unit only |
| T40–T42 | Phone list rows, "Show N more of M", order | | PTM; u:MobileTaskList | unit only / gap |
| T50 | Kanban columns + counts | | KB; TF | yes |
| T51–T53 | Card opens by click / Enter (`role=button`); "Drop here"; column paging | | u:WorkItemKanban | unit only |
| T54 | Legal drop → `PATCH …/status`, persisted | | TF "a legal drag moves the Task and persists…" | unit only |
| T55–T56 | Illegal drop → one toast `Can't move {id} to {Status}` + "From Draft you can go to: Ready, Waiting for Info. To force…" / "Done is terminal…" | | TF "an illegal drop is refused with one toast…"; u:WorkItemKanban | unit only / gap |
| T58–T59 | API refusal → exactly one toast: 422 "Cannot close — open children" + "{id} is not done yet." (no second "Couldn't move"); 409 / 400 "Couldn't move {id}" + reason | | TF "closing a Task with an open sub-task is refused… exactly one toast"; u:useTasks | unit only |
| T60 | Drag affordance | | u:WorkItemKanban | unit only |

## 8. `/tasks/new`

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| TN1–TN3 | "New task", breadcrumb, subtitle and tips (workflow vs none) | | TNs; u:TaskNew | yes / unit only |
| TN4–TN5 | Title / Description required | | TNs; TF | yes |
| TN6 | Project select; `?project=<id or name>` preselects | | TF (`?project=<id>`); u:TaskNew | partial |
| TN7 | Priority Low (default) / Normal / High / Urgent | | TF (default Low stored `low`; High stored `high`) | yes |
| TN8–TN9 | Repos: first preselected, add more, order kept; no repos → info alert, buttons off | | TF; MR; RWP | yes |
| TN10–TN12 | Workflow / Reporter / Assignee selects | | u:TaskNew | unit only |
| TN13 | **Save as draft** (phones "Draft") → "Saved as draft — {title}" → Draft | | TF "Save as draft lands Draft…"; PTM | partial |
| TN14 | Submit with a workflow → "Submitted — {workflow} is starting" | | u:TaskNew; WP | unit only |
| TN15 | Submit, no workflow → Ready + "Submitted — {title}"; a failed transition is toasted by the hook and the Task stays Draft | | TF "Submit with no workflow lands Ready…" | unit only |
| TN16–TN17 | Invalid submit; create error toast | | TNs; u:TaskNew | yes |
| TN18 | Buttons off while pending / no repo | | RWP; u:TaskNew | gap |
| TN19–TN21 | Cancel, draft guard, phone footer | | TNs; PTM; u:TaskNew | yes / unit only |
| TN22 | Labels on the create form | not on this form (labels are set on the Task page) | TDF | — |

## 9. `/tasks/:id` and `/sub-tasks/:id`

| # | Element / state | Expected (current) | Tests | Before |
|---|---|---|---|---|
| TD1–TD2 / SD1–SD2 | Loading; "Task not found" / "Sub-task not found" + **Back to Tasks** | | u:TaskDetail; u:SubTaskDetail | unit only |
| TD3 / SD3 | Tab title = id, subtitle "Task" / "Sub-task" | | — | gap |
| TD4 / SD4 | Breadcrumb Tasks › (parent) › id | | TDs; SDs; TDF (clone keeps the parent) | yes |
| TD5 / SH77 | "Add related item" → "Link an item" / "Add dependency" | | TDF "Link an item and Add PR link…" | unit only |
| TD6–TD7 / SD5, SD7 | "Task actions" → "Delete this task…" / "Sub-task actions" → "Clone item…", "Delete this sub-task…"; "Delete this task?" + impact; **Delete task** → `/tasks` (sub-task → its Task) with no 404 refetch | | TDF "deleting a Task / sub-task navigates away with no 404 refetch"; CDd; A11 | partial / unit only |
| TD8–TD9 / SD8–SD9 | Description / Acceptance criteria cards: **Edit** → textarea → **Save**; markdown renders (headings as styled text); persisted | | TDF "title, description and acceptance criteria save…" (both kinds) | unit only |
| TD10–TD11 | Spec card, Pull request card | | u:TaskDetail | unit only |
| TD12 | Sub-tasks table · n, rows open | | TDs; TDF (order) | yes |
| TD13–TD14 | **Reorder** → "Reorder sub-tasks" ("…runs its sub-tasks top to bottom, one at a time, skipping any that are in review or done."), "Move {id} up/down", **Save order** (off until changed) → persisted | | TDF "Reorder moves a sub-task and the order persists" | unit only |
| TD15–TD17 | Add sub-task form + draft guard | | TDs; u:TaskDetail | yes |
| SD6 | Clone → "Copy of {title}" under the same Task, keeps priority / assignee / labels, `relates_to` the original; failure toasts "Couldn't clone {id}" / "Cloned as …, but couldn't link it…" | | TDF "Clone item makes "Copy of …"…"; u:SubTaskDetail | unit only |
| TD18 / SD11 | Rail rows (Project, Task, Repos, Status, Assignee, Reporter, Priority, Labels, AI cost, Created, Last updated, Branch, Path) | | u:DetailsRailCard | unit only |
| TD19 / SD12 | Assign lock follows a **live workflow run** (not `in_progress`): lock icon "Locked while a workflow run works this item" on Status and Assignee, rows not clickable; API 409s meanwhile | | TDF "the assign lock follows a live workflow run…" | unit only / gap |
| TD20 / SD13 | Refused status move → toast "Couldn't move {id}" + reason (409 / 400); 422 closure → "Cannot close — open children" + "… not done yet." | | TDF "a refused save and a refused status move each toast…" *(routed 409)*; TDF "a Task with an open sub-task cannot close…" (real 422) | gap |
| TD21 / SD13 | Refused save (title / description / priority / labels) → "Couldn't save {id}" + reason, editor stays open; assign → "Couldn't reassign {id}" | | TDF *(routed 500)*; u:useTasks, u:useSubTasks | gap |
| SH3–SH4 | Title: click h1 or **Edit title** (shown on keyboard focus too) → Enter saves, Escape cancels, "Save title" / "Cancel title edit" | | TDF; A11 ("Edit title" visible on focus) | unit only |
| SH13 / SH20 | Status row (`role=button`) → "Move to" + valid moves, "Override" + the rest | | TDF (both kinds, four statuses); A11 (Enter / Escape, focus returns) | partial |
| SH14 | Done guard for unmerged PR links | | u:DetailsRailCard | unit only |
| SH15 / SH22 | Assignee picker → agent → persisted | | TDF "priority, labels and assignee persist" | unit only |
| SH17 / SH21 | Priority picker → persisted | | TDF | unit only |
| SH18 | Labels: "Add labels" → "Type a label…" → Enter per label → saved once on blur | | TDF | unit only |
| SH23–SH24 | Repos row, Branch / Path copy | | MR; u:DetailsRailCard | yes |
| SH60–SH66 | Workflow panel | | WP; u:ItemWorkflowPanel | yes |
| SH40–SH42 | Conversation: "Comment on this item…" + **Post**; cleared after | | TDF "comments post, edit and delete…" (both kinds) | partial |
| SH45–SH46 | "Edit comment" (shown on hover and focus) → **Save** → "edited" badge | | TDF | unit only |
| SH47 | "Delete comment" → "Delete this comment?" → **Delete** → gone (API) | | TDF | unit only |
| SH33 | Comment markdown: GFM table → `<table>`, fenced block → `<pre>` that scrolls inside the page (no sideways scroll at 390px); both focusable | focusable since this pass | TDF; A11 (axe `scrollable-region-focusable`); u:MarkdownPreview | unit only |
| SH48 / SH50–SH53 | Paging, activity log | | u:ActivityCard | unit only |
| SH71 / SH82 | **Add PR link**: bad URL "Enter a GitHub PR URL — …", **Add link** → "PR link added", row "#7" | | TDF; PRd | yes |
| SH73–SH76 / SH78–SH81 | Relates to / Blocked by / Tests sections; picker "Id or title" → "Linked to {id}" | | TDF; LPd | partial |
| SH70 | Jira section | | JM | gap |

## 10. Everywhere (12 routes: `/projects`, the 7 project tabs, `/tasks`, `/tasks/new`, `/tasks/:id`, `/sub-tasks/:id`)

| # | Check | Tests | Before |
|---|---|---|---|
| E1 | axe WCAG 2.1 A/AA, light and dark, at 390 / 834 / 1440 (12 × 6) | A11 | gap (only Jira tab in SA) |
| E2 | No console errors through load | A11 (whole-test listener); `goto()` everywhere | partial |
| E3 | No sideways page scroll at 390 / 360 / 834 / 1440 | PTM; A11 | partial (iPad overview only) |
| E4 | Tab reaches every visible control on each route | A11 "Tab reaches every control" (12) | gap |
| E5 | Enter / Space open menus and dialogs; arrows inside menus and tab strips | A11 keyboard tests | gap |
| E6 | Escape closes menus and dialogs; focus returns to the trigger | A11 | gap |
| E7 | Key actions on screen and clickable on a phone (not under the bottom nav / FAB) | PTM (trial clicks) | gap |

## Fixed in this pass

| What | Where | Test |
|---|---|---|
| Deleting a project from its own page lost the success view: the finished delete drops `['projects', id]`, the page fell to its skeleton / "Project not found" branch and unmounted the dialog (and a remount reset it to "Delete project?"), so "Project deleted" and **Back to projects** vanished. The dialog now holds its own copy of the project and renders in the same fragment slot on every branch. | `packages/web/src/pages/ProjectDetail.tsx:64,88,168-185,187,199,215,227` | u:PDdel (fails on the old code); PF "Delete in "Remove from Atlas only" mode…" |
| The dirty-tree warning said files are stashed to `.atlas/stash/`; the runner writes the patch to `.git/atlas-stash/`. | `packages/web/src/pages/projects/RecloneProjectModal.tsx:402` | u:RecloneProjectModal "shows uncommitted warning…"; PTF "a dirty tree is named and stashed first" |
| Fenced code blocks and wide tables scrolled but could not take keyboard focus (axe `scrollable-region-focusable`, WCAG 2.1.1). | `packages/web/src/components/MarkdownBody.tsx:92,133` | u:MarkdownPreview "makes fenced code and tables focusable…"; A11 task detail |
| The always-on guard-rails switch had no accessible name (axe `label`). | `packages/web/src/pages/ProjectGuardrails.tsx:497` | u:ProjectGuardrails "names the always-on guard-rails switch"; A11 project guard-rails |
| Repo clone chip "Ready" was #46A56A on its pale green fill, 2.6:1 (axe `color-contrast`). | `packages/web/src/components/CloneStatusChip.tsx:16-17` | u:CloneStatusChip "writes ready in the dark success tone…"; A11 project repos |
| Keyboard focus was invisible app-wide: CssBaseline set `*:focus-visible { outline: none }` (WCAG 2.4.7). Now a 2px brand-blue ring (theme-aware), on ButtonBase via `.Mui-focusVisible` too, inset on tabs and menu items; mouse focus and text fields unchanged. | `packages/web/src/theme/theme.ts` (`FOCUS_RING`, CssBaseline, MuiButtonBase, MuiTab, MuiMenuItem) | A11 "keyboard focus draws a ring; a mouse press does not" |

## Open

| Row | What | Why it is left |
|---|---|---|
| SH92 | The Draft status chip is 3.8:1 (`--atlas-status-draft-fg` #727a87 on `--atlas-status-draft-bg` #eef1f4, light and dark). A11 filters exactly that colour pair and nothing else. | App-wide theme token (`packages/web/src/theme/theme-vars.css:151,292`) used by every status chip; changing it is a design-token decision, not a page fix. |
| P141 / New project | Opened by keyboard, focus lands on the dialog paper instead of Name (`autoFocus` loses); Tab reaches Close, then Name. | Focus stays inside the dialog (keyboard-usable); root cause in the lazy-mounted MUI focus trap not yet traced. |
| P75 | Table "Repos" cell says "—" where the card says "No repos". | Copy choice; asserted as is. |
| TD8 / SH33 | Markdown headings render as styled `<p>` (`MarkdownBody.tsx` h1–h3), not heading elements. | No axe rule fires; giving them heading roles changes the outline of every page that renders markdown, so it needs a decision, not a drive-by. |
| T24, PR6, PS11 | `/tasks` list load error still renders as an empty list; repo / workflow load errors are plain. | Not in this pass's scope (list-level error states were done for projects and tabs). |
| P94–P95 | Page and limit are not in the URL; deleting the last project on a later page can leave an empty page. | Needs a product decision on URL state. |
| PO34 / PH18 | Recent activity and History do not refresh on run SSE. | Query key sits under `['projects', id]`; refresh on Refresh / `counts_changed` only. |
| PR50–PR68, PR90–PR108 | Add repo (clone / connect) has no e2e. | Needs a GitHub URL and a live `ls-remote`; covered by unit tests. |
| PX50–PX58 | Generate AI scaffold dialog submit has no e2e; GAS still looks for the trigger on the Setup tab. | Starts a workflow that needs a credential and a remote. |
| PR181 / PG78 | Auto-fetch preset / policy cards and global `/guardrails` rule rows are not keyboard-operable. | Outside the 12 audited routes' Tab walk (dialog / other page). |
| PG93 | No e2e create / edit / delete round trip on global `/guardrails`. | Out of this pass (project tab done). |
| TD3 / SD3 | Tab title per item kind not asserted. | Shell title, low value. |
