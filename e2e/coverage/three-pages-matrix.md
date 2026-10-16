# Coverage contract: Notifications, Reminders, Analytics

Every finite thing these pages can show or do, and the test that proves it.
A change that adds a row here (a new event type, status, control, tab, window,
error path) adds its test in the same change. "Before" says whether a test
covered the row before 2026-10-16 (`gap` = it did not).

Test kinds: **e2e** = Playwright against the real e2e API unless the row says
*fixture* (summary endpoints routed to `e2e/fixtures/analytics-fixtures.ts`);
**unit** = Vitest. Paths are relative to the repo root.

Abbreviations for the files used most:

| Key | File |
|---|---|
| NF | `e2e/pages/notifications-full.spec.ts` |
| NM | `e2e/pages/notifications-mobile.spec.ts` |
| NT | `e2e/tabs/notifications-tabs.spec.ts` |
| RF | `e2e/pages/reminders-full.spec.ts` |
| RM | `e2e/pages/reminders-mobile.spec.ts` |
| AF | `e2e/pages/analytics-full.spec.ts` |
| AR | `e2e/pages/analytics-real.spec.ts` |
| AS | `e2e/pages/analytics.spec.ts` |
| AB | `e2e/analytics-base-seed.spec.ts` |
| A11 | `e2e/a11y/three-pages.spec.ts` |
| SN | `e2e/flows/settings-notifications.spec.ts` |
| QL | `e2e/live/quiet-hours-live.spec.ts` (`pnpm e2e:live`) |
| u:NL | `packages/web/src/pages/notifications/NotificationLogTabContent.test.tsx` |
| u:IF | `packages/web/src/pages/notifications/InAppFeedTabContent.test.tsx` |
| u:N | `packages/web/src/pages/Notifications.test.tsx` |
| u:R | `packages/web/src/pages/Reminders.test.tsx` |
| u:RM | `packages/web/src/pages/reminders/NewReminderModal.test.tsx` |
| u:SZ | `packages/web/src/pages/reminders/snooze.test.ts` |
| u:ST | `packages/web/src/pages/settings/NotificationsTab.test.tsx` |
| u:api-N | `packages/api/src/services/notifications.test.ts`, `.../external-notifications.test.ts`, `packages/api/src/routes/notifications.test.ts` |
| u:api-R | `packages/api/src/routes/reminders.test.ts`, `.../services/reminders.test.ts`, `.../reminders-lifecycle.test.ts` |
| u:EventTypeIcon, u:Sidenav, u:NotificationStatusPopover, u:useSSE, u:_chrome | the matching `*.test.ts(x)` beside each component / hook in `packages/web/src` |
| u:api-A | `packages/api/src/routes/analytics.test.ts`, `.../services/analytics-delivery.test.ts`, `.../analytics-workflows.test.ts`, `.../analytics-spend.test.ts` |
| u:api-delivery, u:api-workflows, u:api-spend | `packages/api/src/services/analytics-{delivery,workflows,spend}.test.ts` (part of u:api-A) |
| u:_depth | `packages/web/src/pages/analytics/_depth.test.tsx` |

## 1. Notifications — data variants

### 1.1 event_type → label, icon, click target (In-App Feed)

| # | event_type | Label · icon | Target | Tests | Before |
|---|---|---|---|---|---|
| N1 | `workflow_run` (link_url) | Workflow · workflow | `/workflows/:id/runs/:runId` | NF "each renders its icon and label…"; NM routing; u:EventTypeIcon | yes |
| N2 | `agent_completed` (task item) | Agent Completed · task_alt | `/tasks/:id` | NF same | gap |
| N3 | `agent_completed_no_item` | Agent Run Finished · task_alt | `/agents/:id/runs/:runId` | NF same | gap |
| N4 | `agent_error` (sub-task item) | Agent Failed · error | `/sub-tasks/:id` | NF same | gap |
| N5 | `agent_error_no_item` | Agent Run Failed · error | `/agents/:id/runs/:runId` | NF same | gap |
| N6 | `ci_failed` | CI Failed · bug_report | `/tasks/:id` | NF same | gap |
| N7 | `reminder` without `reminder_id` | Reminder · alarm | `/reminders` | NF same; NM routing | yes |
| N8 | `reminder` with `reminder_id` | Reminder + Snooze button (card not a button) | menu → `/reminders` | NF "a reminder card snoozes…"; u:IF | yes (unit) |
| N9 | `jira_sync` | Jira · sync_alt | `/settings?tab=jira` | NF; NM routing | yes |
| N10 | `mcp_external` (log only) | Sent by Claude · send | log only | NF "a log-only row…"; u:NL | yes (unit) |
| N11 | `terminal.waiting_for_input` | Terminal Waiting · terminal | `/terminal/:id` | NF | gap |
| N12–16 | `autofetch_success / _skipped / _failed / _conflict / _disabled` | Auto-fetch … · sync / sync_disabled / cloud_off / merge_type / block | `/projects/:id` | NF | gap (only `_failed` in NM) |
| N17 | unknown event_type | Title-cased type · notifications | `/notifications` | NF "Some New Event"; u:EventTypeIcon | yes (unit) |

### 1.2 kind × in_app × read

| # | Variant | Tests | Before |
|---|---|---|---|
| N20 | `needs_you` → "Needs you" chip, counted in alert ("1 item needs you." / "N items need you.") | NF "pills count and filter by kind…" | partial |
| N21 | `update` / `system` (no chip) | NF same | partial |
| N22 | `in_app=false` → Log tab only; not feed, badge, Mark All Read | NF "log-only row"; u:NL; u:api-N | yes (unit) |
| N23 | unread → blue edge bar, aria "Unread: …"; read → plain | NF event-type test (before/after click) | gap |
| N24 | needs_you staleness: `workflow_run` / `agent_completed` row hidden once its item leaves waiting_for_info / in_review, shown again when it returns | NF "pills count…" (ETM-1 toggled), NF live "…the reply that moves the item on drops it"; u:api-N | unit only |

### 1.3 external_status (Notification Log)

| # | State | Chip · action | Tests | Before |
|---|---|---|---|---|
| N30 | `none`, no reason | not listed | NF "every delivery state…"; u:NL | yes |
| N31 | `sent` | Sent · Resend | NF; u:NL | yes |
| N32 | `failed` + reason | Failed + ⚠ reason · Retry | NF; u:NL | yes |
| N33 | `pending` + `external_deferred_at` (held) | Held · quiet hours + "sends HH:MM" · Cancel | NF; NM; QL | yes |
| N34 | `pending` in flight | Pending · Cancel | NF | gap |
| N35 | `none` + "Skipped: …" (toggle off while held / no channel) | Skipped + muted reason · Send now | NF; u:NL; QL | yes |
| N36 | `none` + "Cancelled by you" | Cancelled · Send now | NF "Resend, Retry, Cancel…"; u:NL | new |
| N37 | `push_status` none/pending/sent/failed | shown in the reminder fire log | RF "the fire log…"; u:R | partial |

### 1.4 Log actions and their API paths

| # | Action | Outcome | Tests | Before |
|---|---|---|---|---|
| N40 | Resend (sent) | toast "Resent external notification", chip stays Sent, message delivered | NF | gap |
| N41 | Retry (failed) | chip → Sent, reason gone | NF | gap |
| N42 | Cancel (held) | toast, chip → Cancelled, "sends" gone | NF; u:api-N | gap |
| N43 | Cancel (in flight) | chip → Cancelled | NF | gap |
| N44 | Send now (skipped / cancelled) | chip → Sent | NF | gap |
| N45 | Resend with a failing transport (502) | toast "Resend failed", chip → Failed + reason | NF "a transport failure…" | gap |
| N46 | Resend with no channel (409) | toast with "No external channel is connected…", row unchanged | NF; u:api-N route test | new |
| N47 | Cancel refused (409) | toast "Cancel failed" + reason | NF "a refused cancel…"; u:NL | new |

### 1.5 Page controls and states

| # | Element / state | Tests | Before |
|---|---|---|---|
| N50 | Tabs Notification Log / In-App Feed, `?tab=external|in-app`, default | NT; NF (click writes URL) | yes |
| N51 | Log pills All / Sent / Failed / Pending / Skipped with counts; empty filter copy | NF "every delivery state…"; u:NL | partial |
| N52 | Feed pills All / Needs You / Updates / System with counts; "Nothing here yet." | NF "pills count…" | gap |
| N53 | Load more (200 a page) on both tabs | NF "Load more…" | gap |
| N54 | Refresh | NF "Notification Settings … Refresh refetches" | gap |
| N55 | Notification Settings button / phone icon | NF; NM | yes |
| N56 | Mark All Read → toast count, badge, popover, "Marked 0" | NF "Mark All Read empties…"; A11 keyboard | gap |
| N57 | Mark All Read failure toast | u:N (hook) | new |
| N58 | Loading skeleton (`aria-busy`) | u:N "shows a busy skeleton" | new |
| N59 | Load error → `Alert` "Could not load notifications: …" | NF "a failed load…"; u:N | new |
| N60 | Empty log: "No External Channel Yet" + disabled Send a Test Message | NF "no channel…" | gap |
| N61 | Empty log, connected: "…Configured but Quiet", Send a Test Message success / failure / network error | NF "a connected, untested channel…"; u:NL | partial |
| N62 | Subtitle: connected (endpoint + last delivery) / set up untested / not connected + Settings link | NF; u:N | partial |
| N63 | SSE: new row + badge arrive without reload | NF live "a workflow park arrives over SSE…"; u:useSSE | gap |
| N64 | Topbar pill + popover: provider, endpoint / untested / none, unread count, Open notifications, Settings, Escape | NF "Mark All Read…", "the popover names…"; A11 keyboard; u:NotificationStatusPopover | gap |
| N65 | Sidenav badge count / hidden at 0 | NF; u:Sidenav | partial |
| N66 | Phone cards (3-zone grid), icon header buttons | NM | yes |

## 2. Settings → Notifications

| # | Element | Tests | Before |
|---|---|---|---|
| S1 | Provider Telegram ↔ Teams; Teams settings survive switching back | SN "Teams: …" | yes |
| S2 | Bot token / chat id / webhook save on blur; Untested pill after edit | SN "Telegram: …" | yes |
| S3 | Reveal + 30s mask; revealed field is read-only | SN; u:ST | yes |
| S4 | Send Test success / failure (bad token, failing webhook) → pill | SN | yes |
| S5 | Every event toggle (7 keys) persists both ways across reload | SN "every event toggle persists…" | gap (first only) |
| S6 | Quiet hours on/off, From, To persist; bad time refused; `from == to` copy | SN both tests; u:ST | partial |
| S7 | Time zone: "(this device's zone)" / "(this device is in X)" + Use X persists | SN; u:ST | new |
| S8 | Terminal idle threshold bounds | SN | yes |
| S9 | Quiet hours hold → flush → sent; toggled off while held → Skipped (real clock) | QL | yes |

## 3. Reminders

### 3.1 Create: schedule kind × channel (12 combos)

| # | Kind | Shown as | Channels (In-app / External / Both, icon labels) | Tests | Before |
|---|---|---|---|---|---|
| R1 | Once (Owner-zone wall time) | "Once on <Owner-zone date>" | all three | RF "every schedule kind × channel"; u:RM | gap |
| R2 | Daily | "Daily at HH:MM" | all three | RF; u:RM | gap |
| R3 | Weekly | "Weekly Mon, Fri, Sat at HH:MM" | all three | RF; u:RM | gap |
| R4 | Cron | "cron: <expr>" | all three | RF; u:RM | gap |

### 3.2 Validation

| # | Error | Tests | Before |
|---|---|---|---|
| R10 | Empty / blank label → Create disabled | RF "every validation error…"; u:RM | yes |
| R11 | Label > 200 cannot be typed; counter "N/200" | RF; u:RM | gap |
| R12 | Once in the past → "Pick a time in the future." | RF; u:RM | gap (accepted before) |
| R13 | Once missing / unparseable → "Pick a date and time." | u:RM | yes (generic copy) |
| R14 | Daily / weekly bad time → "Pick a time." | u:RM | yes (generic copy) |
| R15 | Weekly, no weekday → "Pick at least one weekday." | RF; u:RM | yes (generic copy) |
| R16 | Cron blank → "Enter a cron expression." | RF; u:RM | yes (generic copy) |
| R17 | Cron invalid → 400 "Invalid cron expression …" shown | RF; u:RM; u:api-R | gap (was a 500) |
| R18 | Cron with no future fire → 400 "… has no future fire" | RF; u:api-R | gap |
| R19 | Cancel / Escape close without creating | RF | yes |

### 3.3 Status × action (row menu shows exactly these)

| # | Status | Menu | Tests | Before |
|---|---|---|---|---|
| R20 | active | Edit, Pause, Snooze ×3, Cancel reminder | RF "each status offers exactly its actions" | partial |
| R21 | paused | Edit, Resume, Snooze ×3, Cancel reminder | RF | partial |
| R22 | completed | Snooze ×3, Delete | RF | gap |
| R23 | cancelled | Delete | RF; RM | partial |

### 3.4 Actions

| # | Action | Tests | Before |
|---|---|---|---|
| R30 | Edit: prefilled (kind, time, days, channel), saves every field | RF "Edit opens prefilled…"; u:RM | unit only |
| R31 | Pause / Resume (toast, chip, "Paused · never fired") | RF; RM | yes |
| R32 | Snooze 10 minutes / 1 hour / until tomorrow 9:00 (Owner zone) | RF "pause, resume and each snooze choice"; RM (1 hour); u:SZ | partial |
| R33 | Snooze from the feed card + Open Reminders | NF "a reminder card snoozes…" | gap |
| R34 | Cancel with confirm (Keep / Escape / confirm) → history | RF "Cancel asks first…"; A11 keyboard | partial |
| R35 | Delete with confirm (Keep / confirm) → gone (404) | RF; RM | yes |
| R36 | Refused action (snooze a cancelled one) → toast with reason | RF "an action the server refuses…" | gap |
| R37 | Show history toggle; history region; empty history copy | RF; u:R | partial |
| R38 | Show more history (50 a page) | RF "history pages 50 at a time…"; u:R | unit only |
| R39 | Fire log expand / collapse; push + external status per fire, failed reason | RF "the fire log…"; RM; u:R | partial |
| R40 | Refresh | RF "Refresh picks up a reminder made elsewhere…" | gap |
| R41 | Reminder created by Claude (MCP `crud_reminder` create / pause) appears | RF same | gap |
| R42 | Times in the Owner zone (subtitle, Once input, row, tooltip, edit round trip) with the browser elsewhere | RF "the Owner zone, not the browser zone"; u:R; u:SZ | gap |
| R43 | A real fire: notification arrives live in the feed with Snooze; reminder completes, "fired 1×" | RF "a due reminder fires…" | gap |
| R44 | An open Reminders page follows a fire without refresh | RF "an open Reminders page follows a fire…"; u:useSSE | gap |
| R45 | Loading skeleton; load error `Alert` (not the empty hero) | RF "a failed load…"; u:R | new |
| R46 | Empty state hero | `e2e/pages/reminders.spec.ts`; RF | yes |
| R47 | Phone card layout, FAB | RM | yes |

## 4. Analytics

### 4.1 Tab × window (16 deep links) and fetches

| # | Item | Tests | Before |
|---|---|---|---|
| A1–A16 | `?tab=overview|delivery|workflows|spend` × `?window=7d|30d|90d|month`: tab selected, window pressed, subtitle span, only that tab's endpoints with that window | AF "every tab × window deep link" (16 tests, fixture) | partial (1 combo) |
| A17 | Unknown tab / window → Overview, This month | AF | gap |
| A18 | Window change refetches the open tab and rewrites the URL; re-pressing keeps it | AF "changing the window…"; AS | partial |
| A19 | Numbers per window equal hand-written SQL over a realistic seed | AR (all four windows) | yes |
| A20 | Month default Spend = Dashboard "this month"; agent-test runs excluded | AR "agent-test runs are not spend…"; u:api-A "Dashboard month agrees" | new |

### 4.2 Every tile definition (tooltip)

| # | Tab | Tiles | Tests | Before |
|---|---|---|---|---|
| A30 | Overview | Tasks shipped, Median cycle time, PRs merged, Workflow success rate, Spend, Cost per shipped Task | AF "each tile's info button shows its own definition" + "the definitions read as written"; u:_chrome | partial (1 tile) |
| A31 | Delivery | Tasks shipped, Lead time, Cycle time, Work in progress, Waiting on you, Reopen rate, PRs merged, Time to PR | AF | partial |
| A32 | Workflows | Success rate, Workflow runs, Gate pass rate, Retries | AF | gap |
| A33 | Spend | Spend, Cost per shipped Task, Cache savings, Cache hit rate (+ terminal card tiles) | AF | gap |
| A34 | Tooltips by keyboard focus, Escape closes | AF; A11 keyboard | gap |

### 4.3 Empty states (real API, base seed), every tab × window

| # | Tab | Copy | Tests | Before |
|---|---|---|---|---|
| A40 | Overview | "Nothing shipped, ran or spent in this window yet." + 0 / — / $0.00 tiles | AB (4 windows) | gap |
| A41 | Delivery | "Nothing shipped in this window" ×3, "No cycle times yet" ×3, "No project shipped a Task in this window." | AB; AS (fixture) | partial |
| A42 | Workflows | "No workflow runs…", "No checks ran…", "No parks…", "No run cost…", "No workflow ran…", "No agent took a workflow step…" | AB | gap |
| A43 | Spend | "No spend in this window" ×3, "No tokens…", "No agent spend…", "No project spend…", "No completed runs…", "No spend in the trailing 12 months" | AB | gap |
| A44 | Project / Task drill-downs with no runs ("No tasks with cost data yet."; descendants listed at $0.00; unfiltered empty table "No completed runs on this Task or its sub-tasks yet.") | AB; u:AnalyticsProject, u:AnalyticsTask | gap |
| A45 | Dashboard "No spend yet this month" | AB | gap |

### 4.4 Row links and drill-down controls

| # | Control | Tests | Before |
|---|---|---|---|
| A50 | Delivery WIP id → `/tasks/:id`; aging marker | AF; AS | yes |
| A51 | Delivery by project: name link and whole row → `/analytics/project/:id` | AF; AS (link) | partial |
| A52 | Workflows table: link and row → `/workflows/:id` | AF | gap |
| A53 | Agents table: name order, link → `/agents/:id?tab=performance`; First-attempt legend; Fleet performance button | AF; AR (agent tests left out) | partial |
| A54 | Spend: project bars → drill-down; top run → `/agents/:id/runs/:runId`; top session → `/terminal/:id/history` | AF | gap |
| A55 | Project page: top bars, View all, rows per page, paging, row links | AR; `e2e/pages/analytics-project.spec.ts` | yes |
| A56 | Task page: kind cards filter, chip delete, rows per page, paging, project link | AR; `e2e/pages/analytics-task.spec.ts` | yes |

### 4.5 Errors

| # | Path | Tests | Before |
|---|---|---|---|
| A60 | Overview: any of its three endpoints 500 → "Could not load analytics: <reason>" | AF "honest errors" | gap |
| A61 | Delivery 500 → "Could not load delivery analytics: …" | AF | gap |
| A62 | Workflows 500 → "Could not load workflow analytics: …" | AF | gap |
| A63 | Spend 500 → "Could not load spend: …"; other tabs still work | AF | gap |
| A64 | Project 500 / 404, Task 404 / not-a-task | AF "drill-downs…" | gap |

### 4.6 Trends, flow, quality and cost efficiency (2026-10-16)

| # | Item | Tests | Before |
|---|---|---|---|
| A70 | Every tile (Overview 6, Delivery 13, Workflows 5, Spend 4): Δ vs the previous equal-length window (▲/▼, green when good news for that metric, points for rates, "—" with no earlier data) and a labelled sparkline of the per-bucket series | AF "every tile compares with the previous window…"; AR "every tile's trend…" (Tasks shipped delta = SQL, all windows); u:_depth (Sparkline, StatTile trend); u:api delivery/workflows/spend `trends` (exact series) | new |
| A71 | Flow efficiency (In progress + In review ÷ all status time before first Done, shipped Tasks) | AR (SQL, 4 windows); AF definition + value; AB "—"; u:api-delivery 37200/127800 | new |
| A72 | Your response to parks (park → run's next resume; p50 / p90; sub-task copies and agent tests out; open parks counted) | AR (SQL median, 4 windows); AF; AB "—", "no parks"; u:api-delivery 2h / 18720s | new |
| A73 | Weekly throughput (Tasks shipped ÷ window weeks; sparkline per Monday week) | AR; AF; AB "0.0"; u:api-delivery 56/13 | new |
| A74 | Rework after Done (shipped Tasks that left Done again by the window end) | AR; AF; AB "—"; u:api-delivery 1 of 4 | new |
| A75 | First-attempt merges (runs whose every PR merged with no retried step and no park in the tree) | AR (SQL, 4 windows); AF; AB "—", "no merged runs"; u:api-delivery 1 of 3 | new |
| A76 | Retries per Task (retries ÷ distinct Tasks worked; a sub-task's run counts for its Task) | AR; AF; AB "—", "no Tasks worked"; u:api-workflows 2 ÷ 2 | new |
| A77 | Red checks by script table (failures, run trees, last failed; top 10) | AR (rows = SQL); AF; AB "No failed checks in this window"; u:api-workflows, u:_depth | new |
| A78 | Agents: cost vs first-attempt success scatter (a comparison, not a ranking, ADR 0023) | AF (one dot per agent); AB "No agent steps in this window"; u:_depth | new |
| A79 | Cost per PR and per shipped Task, by workflow and by model | AR (per-PR column = SQL, 4 windows); AF; AB "No workflow runs in this window"; u:api-spend exact rows; u:_depth | new |
| A80 | Cache savings per day / week chart | AF; AB "No cache savings in this window"; u:api-spend 5.6 | new |
| A81 | No sideways page scroll at 390px on any tab | AF "nothing scrolls sideways at 390px" | new |

## 5. Everywhere (all three pages + Settings → Notifications + drill-downs)

| # | Check | Tests | Before |
|---|---|---|---|
| E1 | axe WCAG 2.1 A/AA, light and dark, at 390 / 834 / 1440 (10 views × 6) | A11 | partial (some views, 1–2 widths) |
| E2 | No console errors through load and interaction | A11 (whole-test listener); `goto()` everywhere | partial |
| E3 | No sideways page scroll at 390 / 834 / 1440 | A11; AS; NM; RM | partial |
| E4 | Tab reaches every visible control on each view | A11 "Tab reaches every control" (10 views) | gap |
| E5 | Enter / Space activate (tabs, pills, popover, Mark All Read, kebab, menu items, switch, fire log, window buttons) | A11 keyboard tests; NF (Enter / Space on feed cards) | gap |
| E6 | Escape closes menus, dialogs, the popover and tooltips; focus returns to the trigger | A11; RF; NF | partial |
| E7 | Sidenav entries are links (keyboard reachable) | A11; u:Sidenav | gap (they were not) |
| E8 | One `main` landmark holds the page | `e2e/pages/analytics-project.spec.ts`, `e2e/pages/marketplace-workflows.spec.ts` (scope links to `main`) | gap (there was none) |

## 6. Cannot be tested here

| Row | Why |
|---|---|
| Real Telegram / Teams delivery | External services; a local fake Bot API / webhook stands in (NF, SN, QL). |
| Web push to a real browser | Needs a push service; `e2e/flows/push-subscription.spec.ts` covers the subscription, the API unit tests cover `push_status`. |
| A send stuck in flight for 10 minutes after a crash | Needs a process kill mid-send plus 10 minutes; covered by `reclaimStuck` unit tests (u:api-N). |
| "Tomorrow 9:00" across a DST change on the real clock | Needs the wall clock at a DST boundary; covered by u:SZ with pinned dates. |
| The real-clock quiet-hours window | Runs in `pnpm e2e:live` (QL), not the default suite (needs minutes of wall time). |
