# Per-page checklist

Every route Atlas has, every action on it, and what to assert. Waves A–E are
executed by [task-08](../task-08-walk-wave-a-projects-repos.md) through
[task-12](../task-12-walk-wave-e-read-surfaces.md); the chains a page walk
cannot catch live in [cross-cutting.md](cross-cutting.md).

41 sections cover the 34 page docs in `.agents/pages/` — Settings is split one
section per tab, and the live terminal session page `/terminal/:id` gets its
own section although it has no page doc of its own.

## Before you file anything

1. **`.agents/coming-soon.md` first.** Controls that toast or sit disabled on
   purpose are marked `(stub — see coming-soon.md)` below. A stub is not a bug.
   ⚠️ Several `coming-soon.md` rows are themselves stale — they describe
   controls that were *removed*, not deferred. Those are documentation
   findings, listed in [task-21](../task-21-agents-sync-and-adrs.md).
2. **The page doc second.** If `.agents/pages/<NN-slug>.md` says the behaviour
   is intended, believe it until the code disagrees. Sections below carry a
   `⚠️ page doc stale:` note wherever authoring found the doc and the code
   already in conflict — in those places the section states the **code's**
   behaviour, and the doc is the finding.
3. **Log, do not fix** (ruling D-9). Findings go to
   [findings.md](../findings.md) with an `F-NNN` id and `file:line` evidence.

## The six check classes

Every section works these, defined in `.agents/functional-checklist.md:32-58`.
`n/a — <reason>` means the class genuinely does not apply, not that it was
skipped.

1. **Round-trip** — write a value, **hard-reload**, read it back. Secrets need
   their reveal endpoint, not an input `type` flip.
2. **Attribution and joins** — every name, avatar, author, assignee and count
   rendered from an FK resolves to a real row. A hardcoded literal where a
   field belongs (`'Agent'`, `'Owner'`, `'Atlas'`) is this class of bug.
3. **List membership** — anything created, installed or imported appears in the
   list that claims to show it, after invalidation **and** after a hard reload.
   A failed write names which item failed and why, never a bare count.
4. **Transition legality** — only valid next statuses are offered, and invalid
   ones are **absent, not greyed**. Always from `getValidNextStatuses()`.
   Extra rules at `.agents/functional-checklist.md:135+`.
5. **Cross-page propagation** — after a mutation the sidenav badge, dashboard,
   search, queue and notifications agree with no manual refresh.
6. **Error / empty / loading** — all three non-happy states render, and a
   failed mutation surfaces visibly. A `throw` inside an async click handler
   is an unhandled rejection with no UI at all.

## Cross-cutting invariants

| # | Invariant |
|---|---|
| X1 | No stored secret in a list or get response. Plaintext only via a reveal endpoint that logs `{tag:'secret_reveal'}` |
| X2 | Every writer into `agents` calls `assertModelInRegistry` first — `agents(cli, model)` is a composite FK with `ON DELETE RESTRICT`, and skipping it yields an opaque 500 |
| X3 | Agent-authored rows carry `agent_id` / `actor_agent_id`. A null renders as "Agent", or worse, as the Owner |
| X4 | A badge count agrees with the page it links to, or the difference is labelled |
| X5 | Status logic only from `@atlas/shared/status-machine` |

---

## Wave A — onboarding, dashboard, scratch pad, projects

### A1 · Onboarding — `/onboarding`

**Component:** `packages/web/src/pages/Onboarding.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Display name field | required; Enter advances to step 2 (`Onboarding.tsx:366`) | — |
| Accent swatches | 6-option radio, arrow keys cycle (`Onboarding.tsx:249-263`); **local state only, never sent** | — |
| Next | `validateStep1()` → step 2; blank name blocks with "Enter a display name to continue." (`Onboarding.tsx:212-218`) | — |
| Workspace path (FolderPicker) | Enter triggers Finish | — |
| Back | step 2 → step 1; disabled while submitting | — |
| Finish Setup | `api.settings.onboard({owner_name, workspace_path})` → `submitState='success'`, 5s then `navigate('/')` (`Onboarding.tsx:172-199, 232-246`) | `POST /api/settings/onboard` (`api.ts:299-300`) |

**States** — Empty: n/a, the form is the empty state · Loading: `settings.isPending` → `WizardSkeleton` (`Onboarding.tsx:264-266`) · Error: `submitError` rendered under the action row; API 400 `validation_error` for a relative/uncreatable path (`services/settings.ts:169-185`) · Populated: step 1 / step 2 / `SuccessView`.

**Checks**
- [ ] **1 Round-trip** — un-onboard (`POST /api/settings/test/clear-onboarding`, `routes/settings.ts:199`), enter name `Ada L`, pick the 3rd accent swatch, workspace `/tmp/atlas-ws-x`, Finish. After the redirect open `/settings` → Profile: `owner_name` is `Ada L` and `workspace_path` is `/tmp/atlas-ws-x`. **`accent_color` will be unchanged from its seed** — the 3rd swatch is dropped. Assert exactly that, and that `/tmp/atlas-ws-x` now exists on disk (`services/settings.ts:177`).
- [ ] **2 Attribution** — `n/a — no FK-rendered fields on this page`.
- [ ] **3 List membership** — `n/a — the page creates no list row`.
- [ ] **4 Transition legality** — `n/a — no item status on this page`.
- [ ] **5 Cross-page** — immediately after the redirect (inside the 5s window) the Dashboard greeting reads `Hi Ada` with no skeleton flash — the prefetch fan-out primes `['dashboard'] ['agents'] ['projects'] ['sidenav-counts'] ['notifications']` (`Onboarding.tsx:173-190`). Then hit `/onboarding` again: expect a redirect to `/` (`App.tsx` guard).
- [ ] **6 Error/empty/loading** — Finish with workspace `relative/path`: expect the inline error "Workspace folder must be an absolute path: relative/path", buttons re-enabled, and `settings.onboarding_complete` still 0 (reload `/` → back on `/onboarding`). Then edit the path and confirm the error text clears on the keystroke (`Onboarding.tsx:201-210`).

**Traps**
- ⚠️ page doc stale: `00-onboarding.md:43` documents the payload as `{ owner_name, accent_color, workspace_path }` and `:53` claims "Color selection persists into `settings.accent_color`". Neither is true — `api.ts:299-300` sends two fields and `services/settings.ts:186-194` writes `owner_name`/`workspace_path`/`onboarding_complete` only. `.agents/functional-checklist.md:69` repeats the claim. The swatch UI is live but write-only-to-nowhere; this is a real round-trip defect, not a stub.
- `pendingSettings` is written into the query cache *at* navigate time, not at response time (`Onboarding.tsx:191-196`) — a `useSettings` read during the 5s success window still returns the pre-onboard row.

---

### A2 · Dashboard — `/`

**Component:** `packages/web/src/pages/Dashboard.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| (empty) New Project | opens `NewProjectModal` | `POST /api/projects/clone` |
| (empty) Credentials alert | navigates `/settings/credentials` | — |
| (empty) Agents alert | navigates `/agents/marketplace`; rendered only when `useAgents()` loaded and returned 0 | — |
| Awaiting You / In Motion row | navigates `itemPath(type,id)` → `/tasks/:id` or `/sub-tasks/:id` (`utils/itemPath.ts:4`) | — |
| Kind filter (All / Tasks / Sub-tasks) | client-side filter on `data.awaiting` / `data.queue` | — |

**States** — Empty: `(data.kpis?.projectCount ?? 0) === 0` → `DashboardEmptyState` (`Dashboard.tsx:22`) · Loading: `isPending || data === undefined` → `BrandedFallback`, beats the empty branch (`Dashboard.tsx:14-20`) · Error: none rendered — the composite query has no error branch · Populated: `DashboardPopulated`.

**Checks**
- [ ] **1 Round-trip** — `n/a — read-only page, no writes originate here` (the empty-state modal is covered in A4).
- [ ] **2 Attribution** — with one `in_progress` run live, the In Motion row must show the agent's real name. `InMotionRow.tsx:113` is `agent?.name ?? row.agent_name ?? 'Unassigned'`; `counts.ts:315,331` denormalizes `a.name as agent_name`. Rename that agent in `/agents/:id`, hard-reload `/` and expect the new name — an "Unassigned" on a row that has a running agent is the bug.
- [ ] **3 List membership** — count the rows in Awaiting You against `/tasks?status=waiting_for_info` plus the `in_review` set for the same filter; when the panel caps, it must say "Showing N of M — open Tasks to see the rest." rather than silently truncating.
- [ ] **4 Transition legality** — `n/a — the panels are read-only listings, no status control`.
- [ ] **5 Cross-page** — with `/` open in one tab, create a Task in another. Expect the KPI strip and the sidenav badge to move without a manual reload (SSE `counts_changed` → `['dashboard']`). Then verify each KPI equals its page: project count == `/projects` header total, Tasks-in-progress == `/tasks?status=in_progress` row count, the three agent tiles == the `in_progress` runs `/queue` lists (X4).
- [ ] **6 Error/empty/loading** — delete every project: expect `DashboardEmptyState`, and the Agents alert to be absent while `useAgents()` is still pending and present only once it resolves to 0. Throttle the network and confirm `BrandedFallback` renders before either branch.

**Traps**
- The AI Cost tile sums **`completed` runs and `closed` sessions since the start of the local month** against a UTC column — a run that finished 19:00Z on the last of the month lands in the next month locally. Assert the tile states the timezone rather than asserting the number against a UTC-midnight SQL query (`functional-checklist.md` sweep log).
- The KPI payload carries `tasks` / `tasksInProgress` that the strip never renders (`01-dashboard.md:58`) — don't reconcile against fields that aren't on screen.

---

### A3 · Scratch Pad — `/scratch-pad`

**Component:** `packages/web/src/pages/ScratchPad.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| New tile | `useCreateScratchPad({})`, opens the editor on the new tile | `POST /api/scratch-pad` |
| Tile card click | opens `ScratchPadEditor` | — |
| Title / body typing | autosave 5000 ms after the last keystroke, diffed against the last-saved snapshot (`ScratchPadEditor.tsx:34,97-102`) | `PATCH /api/scratch-pad/:id` |
| Close icon | flushes pending changes synchronously, then closes (`ScratchPadEditor.tsx:118-124`) | `PATCH /api/scratch-pad/:id` |
| Delete icon | `ConfirmDeleteModal` → delete, closes the editor | `DELETE /api/scratch-pad/:id` |

**States** — Empty: `HeroEmptyState` "No scratch pad tiles yet" · Loading: none — stale-while-revalidate keeps the grid up · Error: create failure via `useToast()` · Populated: CSS grid, newest-first by `updated_at`.

**Checks**
- [ ] **1 Round-trip** — New tile, type body `alpha bravo charlie delta`, leave the title blank, wait 6s for the autosave (footer flips to "Saved · Ns ago"), hard-reload `/scratch-pad`. Expect the card titled `alpha bravo charlie` (3 words, `ScratchPadEditor.tsx:42-45`) with that body. Re-open, append ` echo`, close immediately (under 5s) — the close flush must persist it, so a hard-reload shows ` echo`.
- [ ] **2 Attribution** — `n/a — scratch pad rows have no FK-rendered author or assignee`.
- [ ] **3 List membership** — after **New tile** the new card is in the grid without a reload (create invalidates `['scratch-pad']`) and after a hard reload. Delete it and confirm it is gone from `GET /api/scratch-pad` too, not only from the grid — a soft delete that leaves the row is the defect this class names.
- [ ] **4 Transition legality** — `n/a — no status machine on scratch pad rows`.
- [ ] **5 Cross-page** — `n/a — no badge, KPI, queue or search surface reads scratch pad` (the sidenav row under WORKSPACE carries no count).
- [ ] **6 Error/empty/loading** — delete every tile → the `HeroEmptyState` copy. Stop the API and click **New tile**: expect a toast, not an unhandled rejection in the console.

**Traps**
- Autosave compares against a snapshot ref, so an idle open modal must NOT re-fire PATCH every 5s — watch the network tab for 30s on an untouched modal and assert zero PATCHes.
- `inferTitle()` exists twice on purpose: client (`ScratchPadEditor.tsx:42`) and server backstop (`packages/api/src/services/scratch-pad.ts:36,105`). Create a tile via MCP/curl with a blank title and a body, then check the grid — the server must have supplied the title.

---

### A4 · Projects — `/projects`

**Component:** `packages/web/src/pages/Projects.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| New Project | `NewProjectModal` — credential picker, URL, name, clone destination | `POST /api/projects/clone` |
| View toggle Cards ↔ Table | `ViewToggle`, same data both sides | — |
| Filter chips | All / Assigned to me / software-dev / marketing / content / design; `mine == all` (single-owner, `Projects.tsx:121`) | — |
| Row menu → Copy repo URL | copies the **first** repo's `git_url`, `''` when the project has no repos (ADR 0018) | — |
| Row menu → Delete | `DeleteProjectModal`, chip lists every repo folder or "No repos" | `DELETE /api/projects/:id` |
| Rows-per-page select | `[10,20,50,100]`; changing it resets `page` to 1 | `GET /api/projects` (paged) |

**States** — Empty: `totalProjects === 0 && allProjectsForEmpty.length === 0` → `ProjectsEmptyState` (`Projects.tsx:266-268`) · Loading: `paged.isPending` → `BrandedFallback` · Error: none on the list itself; modal failures toast · Populated: header + filters + grid/table + pagination footer (footer only when `totalProjects > limit`).

**Checks**
- [ ] **1 Round-trip** — clone a project named `ck-round-trip` with prefix `CKR`; hard-reload `/projects` and expect the card's display-ID chip to read `CKR`, taken from `p.issue_key_prefix` (`Projects.tsx:86-92`) — **not** a position-derived letter. Create a second project and confirm the first project's chip did not change.
- [ ] **2 Attribution** — the card's repo line must resolve from `useAllRepos()` (one `GET /api/repos` grouped by `project_id`): a project with 2 repos shows `2 repos` + the first repo's remote, the table's Repo URL column shows that remote ` +1`. A project with 0 repos shows `No repos`, never a blank or a hardcoded host string.
- [ ] **3 List membership** — with `/projects` open in tab A, create a project in tab B. Expect it in tab A's grid without a reload (SSE `counts_changed` → `['projects']`, F2 fix) and after a hard reload. Delete it and confirm it is gone from all four: this grid, the Dashboard project KPI, the sidenav badge, and the `NewProjectModal` credential picker's project list.
- [ ] **4 Transition legality** — `n/a — projects have no item status machine`.
- [ ] **5 Cross-page** — after a delete, the sidenav Projects badge and the Dashboard `projectCount` must agree with this page's `{totalProjects} projects` header without a manual refresh (X4).
- [ ] **6 Error/empty/loading** — clone a URL that isn't `https://github.com/…`: expect the modal's `ConnectErrorDetails` block (headline / checks / "Try" list) inline, not a toast that loses the reason. Then start a clone and watch `clone_status`/`clone_output` SSE drive the card to a terminal state — a card stuck on a spinner after the API finished is the defect.

**Traps**
- Pagination is local `useState`, not URL state (`Projects.tsx:56-57`) — a hard reload on "page 3" silently returns to page 1 / limit 20. Assert the header total (server) and the visible rows (page-local) separately; they are not the same number.
- Modals are mounted outside the empty/populated branches on purpose (`Projects.tsx:258-261`). If a test moves them, the modal unmounts mid-clone.
- The empty branch needs BOTH the paged total and the unpaged `useProjects()` fallback (`Projects.tsx:65`) — an empty *page* with projects on other pages must not render the empty state.

---

### A5 · Project Detail — `/projects/:id` (tabs: overview|tasks|guardrails|repos|setup|history)

**Component:** `packages/web/src/pages/ProjectDetail.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Tab strip | `useTabParam<TabKey>(TAB_KEYS,'overview')` — `?tab=` controlled, `overview` when absent (`ProjectDetail.tsx:43-44,53`) | — |
| Actions → Rename project… | opens `RenameProjectModal` (real, not a stub — `ProjectDetail.tsx:36,176,360`) | `PATCH /api/projects/:id` |
| Actions → Edit guard-rails | `setTab('guardrails')` via the idempotent callback (`ProjectDetail.tsx:64`) | — |
| Actions → Manage Secrets | opens `ProjectEnvSecretsModal` | `GET/PUT /api/projects/:id/env`, `GET …/env/:key/value` |
| Actions → Generate AI scaffold… | disabled until some repo has `clone_status === 'ready'` (`ProjectDetail.tsx:182`) | — |
| Actions → Delete project… | `DeleteProjectModal` (danger) | `DELETE /api/projects/:id` |
| Repos tab → row menu | Edit / Auto-fetch schedule… / Re-clone / Open folder / **Remove** (allowed on every repo, incl. the last) | `PATCH`/`DELETE /api/projects/:id/repos/:repoId`, `POST …/reveal` |
| Repos tab → Add repo | `AddRepoDialog` — Clone fresh (`{mode:'clone'}`) or Use existing folder (`{mode:'connect'}`) | `POST /api/projects/:id/repos` |
| Setup tab | **Repo** select + `.sh` / `.ps1` bodies **per repo** | `PATCH /api/projects/:id/repos/:repoId` |

**States** — Loading: skeleton (`ProjectDetail.tsx:103-111`) · Not found: "Project not found" + back · Error: modal/mutation failures toast · Populated: header + tabs + right rail (hidden on `guardrails`, `ProjectDetail.tsx:159`).

**Checks**
- [ ] **1 Round-trip** — **Secrets:** open Manage Secrets, add `CK_TOKEN=s3cr3t-alpha`, Save, close, hard-reload, re-open, click that row's Reveal. Expect `s3cr3t-alpha` from `GET /api/projects/:id/env/CK_TOKEN/value`, not a blank box (the list endpoint is metadata-only: `{key, updated_at, has_value}`, X1). **Copy** must put `s3cr3t-alpha` on the clipboard, not `''` (`ProjectEnvSecretsModal.tsx:893-927`). **Reveal all** must fire one call per stored row. Add a second row and Save without touching the first — the first must still reveal its old value, not blank. **Setup:** on the Setup tab pick repo `api`, write `echo alpha` in `.sh` and `Write-Host alpha` in `.ps1`, Save, switch to repo `web` — its editors must be empty (scripts are per-repo via `project_repos.setup_sh_body`), then switch back and hard-reload and expect both bodies on `api` only.
- [ ] **2 Attribution** — History tab rows must name the real agent and the real item: each row's agent chip resolves from the run's `agent_id` and the item id links to `/tasks/:id` or `/sub-tasks/:id`. A row rendering the literal "Agent" is the X3 defect. Right rail `activeAgents` must list only agents on a not-`done` item (`ProjectDetail.tsx:83`) — mark a Task done and confirm its agent leaves the rail after a refetch.
- [ ] **3 List membership** — **Add repo** (clone mode) → after `clone_completed` the repo row is in the Repos tab without a reload (`['projects', id, 'repos']` invalidation) and after one. **Remove** the last repo: the API must allow it, the row disappears, the folder stays on disk, and the project's Tasks drop it. A 409 (a run holds the repo) must toast the API message, not vanish.
- [ ] **4 Transition legality** — `n/a — the Tasks tab's TaskTable has no inline status control; transitions are exercised in B1/B3`.
- [ ] **5 Cross-page** — the Tasks tab's "Showing N tasks in this project" must equal `/tasks?project=<name>` row count, and the Overview tile **Open tasks** must equal the `ready` + `draft` + `in_progress`-but-unstarted set the Tasks tab lists. Adding a repo here must also change the `/projects` card's repo count without a reload.
- [ ] **6 Error/empty/loading** — Setup tab on a project with zero repos: expect the info alert replacing the editors, not a crashed editor. Add-repo with a URL whose origin doesn't verify: expect `ConnectErrorDetails` + **Edit details** inline; a name collision → the API's 409 message inline. Deep-link `/projects/<bad-id>` → "Project not found".

**Traps**
- ⚠️ page doc stale: `03-project-detail.md:23-31` lists **Edit repository URL**, **Change default branch**, **Notification routing**, **Archive project** in the actions menu and calls Rename a stub. None of the four exists in `pages/project/ProjectActionsMenu.tsx:57-96`, and Rename opens a real modal. The menu is: Rename project… · Edit guard-rails · Manage Secrets · Generate AI scaffold… (conditional, disabled until a repo is `ready`) · Delete project…. Do not write failing checks against menu entries that are gone.
- ⚠️ `coming-soon.md` row "Bulk edit / assign on Project Detail" has no trigger in `ProjectDetail.tsx` or `pages/project/` — nothing to assert; treat the row as stale, not as a missing feature.
- Deep-link `?tab=setup` and `?tab=repos` directly with a cold cache — the page lifts its fetches to the page (`ProjectDetail.tsx:76-77`), so a tab that renders before `data` resolves must gate on `data === undefined`, not throw.
- All three Edit-guard-rails affordances route through the same imperative `setTab` callback because the old RouterLink `?tab=guardrails` was a no-op on a second click from the same URL (`ProjectDetail.tsx:60-64`). Click it twice from `?tab=guardrails` and expect it to keep working.

---

### A6 · Project Guard-rails — `/projects/:id/guard-rails` (tabs: rules|scripts)

**Component:** `packages/web/src/pages/ProjectGuardrails.tsx` (body rendered as `GuardrailsTab` by `ProjectDetail`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| the route itself | redirects to `/projects/:id?tab=guardrails` | — |
| Add rule / Add first rule | `AddRuleDialog` — Title + Rule body required, Applies-to optional | `POST /api/projects/:projectId/guardrails` |
| Per-rule toggle | sends `{ enabled: 1 \| 0 }` — **numeric, not boolean** (`api.ts:913-914`) | `PATCH …/guardrails/:id/toggle` |
| Scripts tab → Add script / card | `ScriptModal` add / edit; add mode offers one slug chip per non-overridden workspace script | `GET/POST/PATCH/DELETE …/guardrail-scripts`, `GET /api/guardrail-scripts` |

**States** — Empty: `rules.length === 0` → centered empty state + "Add your first rule" · Loading: 4 skeleton boxes in a 2×2 grid · Error: mutation failures toast · Populated: 2-column `RuleCard` grid; paused cards at 0.6 opacity.

**Checks**
- [ ] **1 Round-trip** — add a rule titled `No migrations` / body `Never edit /migrations` / applies-to `/migrations`, hard-reload `/projects/:id?tab=guardrails`, expect all three fields back on the card (`applies_to` renders only when set). Then flip its toggle off, **hard-reload**, and expect it still Paused — a toggle that resets on reload is local-only state, which is exactly what this check exists to catch.
- [ ] **2 Attribution** — `n/a — project guardrails carry no author or assignee FK`.
- [ ] **3 List membership** — the new rule appears in the grid on success (invalidation) and after a reload, and the header's active-rule count increments by one. A failed create must name the rule that failed, not just fail the count.
- [ ] **4 Transition legality** — `n/a — guardrail enable/disable is a boolean flag, not the item status machine`.
- [ ] **5 Cross-page** — with at least one enabled rule, `project.guardrails_md` is non-empty so the Project Detail header shows the shield indicator and the right rail shows the guardrails summary. Disable every rule and confirm the indicator agrees. Also confirm a project-scoped script whose slug matches a workspace script overrides it (the add modal's chip list must then stop offering that slug).
- [ ] **6 Error/empty/loading** — a project with no rules shows the empty state, not a blank panel. **Add rule** must stay disabled until title and body are both non-blank. Navigate to `/projects/:id/guard-rails` directly and assert the URL ends up at `?tab=guardrails`.

**Traps**
- The toggle endpoint takes **only** `{ enabled }`, not the whole rule (`04-project-guardrails.md:67`) — there is no edit-in-place; changing a title means delete + re-add. Don't write a check for an edit affordance that doesn't exist.
- The right rail is hidden on this tab (`ProjectDetail.tsx:159`), so a cross-page assertion about the rail's guardrails summary has to be made from another tab.
- `enabled` is numeric in the payload; a test asserting `{enabled:true}` on the wire passes against a component and fails against the API.

---

---

## Wave B — tasks, sub-tasks, queue, workflows

### B1 · Tasks — `/tasks`

**Component:** `packages/web/src/pages/Tasks.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| New Task | → `/tasks/new`; disabled when `projects.length === 0` | — |
| Show archived switch | `?include_archived=true` (`Tasks.tsx:49,166`); done Tasks older than 7 days hidden by default | `GET /api/tasks?include_archived=true` |
| Filters | project (by name) / status / assignee chips / `q`; all URL state; `/` focuses search (`TaskFiltersBar.tsx:163`) | `GET /api/tasks` |
| View toggle | Table ↔ Kanban, persisted in `localStorage` key `atlas.viewMode.tasks` (`ViewModeToggle.tsx:55`, `Tasks.tsx:38-43`) | — |
| Kanban drop | legal column → `useTransitionTask` with `override:false`; **illegal column is refused with a toast naming the legal targets** (`WorkItemKanban.tsx:237-256`) | `PATCH /api/tasks/:id/status` |
| Row / card click | → `/tasks/:id` | — |

**States** — Empty: `projects.length === 0` → "Create a project first, then add tasks." (`Tasks.tsx:249`) · Empty filter: `TaskTable.tsx:459` "No tasks match this view." · Loading: skeleton rows (`Tasks.tsx:216`) · Error: transition failures toast the server reason (`Tasks.tsx:287`) · Populated: `TaskTable` or `WorkItemKanban`.

**Checks**
- [ ] **1 Round-trip** — set `?project=<name>&status=in_progress&q=alpha`, hard-reload: all four filter controls must come back set from the URL and the rows must match. Flip to Kanban, hard-reload, expect Kanban (localStorage), then clear `atlas.viewMode.tasks` and expect Table.
- [ ] **2 Attribution** — for a Task with `reporter_agent_id` set and `assignee_agent_id` null, the Reporter column shows the agent's real name and Assignee shows the Owner's name from `settings.owner_name` — never the literal `'Agent'` or `'Unassigned'` for a row that has an FK (class 2). The Sub-tasks column must equal `sub_task_count`; open that Task and count the rows in its Sub-tasks table — the two must agree.
- [ ] **3 List membership** — create a Task from `/tasks/new`; it appears here without a reload and after one, and the header subtitle `N tasks · M awaiting pickup` (`GET /api/tasks/stats`, `Tasks.tsx:113`) must equal the listed rows for the same filter. Mark a Task done, wait past the 7-day archive window (or seed one), and confirm it is hidden until **Show archived** is on.
- [ ] **4 Transition legality** — in Kanban, drag a `ready` card onto **In Review**: expect a refusal toast reading `Can't move <id> to In Review` + `From Ready you can go to: In Progress, Waiting for Info.` and **no PATCH on the wire**. Drag the same card onto **In Progress**: expect a 200 and the card to stay. Drag a `done` card anywhere: the toast must say Done is terminal. Every column must derive from `getValidNextStatuses()` (`packages/shared/src/status-machine/index.ts:18-25`), never a hardcoded list.
- [ ] **5 Cross-page** — after a Kanban move, the Dashboard KPI strip, the sidenav Tasks badge and the project's Tasks tab must all agree without a manual reload.
- [ ] **6 Error/empty/loading** — drag a card whose Task has a **running** workflow run: expect a 409 from `workflow-lock.ts:27-32` surfaced as a toast carrying the server message ("…stop the workflow run to change it by hand"), and the card snapping back. A silent snap-back is the Epics-class defect the sweep already fixed once.

**Traps**
- ⚠️ page doc stale: `05-tasks.md` says "shift-drop overrides the status machine". There is no shift path in `WorkItemKanban.tsx` — illegal drops are refused outright and `onTransition(item, status, false)` is the only call site (`:257`). Override is available **only** via the detail page's `StatusPickerPopover`. A check written against shift-drop will fail for the wrong reason.
- "Assigned to me" means `assignee_agent_id === null` — single Owner, so unassigned *is* the Owner's. Don't read a null assignee as data loss here.
- The `?project=` filter matches by **name**, not id — a rename breaks a bookmarked filter.

---

### B2 · New Task — `/tasks/new`

**Component:** `packages/web/src/pages/TaskNew.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Title / Description | required; inline error on blur or on an invalid submit | — |
| Project select | required; pre-filled from `?project=` | `GET /api/projects/:id/repos` once picked |
| Repos (`RepoSelect`) | multi-select, project's **first** repo preselected, order = pick order; always sent as `repo_ids` (`TaskNew.tsx:148`) | — |
| Priority / Reporter / Assignee | `low` default; Reporter default `OWNER`; Assignee defaults `agent-po-writer` when installed+active, else `OWNER` (`TaskNew.tsx:103-105`) | — |
| Save as draft | create only → `draft` | `POST /api/tasks` |
| Submit | create then transition | `POST /api/tasks` + `PATCH /api/tasks/:id/status {status:'ready'}` |
| Cancel | → `/tasks`, no draft-guard prompt | — |

**States** — Empty: n/a, the form is the page · Loading: none; a pending create disables the actions · Error: toast from `submit()`'s catch (`TaskNew.tsx:161-163`) · Populated: form; Save/Submit also disabled while `reposMissing` (project picked, nothing selected — `TaskNew.tsx:122-123,524,546`).

**Checks**
- [ ] **1 Round-trip** — on a project with 3 repos, deselect the preselected repo and pick `web` then `api` (in that order), title `CK multi-repo`, Submit. On the `/tasks/:id` redirect, hard-reload and expect the rail's Repos row to show `web` then `api` as mono chips — **order preserved**, and `web` (the first picked) is the one that holds Task-wide files. Priority/reporter/assignee must round-trip too.
- [ ] **2 Attribution** — pick Reporter = a named agent and Assignee = Owner. On the created Task, Reporter renders that agent's name and Assignee renders `settings.owner_name`. `"OWNER"` is a select sentinel mapped to `null` in the payload (`TaskNew.tsx:145-147`) — a Task showing the literal string `OWNER` anywhere is the defect.
- [ ] **3 List membership** — after Submit the Task is on `/tasks` (status `ready`), on the project's Tasks tab, in the Dashboard KPI and in the sidenav badge, after invalidation and after a hard reload. **Save as draft** must land `draft`; **Submit** must land `ready` — check the rail chip on the detail page, not just the toast.
- [ ] **4 Transition legality** — Submit is the only transition this page performs and it is `draft → ready`, which the machine allows (`status-machine/index.ts:19`). Confirm no other status is reachable from this form. If the `ready` PATCH fails after a successful create, the toast reads "Saved — …" and the Task **stays `draft`** (`TaskNew.tsx:151-158`) — verify the rail agrees with the toast; a Task shown as ready after a failed transition is the bug.
- [ ] **5 Cross-page** — creating here must move `/tasks` stats subtitle, the project Tasks tab count, the Dashboard KPI and the sidenav badge. A `ready` Task with no `workflow_id` must appear in `/queue` → **Needs a workflow** (B5), because nothing will start it.
- [ ] **6 Error/empty/loading** — pick a project with **zero** repos: expect the info alert pointing at its Repos tab instead of the `RepoSelect`, and Save/Submit disabled. Click Submit with a blank title: expect `submitAttempted` to paint every field error inline, no request on the wire. Type a title then hit a sidenav row: expect the **Discard draft?** modal (`useDraftGuard`, `TaskNew.tsx:115`); then hit **Cancel** and confirm it leaves without asking (documented gap — `BrowserRouter`, no `useBlocker`).

**Traps**
- **Submitting starts nothing.** The form sets no `workflow_id`; the assignee is informational (ADR 0014). Do not assert that a worktree, branch or run exists after Submit — the workflow run provisions those. Rail Branch / Path stay empty.
- Browser automation at ~4-5 ms/key drops ~1 char per 50 in these controlled fields (`06-task-new.md:64`) — set values via the native setter + `input` event, or a spec will "find" a phantom truncation bug.

---

### B3 · Task Detail — `/tasks/:id`

**Component:** `packages/web/src/pages/TaskDetail.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| `EditableTitle`, Description, Acceptance criteria | inline edit cards | `PATCH /api/tasks/:id` |
| Rail Status (`StatusPickerPopover`) | **MOVE TO** = `getValidNextStatuses()`, **OVERRIDE** = every other status (`StatusPickerPopover.tsx:82-87,119,136-150`) | `PATCH /api/tasks/:id/status[?override=1]` |
| Rail Assignee | locked while `in_progress` | `PATCH /api/tasks/:id/assign` |
| Rail Repos (`TaskReposRow`) | clickable only when the project has >1 repo; Save → `{repo_ids}`; 409 toasts "Stop the workflow run to change repos" (`components/TaskReposRow.tsx:43-44`) | `PATCH /api/tasks/:id {repo_ids}` |
| Rail Workflow select | None + the project's `input_kind='item'` workflows; picking one on a **draft** Task also flips it to **ready** (`services/workflows.ts:467-471`) | `PUT /api/items/:id/workflow` |
| Rail Start now | starts a run when a workflow is set and none is live | `POST /api/workflows/:id/runs` |
| Rail **Continue · N open** | only when `!live && latest.status==='completed' && openSubtasks>0 && workflow has a subtasks node` (`ItemWorkflowPanel.tsx:56-57`) | `POST /api/workflows/:id/runs {item_id, from_subtasks:true}` |
| Add sub-task | inline `AddSubTaskForm` | `POST /api/tasks/:id/sub-tasks` |
| Reorder | `ReorderSubTasksDialog` → Save order | `PUT /api/tasks/:id/sub-tasks/order` |

**States** — Loading: `IssueDetailLoading withBreadcrumb` · Not found: "Task not found" + Back to Tasks · Error: mutation toasts · Populated: `IssueDetailShell`; Spec and Pull request cards render **only** when `spec_md` / `pr_url` are non-empty.

**Checks**
- [ ] **1 Round-trip** — edit title, description, acceptance criteria, priority `urgent`, labels `dev,qa`; hard-reload `/tasks/:id` and expect all five back. On a multi-repo project, open the Repos dialog, reorder to `api,web`, Save, hard-reload, expect the chips in that order and the **Path** info icon ("Workspace folder — one checkout per repo") present.
- [ ] **2 Attribution** — post a comment as the Owner: `ConversationCard` must render `settings.owner_name`, never `'Agent'` (X3 / C1). Every Activity feed row's actor resolves — a status row written by a workflow step shows the step's agent name. Rail Total cost must equal the sum over `useItemAgentRuns(id)`, not a placeholder.
- [ ] **3 List membership** — **Add sub-task** `CK child`: it appears in the Sub-tasks table without a reload, after a hard reload, and `/sub-tasks/<newId>` resolves on a **cold** deep link (new tab). The Task's Sub-tasks count on `/tasks` and on the project Tasks tab must both increment. Reorder two sub-tasks, Save order, hard-reload — the new order must hold (run order is hand-set, then oldest-first).
- [ ] **4 Transition legality** — open the Status popover on an `in_review` Task: **MOVE TO** holds exactly Done / In Progress / Waiting for Info, and Draft / Ready sit under **OVERRIDE** — absent from MOVE TO, not greyed inside it. On a `done` Task, MOVE TO is empty and all five others are under OVERRIDE. Then: with one **open** sub-task, pick Done → expect **422** from `routes/tasks.ts:86-95` with `details.open_children` naming the blocker, surfaced in the UI (not swallowed). With only **`in_review`** sub-tasks blocking, expect the toast "N sub-task(s) in review — Close them with the Task?" and **Close them too** re-PATCHing with `close_sub_tasks: true` (`routes/tasks.ts:72-74`). Finally pick Done under **OVERRIDE** (`?override=1`, accepted as `1` or `true` at `routes/tasks.ts:70`) and confirm it succeeds and the activity row carries an `override` badge.
- [ ] **5 Cross-page** — set the rail Workflow on a **draft** Task: the Task must flip to **ready** here, leave `/queue`'s **Needs a workflow** section and appear under that workflow's card, all without a manual reload. **Start now** must put the run on `/queue` → Running and on `/workflows/:id?tab=runs`, and the rail chip must link to `/workflows/:id/runs/:runId`.
- [ ] **6 Error/empty/loading** — while the run is `running`, use the rail Status picker: expect a 409 toast carrying the `workflow-lock.ts:27-32` message and the chip unchanged. A **parked** (`waiting_for_owner`) run must NOT lock — the same PATCH succeeds. Deep-link `/tasks/does-not-exist` → "Task not found" with no console error.

**Traps**
- Setting a workflow on a Task whose `repo_ids` is empty is refused **409** "This Task has no repos — add one to the project first" (`services/workflows.ts:453-456`) — assert the toast, this is a legitimate refusal, not a failure.
- Spec and Pull request cards are absent until the run writes `spec_md` / `pr_url`. Absent ≠ broken.
- A finished run leaves the Task `in_review`, not `done`, when it opened a PR or any sub-task isn't done. Choosing Done while a `pull_request` link is unmerged first fires `POST /api/issues/task/:id/external-links/refresh`, then asks **Mark done anyway?** listing the PRs.
- `PUT /api/items/:id/workflow` 400s on a sub-task ("Only Tasks are queued for workflows", `services/workflows.ts:458`) — the rail panel is Tasks-only by design.

---

### B4 · Sub-task Detail — `/sub-tasks/:id`

**Component:** `packages/web/src/pages/SubTaskDetail.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| `EditableTitle`, Description, Acceptance criteria | inline edit | `PATCH /api/sub-tasks/:id` |
| Rail Status (with Override) | same `StatusPickerPopover`, `issueType='sub_task'` (`StatusPickerPopover.tsx:82-84`) | `PATCH /api/sub-tasks/:id/status` |
| Rail Assignee | locked while `in_progress` | `PATCH /api/sub-tasks/:id/assign` |
| Rail Labels | project label suggestions; labels pick which Sub-tasks step claims the row | `PATCH /api/sub-tasks/:id` |
| 3-dots → Clone item | creates `CLONE <title>` under the **same** Task, copies description / AC / labels, then a `relates_to` link back, then navigates to the clone (`SubTaskDetail.tsx:135-145`) | `POST /api/tasks/:taskId/sub-tasks` + `POST /api/issues/sub_task/:id/links` |
| 3-dots → Delete | `ConfirmDeleteModal` → back to the parent Task | `DELETE /api/sub-tasks/:id` |
| Related → **Add test link** | `allowAddTestLink` (`:251`); the picker is restricted to the same Task via `restrictToTaskId` (`:272`) | `POST /api/issues/sub_task/:id/links` |

**States** — Loading: `IssueDetailLoading` · Not found: "Sub-task not found" + Back to Tasks · Error: mutation toasts · Populated: `IssueDetailShell`; Blocked by / Relates to / Pull Requests hide while empty, Tested by / Tests always offers **Add test link**.

**Checks**
- [ ] **1 Round-trip** — edit the title, set labels `qa,regression`, priority `high`; hard-reload and expect all three. Then open `/sub-tasks/:id` in a **fresh tab with a cold cache** — it must resolve from the direct `GET /api/sub-tasks/:id/full`, not by scanning the parent's children.
- [ ] **2 Attribution** — post a comment as the Owner and expect `settings.owner_name` on the card, never `'Agent'` (X3 — `comments.agent_id` null renders the literal). A comment written by a workflow step must carry that step's agent name.
- [ ] **3 List membership** — **Clone item**: the clone lands under the **same** Task (check its rail Task link and the parent's Sub-tasks table), carries `CLONE <title>` + the copied description/AC/labels, and shows a `relates_to` link back to the source on both ends. Open **Add test link** and confirm the picker offers **only** sub-tasks of this Task — a candidate from another Task in that list is the defect.
- [ ] **4 Transition legality** — on a `ready` sub-task the popover's MOVE TO holds exactly In Progress / Waiting for Info; Draft / In Review / Done sit under OVERRIDE. The open-children rule does **not** apply (sub-tasks have no children) — a sub-task at `in_review` may go straight to `done`. With an open `depends_on` blocker, moving to `in_progress` must be refused with the blocker named (`services/dependency-guard.ts:64-78`, error `Blocked by <id> (<status>)`), while `waiting_for_info` is still allowed (`:66`).
- [ ] **5 Cross-page** — closing a sub-task must move its Task's Sub-tasks table, the Sub-tasks column on `/tasks`, and the Dashboard Awaiting You panel without a manual reload. If its Task's run holds it, the run's canvas Sub-tasks node caption `X of Y sub-tasks done` on `/workflows/:id/runs/:runId` must agree.
- [ ] **6 Error/empty/loading** — while this sub-task's own workflow run is `running`, a status or assign PATCH must 409 with the `workflow-lock.ts` message in a toast. Deep-link `/sub-tasks/nope` → "Sub-task not found", no console error. A sub-task with no links must hide Blocked by / Relates to / Pull Requests but still show **Add test link**.

**Traps**
- The rail has **no Workflow rows and no Branch / Path** — sub-tasks share the Task's worktree. A check expecting a Workflow select here is wrong by design.
- A finished sub-task is `in_review`, not `done`; a Sub-tasks step only picks up sub-tasks that are neither `in_review` nor `done`, so re-running a Task redoes only the unfinished ones.
- Creating a sub-task while its Task's run is live is legal — the run picks it up at its Sub-tasks step or its End gate sends the run back there. Don't assert a refusal.

---

### B5 · Queue — `/queue`

**Component:** `packages/web/src/pages/Queue.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Project select | `All projects` + each project; refetches with `?project_id=` — the only filter | `GET /api/workflow-queue` |
| Card **Active / Paused** switch | `aria-label "<name> active"` | `PATCH /api/workflows/:id` |
| Running / Waiting row → **Open run** | → `/workflows/:wid/runs/:rid` | — |
| Queued row → **Start now** | rendered **only** while `free = max_parallel_runs - running.length > 0` (`WorkflowQueueCard.tsx:106,212`) | `POST /api/workflows/:id/runs {item_id}` |
| Needs a workflow → picker | `aria-label "Workflow for <id>"`, lists that project's Task workflows | `PUT /api/items/:id/workflow` |

**States** — Loading: two rounded skeleton cards · Error: `Alert` "Couldn't load the queue: …" · Empty: dashed `EmptyState` "No workflows yet" + **Go to workflows**; the Needs-a-workflow section still renders under it · Idle card: "Nothing running or queued. Set a ready Task's workflow to this one to queue it." (`WorkflowQueueCard.tsx:230`) · Populated: one card per workflow, 1 col (2 from `lg`).

**Checks**
- [ ] **1 Round-trip** — flip a card's Active switch to Paused, hard-reload `/queue`, expect it still Paused and the same state on `/workflows` (card pill) and in the builder header. Use the **Needs a workflow** picker to assign a workflow, hard-reload, and expect that Task to have moved onto the workflow's card under **Queued**.
- [ ] **2 Attribution** — each Running row's current step must name the node's **agent** resolved from `graph_snapshot` via `agentLabel`, or one of the literals `Sub-tasks` / `Owner` / `Starting` / `Delivering`. A raw node id or a blank step label on a live run is the defect. Each row's Task id + title must link to a real `/tasks/:id`.
- [ ] **3 List membership** — set a `ready` Task's workflow from its detail rail: it must leave **Needs a workflow** and appear under that workflow's **Queued** list without a manual reload (`useSSE` invalidates `['workflow-queue']` on `workflow_run_updated` / `counts_changed`), and after a hard reload. Start it: it must move Queued → Running and the meter must tick up.
- [ ] **4 Transition legality** — `n/a — the queue has no status control; a Task's status is moved by the run or on its detail page`.
- [ ] **5 Cross-page** — the header strip `N running · N queued · N waiting on you · N need a workflow` (`Queue.tsx:48-53`) must equal the sum over the cards plus the unassigned list. The sidenav **Queue** badge (`GET /api/counts` → `queue`) must equal queued + running **across all projects** — set the Project select to one project and confirm the badge does not follow the filter (X4: the difference must be explainable, not silent).
- [ ] **6 Error/empty/loading** — with `running === max_parallel_runs`, **Start now** must be **absent** on every Queued row (not disabled). On a paused or manual workflow the Queued section must carry the explanatory line ("Paused: these wait until you turn it back on." / "Manual: these wait until you start them."). Stop the API and reload: expect the `Alert`, not a blank page.

**Traps**
- Queued rows are numbered in `updated_at` order **including** Tasks blocked by an open `depends_on` target; dispatch skips those, so **the next Task to start may not be #1**. Don't assert #1 starts first.
- A project-run (`input_kind='none'`) workflow only appears while one of its runs is live; sub-workflows never appear. An absent card is not a missing workflow.
- A parked run does not hold a slot — a card can show 1 waiting + 1 running with `max_parallel_runs = 1` and still offer **Start now**.

---

### B6 · Workflows — `/workflows`

**Component:** `packages/web/src/pages/Workflows.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| New workflow | `NewWorkflowDialog` — Project required, then **Blank** or a template card | `POST /api/workflows` or `POST /api/workflows/from-template` |
| Import | `ImportWorkflowDialog` — Project + `.zip`; both required before Import enables | `POST /api/workflows/import` (multipart, `project_id` **before** `file`, `api.ts:1133-1139`) |
| Card click / Enter | → `/workflows/:id` | — |

**States** — Loading: 3 rounded skeleton cards · Error: `Alert` "Couldn't load workflows: {message}" · Empty: dashed `EmptyState` "No workflows yet" + **New workflow** · Populated: 1/2/3-column card grid.

**Checks**
- [ ] **1 Round-trip** — create a **Blank** workflow on project P; it lands in the builder as `Untitled workflow` with a Start → End pass edge. Rename it to `CK flow`, Save, go back to `/workflows`, hard-reload: the card reads `CK flow · {P} · N agents`, and its footer metas show Trigger `Manual`, Input `Per Task`.
- [ ] **2 Attribution** — template cards' agent chips must render each **installed** agent's name + accent; a catalog agent that isn't installed renders as a humanized id with a dashed border, and the dialog says "Installs from the marketplace: …". A chip showing a raw slug for an agent you *do* have installed is the defect. Card sub-lines must resolve the real project name, not the id.
- [ ] **3 List membership** — create from the **Delivery** template: the new workflow AND the project's **Build sub-task** / **Test sub-task** workflows appear in the grid without a reload (SSE `counts_changed`) and after one. Header `N workflows · M active` must equal the visible cards. Import a bundle: the toast names `Installed … · Reused … · Sub-workflows …` and the page navigates to the imported workflow — a bare count with no detail is the class-3 bug.
- [ ] **4 Transition legality** — `n/a — workflow status is Active/Inactive, not the item status machine`.
- [ ] **5 Cross-page** — a newly created Task workflow must appear in the Task Detail rail's Workflow select for that project, in `/queue` as its own card, and (from a template that installs agents) its new agents must be on `/agents` — `useImportWorkflow` / from-template invalidate `['agents']` too.
- [ ] **6 Error/empty/loading** — Import a zip missing `workflow.json`: expect the 400 reason inline as an `Alert` (`Workflow bundle: missing workflow.json`), the dialog staying open, and no partial workflow left behind (the import rolls everything back). Import a bundle whose name clashes: expect ` (imported)` / ` (imported 2)` suffixing, not a silent overwrite. Delete every workflow → the dashed empty state.

**Traps**
- The multipart field order matters: the server only sees fields sent **before** the file part (`api.ts:1134`). A refactor that appends `file` first breaks import with a confusing error.
- **Create workflow** stays disabled until a project is picked — a template selected with no project is not a failing state.

---

### B7 · Workflow Detail (Builder) — `/workflows/:id` (tabs: builder|runs)

**Component:** `packages/web/src/pages/workflows/WorkflowBuilder.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Save | PATCHes the **whole** workflow — all settings + graph; disabled when clean, name blank, or client validation fails (`WorkflowHeader.tsx:87`) | `PATCH /api/workflows/:id` |
| Run now | `input_kind='item'` → `RunWorkflowDialog`; else POST + navigate. Disabled with "Save your changes before running" while dirty (`WorkflowHeader.tsx:104`) | `POST /api/workflows/:id/runs` |
| Export | link to the zip; disabled while dirty, tooltip "Save your changes before exporting" (`WorkflowHeader.tsx:112-117`) | `GET /api/workflows/:id/export` |
| Publish | stores the same bundle as a Marketplace entry; disabled while dirty or publishing (`WorkflowHeader.tsx:125-130`) | `POST /api/workflows/:id/publish` |
| Delete | `ConfirmActionModal` → `/workflows`; 409 on live runs or a sub-workflow in use | `DELETE /api/workflows/:id` |
| Palette drag / click | adds Owner / Sub-tasks (only when `input_kind='item'`) / End / agent node | — |
| Handle drag | creates a `pass` (bottom, green) or `fail` (right, red) edge and **replaces** that handle's previous edge | — |
| Inspector | per-node settings; nothing selected = workflow settings | — |

**States** — Loading: centered spinner · Not found: "Workflow not found." (or the API message for non-404) · Error: 400 `details.graph_errors` join the validation list and outline their nodes · Populated: header + tabs · Phone (<`sm`): read-only canvas, palette + inspector hidden.

**Checks**
- [ ] **1 Round-trip** — drop an agent node, wire Start → agent → End, set Name `CK builder`, Max loops `7`, Tasks in parallel `3`, Delivery **Push branch**; Save; hard-reload `/workflows/:id`. Expect every one of those back, including the node **positions** and the edge kinds (`pass` solid, `fail` dashed). Then switch to `?tab=runs` and back to `?tab=builder` — the tab is URL-controlled (`useTabParam`) and must survive a deep link.
- [ ] **2 Attribution** — every agent card must show the real `name` + `accent_color` + `cli · model · effort` from the installed agent. A node whose agent isn't installed shows its **raw id** and "not installed" by design, and saving must return a server `graph_errors` entry naming it — a node silently rendering a humanized id with no error is the defect. A Sub-tasks node titled with the sub-workflow's real name, "Sub-tasks" only when the sub-workflow is missing.
- [ ] **3 List membership** — **Run now** → the run appears in the **Runs** tab table without a reload and after one, on `/queue` under this workflow, and on the Task's rail as the latest run. The Runs row's Pull request column populates once the run's End writes `pr_url`.
- [ ] **4 Transition legality** — `n/a — the builder edits a graph; item status transitions belong to the run`. (Only the `RunWorkflowDialog`'s **Ready task** list touches status: it must offer **only** `ready` Tasks of the project, queued-here ones first with "(queued here)".)
- [ ] **5 Cross-page** — rename here + Save: the new name must show on `/workflows` cards, on `/queue`'s card header, and in the Task Detail rail's Workflow select. Flip **Active** off in the inspector + Save: the `/queue` card switch and the `/workflows` card pill must both read Paused/Inactive.
- [ ] **6 Error/empty/loading** — build an invalid graph (e.g. a Sub-tasks node with `input_kind` switched to Project run): the shared `validateWorkflowGraph` must show "Fix before saving" with the offending node dash-outlined, and Save disabled. Save a graph referencing a deleted agent: expect the server's `graph_errors` in the list, not a 500. Delete a workflow another workflow's Sub-tasks step uses: expect a 409 toast. Make an edit then navigate via the sidenav: expect the **Discard draft?** guard.

**Traps**
- A node owns exactly **one** pass edge and at most one fail edge — dragging a second pass edge from the same handle silently **replaces** the first. Assert the old edge is gone, not that two exist.
- Handle choice (`in` vs the side `loop` entry) is derived from node positions at render and is **not saved** (`34-workflow-detail.md`) — don't assert a persisted handle id.
- `push_to_default` requires push on and PR off; the API 400s the other three combinations. The four Delivery cards are the only legal combos.
- **Run now** on a sub-workflow is refused 400 ("A sub-task workflow runs only from a Task workflow's Sub-tasks step") and toasts — a legitimate refusal.
- A newer server copy (SSE refetch) replaces the local draft **only while it isn't dirty**; with unsaved edits the canvas deliberately keeps the stale draft.

---

### B8 · Workflow Run — `/workflows/:id/runs/:runId`

**Component:** `packages/web/src/pages/workflows/WorkflowRunDetail.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Breadcrumb `Workflows / {name}` | → `/workflows/:id?tab=runs` | — |
| **part of the Task run** (sub-task runs only) | → `/workflows/:workflowId/runs/:parent_workflow_run_id` | — |
| Resume | only on `waiting_for_owner` (`WorkflowRunDetail.tsx:267`) | `POST /api/workflow-runs/:id/resume` |
| Stop | on `running` or `waiting_for_owner`; stopping a sub-task's run stops its whole Task run (shared branch) | `POST /api/workflow-runs/:id/stop` |
| Pull request | shown when `pr_url` is set | — |
| Step row click | → `/agents/:agentId/runs/:runId` | — |
| Child row click | opens that sub-task's run view | — |

**States** — Loading: centered spinner · Not found: "Workflow run not found." · Error: `error` banner "The run stopped on an error. Check the failed step's log." · Populated: header + banner + canvas + Steps panel (side-by-side on `lg`).

**Checks**
- [ ] **1 Round-trip** — `n/a — the page is read-only over the run; Stop/Resume are covered under 4/6` (there are no editable fields to reload).
- [ ] **2 Attribution** — each Steps row must name the real agent and the step's **snapshot** `cli · model · {effort} effort`, plus `outcome: {kind}` and the summary reason. A row rendering a raw `agent_id` or a blank model is the defect. The header's item id must link to the real item when it is in the project's issue tree, and render as plain mono text when it isn't (archived) — never a broken link.
- [ ] **3 List membership** — on a Task run with sub-tasks, the Steps panel's **Sub-tasks · X of Y done** list (`WorkflowRunDetail.tsx:331-336`) must contain exactly `run.children`, oldest first, and X must equal the children with `status === 'completed'` (`:334`). The Task run's own steps must **not** include its sub-tasks' steps. The canvas Sub-tasks node caption must show the same `X of Y`.
- [ ] **4 Transition legality** — `n/a — the run moves item statuses through the engine, not through a control on this page`. Confirm only that stopping a `running` run releases the `workflow-lock` 409 on the item: Stop here, then change the Task's status from `/tasks/:id` and expect a 200.
- [ ] **5 Cross-page** — while a run is live, this page, `/queue`'s Running section, the Task Detail rail chip and the Runs tab row must all show the same status without a manual reload (`useSSE` invalidates `['workflow-run', runId]` on `workflow_run_updated` — also under `parentWorkflowRunId` — and on every `agent_status` / `run_completed` / `run_error`). `total_cost_usd` in the header must equal this run's steps **plus** its sub-task runs' steps; cross-check against `/analytics/task/:taskId`.
- [ ] **6 Error/empty/loading** — park a run: expect the warning banner led by `park_reason` (`:129-131`) and the parked node amber with a hand icon; a Task run held by a parked sub-task must read `Sub-task <id> is waiting for you: <reason>`. Reply on the sub-task and confirm **both** runs resume. Force a step error: the node goes red with an error icon and the banner points at the failed step's log. Deep-link a bad `:runId` → "Workflow run not found."

**Traps**
- The canvas renders `graph_snapshot`, **not** the live workflow. Edit the workflow mid-run and reload this page — the canvas must be unchanged. A redrawn canvas is the bug.
- The run summary carries **no `item_type`**, so the item link is resolved through the project's issue tree; plain mono text for an out-of-tree item is correct, not a broken join.
- **Owner nodes have no steps** — they only light up while parked. An Owner node with no Steps row is expected.
- A `×N` badge on a node means it ran more than once (a fail loop); `N loops` appears in the header only when `loop_count > 0`.
---

## Wave C — terminals, agents, marketplace

### C1 · Terminal — `/terminal`

**Component:** `packages/web/src/pages/Terminal.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Start Session | opens `StartSessionDialog` (CLI, project, repo, model, item, title/branch, initial prompt) | `POST /api/cli/sessions` |
| Multi-pane icon (`DashboardCustomizeRounded`, `Terminal.tsx:172-183`) | navigates `/terminal/layout` | — |
| Status pills / CLI chip / Project chip / Search | client-side filter over the fetched list (`Terminal.tsx:107-121`) | — (no refetch) |
| Card click | `navigate(sessionDetailUrl(s))` — `active`/`paused` → `/terminal/:id`, `closed`/`errored` → `/terminal/:id/history` (`cliSessionRouting.ts:8-12`) | — |

**States** — Empty: `sessions.length === 0` → dashed `EmptyState` card + Start Session CTA (`:222`) · Loading: centered `CircularProgress` (`:218`) · Error: **none** — `useCliSessions` error is swallowed by `data = []`, so a 500 renders the empty state, not an error (`:88`) · Populated: 3-col grid of fixed-200px `SessionCard`s (`:235`).

**Checks**
- [ ] **1 Round-trip** — Start Session on project P, branch `x`, title `T`; land on `/terminal/:id`; hard-reload `/terminal`; the card must show title `T`, branch `x`, project name P and `model` exactly as picked. Then set Status=Paused + CLI=Claude + a search string, hard-reload: the three chips come back set (`localStorage` `atlas.terminal-filters.v1`, `Terminal.tsx:41,93-99`).
- [ ] **2 Attribution** — the project line is a resolved name, not a UUID: `projectNameById.get(s.project_id) ?? s.project_id` (`Terminal.tsx:250-254`). Create a session, then confirm the card reads the project's name. A raw UUID on screen means `useProjects()` lost the row. A standalone row would render the literal `'Standalone'` — it must never appear here, because the query is `{standalone: false}`.
- [ ] **3 List membership** — count the grid with all filters cleared and compare to `GET /api/cli/sessions?standalone=false` length; the header line `{n} sessions` must equal both (`:168`). A session created on `/terminal/standalone` must **not** appear.
- [ ] **4 Transition legality** — the card itself offers no status control; assert instead that a `closed` card routes to `/history` and an `active` card to the live view (`sessionDetailUrl`). Clicking a `closed` card that lands on `/terminal/:id` is the failure.
- [ ] **5 Cross-page** — stop a session from `/terminal/:id`; without touching reload, this list must flip that card to `closed` (SSE `cli_session_closed`, `cli-sessions.ts:988`) and the per-status count chips must re-derive (`counts`, `:123-129`).
- [ ] **6 Error/empty/loading** — kill the API and load `/terminal`: today you get the "No sessions yet" empty card, which claims zero sessions when the truth is unknown. Assert an error surface exists, or record this as the known gap.

**Traps**
- The new-session navigation bypasses the router helper: `navigate('/terminal/' + created.id)` (`Terminal.tsx:268`) instead of `sessionDetailUrl`. Harmless only because a fresh session is always `active`.
- `relativeAgo` returns `''` (blank, not "now") for a future or non-finite `last_active_at`, so a clock-skewed row renders `last active ` with nothing after it (`Terminal.tsx:68-79`).
- ⚠️ page doc stale: `23-terminal.md:78-79` lists the multi-pane entry point and the closed/errored → history routing under "Coming soon". Both ship — `Terminal.tsx:174` and `Terminal.tsx:255`. Neither is in `coming-soon.md`.
- ⚠️ page doc stale: `23-terminal.md:31,70` sources the CLI icons from `utils/cliPresentation.ts`; the page imports `cliIcon` from `utils/cliIcons.ts` (`Terminal.tsx:14`), a separate module split out to keep icon components out of label-only chunks (`cliIcons.ts:7-9`).

---

### C2 · Terminal Session (live) — `/terminal/:id`

**Component:** `packages/web/src/pages/TerminalSession.tsx` (no page doc — covered inside `23-terminal.md`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Pause | `usePauseCliSession` → toast "Session paused"; rendered only when `status === 'active'` (`TerminalSessionControls.tsx:171,191`) | `POST /api/cli/sessions/:id/pause` |
| Resume | rendered only when `status === 'paused'` (`:172`) | `POST /api/cli/sessions/:id/resume` |
| Stop | project session → `StopSessionModal`; standalone → `ConfirmActionModal` "Close terminal?" (`TerminalSessionControls.tsx:49-82`) | `POST …/preflight-stop`, `GET …/diff`, `POST …/stop` |
| Copy session id | `navigator.clipboard.writeText(claude_session_id)` (`TerminalSession.tsx:83-91`) | — |
| xterm keystrokes | raw byte pipe over WS | `WS /api/cli/sessions/:id/stream` |

**States** — Empty: n/a (a session row always exists or 404s) · Loading: centered spinner (`:57`) · Error: "Session not found or no longer accessible." + back link (`:65-74`) · Populated: header chips + branch/model/session-id strip + `TerminalXterm` · Terminal-status: renders `null` and `history.replace`s to `/terminal/:id/history` (`:43-47,:79`).

**Checks**
- [ ] **1 Round-trip** — type `echo atlas-rt-1` into the xterm, press Enter, wait for output, then hard-reload the page. The line must repaint from the server-side headless mirror's snapshot frame, not vanish. Then Pause, reload: status chip reads `paused` and the Pause button is replaced by Resume.
- [ ] **2 Attribution** — the Branch field must print the session's real `worktree_branch`; `'—'` is the null placeholder (`:150`) and is correct **only** for a standalone session. A project session showing `—` means the create path never wrote the branch.
- [ ] **3 List membership** — after Stop → confirm, `/terminal` must show this session as `closed` and `/terminal/:id` must bounce to `/history` on a direct revisit (`:44`).
- [ ] **4 Transition legality** — from `active`: Pause + Stop shown, Resume **absent** (not greyed). From `paused`: Resume + Stop, Pause absent. From `closed`/`errored`: the page redirects, so no control is reachable at all (`:171-173` + `:79`). A greyed-out Resume on an active session is the failure.
- [ ] **5 Cross-page** — Stop with "Open a pull request" ticked; the toast must read "Session stopped + PR opened" with the URL in `detail` (`TerminalSessionControls.tsx:23-27`), and `/terminal/:id/history` must then render the PR success alert from `finalize_pr_url` (`TerminalHistory.tsx:141`).
- [ ] **6 Error/empty/loading** — Pause a session twice in quick succession: the second call 409s (`cli-sessions.ts:762`) and must surface as the toast "Could not pause" + the server message (`TerminalSessionControls.tsx:148-150`), never a silent no-op.

**Traps**
- Stop on a **standalone** session must never open `StopSessionModal` — the branch is `session.project_id !== null` (`TerminalSessionControls.tsx:49`). Getting it wrong shows a diff/stage UI over the Owner's own repo, and the server-side guard that stops `cleanupWorktreeAfterPush` from deleting a real repository sits at `cli-sessions.ts:975-981`.
- The standalone confirm hard-codes `{files_to_stage: [], open_pull_request: false}` (`TerminalSessionControls.tsx:73`) and reports `{pushed:false, committed:false, prUrl:null}` (`:75`) without reading the server response — the toast can only ever say "Session stopped" for that kind.
- Resume does **not** re-run the project setup script (`cli-sessions.ts:791`); it only refreshes ground rules. A test that assumes `node_modules` is re-installed on resume will pass for the wrong reason.
- In compact contexts the Stop modal must be mounted by the parent via `useTerminalStopModal`, not in-component — the MUI `Menu` unmounts its children on close and would kill an in-flight preflight (`TerminalSessionControls.tsx:92-99`).

---

### C3 · Terminal Layout (multi-pane) — `/terminal/layout`

**Component:** `packages/web/src/pages/TerminalLayout.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| `LayoutPickerMenu` | switches `kind`; truncates `panes[]` when the new shape has fewer panes, toasts how many detached (`:187-196`) | — |
| Connect ▾ → Start new session… | `StartSessionDialog`; `onCreated` attaches to *this* pane, no navigation | `POST /api/cli/sessions` |
| Connect ▾ → Attach to existing | lists `active`/`paused` only; already-attached ids disabled | — |
| Pane kebab → Pause/Resume/Stop | `TerminalSessionControls compact` + parent-owned stop modal | `…/pause`, `…/resume`, `…/stop` |
| Pane kebab → Detach pane (keep session) | clears `panes[i].sessionId`; server session keeps running | — |
| Hide chrome | collapses the 44px toolbar to a floating eye | — |

**States** — Empty: `EmptyPane` dashed tile + "Connect ▾" · Loading: `useCliSessions` spinner only in the attach menu · Error: per-pane "Session not found — it may have been deleted." + Clear (`:246`) · Populated: `PaneChrome` + `TerminalXterm` per attached pane · Non-live attached: "Session is {status}. Open in single view for transcript." (`:279`).

**Checks**
- [ ] **1 Round-trip** — attach two sessions in a `v2` layout, drag the divider off-center, hard-reload. Pane assignment comes back from `atlas.terminal-layout.v1` (`:34,:149`) and the drag sizes from `react-resizable-panels`' `autoSaveId` `atlas.terminal-layout.v2` (`:307`). Switch to `single`, then back to `v2`: the drag sizes must be the ones you set, because `autoSaveId` is per-kind.
- [ ] **2 Attribution** — `PaneChrome` must print each pane's own `session.title` and its own CLI icon. Two panes on different CLIs showing the same icon is the failure.
- [ ] **3 List membership** — "Attach to existing" must list every `active`/`paused` session from `GET /api/cli/sessions` and **exclude nothing else**; a session already in another pane appears disabled with "(in another pane)", not missing.
- [ ] **4 Transition legality** — detach a pane, then re-open the attach menu: the detached session must be selectable again (detach ≠ stop). Switch from `grid2x2` to `single` with 4 panes filled: the toast names 3 detached, and all 3 remain attachable — none moved to `closed`.
- [ ] **5 Cross-page** — Stop a session from a pane kebab; `/terminal` must show it `closed` without a manual reload, and the pane must flip to the "Session is closed" body (`:279`) rather than keep a dead xterm.
- [ ] **6 Error/empty/loading** — paste `?k=v2&s=<deleted-id>,` in the URL: the pane renders "Session not found" with a working Clear button (`:246`), not a blank tile or a crash.

**Traps**
- The URL wins over `localStorage` on first load, so a shared `?k=…&s=…` link must override the local record — test by opening a link that disagrees with your saved layout.
- The xterm grid is **pinned** to `TERMINAL_COLS × TERMINAL_ROWS` and nothing is sent to the server on resize; a divider drag rescales the font instead (`24-terminal-layout.md:38`). Assert that dragging never produces stranded/duplicated cells in an Ink-style TUI — that is the ConPTY zombie-character bug this design exists to avoid.
- A `closed`/`errored` id can only reach a pane via URL paste; it must render the status notice, never an xterm that silently accepts keystrokes.

---

### C4 · Terminal — Standalone — `/terminal/standalone`

**Component:** `packages/web/src/pages/TerminalStandalone.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Open folder | `StartStandaloneSessionDialog` — CLI, `FolderPicker`, Git credentials select, model, optional title + prompt | `POST /api/cli/sessions/standalone` (+ `GET /api/fs/list\|stat\|join\|home`) |
| Card click | `navigate(sessionDetailUrl(s))` (`:161`) | — |
| Stop (from `/terminal/:id`) | `ConfirmActionModal` "Close terminal?" — no diff, no commit, no cleanup | `POST /api/cli/sessions/:id/stop` |

**States** — Empty: dashed `EmptyState` + "Open folder" CTA (`:139`) · Loading: centered spinner · Error: same swallow-to-empty gap as C1 · Populated: header + card grid, **no filter row** (none of project/branch/item exists here).

**Checks**
- [ ] **1 Round-trip** — open a folder under credential `C` with title `T`; hard-reload `/terminal/standalone`. The card must show `T`, the folder path, and the credential chip labelled `C`. Then close the session and reload: the `{spend} spent` header figure must be non-zero for a Claude session (ingest fills `total_cost_usd` from the on-disk JSONL resolved via `worktree_path` + `claude_session_id`).
- [ ] **2 Attribution** — the credential chip resolves the FK: `credentialLabelById.get(s.credential_id) ?? s.credential_id` (`:156-159`), falling back to the literal `'machine git config'` only when `credential_id` is null (`:282`). A raw UUID on the chip is a broken join; `'machine git config'` on a session you created *with* a credential is the attribution bug. Then commit inside the session and check `git log` shows the credential's name/email, not the host `~/.gitconfig` identity.
- [ ] **3 List membership** — a standalone session must appear here and **never** on `/terminal` (`Terminal.tsx:88` filters `standalone: false`). Create two standalone sessions on the *same* folder — both must list; the unique index is scoped `WHERE worktree_branch IS NOT NULL`, so null-branch rows cannot collide.
- [ ] **4 Transition legality** — `active` → Stop → `closed`. Confirm the folder afterwards: `git status` unchanged, no `.atlas/` directory written, the directory still on disk. The server short-circuits above the worktree guard (`cli-sessions.ts:975-981`); a deleted or rewritten folder here is the worst bug on any of these pages.
- [ ] **5 Cross-page** — after close, `/terminal/:id` must redirect to `/terminal/:id/history`, the transcript must render, and the `AiUsagePanel` cost must equal the `{spend}` delta in this page's header.
- [ ] **6 Error/empty/loading** — submit the dialog with a non-absolute path, a missing path, and a path that is a file: each must return `400 validation_error` and show inline, not spawn a process. Delete the selected credential in another tab, then re-render the dialog: the select clears itself rather than 404ing at submit.

**Traps**
- `preflight-stop`, `diff` and `diff/file` return `409 {details:{code:'standalone_session'}}` (`cli-sessions.ts:156-159`) — no UI on this surface may call them.
- Resume skips staging entirely; re-staging would write `.atlas/` into the Owner's repo behind their back (`cli-sessions.ts:791-796`).
- `worktree_path` holds the chosen folder, not a worktree. `worktree_branch !== null` is the real "Atlas owns this directory" predicate — any check that keys off `worktree_path` being set will mis-classify standalone rows.
- `POST /api/cli/sessions/standalone` is `requireMcpToken`-gated because it spawns a process at a caller-supplied absolute path. Same-origin browser requests auto-pass; a non-browser client without the token must be rejected.

---

### C5 · Terminal History — `/terminal/:id/history`

**Component:** `packages/web/src/pages/TerminalHistory.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Back | `/terminal` (`:96`) | — |
| Transcript viewer rows | `RunEventViewer` master-detail; click a row to show that event's JSON (`:177-186`) | — |
| PR link | `finalize_pr_url`, rendered as a link only when it matches `^https://` (`:141`) | — |

**States** — Empty: info Alert "Transcript unavailable — the CLI may have removed its on-disk copy…" when `jsonl_content` is falsy (`:166`) · Loading: spinner for the session row (`:59`), then a second spinner for the transcript (`:157`) · Error: red Alert "Could not load transcript: {message}" (`:161`) · Not found: "Session not found." + back link (`:67`) · Live deep link: returns `null` and `replace`s to `/terminal/:id` (`:45-49,:78`).

**Checks**
- [ ] **1 Round-trip** — run two prompts in a session, stop it, open `/terminal/:id/history`: both turns appear in the event index. Hard-reload — identical content, served from the persisted `cli_sessions.transcript_jsonl`. Then delete the CLI's on-disk state dir (`~/.claude/projects/…`) and reload again: the transcript must still render from the DB column. That is the entire point of the cache.
- [ ] **2 Attribution** — the metadata strip's Branch / Model / Closed-at come from the session row, and "Transcript captured" appears only when `transcriptQuery.data.ingested_at` is set (`:131-138`). Branch showing `—` on a *project* session is the join failure; on a standalone session it is correct.
- [ ] **3 List membership** — every closed/errored session reachable from `/terminal` must have a history page that loads. Stop a session, click its card: it must land here, not on the live view.
- [ ] **4 Transition legality** — deep-link `/terminal/:id/history` for an `active` session: the page must redirect to `/terminal/:id` (`:46`), and the transcript GET must 409 for `active`/`paused` (`cli-sessions.ts:1268`) as the server-side safety net. Reaching a rendered history page for a live session is the failure. `paused` is deliberately excluded from history — a paused session is still alive.
- [ ] **5 Cross-page** — the `AiUsagePanel` token/cost figures here must equal the `{spend}` contribution this session makes to the `/terminal/standalone` header total, and the PR link must equal the URL the Stop toast reported on `/terminal/:id`.
- [ ] **6 Error/empty/loading** — three distinct states must be reachable: (a) session row 404 → "Session not found."; (b) transcript endpoint 500 → the red Alert with the server message; (c) both DB column and on-disk file gone → the blue info Alert. (b) and (c) must not look the same.

**Traps**
- A `finalize_pr_url` that is not `https://` renders a **warning** Alert "PR link rejected (must be https)" and is deliberately not made clickable (`:151-154`) — an anti-`javascript:` guard, not a cosmetic branch.
- Transcripts over 10 MB: ingest skips the write, so the page renders the last persisted content (possibly stale, possibly empty) with no warning.
- ⚠️ page doc stale: `25-terminal-history.md:20,34,40-43` describes a `JsonlTranscriptViewer` component with role chips and a 5 000-event cap. No such file exists. The page renders the shared `RunEventViewer` with `source='claude-pty' | 'copilot'` (`TerminalHistory.tsx:16,177-185`). The doc also omits the `AiUsagePanel` cost card entirely (`:195-201`).

---

### C6 · Agents — `/agents`

**Component:** `packages/web/src/pages/Agents.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Add Agent (header + `PageFab`) | dialog: name, category, CLI, `ModelSelect`, accent color → `handleAddAgent()` (`:242`) | `POST /api/agents` |
| Import zip | `ImportAgentZipModal` → navigates to the imported agent (`:613-621`) | `POST /api/agents/import` |
| Card ⋯ → Pause/Resume, Disable/Enable | toggles `status` between `active`/`inactive` | `PATCH /api/agents/:id` |
| Card ⋯ → Duplicate | `DuplicateAgentModal` | `POST /api/agents/:id/duplicate` |
| Card ⋯ → Delete | `DeleteAgentModal` → confirm | `DELETE /api/agents/:id` |
| Star | `favorites.toggle(id)` — localStorage only, never leaves the browser | — |
| Category chips / Role dropdown / Sort | client-side over `useAgents()` | — |
| Browse the Marketplace (empty state) | `/agents/marketplace` | — |

**States** — Empty: hero + "Browse the Marketplace" CTA · Loading: 6-card skeleton grid · Error: `AgentsErrorBanner` when the runs query fails while agents exist · No matches: filter empty state · Populated: grouped category sections.

**Checks**
- [ ] **1 Round-trip** — Add Agent named `RT-1`, category `content`, CLI `claude`, a registry model, a non-default accent. Hard-reload `/agents`: name, category section, the spec box's CLI/Model/Effort and the accent dot must all match. Pause it, hard-reload: the status label still reads **Paused**. Star it, reload: still starred — but only in *this* browser (`useAgentFavorites` is localStorage; a second browser must show it unstarred, and that is correct, not a bug).
- [ ] **2 Attribution** — the sub-label is `designation · category`, falling back to the SDLC role label from `SDLC_ROLE_LABELS[role_id]` when `designation` is empty, then to category alone (`agentViewModel.ts`). Install a marketplace agent with a `role_id` and no designation: the sub-label must print the role's human label, never the raw slug and never the bare category.
- [ ] **3 List membership** — card count == `GET /api/agents` length == the marketplace's `is_installed` count. Install one agent from `/agents/marketplace`: it must appear here after invalidation **and** after a hard reload. Delete it: gone from here, from the sidenav badge, and `is_installed` flips back in the catalog.
- [ ] **4 Transition legality** — pause an agent and confirm the ⋯ menu then offers Resume and not Pause. Delete an agent that a workflow uses: it must be refused with `409` and the toast must **name the workflows** — `Agent is used by workflow(s): {names}` (`services/agents.ts:427-434`), not a generic failure.
- [ ] **5 Cross-page** — after Add, the sidenav Agents badge and the Dashboard `activeAgents` KPI must both move without a manual refresh (`agents.create` broadcasts `counts_changed` **after** the transaction commits, `services/agents.ts:306-310`). X4: the badge number and this page's card count must agree, or the difference must be labelled.
- [ ] **6 Error/empty/loading** — see the trap below: force a `MODEL_NOT_IN_REGISTRY` and assert a visible toast. Separately, stop the runs query (`GET /api/run?limit=500`) while agents exist and confirm `AgentsErrorBanner` renders instead of an empty grid.

**Traps**
- **X2, live**: `handleAddAgent` is `try { await api.agents.create(...) } finally { setSaving(false) }` with **no catch** (`Agents.tsx:242-262`), invoked as `onClick={() => void handleAddAgent()}` (`:606`). The form seeds `model: 'claude-sonnet-4-6'` as a literal (`:128,:254`) rather than from the registry. Prune that model from Settings → Model Registry, then Add Agent without touching the Model dropdown: `assertModelInRegistry` throws (`services/agents.ts:252`) and the 400 becomes an unhandled rejection — no toast, no error, the dialog just sits there. This is the `/agents` instance of the bug that made marketplace installs fail silently.
- Role filter: picking a specific role excludes every `role_id IS NULL` autonomous agent **by design**. Confirm the user can tell — an autonomous agent vanishing from a filtered grid must not read as data loss.
- The per-card **queue N** caption and the status label are fed by two different counts: `queueDepth` from `useQueueDepthByAgent()` (ready + in-progress *items*) and `queuedCount`/`runningCount` from `getRuntimeStats()` (*runs*). The label is `resolveAgentStatusLabel()` over `queuedCount + queueDepth` — an active agent with Ready items and no run must read **Queued**, not **Idle**.
- ⚠️ page doc stale: `15-agents.md` documents no Import-zip control and no `PageFab`; both exist (`Agents.tsx:613,622`).

---

### C7 · Agent Detail — `/agents/:id`

**Component:** `packages/web/src/pages/AgentDetail.tsx` · tabs `?tab=` ∈ `overview|prompt|test|runs|memory` (`:33-39`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Hero name (inline edit) | Enter/blur saves | `PATCH /api/agents/:id {name}` |
| Run now → **Run now** | no-item run, then navigates to the new run | `POST /api/run {agent_id, issue_type:null, issue_id:null}` |
| Run now → **Preview prompt** | renders the exact compiled markdown; no spawn, no DB write | `POST /api/agents/:id/compile-prompt` |
| Pause/Resume, Color, Glyph | `PATCH /api/agents/:id` | `PATCH /api/agents/:id` |
| Overview → Save changes | `{cli, model, effort}`; `isDirty` over those three | `PATCH /api/agents/:id` |
| Overview → Save role | `{designation, memory_cadence}` | `PATCH /api/agents/:id` |
| Overview → Save checklist | whole-array replace | `PUT /api/agents/:id/checklists` |
| Prompt → Save | `{prompt_md}` — bumps `prompt_version` + inserts a version row in one transaction | `PATCH /api/agents/:id` |
| Prompt → Revert (per non-active row) | appends a new active version with `reverted_from` set | `POST /api/agents/:id/prompt-versions/:version/revert` |
| Prompt → formatting toolbar | **(stub — see coming-soon.md)** `PromptTab.tsx:157-183`, icons not wired | — |
| Test Run → Run test / Stop / Copy log | spawns the real CLI with a one-line ping; streams over `dry_run_*` SSE | `POST /api/agents/:id/dry-run` |
| Test Run → Save as run | **(stub — see coming-soon.md)** toast "Save as run coming soon", `TestRunTab.tsx:438-439` | — |
| Memory → Save / Regenerate | `PUT` flips `source` to manual-edit + bumps `version`; regenerate appends a `memory_regenerations` row | `PUT /api/agents/:id/memory`, `POST …/memory/regenerate` |
| ⋯ → Duplicate / Delete | modal → mutation | `POST …/duplicate`, `DELETE /api/agents/:id` |

**States** — Empty: Runs tab's no-runs hero with Run now; Memory body empty on a fresh agent · Loading: centered spinner · Error: "Agent not found." (`:131-139`) · Populated: breadcrumbs + `AgentHero` + tabs + `AgentSidebar`.

**Checks**
- [ ] **1 Round-trip** — Prompt tab: append a unique marker line, Save, hard-reload. The body comes back with the marker, the header reads `Active prompt · v{n+1}`, and the version history table has one more row. Memory tab: edit the body, Save, reload — body persists, the chip flips to **MANUAL**, and `version {n}` increments. Checklist: add a row, Save, reload — the row and its `required` flag survive (`PUT` replaces the whole array, so an untouched sibling row disappearing is the failure).
- [ ] **2 Attribution** — the version-history `edited_by` column: `services/agents.ts:291,354,419` writes the **literal** `'Owner'` on create, on prompt update and on revert. An agent-driven prompt edit would therefore also be attributed to the Owner. This is exactly the X3 class of defect (a hardcoded literal where an identity field belongs) — assert whether any non-Owner write path exists, and if it does, that it is not recorded as `'Owner'`. Memory tab's source label must likewise read AI-generated vs Manual edit from the row, never a constant.
- [ ] **3 List membership** — Run now → the new run must appear in the Runs tab list (recent 50) after invalidation and after a hard reload, and the same row must be visible in `GET /api/run?agent_id=…`. Prompt Save → the new version must appear in the history table without a reload.
- [ ] **4 Transition legality** — Pause an `active` agent: the hero button flips to Resume and `POST /api/run` on it must then be refused — `Agent is not active`, 400 (`routes/run.ts:53`). Delete an agent a workflow uses: refused `409` naming the workflows (`services/agents.ts:427-434`), and `confirmDelete`'s catch must toast "Could not delete agent" with that message (`AgentDetail.tsx:141-155`), not navigate away.
- [ ] **5 Cross-page** — Run now → the run must appear on `/queue`, on the Dashboard "in motion" rows with this agent's resolved `agent_name` (not "Unassigned"), and on `/agents/:id/runs/:runId`. Change the agent's model here, then reopen `/agents`: the card's spec box must show the new model without a manual refresh.
- [ ] **6 Error/empty/loading** — Test Run with the CLI binary renamed off `PATH`: the panel must print `[test] connection failed · exit=N · Ns` in orange, and the hero's `CliUnavailableAlert` must already be warning before you press it. Memory Regenerate with the API down must toast, not fail silently.

**Traps**
- **X2**: the Model dropdown is backed by `cli_models` (`ModelSelect.modelsForCli`), and `agentsService.update` re-asserts the pair whenever `cli` **or** `model` changes, fetching the missing half from the stored row (`services/agents.ts:317-322`). Switching CLI auto-selects the new CLI's registry default; switching back restores the saved model. Assert the dropdown can never offer a model absent from the registry — a `… (not in registry)` option is shown for the *current* value only (`ModelSelect.tsx:130`) and must not be selectable as a new value.
- **Run now rejects items by design**: `POST /api/run` 400s on any `issue_type` or `issue_id` (`routes/run.ts:42-48`) — "Runs on an item go through a workflow". The dialog therefore has no item picker; a run started here gets a throwaway `mkdtemp` dir, **not** a worktree.
- Test Run **never** writes `agent_runs`, and closing the panel does not abort the server-side CLI — only the client SSE stream stops. A test asserting the process died on navigate-away will fail correctly.
- With `ATLAS_AI_ENABLED !== 'true'` the Memory regenerate body and every run output are simulated and prefixed `[SIMULATED …]` (`services/agent-runner.ts:197`). Intentional, not a stub — but any output-content assertion must account for it.
- ⚠️ page doc stale: `16-agent-detail.md:58` describes "Two version history tables — one per kind" with `?kind=performer` / `?kind=reviewer` and a shared `useRevertAgentPrompt`. The client has no `kind` parameter at all: `getPromptVersions(id)` and `revertPrompt(id, version)` (`api/api.ts:423-429`). The doc contradicts itself two lines earlier at `:57`, which states the reviewer persona was removed.

---

### C8 · Agent Run Detail — `/agents/:id/runs/:runId`

**Component:** `packages/web/src/pages/AgentRunDetail.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Re-run with same inputs | rendered only when `canRerun` (`:247`); posts the run's `{agent_id, issue_type, issue_id}` and navigates to the new run | `POST /api/run` |
| Stop run | queued/in-progress only; optimistically patches the cached row to the returned terminal status (`:504-520`) | `POST /api/run/:id/stop` |
| Open workflow run | shown when `run.workflow_run_id` is set (`:480`) | — |
| Copy log / Download log | over `output_text`; toast "Nothing to copy yet" / "Nothing to download yet" when null (`:294,:304`) | — |
| Event index row click | selects that event for the right pane | — |

**States** — Loading: centered spinner · Not found: "Run not found." · queued/in_progress: `live · agent_output` header + `LiveDot`, viewer fed by the SSE tail, `Waiting for output…` when empty · completed/error: viewer over persisted `output_text`, `— no output captured —` when empty, plus the Summary / Error-tail panel only when a `type:"result"` event landed.

**Checks**
- [ ] **1 Round-trip** — start a run from `/agents/:id`, land here, let it finish, then hard-reload. The event list must be identical to the live tail's final state and must equal `GET /api/run/:runId`'s `output_text` parsed line-by-line. Download log and diff the `.log` against that `output_text` — byte-for-byte NDJSON, no synthesized lines.
- [ ] **2 Attribution** — the breadcrumb and hero agent name come from `useAgent(id)`, not from a string on the run row; the issue link card resolves `itemPath(run.issue_type, run.issue_id)` to a real `/tasks/:id` or `/sub-tasks/:id` (`:561`). A card pointing at `/tasks/undefined` is the failure.
- [ ] **3 List membership** — Re-run creates a **new** `agent_runs` row and navigates to it; the original run's id, status and `output_text` must be unchanged afterwards. Both rows must then be listed in the agent's Runs tab.
- [ ] **4 Transition legality** — Stop run must be absent (not greyed) once the row is `completed`/`error`/`cancelled`. Stopping a row the runner already finalised returns 409 and must land as a benign toast while the status pill still converges to the server's terminal value (`:508-525`). Re-run must be absent for a workflow-step run and for an item-attached run (`canRerun`, `:247`).
- [ ] **5 Cross-page** — while the run is in flight, `/queue` must show it running and `/agents` must show the agent as **Running**; on completion, the Runs tab row, the Dashboard AI-cost figure and this page's Summary panel must all agree without a manual refresh (`useSSE` invalidates `['agent-run', runId]` on `agent_status` and on completion, `:37`).
- [ ] **6 Error/empty/loading** — with `ATLAS_AI_ENABLED=false`, a completed run must carry the **Simulated** chip on the hero (sniffed from `output_text.startsWith('[SIMULATED')` in `utils/isSimulatedRun.ts`) and the topbar pill must be present. A queued run with no lines must show `Waiting for output…`, and Copy log on it must toast "Nothing to copy yet" rather than copying an empty string.

**Traps**
- The live Timeline shows only lines received **since mount**. Reload mid-run and the earlier output is missing from the tail until the run ends, when the gap-filled `output_text` swaps in. Judging "output was lost" from a mid-run reload is a false positive.
- No auto-follow: the right pane keeps whatever event you selected while the index grows. `selectedIdx` is clamped to `events.length - 1` and reset to 0 whenever `:runId` changes (`:82`).
- ⚠️ page doc stale: `16a-agent-run-detail.md:25,58` presents "Re-run with same inputs" as always available and pitched at re-running *on the same target*. Code gates it behind `canRerun = !run.workflow_run_id && !run.issue_id` (`:247`), because `POST /api/run` 400s on any `issue_id` (`routes/run.ts:42`). The doc also omits **Stop run** and **Open workflow run** (`:475-481`), both shipped.

---

### C9 · Marketplace — `/agents/marketplace`

**Component:** `packages/web/src/pages/Marketplace.tsx` · tabs `?tab=` ∈ `agents|workflows` (`:24,:39`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Search / Category chips | part of the query key `['marketplace','list',query,category]` → server-side refetch, not in-memory filter (`:48-59`) | `GET /api/marketplace/agents?q&category&limit=100` |
| Card checkbox | rendered only for `!is_installed`; `installableIds` is what Select-all covers (`:72-75`) | — |
| Card body click | `/agents/marketplace/:id` | — |
| Install (single) | toast `Installed <name>` → `/agents/:installedId` | `POST /api/marketplace/agents/:id/install` |
| Select all → Add selected | `runBulkInstall` fans out one POST per id, then invalidates `['agents']` + `['marketplace']` (`:87-127`) | same, N times |
| Workflows tab cards | starter → `/agents/marketplace/workflows/:templateId`; published → `…/workflows/published/:publishedId` | `GET /api/workflows/templates`, `GET /api/marketplace/workflows` |

**States** — Empty: "No catalog agents" — should be unreachable, `syncMarketplaceCatalog` runs per boot in one transaction (all 16 rows or none) · Loading: skeleton grid · Error: surfaces through the card grid, **no dedicated error panel** · Populated: cards grouped by `category`, empty categories dropped.

**Checks**
- [ ] **1 Round-trip** — install one agent, hard-reload the catalog: that card's checkbox must be gone and its state must read installed (`is_installed` from the server, not client state). Type a query, reload — the query is component state only, so it resets; assert the list matches the cleared query, not a stale filtered set.
- [ ] **2 Attribution** — each card's name/category/cli/model come from the catalog row; the Workflows tab's agent chips resolve names + accents through `useMarketplaceCatalog` (starter) or `useKnownAgentsById` (published). A chip showing a raw agent slug on a *starter* card means the catalog lookup missed; on a published card, "not installed" is the correct label, not a miss.
- [ ] **3 List membership** — grid count == `marketplace_agents` row count (16). Select all → Add selected with every entry installable → all install and the page navigates to `/agents` (`:117`), where the count must now equal the catalog's `is_installed` count.
- [ ] **4 Transition legality** — Select all must never tick an already-installed entry (`installableIds` filters on `!a.is_installed`, `:73`). An installed card must expose no checkbox at all.
- [ ] **5 Cross-page** — after a bulk install the sidenav Agents badge, the Dashboard KPI and `/agents` must all reflect the new agents without a manual reload; both `['agents']` and `['marketplace']` are invalidated before any navigation (`:94-95`).
- [ ] **6 Error/empty/loading** — **X2, the canonical case**: prune a model that a catalog entry names from Settings → Model Registry, then install that entry. The server must return `400 MODEL_NOT_IN_REGISTRY` (`services/marketplace.ts:318,538` call `assertModelInRegistry` before the insert), **never** an opaque 500 from the `agents(cli,model)` FK. In a bulk install the toast must read `Added N agents · couldn't add <ids>` with the per-id reason in `detail` (`:98,:103,:106`), the failures must stay selected (`:112`), and the page must stay put.

**Traps**
- **Never collapse the failure detail to a count.** `bulkInstall.ts` carries `{id, status, reason}` per rejection; a bare "2 couldn't be added" is precisely what hid the pruned-model FK violation. `failDetail` is `id: reason` joined by newline (`:98`).
- A **clean** sweep navigates to `/agents`; a **partial** one deliberately does not, or the Owner never sees which entries failed (`:109-118`).
- The catalog query is `enabled: tab === 'agents'` (`:58`) — the Workflows tab reads the same data through `useMarketplaceCatalog` instead, so a check that asserts a catalog request fires on the Workflows tab will fail by design.
- A catalog entry's `role_id` must exist in `roles`; five `SdlcRole` slugs in `@atlas/shared` are not seeded, so an entry naming one fails `assertRoleInCatalog` (`services/agents.ts:47-56`) with the same "reason must be named" requirement.

---

### C10 · Marketplace Agent Detail — `/agents/marketplace/:id`

**Component:** `packages/web/src/pages/MarketplaceAgentDetail.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Back / breadcrumb | `/agents/marketplace` (`:137-143`) | — |
| Export | plain `href` to `api.marketplace.exportZipUrl(id)` — a real browser download, not an SPA action | `GET /api/marketplace/agents/:id/export` |
| Add to my agents (`!isInstalled`) | `AddFromMarketplaceModal` → `handleInstall(slug)` (`:66-97`) | `POST /api/marketplace/agents/:id/install {agent_id}` |
| Review upgrade (installed + `upgrade_available`) | `/agents/:installedAgentId`, where `AcceptUpgradeModal` does the field-level diff | — |
| Open installed agent (installed, no upgrade) | `/agents/:installedAgentId` | — |

**States** — Loading: two skeleton blocks (`:110-117`) · Not found: "Marketplace agent not found." + Back to marketplace (`:118-128`) · Populated: header + a single primary action + `prompt_md` verbatim + Runtime / Custom settings + Quality checklist (renders "None." when empty).

**Checks**
- [ ] **1 Round-trip** — install from here, then open `/agents/:installedAgentId`: `prompt_md`, cli, model, category, designation, `role_id`, `memory_cadence` and every quality-checklist row must match what this page displayed. Edit the installed agent's prompt, come back here: the catalog body must be **unchanged** — local edits never travel back to the marketplace.
- [ ] **2 Attribution** — the header's cli + model and the Runtime block read from the catalog entry, not from the installed copy. `useMarketplaceCatalog()` supplies only `is_installed` / `installed_agent_id` / `upgrade_available` (`:55-57`), which the full payload does not carry — an installed entry still showing "Add to my agents" means that summary lookup failed.
- [ ] **3 List membership** — after install, the installed agent must be on `/agents`, and this page's action must have switched to **Open installed agent**. Both `['agents']` and `['marketplace']` are invalidated before the navigate (`:71-72`), so neither surface may need a manual reload.
- [ ] **4 Transition legality** — exactly **one** primary action renders, chosen by install state: Add / Review upgrade / Open installed. Two of them visible at once is the failure. `closeAdd()` is a no-op while `installing` (`:99-103`) — the dialog must be undismissable mid-POST.
- [ ] **5 Cross-page** — with `upgrade_available` true, Review upgrade must land on `/agents/:id` with the `MarketplaceUpgradeBanner` shown (`AgentDetail.tsx:30`); the version the diff modal shows must be the catalog version this page displays.
- [ ] **6 Error/empty/loading** — **X2 + class 6**: install an entry whose model was pruned from the registry. The catch splits on `details.conflicting_id && details.suggested_id`; anything else must land as the toast `Couldn't install this agent` with the server message in `detail` (`:81-93`). It must **not** re-throw inside the async click handler — that was an unhandled rejection with no UI at all. Separately, install an entry whose slug already exists locally: the 409 must open the rename-retry face pre-filled with `details.suggested_id`, and the existing local agent must be untouched afterwards.

**Traps**
- The suggested slug appends a random 4-char suffix, so a retry effectively cannot collide again — a test asserting a second 409 on retry will hang.
- Export is a plain `href`, so it bypasses the SPA's fetch wrapper entirely: a 404 from the export endpoint shows as a browser error page, not a toast. A starter export 404s ("Agent … does not exist") when the template names an agent missing from `marketplace_agents`.
- `AddFromMarketplaceModal` defaults its slug field to the catalog id; installing with an edited slug means the installed agent's id differs from `marketplace_source_id` — verify the upgrade/detach affordances still resolve afterwards.

---

### C11 · Marketplace Workflow Detail — `/agents/marketplace/workflows/:templateId`

**Component:** `packages/web/src/pages/MarketplaceWorkflowDetail.tsx` (also serves `…/workflows/published/:publishedId`, `:164-168`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Marketplace (back) | `/agents/marketplace?tab=workflows` | — |
| Export | plain `href`; starter vs published resolve to different endpoints (`:113`) | `GET /api/workflows/templates/:id/export` · `GET /api/marketplace/workflows/:id/export` |
| Use in a project (starter) | `NewWorkflowDialog` with the template pre-selected → pick project → the builder | `POST /api/workflows/from-template` |
| Use in a project (published) | `UsePublishedWorkflowDialog` → project select → toast `Imported {name}` with `Installed … · Reused … · Sub-workflows …` | `POST /api/marketplace/workflows/:id/use {project_id}` |
| Unpublish (published only) | `ConfirmActionModal` → toast `Unpublished {name}` → back to the Workflows tab (`:190-197,:268-276`) | `DELETE /api/marketplace/workflows/:id` |
| Sub-workflow link (starter) | that `template:<id>`'s own page | — |

**States** — Loading: two skeleton blocks · Not found: "Marketplace workflow not found." + Back to marketplace (`:212`) — covers unknown template, unknown published id, 404 and request failure alike · Populated: header + optional description + lazy `WorkflowCanvas` preview + side panel (Agents, Sub-workflows).

**Checks**
- [ ] **1 Round-trip** — Use in a project on a starter template: the created workflow's graph in the builder must have the same node count and the same step order as the canvas preview here. For a published entry, the toast's `Installed N · Reused M` must equal the delta in `/agents` card count (installed) plus the agents that were already there (reused).
- [ ] **2 Attribution** — the Agents list must resolve every agent to a name + accent: catalog names for a starter, the Owner's installed agents first for a published one (`useCatalogAgentsById` / `useKnownAgentsById`). A canvas node rendering a raw agent id + "not installed" is correct **only** when that agent genuinely is not installed — install it and the id must become a name on reload.
- [ ] **3 List membership** — after Unpublish, the entry must be gone from `/agents/marketplace?tab=workflows` → Published by you, after invalidation and after a hard reload, and this URL must then render the not-found state. Workflows already created from it must still exist and still run.
- [ ] **4 Transition legality** — **Unpublish renders only for a published entry** (`publishedId &&`, `:268`); it must be absent, not disabled, on a starter template. The two `Use in a project` paths must not be interchangeable — a starter must never hit `POST /api/marketplace/workflows/:id/use`.
- [ ] **5 Cross-page** — Use in a project → the new workflow must appear on `/workflows`, on the project's Workflows tab, and any agent it installs must appear on `/agents` without a manual reload. Publishing the same workflow again replaces the entry and keeps the **same** URL — reload this page after a re-publish and it must show the new content, not 404.
- [ ] **6 Error/empty/loading** — a published entry whose `source_workflow_id` went null (the source workflow was deleted) must still render and still export. `UsePublishedWorkflowDialog` API errors must show inline as an `Alert`, and a failed unpublish must toast "Could not unpublish workflow" (`:190-197`) rather than close the dialog silently.

**Traps**
- Templates are read from disk on every request; there is no per-template endpoint, so the page finds its template inside the full list (`:82-84`). A slow or failed `GET /api/workflows/templates` therefore renders **not found**, not a loading error — these are indistinguishable to the user (`:185,:212`).
- The three "installs" labels are branch-selected: `Installed` / `Installs with this workflow` (published, the bundle carries the agent) / `Installs from the marketplace` (starter) (`:318-322`). Getting these swapped misstates whether an agent arrives from the bundle or from the catalog.
- The canvas is behind a lazy boundary (`pages/marketplace/WorkflowGraphPreview.tsx`) to keep `@xyflow/react` out of the initial chunk — a static import here is a bundle-budget regression, not just a style issue.

---

### C12 · MCP Tools — `/agents/mcp-tools`

**Component:** `packages/web/src/pages/McpTools.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Breadcrumb **Agents** | `/agents` (`:34`) | — |
| — | nothing else is interactive; every element is a label | `GET /api/tool-catalog` |

**States** — Empty: dashed panel "No MCP tools registered." when `groups.length === 0` · Loading: three skeleton group shells (`:78-88`) · Error: bordered panel "Failed to load tool catalog. Try refreshing the page." (`:64-76`) · Populated: one section per group, `prettyGroupLabel` heading + count chip + tool rows.

**Checks**
- [ ] **1 Round-trip** — n/a — read-only route, no write path to round-trip.
- [ ] **2 Attribution** — each group heading resolves through `GROUP_LABELS[key]`, falling back to `key.replace(/_/g,' ').toLowerCase()` (`:19-21`). A heading rendering a raw `SCREAMING_SNAKE` key means a new group reached `tool_catalog` without a label entry — cosmetic, but it is the literal-where-data-belongs pattern. Tool name + description must come from the `tool_catalog` row, never from a component-side constant.
- [ ] **3 List membership** — the rendered tool count must equal `GET /api/tool-catalog`'s total, and that must equal the non-`excludeFromCatalog` entries in `ALL_TOOL_REGISTRATIONS` (`packages/mcp/src/tools/registrations.ts`). Add a tool to a `<GROUP>_TOOLS` array, restart the API so `syncToolCatalog` re-projects (`main.ts:288`), hard-reload: the new tool appears and the subtitle count increments by one.
- [ ] **4 Transition legality** — n/a — no statuses and no mutations on this route.
- [ ] **5 Cross-page** — n/a — no other surface consumes this catalogue any more; the Agent Detail "Allowed Tools" picker that did was removed by B14 (`16-agent-detail.md:6`).
- [ ] **6 Error/empty/loading** — all three render distinctly: stop the API → the bordered error panel; return `{groups: []}` → the dashed "No MCP tools registered." panel; throttle the request → three skeleton shells. Note the subtitle is suppressed unless `!isLoading && !isError && totalTools > 0` (`:48`), so the error state must not also print `0 tools · 0 categories`.

**Traps**
- The table is derived, never hand-maintained — `syncToolCatalog` overwrites it on every boot. Editing `tool_catalog` rows directly to set up a test fixture is wasted work; the next restart reverts it.
- `{totalTools} tools · {groups.length} categories` has no singular form — cosmetic only, do not file it as a data bug.
- ⚠️ page doc stale: `29-mcp-tools.md:6-7` states this page exists so it "can't disagree" with the Agent Detail **Allowed tools** picker. That picker no longer exists — removed by B14 (`d3cc9bf`), per `16-agent-detail.md:6`; `29-mcp-tools.md:40` still links to it as a live consumer. The catalogue now has exactly one reader: this page.
---

## Wave D — settings, credentials, guard-rails, notifications, reminders

### D1 · Settings → Profile — `/settings?tab=profile`

**Component:** `packages/web/src/pages/settings/ProfileTab.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Display Name | `onBlur` / Enter commits, only if trimmed and changed (`ProfileTab.tsx:62-69`) | `PATCH /api/settings/profile` |
| Accent Color | swatch click commits immediately, optimistic (`:71-76`) | `PATCH /api/settings/profile` |
| Appearance (light/dark) | `ThemeModeToggle` — browser-local only, no request (`:134-142`) | none |
| Workspace Folder | `FolderPicker` onChange commits (`:78-85`) | `PATCH /api/settings/profile` |
| Manage credentials → | `navigate('/settings/credentials')` (`:222`) | — |
| Reset Workspace | opens `ResetWorkspaceModal` (`:240`) | `POST /api/settings/reset` |

**States** — Empty: credentials box reads "No credentials yet. Add one in Manage credentials." (`:216-217`) · Loading: page-level spinner in `Settings.tsx:56-62`, this tab has none of its own · Error: no error UI — a failed `PATCH` shows no toast at all (success-only callbacks, `:66`/`:74`/`:82`) · Populated: two-column grid, Owner Profile left, Credentials + Reset right.

**Checks**
- [ ] **1 Round-trip** — set Display Name to `Roundtrip-D1`, blur, hard-reload `/settings`: field and the topbar owner line (`Settings.tsx:83`) both read `Roundtrip-D1`. Repeat for accent `#31AB46` and for Workspace Folder; all three come back from `GET /api/settings`.
- [ ] **2 Attribution** — credentials summary line is built from the live list, not a literal: with 4 credentials it reads `4 tokens stored · GitHub (<label1>) · GitHub (<label2>) · GitHub (<label3>) · +1 more` (`:53-60`). Singular/plural flips at 1 (`token` vs `tokens`).
- [ ] **3 List membership** — add a credential on `/settings/credentials`, come back: the count in the box increments without a reload (shared `['credentials']` query).
- [ ] **4 Transition legality** — n/a — profile has no status machine.
- [ ] **5 Cross-page** — rename the Owner, then check `/sub-tasks/:id` comment compose and any assignee chip render the new name, not the cached old one.
- [ ] **6 Error/empty/loading** — with 0 projects the yellow migration Alert is absent; with ≥1 it names the exact count and pluralises (`:156-182`). Kill the API and blur a changed Display Name: confirm nothing visible happens (no toast on failure) — that is the current behaviour, assert it rather than assume a toast.

**Traps**
- The Reset copy is wrong in two places. `POST /api/settings/reset` (`packages/api/src/routes/settings.ts:211-248`) deletes exactly: `comments`, `notifications`, `agent_runs`, `jira_issues`, `jira_config`, `items`, `projects`, `credentials`, `agent_checklists`, `agents`, then resets the `settings` row. It does **not** touch `environment_secrets`, `reminders`, `guardrail_rules`, `workflows`, `cli_models`, `tool_catalog`, or anything on disk. The subtitle at `ProfileTab.tsx:235` says "Wipes all … from the local database" and the modal at `ResetWorkspaceModal.tsx:129-132` names "saved schedule" — no schedules table is in the delete list (schedules only vanish via the `projects` cascade). After a reset, Shared Secrets and Reminders are still there. Verify that, don't assume the copy.
- `ThemeModeToggle` is per-browser; it does not round-trip through the API. Testing it on a second browser is not a bug.
- ⚠️ page doc stale: `19-settings.md:16-20` lists only Display Name / Accent / Workspace for Tab 1 — the Appearance row (`ProfileTab.tsx:134-142`) is undocumented.

---

### D2 · Settings → Environment — `/settings?tab=environment`

**Component:** `packages/web/src/pages/settings/EnvironmentTab.tsx` (rows: `EnvVarRow.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| `ATLAS_LOG_LEVEL` select | 6 levels + "(default — info)" empty option (`EnvVarRow.tsx:90-112`) | buffered in draft |
| `ATLAS_FEEDBACK_URL` text | free text + Copy adornment (`EnvVarRow.tsx:136-142`) | buffered in draft |
| Save Changes | sends only the rows whose draft differs from server (`EnvironmentTab.tsx:51-56`) | `PATCH /api/settings/env` |

**States** — Empty: n/a, the catalogue is a fixed 2-entry constant · Loading: centred spinner (`:43-49`) · Error: `toast "Could not save .env"` with the server message (`:63-68`) · Populated: subtitle counts vars/secrets/restart-required (`:36-41`), Save disabled until dirty (`:129`), status text flips to "unsaved changes" (`:144`).

**Checks**
- [ ] **1 Round-trip** — set `ATLAS_LOG_LEVEL=debug`, Save, hard-reload: select still reads `debug`. Then check the API's `.env` on disk carries the line — the toast claims "Wrote N variable(s) to .env" (`:61`) and the route really does write the file (`routes/settings.ts:85`).
- [ ] **2 Attribution** — the subtitle numbers must be derived, not typed: today it must read `2 variables · 0 holds a secret · 0 requires a server restart` because `KNOWN_ENV_VARS` (`packages/api/src/services/env-file.ts:16-40`) has exactly two entries, both `secret:false`, both `restart_required:false`.
- [ ] **3 List membership** — a key absent from `KNOWN_ENV_VARS` never appears here even if it is in `.env`; add `FOO=bar` to `.env`, reload: the tab still shows 2 rows and the `FOO` line survives the next Save untouched (`env-file.ts:8-10`).
- [ ] **4 Transition legality** — n/a — no statuses.
- [ ] **5 Cross-page** — set `ATLAS_FEEDBACK_URL=mailto:you@example.com`, Save, without restarting: the sidenav **Report a bug** link (`components/ReportBugLink.tsx`) and Help & About's button both flip to the mailto — `PATCH` mutates `process.env` in place (`routes/settings.ts:86`).
- [ ] **6 Error/empty/loading** — `PATCH` a denylisted key (`ATLAS_MCP_TOKEN`, `PATH`, `DATABASE_URL`, … `routes/settings.ts:21-36`) via curl and confirm `400` naming the key. There is no UI path to that key, so the check is API-side.

**Traps**
- ⚠️ page doc stale: `19-settings.md:31` and `:102`/`:107` promise a **Restart Server** button, a confirm dialog and a `useRestartServer` hook. None exist. `EnvironmentTab.tsx:149-181` renders a static Alert telling the Owner to Ctrl+C `pnpm dev`; the only reference to `POST /api/server/restart` in the whole web package is the unused client method `api/api.ts:342`. Do **not** file a missing-button bug — file a doc fix.
- `EnvVarRow.tsx:117` toggles the input `type` over a value the API *does* return — but that is fine here and only here, because `/api/settings/env` is a `.env` mirror, not the secrets store, and no catalogued var is `secret:true`. If anyone ever marks one `secret:true`, this becomes the 2026-09-12 eye-icon bug again: the value would be in the list response. Assert `secret:false` on both rows.
- The dirty check compares `draft[key] ?? ''` against `v.value` (`:33`) — clearing a var to empty string counts as dirty and Save writes an empty value, it does not delete the line.

---

### D3 · Settings → Shared Secrets — `/settings?tab=secrets`

**Component:** `packages/web/src/pages/settings/SharedSecretsTab.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Key field | UPPER_SNAKE validated client-side, `KEY_RE` (`:34`, `:131-144`) | — |
| Value field | typed value = replace; blank on an existing row = keep (`:182-184`) | — |
| Reveal (eye) per row | fetches plaintext on demand into transient `revealedValue` (`:107-121`) | `GET /api/environment-secrets/:key/value` |
| Add secret | appends a row with `originalKey:null`, `revealed:true` (`:146-159`) | — |
| Delete row | client-side removal, persisted only by Save (`:161-163`) | — |
| Save | preserves untouched rows by re-revealing them, then `PUT`s the whole set (`:169-238`) | `PUT /api/environment-secrets` |

**States** — Empty: header reads `0 secrets`, no rows · Loading: spinner (`:240-246`) · Error: `toast "Could not reveal secret"` (`:116-119`) / `"Could not save shared secrets"` — with a distinct detail for a failure *while composing the payload* (`:203-208`) vs the `PUT` itself (`:233-236`) · Populated: `{N} secrets` + Add + Save, Save disabled unless `dirty && !invalid` (`:319`).

**Checks**
- [ ] **1 Round-trip (X1 — the spine)** — add `SHARED_RT_KEY` = `shared-rt-value-1`, Save, hard-reload. In DevTools Network, `GET /api/environment-secrets` must return `{key, updated_at, has_value:true}` with **no `value`** (the row hydrates with `value:''`, `SharedSecretsTab.tsx:76-90`). Then click Reveal: a separate `GET /environment-secrets/SHARED_RT_KEY/value` fires and the field shows `shared-rt-value-1`. If the value appears without that second request, X1 is broken.
- [ ] **2 Attribution** — n/a — no FK-resolved names on this tab.
- [ ] **3 List membership** — with two secrets stored, edit only the first, Save, reload, Reveal the **second**: it must still return its original plaintext. The preserve path re-reveals untouched rows and re-sends them (`:182-201`); if that silently fails the untouched row is blanked. This is the "Save with an untouched row preserves it" case.
- [ ] **4 Transition legality** — n/a — no statuses.
- [ ] **5 Cross-page** — set `SHARED_RT_KEY`, then on a project's Setup tab use `${variable.SHARED_RT_KEY}` in a setup script and confirm the project-scoped value wins on a key collision (project overrides global, `:26-31`).
- [ ] **6 Error/empty/loading** — type a lowercase key: Save disables and the error names it — `"foo" must be UPPER_SNAKE_CASE` (`:136-137`). Duplicate a key: `"X" is duplicated` (`:138-139`). A new row with an empty value is *not* dirty (`:100-102`) — adding an empty row leaves Save disabled.

**Traps**
- Rename-in-place: change an existing row's key without typing a value, then Save. The preserve lookup keys on `originalKey`, not the current key (`:191-199`) — otherwise the reveal 404s and the rename silently drops the value. Assert the renamed key holds the old plaintext after reload.
- `PUT` is replace-all — a row deleted in the UI is deleted server-side only once Save runs. Deleting a row and navigating away is a no-op.
- ⚠️ page doc stale: `19-settings.md:10` says 7 tabs but the doc body has no "Shared Secrets" section — it numbers Environment as Tab 2 and jumps to Model Registry as Tab 3. Shared Secrets is tab index 3 in `Settings.tsx:124-129`.

---

### D4 · Settings → Model Registry — `/settings?tab=models`

**Component:** `packages/web/src/pages/settings/ModelRegistryTab.tsx` (modal: `ModelEditModal.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Add model (per CLI card) | opens `ModelEditModal` in add mode (`:94-97`, `:240`) | `POST /api/cli-models` |
| Row click / edit | opens the modal with `editing` set — **note only**, `model_name` is not editable (`ModelEditModal.tsx:53-58`) | `PATCH /api/cli-models/:id` |
| Remove (`aria-label="Remove <model>"`) | opens `ConfirmRemoveModelDialog`; only Confirm mutates (`:223-227`, `:104-123`) | `DELETE /api/cli-models/:id` |

**States** — Empty: a CLI card with no models renders its Add row only · Loading: spinner (`:54-60`) · Error: `toast "Couldn't remove the model"` carrying the server message (`:116-119`) · Populated: three `CliCard`s from `AGENT_CLIS` — claude / copilot / ollama (`:23-43`, `:79-81`).

**Checks**
- [ ] **1 Round-trip** — add `claude` / `test-model-d4` with note `d4 probe`, hard-reload: the row and the note both return. Edit the note to `d4 probe 2`, reload: note updated, `model_name` unchanged.
- [ ] **2 Attribution** — the CLI chip/title on each card comes from `CLI_META[cli]` keyed off `AGENT_CLIS`, not a per-row literal (`:23-43`); a model with `cli:'ollama'` must land under the Ollama card, never Claude's.
- [ ] **3 List membership** — after Add, the new model appears in the **Add Agent** dialog's model dropdown and on `/agents/:id` → Model, without a reload (`useCreateCliModel` invalidates `['cli-models']`, `hooks/useCliModels.ts:17-19`).
- [ ] **4 Transition legality** — n/a — models have no status.
- [ ] **5 Cross-page (X2)** — remove a model that an installed agent still names: expect `409 MODEL_IN_USE` surfaced in the toast, dialog closed, model still listed after reload. Repeat for a model only a `marketplace_agents` catalog row references — that case has no FK, so the 409 must come from the route guard, not Postgres. Then install that marketplace agent and confirm it still installs.
- [ ] **6 Error/empty/loading** — Cancel and the X close the confirm dialog with no request; while the delete is pending both are disabled (`:321`, `:334`).

**Traps**
- `useUpdateCliModel` only accepts `{note, sort_order}` (`hooks/useCliModels.ts:26-33`) — there is no rename. "Rename" = remove + add, which is exactly the path the 409 guard blocks while an agent uses it. Assert the dialog copy says what really happens rather than "dropdown-only".
- ⚠️ page doc stale: `19-settings.md:34` describes an inline "Add row … Enter key in either input triggers Add". The tab now routes add *and* edit through `ModelEditModal` (`ModelRegistryTab.tsx:19`, `:94-102`); there is no inline add row.

---

### D5 · Settings → Notifications — `/settings?tab=notifications`

**Component:** `packages/web/src/pages/settings/NotificationsTab.tsx` (+ `WebPushRow.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Provider (telegram / teams) | commits on change; server clears the test pill + endpoint label (`:131-137`) | `PATCH /api/settings/external-notification` |
| Bot Token (telegram) | `onBlur`; sent only when non-empty (`:198-212`) | same |
| Chat ID | `onBlur`; sent only when changed, `''` → `null` (`:206-208`) | same |
| Webhook URL (teams) | `onBlur` (`:140-151`) | same |
| Reveal token / webhook (eye) | one-shot plaintext, auto-cleared after 30 s (`:76-105`) | `POST /api/settings/external-notification/reveal-token` · `…/reveal-webhook-url` |
| Send Test Message | bypasses quiet hours + toggles by design (`:215-230`) | `POST /api/settings/external-notification/test` |
| Per-event switches | one per `EXTERNAL_NOTIFICATION_EVENT_KEYS` (`:15`, `:182-185`) | `PATCH /api/settings/notifications` |
| Quiet hours enable / From / To | HH:MM regex-validated before commit (`:280-291`) | same |
| Terminal idle minutes | 1–60, invalid reverts; stored as seconds (`:264-273`) | same |
| Web push enable/disable | per-browser subscription (`WebPushRow.tsx:26-74`) | push subscribe routes |

**States** — Empty: connection pill `unknown` (grey) when `external_notification_last_test_ok` is null (`:111-114`) · Loading: inherits the page spinner · Error: `toast "Could not reveal token"` / `"Test failed"` + server detail (`:91-95`, `:226`) · Populated: provider fields for the selected provider only.

**Checks**
- [ ] **1 Round-trip (X1)** — save a bot token `d5-token-probe`, hard-reload. `GET /api/settings` must return `external_notification_token: null` **and** `external_notification_token_set: true` (`:59-69`); the field must render the stored-value placeholder — four bullets, then `Stored — click <magnifier> to reveal, or type to replace` verbatim from `:352-355` — not a masked real value. Click the eye: a `POST …/reveal-token` fires and the field shows `d5-token-probe`. Wait 30 s without touching it — the plaintext must disappear on its own (`:76-79`). Repeat the whole thing for Teams → Webhook URL (`:97-105`, `:438-441`).
- [ ] **2 Attribution** — n/a — no FK-resolved names on this tab.
- [ ] **3 List membership** — flip one per-event switch off, reload: only that key is off; the others keep their default-ON state (`external_notification_event_toggles` is a map, not a list).
- [ ] **4 Transition legality** — n/a.
- [ ] **5 Cross-page** — Send Test Message with a good token: the pill goes green **and survives a hard reload** (persisted as `external_notification_last_test_ok`, `:109-114`), and the delivery shows on `/notifications` → Notification Log as a **Sent** row. Then change the Chat ID and reload: the pill is back to Untested (server-side reset).
- [ ] **6 Error/empty/loading** — with nothing stored and nothing typed, **Send Test Message** is disabled; it enables on either a typed value *or* the `_set` boolean (`:161-164`) — confirm it is enabled after a reload with a stored token and an empty box. Enter `25:99` in Quiet hours From and blur: no request fires (`:281-283`).

**Traps**
- Saving a **blank** token is not a clear — `:205` only sends the token when non-empty, by design (`:196-197`). There is no delete-token affordance; assert that, don't file it as "clear doesn't work".
- ⚠️ coming-soon.md stale: the row "External notification Chat-ID detect — `NotificationsTab.tsx:209-214`" no longer matches anything. There is no **Detect** button in the file (`grep -i detect` hits only timezone detection at `:233-244`), and `:209-213` is now the channel-save patch builder. Nothing to mark `(stub)` on this tab.
- ⚠️ page doc stale: `19-settings.md:38-72` documents no **Web Push** section (`NotificationsTab.tsx:561`) and no **Terminal Idle Notifications** section (`:696-707`); both ship.
- On first visit with no `quiet_hours_timezone`, the tab auto-`PATCH`es the detected zone (`:241-243`) — expect one write you didn't trigger. That is intentional.

---

### D6 · Settings → Jira — `/settings?tab=jira`

**Component:** `packages/web/src/pages/settings/JiraTab.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Site URL / Email | `onBlur`, only when changed; `''` → `null` (`:72-75`) | `PUT /api/integrations/jira` |
| API token | `onBlur`; sent **together with** site + email, then the box is cleared (`:77-90`) | same |
| Test connection | disabled until `api_token_set` (`:191-192`) | `POST /api/integrations/jira/test` |
| Jira sync enabled | switch, commits on change (`:204-211`) | `PUT /api/integrations/jira` |
| Poll every N minutes | `<5` or non-integer reverts to the stored value, no request (`:92-99`) | same |
| Extra fields | comma-split, trimmed, blanks dropped (`:101-107`) | same |
| Sync now | disabled until `api_token_set` (`:276-277`) | `POST /api/integrations/jira/sync` |
| Add source / Remove source N | rewrites the whole `sources[]` array (`:109-123`, `:308-313`) | `PUT /api/integrations/jira` |

**States** — Empty: `sources` empty → only the add row; footer "Not synced yet" (`:270`) · Loading: buttons show "Testing…" / "Syncing…" · Error: `toast "Could not save"` / `"Jira connection failed"` / `"Jira sync failed"` with the server message (`:68`, `:129`, `:139`) · Populated: one row per source + a footer "Last sync <time> · <message>", danger-coloured when `last_sync_ok === false` (`:256-268`).

**Checks**
- [ ] **1 Round-trip (X1)** — save site + email + token, hard-reload. `GET /api/integrations/jira` must return `api_token_set: true` and **no** `api_token`; the field must be empty with placeholder `Stored. Type to replace.` (`:177-179`). There is no reveal endpoint for this one by design — assert the plaintext is unreachable from the UI. Site, email, poll interval and extra fields all come back verbatim.
- [ ] **2 Attribution** — a source row's label is `<project> / <repo>` resolved through `GET /api/repos` + `GET /api/projects` (`:58-63`), and the workflow shows its **name** (`:56-57`). A row whose repo was deleted falls back to the raw `repo_id` — confirm you see the id, not a blank or a crash.
- [ ] **3 List membership** — add a source (repo + JQL + workflow), reload: it is in `sources[]` in order. Remove source 1 of 3 and reload: exactly the other two remain, in order — removal rewrites the array by index (`:311`), so an off-by-one shows up here.
- [ ] **4 Transition legality** — n/a on this tab; the item-side rule (a Task reaching Done moves its Jira issue to Done, `:201`) belongs to the sync path.
- [ ] **5 Cross-page** — with `atlas-bridge-test`-scoped JQL, hit **Sync now**: the toast reports `<N> imported, <M> comment(s) posted`, and the imported issues appear as Tasks on `/tasks` and inside the source's repo's project. A source with `workflow_id: null` must leave its Task as a **draft** and notify, not queue it (`:286`).
- [ ] **6 Error/empty/loading** — **Add source** stays disabled until both a repo and a non-blank JQL are set (`:375-376`). Type `3` into Poll every and blur: it snaps back to the stored value with no request.

**Traps**
- Changing site or email **without** a token clears the stored token server-side — that is why `commitToken` resends site and email in the same request (`:79-86`). Sequence: store a token, then edit only the Email, then reload and check `api_token_set` — if it flipped to false, Test connection is now disabled and that is the documented behaviour, not a regression.
- The config is a singleton with one `sources[]` entry **per repo** (ADR 0017/0018). Two sources on the same repo are not deduped by the UI; an issue matching several sources becomes one Task in the project of the *first* matching source (`:286`).
- Changing the add-row's repo clears the selected workflow (per ADR 0018 a workflow must be global or in that repo's project, `:51`).

---

### D7 · Settings → Help & About — `/settings?tab=help`

**Component:** `packages/web/src/pages/settings/HelpAboutTab.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Open GitHub Issues / Email a bug report | `href` = current `ATLAS_FEEDBACK_URL`, falls back to the constant (`:69`, `:243-247`) | — |
| Restore recommended URL | writes the default back (`:74-86`) | `PATCH /api/settings/env` |
| Repo / docs / release links | static `href`s (`:15-20`) | — |

**States** — Empty: blank `ATLAS_FEEDBACK_URL` → falls back to `https://github.com/sspartorg/atlas/issues` (`:15`, `:69`) · Loading: `useEnv` pending · Error: toast on a failed restore (`:83-85`) · Populated: About facts + Report-a-bug card.

**Checks**
- [ ] **1 Round-trip** — set `ATLAS_FEEDBACK_URL=mailto:you@example.com` on the Environment tab, come here: the button label flips to **Email a bug report** and its `href` is the mailto (`:247`). Click **Restore recommended URL**, hard-reload: the value is back to the GitHub issues URL and the Environment tab agrees.
- [ ] **2 Attribution** — n/a — nothing FK-resolved. But see the trap: the version string is not data.
- [ ] **3 List membership** — n/a — nothing is created here.
- [ ] **4 Transition legality** — n/a.
- [ ] **5 Cross-page** — after Restore, the sidenav footer **Report a bug** link (`components/ReportBugLink.tsx`) points at the same URL without a reload — both read one env var.
- [ ] **6 Error/empty/loading** — while the restore is in flight the button is disabled (`:254`). Blank the env var and confirm the button still has a working `href` (the fallback), not `href=""`.

**Traps**
- `APP_VERSION = '1.0.0'` and `RELEASE_TAG = 'v1.0'` are hardcoded constants (`:18-20`), not read from `package.json` or the API. "App version" on this tab will not change when the app is bumped — assert the constant, and do not treat a stale version as a data bug.

---

### D8 · Credentials — `/settings/credentials`

**Component:** `packages/web/src/pages/Credentials.tsx` (table `credentials/CredentialsTable.tsx`, modal `credentials/CredentialModal.tsx`, menu `credentials/CredentialRowMenu.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Add credential | opens `CredentialModal` in add mode (`Credentials.tsx:81-84`) | `POST /api/credentials` |
| Row Edit (icon or menu) | opens the modal in edit mode with the row (`:86-91`) | `PATCH /api/credentials/:id` |
| Token eye (edit mode, `pat`) | fetches stored plaintext, field goes read-only while shown (`CredentialModal.tsx:143-168`, `:574`) | `GET /api/credentials/:id/token` |
| Verify & save / Save changes | create vs patch (`CredentialModal.tsx:864`) | `POST` / `PATCH /api/credentials` |
| Delete credential… | confirm dialog → delete (`Credentials.tsx:234-262`) | `DELETE /api/credentials/:id` |

**States** — Empty: `CredentialsEmptyState`, and the `{N} credentials · {M} hosts` summary is hidden entirely at 0 rows (`:167`) · Loading: full-height spinner (`:66-79`) · Error: `toast "Could not delete credential"` + server message (`:58-63`) · Populated: AES-256-GCM alert + 8-column table.

**Checks**
- [ ] **1 Round-trip (X1)** — create a `pat` credential with token `ghp_d8probevalue0000`, hard-reload. `GET /api/credentials` must return `token_encrypted: null` and a populated `token_fingerprint` — `stripSecretsForApi` nulls **only** `token_encrypted` (`packages/api/src/services/credentials.ts:123-124`). Open Edit and click the eye: exactly one `GET /api/credentials/:id/token` fires and the field shows `ghp_d8probevalue0000` read-only. Now click **Save changes** without typing: reload and reveal again — the same token. Revealing must never populate the submit payload (`CredentialModal.tsx:211` only sets `token` when the Owner typed one).
- [ ] **2 Attribution** — the Kind chip reads `GitHub App` vs `PAT` off `c.kind` (`CredentialsTable.tsx:206`), not a literal. Create one of each and confirm the `github_app` row is labelled GitHub App. The Fingerprint column must be non-blank (`:242`) — `crypto.ts::fingerprint()` returns a host prefix + dots + last 4, so eyeball that the last 4 characters match your token.
- [ ] **3 List membership** — a newly saved credential appears in the table without a reload, in the Profile tab's status box, and in the NewProjectModal credential picker. Delete it and confirm it is gone from all three.
- [ ] **4 Transition legality** — Status chip is derived, not stored: Expiring only inside 0–30 days and never for `github_app` (`CredentialsTable.tsx:28-34`), Unused at ≥30 days idle, else Active (`:36-51`). Set `expires_at` 10 days out on a `pat` and confirm `Expires in 10 d`; set the same on a `github_app` and confirm it stays Active.
- [ ] **5 Cross-page** — set Commit identity (name + email) on a `pat`, open a standalone terminal on that credential, commit: the author is that identity (`buildGitAuth` writes a `[user]` block). On a `github_app`, the same two columns become a `Co-Authored-By` trailer behind the bot author — different meaning, same fields.
- [ ] **6 Error/empty/loading** — click the eye on a `github_app` row in edit mode: the reveal must be refused with `400 Only pat credentials can be revealed` (`packages/api/src/routes/credentials.ts:40-42`) and surfaced, not swallowed. Delete a credential a project still references and record what happens — blocked with a reason, or cascaded; the dialog copy claims only that "new clones … will fail" (`Credentials.tsx:245-246`).

**Traps**
- ⚠️ coming-soon.md stale (two rows): **Verify now** and **Check expiries** no longer exist. `CredentialRowMenu.tsx:14-23` has exactly two items — Edit and Delete credential… — and `Credentials.tsx:182-194` has only **Add credential**, no disabled header button. `grep -n Verify` in the page + menu returns nothing but the "Verify & save" submit label. Do not write a check against either, and do not mark them `(stub)` — they are gone, and so is **Copy fingerprint** (`20-credentials.md:30`).
- Every credentials write route is behind `requireMcpToken` (`routes/credentials.ts:51`, `:85`, `:101`), and so is the reveal (`:36`) — which also logs `{tag:'secret_reveal', scope:'credential', credential_id}` (`:44-47`). Confirm that line appears in the API log on each reveal; a reveal with no audit line is an X1 failure even if the value is right.
- The summary line only appends `· P expiring soon` when `P > 0` (`Credentials.tsx:178`); `20-credentials.md:17` shows it unconditionally.
- SSH key and App password kinds are disabled radios **(stub — see coming-soon.md)**.

---

### D9 · Guard-rails — `/guardrails` (tabs: rules | scripts)

**Component:** `packages/web/src/pages/Guardrails.tsx` (scripts: `guardrails/GuardrailScriptsTab.tsx`, modal: `guardrails/GuardrailModal.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Tabs `Rules {N}` / `Scripts {N}` | **local `useState`**, no `?tab=` (`:45`, `:161`, `:170-171`) | — |
| Add rule (per category) | opens `GuardrailModal` scoped to that category (`:30`) | `POST /api/guardrails` |
| Edit rule | modal in edit mode (`:62-66`) | `PATCH /api/guardrails/:id` |
| Delete rule | confirm → delete, dirty++ (`:84-88`) | `DELETE /api/guardrails/:id` |
| Save Guard-rails | publishes, then zeroes the dirty counter (`:90-94`) | `POST /api/guardrails/save` |
| Discard | zeroes the counter **only** (`:96-102`) | none |

**States** — Empty: a category card with no rules still renders with its Add button · Loading: spinner (`:104-110`) · Error: `handleSubmit` / `handleDelete` / `handleSaveAll` are bare `await`s with no catch (`:74-94`) — a failed mutation is an unhandled rejection with **no UI**; assert that gap · Populated: stats line `{N} categories · {M} rules` + `· {P} dirty` only when P>0 (`:155`).

**Checks**
- [ ] **1 Round-trip** — add a rule in `secrets_credentials` with body `` never print `${VAR}` values `` and severity `block`, hard-reload: body, category and severity all return, and the rule renders under that category card. Edit the severity to `warn`, reload: `warn`.
- [ ] **2 Attribution** — the sticky bar's "Saved {T} by Owner" uses `data.published_at` (`:113`) through a *local* `relativeTime()` helper (`18-guardrails.md:76`), not the shared one — after a Save, confirm the timestamp actually moves rather than staying on the old publish.
- [ ] **3 List membership** — the tab labels are live counts: `Rules {totalRules}` and `Scripts {scripts.length}` (`:170-171`). Add a rule and confirm the Rules label increments without a reload; add a script and confirm the Scripts label does.
- [ ] **4 Transition legality** — n/a — guard-rails have severity (`block` / `ask_owner` / `warn`), not a status machine.
- [ ] **5 Cross-page** — a workspace rule must show up in the per-project guard-rails surface (`/projects/:id?tab=guardrails`) as an inherited rule, and in the prompt a run is built from. Toggling a rule's enabled state must survive a reload — a toggle that is local-only is the known failure shape here.
- [ ] **6 Error/empty/loading** — submit the modal with an empty rule text: the validation alert blocks it. Then stop the API and delete a rule: confirm nothing is shown (no catch at `:84-88`) — the bug is the silence, and it is falsifiable.

**Traps**
- ⚠️ page doc stale: `18-guardrails.md:75` says "The dirty counter … doesn't decrement on Save — it only clears via Discard. So immediately after a Save you'll still see `{N} dirty`." The code does clear it: `handleSaveAll` calls `setDirtyCount(0)` at `Guardrails.tsx:92`. Write the check against the code — after Save the `· N dirty` suffix must disappear.
- **Discard** genuinely does not roll back edits — it only zeroes the counter and toasts "Dirty marker cleared / Saved edits remain" (`:96-102`). That is a known gap, not a bug to file. The rule rows are already persisted by their own POST/PATCH/DELETE before Save ever runs.
- Tab state is local: `/guardrails` always opens on Rules, and switching to Scripts then reloading loses it. There is no `?tab=` here, unlike `/settings` and `/notifications`.

---

### D10 · Notifications — `/notifications` (tabs: Notification Log | In-App Feed)

**Component:** `packages/web/src/pages/Notifications.tsx` (tabs: `notifications/NotificationLogTabContent.tsx`, `notifications/InAppFeedTabContent.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Notification Settings | `navigate('/settings?tab=notifications')` (`:113`) | — |
| Mark All Read | bulk, toasts the changed count (`:66-71`) | `POST /api/notifications/mark-all-read` |
| Tabs | URL-controlled via `?tab=` | — |
| Row Resend (sent) / Retry (failed) | same endpoint, different label + `aria-label` (`NotificationLogTabContent.tsx:322-345`) | `POST /api/notifications/:id/resend` |
| Row Cancel (pending) | (`:346-355`) | `POST /api/notifications/:id/cancel` |
| Feed row / Open | `itemPath(row.issue_type, row.issue_id)` (`InAppFeedTabContent.tsx:61`) | — |

**States** — Empty (Log): "Configured but Quiet" + **Send a Test Message** · Empty (Feed): per-filter empty (`InAppFeedTabContent.tsx:120`) · Loading: per-tab, no page-level spinner · Error: `toast "Resend failed"` / `"Cancelled pending delivery"` (`NotificationLogTabContent.tsx:252-268`) · Populated: filter pills with counts.

**Checks**
- [ ] **1 Round-trip** — Mark All Read, hard-reload: the sidenav badge is 0 and stays 0; the feed rows are still listed (read state is a separate field from cancellation, `17-notifications.md:80`).
- [ ] **2 Attribution (X3)** — a run-produced feed row must show the **agent's** name and accent colour, resolved from `agent_id` through `useAgents` (`InAppFeedTabContent.tsx:35`, `:146`, `:262-266`). `InAppFeedTabContent.tsx:169` is `const agentName = agent?.name ?? 'Atlas'` — a null `agent_id` **or a deleted agent** both render the literal `Atlas`. Delete an agent that authored a row and confirm which case you are looking at; a row whose `agent_id` is non-null but unresolvable is the X3 bug wearing a different word.
- [ ] **3 List membership** — trigger a run that notifies, then confirm the row appears in the In-App Feed without a reload and again after one. A send skipped by quiet hours / an off toggle / no channel stays at `external_status:'none'` and therefore **never appears in the Log tab at all** — that tab filters to `external_status !== 'none'` (`NotificationLogTabContent.tsx:41`). Check the row is in the Feed and absent from the Log, and that it is not stamped Sent.
- [ ] **4 Transition legality** — Resend/Retry/Cancel are offered strictly per `external_status` (`:322-355`): pending offers only Cancel, sent only Resend, failed only Retry, `none` offers nothing. After Cancel, reload and confirm the status actually moved — not just the button swapped.
- [ ] **5 Cross-page (X4)** — the sidenav badge counts **every** unread notification with no staleness join (`packages/api/src/services/counts.ts:136-140`), while the feed drops a `needs_you` / `agent_completed` row once its item leaves `waiting_for_info` / `in_review` (`packages/api/src/services/notifications.ts:69-78`). Construct that case: leave an `agent_completed` needs-you row unread, move its item to `done`, reload. If the badge still counts a row the page will not show, X4 is violated — and that difference is unlabelled.
- [ ] **6 Error/empty/loading** — Retry a failed row with the channel misconfigured: expect a `toast "Resend failed"` with the reason (`:256-260`), and the row's failure reason rendered inline (`:370`). Confirm no unhandled rejection in the console.

**Traps**
- `Notifications.tsx:42` fetches `limit: 200` — the Feed is capped at the 200 most recent rows, so "unread count equals what I can see" fails by design past 200. Count against the API, not the DOM.
- A `needs_you` row for `agent_error`, terminal-idle, or with no item is exempt from the staleness drop (`notifications.ts:67-68`) — do not expect those to disappear when an item closes.

---

### D11 · Reminders — `/reminders`

**Component:** `packages/web/src/pages/Reminders.tsx` (modal: `reminders/NewReminderModal.tsx`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Refresh | refetch (`:43`) | `GET /api/reminders` |
| Show history | reveals cancelled + completed rows (`:124`) | — |
| New reminder | opens `NewReminderModal` in create mode (`:134`) | `POST /api/reminders` |
| Row edit | same modal with `editing` set → PATCH (`NewReminderModal.tsx:130-140`) | `PATCH /api/reminders/:id` |
| Cancel (active/paused rows only) | confirm dialog → cancel (`:65-79`, `:250-251`) | `DELETE /api/reminders/:id` |

**States** — Empty: `HeroEmptyState` "No active reminders" + the ask-Claude nudge (`:148`) · Loading: single spinner before the first list · Error: `toast "Could not cancel reminder"` + message (`:78`) · Populated: Active list, History muted behind the switch (`:50-51`, `HISTORY_STATES` = cancelled + completed, `:31`).

**Checks**
- [ ] **1 Round-trip** — create a `weekly` reminder, label `D11 probe`, Mon+Wed, 09:30, channel **Both**, hard-reload: label, schedule kind chip, the human-formatted schedule, the dual channel icons and `next_fire_at` all return. Repeat with `cron` = `0 9 * * 1-5` and confirm the raw expression is preserved verbatim, not normalised.
- [ ] **2 Attribution** — n/a — reminders carry no author FK; both Owner and the MCP `setReminder` tool write the same shape.
- [ ] **3 List membership** — create via the MCP tool `setReminder` and confirm it shows in the Active list (the page is the only reader of `['reminders']`). Cancel a reminder: it must leave the Active list **and** appear under Show history with the `cancelled` chip — not vanish entirely.
- [ ] **4 Transition legality** — the Cancel button renders only for `active` / `paused` and never in History (`:250-251`, `ACTIVE_STATES`/`HISTORY_STATES` at `:30-31`). Confirm a `completed` row has no cancel affordance at all — absent, not disabled.
- [ ] **5 Cross-page** — let a reminder fire: one `notification` row is produced per fire, so it must land in `/notifications` → In-App Feed, and — if the channel is External or Both and quiet hours allow — as a Sent row in the Notification Log. Cancel a reminder scheduled to fire within the minute and confirm it does **not** fire (the row must leave the scheduler, not just the list).
- [ ] **6 Error/empty/loading** — in the modal pick **Weekly** and uncheck every weekday, or **Cron** and clear the expression: `buildSchedule` returns `null` (`NewReminderModal.tsx:325`, `:328`) — confirm the submit is blocked with a visible reason rather than posting a malformed schedule. While a cancel is pending both dialog buttons are disabled (`Reminders.tsx:199`, `:208`).

**Traps**
- `POST` and `DELETE /api/reminders` are behind `requireMcpToken`; `GET` is open (`21-reminders.md:75`). A create that 401s must surface, not fail silently.
- Reminders are **not** deleted by `POST /api/settings/reset` (`packages/api/src/routes/settings.ts:212-246` — no `reminders` in the delete list). After a workspace reset, every reminder is still here and still scheduled. Check this explicitly; it contradicts the reset modal's "You will lose all content" framing.
- ⚠️ page doc stale: `21-reminders.md:54-57` lists only GET/POST/DELETE. The edit path uses `PATCH /api/reminders/:id` (`api/api.ts:853-855`, `NewReminderModal.tsx:130`), and `useUpdateReminder` is not in the doc's hooks list either.

---

---

## Wave E — search and analytics

### E1 · Search — `/search`

**Component:** `packages/web/src/pages/Search.tsx` (view model: `search/searchViewModel.ts`, hook: `hooks/useSearch.ts`)

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Mode toggle (Filters / Query) | swaps the builder for the KQL input (`:51`, `:93-94`) | — |
| Text input | debounced 250 ms into both `?q=` and the request (`:61-74`, `:100`) | `GET /api/search` |
| Filter pills (Type / Project / Updated / Status / Labels) | translated by `filtersToServerArgs` (`:102`) | same |
| Sort (updated_desc / updated_asc / type) | client-side over the fetched set (`search/SearchResults.tsx:70-78`) | — |
| Result row click | `/agents/:id` for a prompt hit, else `itemPath()` (`SearchResults.tsx:81`) | — |
| Create a Task / Sub-task (empty state) | toast "Create from search is not wired up yet." **(stub — see coming-soon.md)** (`:138-140`) | — |

**States** — Empty: `SearchEmptyState` with clear-filter helpers · Loading: `keepPreviousData` holds the last result set so the grid never flashes empty (`hooks/useSearch.ts:87`) · Error: no error UI — a failed `/api/search` yields an empty grid · Populated: grouped by type, descriptions clamped to 2 lines.

**Checks**
- [ ] **1 Round-trip** — n/a — read-only surface; the only writable state is `?q=`, covered below.
- [ ] **2 Attribution** — a result row's project pill and assignee resolve from the server row's `project_id` / `assignee_agent_id` (`api/api.ts:993-1004` result shape), not a literal. A row whose assignee is null must render the unassigned treatment, not the Owner's name.
- [ ] **3 List membership** — create a Task titled `E1 Search Probe`, then search `Search Probe`: the hit appears and clicking it lands on `/tasks/:id` with that title. Archive or delete it and confirm it drops out — the corpus is server-side FTS (`items.search_tsv`), so a stale hit means the index, not the cache.
- [ ] **4 Transition legality** — n/a — search does not mutate status.
- [ ] **5 Cross-page** — filter to one project + status `in_progress` and compare the row set against that project's Tasks tab under the same filter. They must match; if they differ, check the 50-row default limit first (`hooks/useSearch.ts:72`).
- [ ] **6 Error/empty/loading** — type a **single** character: no request fires and the empty state shows even when items match, because a query under 2 characters is dropped (`searchViewModel.ts:449`) and the hook is then `enabled:false` (`useSearch.ts:59`, `:92`). With no query and no filter at all the page shows the empty state and issues zero requests — assert that in the Network tab, not by eye.

**Traps**
- Prompt hits are **not** in the FTS. They are computed client-side from `GET /api/agents` and concatenated after the server rows (`Search.tsx:105-111`, `searchViewModel.ts:494-520`), and they are suppressed entirely by any project filter or a non-`any` status (`:498-499`). So "filter by project" silently removes every prompt result — expected, and worth asserting so it is not read as data loss.
- The `?q=` sync is one-directional (`Search.tsx:72-73`): editing the URL's `q` after mount does not update the input. Deep links work on a fresh load only.
- ⚠️ page doc stale: `14-search.md:21` documents a **Save This Search** button + ⌘S shortcut toasting "Search saved". It does not exist — `grep -rn "Search saved"` over `Search.tsx` and `search/*.tsx` returns nothing, and `useToast` is used only by the `createType` stub (`:138-140`).

---

### E2 · Analytics — `/analytics`

**Component:** `packages/web/src/pages/Analytics.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| (none — read-only) | one query on mount | `GET /api/analytics?tz=<IANA zone>` |
| Project bar row → | link to `/analytics/project/:projectId` (`analytics/_ProjectCostBars.tsx:129`) | — |

**States** — Loading: stacked `<Skeleton>` blocks (`:289-296`) plus a per-chart `<Suspense>` skeleton, every chart `lazy()` (`:16-22`, `:879-902`) · Error: none at page level — panels render their own empty copy · Empty: per-panel · Populated: header clock → headline insight → KPI tiles → chart stack.

**Checks**
- [ ] **1 Round-trip** — n/a — read-only page, no writes.
- [ ] **2 Attribution** — agent names in Spend-by-agent and Top runs come from the denormalized `agent_name` the API joins (`packages/api/src/routes/analytics.ts:182`, `:221`), with the **agent id** as the fallback when the join is null (`:484`, `:506`). Delete an agent that has historical runs: its spend must still carry a name, and if it falls back you must see the raw id — never a blank, never "Agent".
- [ ] **3 List membership** — a run that completes this month appears in Top runs / the daily series after an invalidation and after a hard reload. Top runs is capped at 10 (`analytics.ts:234`) — verify the cap, not the absence.
- [ ] **4 Transition legality** — n/a — read-only.
- [ ] **5 Cross-page** — the Dashboard's **AI Cost** tile is labelled with the current month name (`pages/dashboard/KpiStrip.tsx:93-94`) and sums `costSummary30d + terminalCostSummary30d`, which the API computes from a **server-local** month start (`packages/api/src/services/counts.ts:159`, `:221`, `:238`). `/analytics` computes its month from the **browser's** `tz` query param (`api/api.ts:237-242`). Compare both with the browser and the API process in the same timezone first; only a difference that survives that is a bug.
- [ ] **6 Error/empty/loading** — throttle the network and confirm the skeletons render, then each chart's own `<Suspense>` skeleton, and finally the charts. Point the page at a workspace with zero runs and confirm the panels show their empty copy instead of `NaN` / `$NaN` in the KPI tiles (`:305` divides by cache totals).

**Traps**
- **The month boundary is local and `completed_at` is UTC.** A run at 19:00Z on the last of the month is next month in Asia/Calcutta. Before filing any "the SQL disagrees" bug, re-run the query with the exact `tz` the page sent — the header states it for this reason (`:536`, `:561`).
- `queryKey: ['analytics']` does not include `tz` (`:176`), and `api.analytics.get()` is called with no argument so the zone is resolved inside the client (`api/api.ts:237-241`). A viewer who changes their system timezone mid-session keeps the cached payload.
- Charts are `lazy()` for the `bundle:check` budget — a chart imported eagerly will fail `pnpm gate`, not the page.

---

### E3 · Analytics — Project — `/analytics/project/:projectId`

**Component:** `packages/web/src/pages/AnalyticsProject.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| View all {task_count} tasks | flips `showAll`, which gates the paged query's `enabled` (`:58`, `:71`, `:513`) | `GET /api/analytics/project/:id/tasks?page&limit` |
| Rows per page | sets `limit` **and** resets `page` to 1 (`:651-655`) | same |
| Pagination | `count = max(1, ceil(total / limit))` (`:663-666`) | same |
| Task bar / table row → | `/analytics/task/:taskId` | — |

**States** — No id: "No project id in the URL." (`:80`) · Loading: three `<Skeleton>`s (`:86`) · Error: `Failed to load project analytics: <real message>` (`:100`) · Empty: "No tasks with cost data yet." (`:485-490`) · Populated: totals → by-kind pie → top-25 bars → optional paged table.

**Checks**
- [ ] **1 Round-trip** — n/a — read-only.
- [ ] **2 Attribution** — the header shows the project's real name and `task_count` from the summary payload (`:169`, `:185`); a bad `projectId` must produce `404 Project not found` (`packages/api/src/routes/analytics.ts:595`) rendered through the error branch with the server's message, not a blank page.
- [ ] **3 List membership** — click **View all**: confirm exactly one `…/tasks?page=1&limit=25` fires and none fired before the click (`enabled: showAll`, `:71`). Then page through the whole set at `limit=25` and collect the task ids: no id may appear twice and the union must equal `paged.data.total`. Set Rows per page to 100 (the server caps `limit` at 100, `analytics.ts:869`) and repeat.
- [ ] **4 Transition legality** — n/a — read-only.
- [ ] **5 Cross-page** — this page is **all-time**; `/analytics` is the current month. They are supposed to differ. Reconcile: all-time total should equal completed-run cost + closed terminal-session cost for the project. A Task's bar is **descendant-rolled**, so the bars will not sum to the project total (`31-analytics-project.md:46`) — assert that they don't, rather than treating it as an arithmetic bug.
- [ ] **6 Error/empty/loading** — go to page 4 at `limit=25`, then switch Rows per page to 100: `page` must snap to 1 (`:654`), never leaving you on an out-of-range page. While paging, `keepPreviousData` must hold the previous rows — no skeleton flash between pages.

**Traps**
- The by-kind pie filters to `total_cost_usd > 0` (`:107`) so a zero-cost kind renders no slice at all. A missing `sub_task` slice means zero cost, not a missing join.
- Both the caption and the pagination count fall back to `data.task_count` before the paged query resolves (`:525`, `:664`) — on the first render after **View all**, the page count is computed from the summary's total, which can differ from the paged endpoint's `total` if they filter differently. Compare the two numbers once the paged query lands.

---

### E4 · Analytics — Task — `/analytics/task/:taskId`

**Component:** `packages/web/src/pages/AnalyticsTask.tsx`

**Actions**
| Control | Does | Endpoint |
|---|---|---|
| Project link → | `/analytics/project/:projectId` | — |
| Per-kind card | acts as a filter toggle, sets `typeFilter` and resets `page` (`:270-277`) | `GET /api/analytics/task/:id/children?type=` |
| `Showing only: <label>` chip | deletable; clearing resets `page` (`:349-354`) | same |
| Rows per page / Pagination | resets `page` (`:515-522`) / pages the filtered total (`:534-537`) | same |

**States** — No id: "No task id in the URL." (`:90`) · Loading: three `<Skeleton>`s (`:99`) · Error: `Failed to load task analytics: <message>` (`:110`) · Populated: totals → per-kind cards → paged descendant table, always enabled (`:67`).

**Checks**
- [ ] **1 Round-trip** — n/a — read-only.
- [ ] **2 Attribution** — the header renders the Task's real title, id and project name from `GET /api/analytics/task/:taskId` (`routes/analytics.ts:982-990`). Hit the route with a **sub-task** id: it must return `404 Item is not a task` (`analytics.ts:976-978`, and the same guard on `/children` at `:1010-1012`), and the page must show that message, not a generic one.
- [ ] **3 List membership** — every sub-task with cost under this Task appears in the descendant table. Page through at `limit=25` with no filter: ids are unique and count to the unfiltered total. Then apply the `sub_task` filter and confirm the total shrinks to just that kind, with page 1 selected.
- [ ] **4 Transition legality** — n/a — read-only.
- [ ] **5 Cross-page** — the Task's rolled total here must equal the same Task's bar on `/analytics/project/:projectId` (both descendant-rolled, both all-time), and both must be reconcilable with the run costs on `/agents/:id/runs/:runId` for that Task. It will **not** match `/analytics`, which is the current month.
- [ ] **6 Error/empty/loading** — an unknown `type=` value is ignored server-side rather than erroring — the route only accepts a value in `ITEM_TYPES` (`analytics.ts:1013-1015`), so `?type=bogus` returns the unfiltered set. Confirm the UI never sends one; the cards are built from the response's `byKind`.

**Traps**
- `typeFilter ?? 'all'` is deliberately in the query key (`:73`) so `null` and a filtered payload never share a cache slot. If someone "simplifies" it, switching filters serves the wrong rows from cache — check that filtering and clearing twice in a row returns the right set both times.
- Every control that changes the result set resets `page` to 1 (`:277`, `:354`, `:522`). Test each one from page 3 — a new control that forgets this strands the Owner on an empty page.
