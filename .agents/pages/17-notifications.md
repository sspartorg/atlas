# Notifications

**Route:** `/notifications` â€¢ **Component:** `packages/web/src/pages/Notifications.tsx` â€¢ **Slug:** `guardrails` (mockups also live there)

## Purpose
Two-tab notifications hub. The **Notification Log** tab is the delivery queue (sent / failed / pending) with retry/cancel/resend controls. The **In-App Feed** tab lists `needs_you` / `update` / `system` items with row-click navigation.

## States
- Loading: three skeleton rows (`aria-busy`) while the first feed page loads — never the empty state.
- Error: `Alert` "Could not load notifications: <message>" in place of both tabs (before 2026-10-16 a failed load read as "No External Channel Yet" / "Nothing here yet.").
- Per-tab empty + populated states.
- A metadata subtitle line shows the channel: "connected to <endpoint> · last delivery <age>"; "<Telegram|Teams> set up, not tested yet · last delivery …" when the active provider has credentials but no endpoint label yet; or red **not connected** with a **Settings → Notifications** link (a real router link, keyboard-focusable). "Connected" means the ACTIVE provider has its credentials (`isExternalChannelConnected`: Telegram token + chat id, Teams webhook) — a Telegram token left behind after switching to Teams does not count.

## UI elements
**Page header**
- **Refresh** icon button → invalidates notifications, agents, settings
- **Notification Settings** button → `/settings?tab=notifications`
- **Mark All Read** button → `markAllRead.mutate()` → toast with count ("Marked N notifications read"); a failure toasts "Could not mark notifications read"
- On phones (`useIsMobile()`, below `md`) the three actions are icon-only `IconButton`s with a Tooltip + `aria-label` (`Refresh notifications`, `Notification settings`, `Mark all read`), all on one row — the title's row (`PageHeader` keeps phone actions beside the title and puts the subtitle full width underneath; before 2026-10-16 the long subtitle pushed them onto a line of their own below it).
- **Tabs** (controlled via `?tab=`): Notification Log (default) / In-App Feed
- **Load more** (below either tab, only while the last page came back full): both tabs read one feed, 200 rows a page (`useNotificationFeed`, `useInfiniteQuery`); the button fetches the next 200 with `?before=<last id>`.

### Notification Log tab (`NotificationLogTab`)
- Lists every row with an outward send (`external_status != 'none'`, plus skipped / cancelled rows — `none` with a reason), including log-only rows (`in_app=false`: external-only reminders, MCP sends) that the feed hides.
- Filter pills: All / Sent / Failed / Pending / Skipped (with counts; Skipped holds skipped and cancelled rows, so the four add up to All), in one row that scrolls sideways instead of wrapping (`PillRow`, `role="group"` "Filter deliveries"). Pending counts held rows too.
- **Empty state**: "External Channel Is Configured but Quiet" (channel connected) or "No External Channel Yet", + **Send a Test Message** (enabled whenever the active provider is connected — it used to need an endpoint label and a chat id, so it was always disabled for Teams and before the first test) → `POST /api/settings/external-notification/test` → toast "Test message sent" / "Test failed" + reason (a network error toasts too) and refreshes settings so the subtitle and topbar update
- Table columns:
  - Timestamp (time + relative day)
  - Event Type (icon + label + `event_type` code)
  - Item (`issue_id` + message; failure reason if failed)
  - Status badge: Sent / Failed / Pending, or **Held · quiet hours** (clock glyph) with `sends HH:MM` under it when `external_deferred_at` is set — the planned time is `settings.quiet_hours_to` — or **Skipped** (grey) for a held row whose event toggle was off when the window ended (`none` + reason "Skipped: event turned off while held", shown muted under the message)
  - Action buttons per status:
    - Sent → **Resend** → `POST /api/notifications/:id/resend` → toast "Resent external notification"
    - Failed → **Retry** → same endpoint
    - Pending (held or in flight) → **Cancel** → `POST /api/notifications/:id/cancel` → toast "Cancelled pending delivery"; the row stays, chip **Cancelled**, reason "Cancelled by you", action Send now. A refused cancel toasts "Cancel failed" + reason
    - Skipped / Cancelled → **Send now** → `POST /api/notifications/:id/resend`
    - Resend / Retry / Send now with no channel connected → toast "Resend failed" + "No external channel is connected. Set one up in Settings → Notifications." (409; the row is left as it was)
- **Phones**: one `NotificationCard` per row (`pages/notifications/NotificationCard.tsx`), a 3-zone grid shared with the feed: fixed 32px event icon · middle (event label alone on the first line, message clamped to 2 lines, a status line — the chip, plus `sends HH:MM` for a held row — then mono meta `item id · time · day`, failure reason on its own clamped line) · fixed 40px action (Resend / Retry / Cancel). A held card has a gold edge bar. The chip used to share the title's line, so "Held · quiet hours" crushed the title at 360px and `sends HH:MM` was ellipsised off the meta line.

### In-App Feed tab (`InAppFeedTab`)
- Shows only `in_app` rows: an external-only reminder fire and an MCP `send-external` (`mcp_external`) are log-only and appear on the Notification Log tab alone. Counts and the unread badge leave them out too.
- Top alert when `needs_you > 0` ("{N} items need you. Click any rowâ€¦")
- Filter pills: All / Needs You / Updates / System — same sideways-scrolling `PillRow` ("Filter notifications")
- Each row is a `NotificationCard` (all widths): event icon (`EventTypeIcon`) · event label, message (2 lines), **Needs you** chip on its own status line, mono meta `item id · type · agent · age` · chevron. Unread rows have a blue edge bar. The card is a focusable `role="button"` (Enter/Space open it).
- Clicking marks it read and opens `notificationLinkUrl(row)` (@atlas/shared) — the same chain the web-push click uses: stored `link_url` → `/tasks/:id` · `/sub-tasks/:id` → `/reminders` → `/settings?tab=jira` → `/projects/:id` → `/notifications`. Producers stamp `link_url` at create time (workflow runs `/workflows/:id/runs/:runId`, standalone agent runs `/agents/:id/runs/:runId`, terminal `/terminal/:id`; migration 010 backfilled older rows).
- A reminder card whose row carries `reminder_id` (fires since migration 011) swaps the chevron for a **Snooze reminder** button: Snooze 10 minutes / 1 hour / until tomorrow 9:00 (Owner zone) + **Open Reminders**. Snoozing marks it read. The card itself isn't clickable then (no button inside a button). See [Reminders](21-reminders.md).
- `EventTypeIcon` has an entry per produced `event_type`: `workflow_run`, `agent_completed(_no_item)`, `agent_error(_no_item)`, `ci_failed`, `reminder`, `jira_sync`, `mcp_external` (send glyph, "Sent by Claude"), `terminal.waiting_for_input`, `autofetch_*` (success/skipped/failed/conflict/disabled). Fills are theme soft tokens, so they flip with dark mode.

## Why these affordances exist
- **Two tabs (Notification Log / In-App Feed)** â€” Notification Log is the diagnostic surface; In-App is the unread inbox. Splitting them prevents diagnostics from drowning actionable items.
- **Per-row Resend / Retry / Cancel** â€” Notifications fail for transient reasons (network, rate-limits); row-level retry beats re-triggering the producing event.
- **Send a Test Message (empty state)** â€” External notification silence is ambiguous (working but quiet vs. misconfigured); the test resolves it.
- **Top alert for `needs_you > 0`** â€” Surfaces urgency without forcing a row scan; matches the dashboard's "awaiting you" signal.
- **Mark All Read** â€” In-app feeds accumulate update/system rows the Owner already saw elsewhere; bulk-clear avoids per-row dismissal.

## Topbar Notifications pill (every desktop page)
- The pill's dot is green when the active provider is connected (`isExternalChannelConnected`), red when not. Click / Enter / Space opens `NotificationStatusPopover` (`role=dialog`, "Notifications status"): **Sending via Telegram | Microsoft Teams** (or **No external channel**), "Connected to <endpoint>." / "Set up, not tested yet.", the unread count from `/api/counts` ("N unread notifications" / "No unread notifications" — the same number as the sidenav badge, so Mark All Read empties both), and two links: **Open notifications** (`/notifications?tab=in-app`) and **Settings** (`/settings?tab=notifications`). Escape closes it. Before 2026-10-16 it said "Teams is the only supported channel" whatever the provider.

## Modals / drawers
None.

## Hooks used
- `useNotificationFeed()` (the rows both tabs filter, paged 200 at a time) + `useNotifications({ external_status: 'sent', limit: 1 })` (last delivery stamp)
- `useMarkAllRead`, `useResendNotification`, `useCancelNotification`
- `useAgents` (for agent chip resolution)
- `useNow` (60s tick for relative-time aging)
- `useIsMobile` (header icon buttons, log cards)

## API endpoints touched
- `GET /api/notifications?limit=200[&before=<id>]` (feed pages) and `?external_status=sent&limit=1` (last delivery)
- `POST /api/notifications/:id/resend`
- `POST /api/notifications/:id/cancel`
- `POST /api/notifications/mark-all-read`
- `POST /api/settings/external-notification/test` (test message button)
- `GET /api/agents`

## Permissions / guards
- Post-onboarding only.
- Quiet hours (settings) affect delivery timing on the API side, not the listing here.

## Notification dispatch model
- **In-app notifications are always created** for every run completion (item-attached or freedom-mode, success or error). They appear in the In-App Feed regardless of any toggle. The "always published" invariant. The two log-only producers (external-only reminders, MCP `send-external`) are the exception by design: an outward message, not an inbox item.
- **Outward delivery (Telegram / Teams) and web push follow one rule** (`outwardGate`, `services/external-notifications.ts`):
  1. Per-event toggle in `settings.external_notification_event_toggles` (Settings → Notifications). Off → the row is `none` with reason `Skipped: "<toggle title>" is turned off in Settings`, so the Log shows it **Skipped** with **Send now** (before 2026-10-17 it was a bare `none` and the row vanished). Web push for that row is not sent.
  2. Quiet hours (`quiet_hours_enabled = 1`, Owner zone `quiet_hours_timezone`): a send inside the window is **held** (`pending` + `external_deferred_at`), and its web push too (`push_deferred_at`, migration 015). The minute tick sends both once the window ends; the outward text is prefixed `Held during quiet hours · HH:MM`. Nothing is dropped. `from == to` = no window. The flush re-checks the toggle: turned off while held → **Skipped**. An in-app-only event (no key) is held by quiet hours only.
- **Which events go outward** (Owner decision 2026-10-17: needs-you, failures and every Task finish):

  | Event | event_type | Toggle key |
  |---|---|---|
  | Workflow parks on an item or project (question / rejection) | `workflow_run` | `item.status_changed:waiting_for_info` |
  | Workflow park because something broke; queued Task could not start | `workflow_run` | `workflow.failed` |
  | Workflow finished a Task with a PR | `workflow_run` | `item.status_changed:in_review` |
  | Workflow finished a Task without a PR, or a project-level run | `workflow_run` | `workflow.finished` |
  | Direct (non-workflow) agent run finished on an item | `agent_completed` | `workflow.finished` |
  | Direct agent run errored on an item | `agent_error` | `agent.failed` |
  | Standalone agent run finished / errored | `agent_completed_no_item` / `agent_error_no_item` | `agent.run_finished_no_item` / `agent.failed_no_item` |
  | CI failed on a Task's PR | `ci_failed` | `ci.failed` |
  | Jira sync failed (once per new failure) | `jira_sync` | `jira.sync_failed` |
  | Auto-fetch failed (incl. no / missing / unreadable credential), conflict-abort, auto-disabled | `autofetch_failed` / `_conflict` / `_disabled` | `autofetch.failed` |
  | Reminder fired with channel External or Both | `reminder` | `reminder.fired` |
  | Terminal idle (default OFF) | `terminal.waiting_for_input` | `terminal.waiting_for_input` |
  | MCP `send-external` | `mcp_external` (log-only) | its own free-form `event_key`, if any |

  In-app only (no outward send): Jira imports / moves, sub-task done, auto-fetch success / skipped.
- **Telegram is sent as plain text** (no `parse_mode`), capped at 4096 characters. With `parse_mode: 'Markdown'` Telegram rejected every message carrying an unbalanced `_` / `*` / `[` (paths, check names, error text) with 400 "can't parse entities" — most workflow parks never arrived (fixed 2026-10-17). Both transports time out after 15 s, so a hung send cannot stall the minute tick.
- **Test Message** (`POST /api/settings/external-notification/test`) deliberately bypasses both checks â€” the Owner pressed Send Test, so a silent success would be indistinguishable from misconfiguration.

## Edge cases / quirks
- The header "last delivery" age uses `useNow` to tick every minute â€” UI updates without refetch.
- Marking all read does **not** mark externally delivered notifications as cancelled â€” it's a separate read-state field.
- Quiet hours hold outward sends and web push; in-app rows still arrive in the feed.
- An unconfigured channel leaves the row at `external_status='none'` (not listed); an off toggle leaves `none` + a Skipped reason (listed). A row never shows **Sent** unless a transport actually delivered. A quiet-hours send shows **Held** until the flush (2026-10-16; before, it was dropped to `none`).
- **Resend / Retry** send immediately, even inside quiet hours.
- A send left in flight by a server that died mid-send is retried by the minute tick after 10 minutes, once; stuck again, it shows **Failed** ("Send interrupted twice … Press Retry").
- Clicking a web-push notification marks it read (`sw.js` → `POST /api/notifications/:id/read`) before navigating.
- A `needs_you` completion row (`event_type='agent_completed'` or `workflow_run`) drops out of the In-App Feed and the unread count once its item leaves `waiting_for_info` / `in_review` (or a newer one on the same item supersedes it). An open page drops it live: `counts_changed` (broadcast on every item status write) now refetches `['notifications']` as well as the badge. `agent_error`, terminal-idle, and item-less `needs_you` rows are unaffected.

## Connectivity
- **Pages**: [Settings â†’ external notification](19-settings.md) â€” header CTA target for configuring the bridge; [Task Detail](07-task-detail.md) and [Sub-task Detail](10-sub-task-detail.md) â€” row "Open" navigation when the notification references an item.
- **Routes**: `POST /api/notifications/:id/resend` â€” separate from the create path because resend preserves the original event metadata; re-creating would lose the audit trail.
- **Entities**: `notification`, `agent` (sender), `task` / `sub_task` (subject).

## Coming soon on this page
None.
