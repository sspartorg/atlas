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
- **external notification delivery is gated by two checks:**
  1. Per-event toggle in `settings.external_notification_event_toggles` (see Settings → Notifications). Off → the row stays `none`.
  2. `settings.quiet_hours_enabled` — when `1`, a send inside the `quiet_hours_from` / `quiet_hours_to` window is **held** (`pending` + `external_deferred_at`) and the minute tick sends it once the window ends, prefixed `Held during quiet hours · HH:MM`. Nothing is dropped. `from == to` means no window. The flush re-checks the event toggle: one turned off while the row was held is **Skipped** (`none`), not sent. MCP `send-external` gets a log-only row, so it is held like everything else (before 2026-10-16 quiet hours dropped it).
- **Workflow failures** (a run parked because something broke, or a queued Task that could not be dispatched) go out as `workflow.failed`; **Jira sync failures** as `jira.sync_failed`. Reminders (no event key; opt-in per reminder) and auto-fetch failures go through the same held path on their own row.
- **Item-attached runs** map the external-notification event key from the item's final post-handoff status:
  - `waiting_for_info` â†’ `item.status_changed:waiting_for_info`
  - `in_review` â†’ `item.status_changed:in_review`
  - any other status (e.g. `done`, `in_progress`) â†’ no external notification, in-app only.
- **Freedom-mode runs** (no item attached) emit an external notification under `agent.run_finished_no_item` for both success and error paths.
- **Errored runs** on item-attached agents emit under `agent.failed`.
- **Test Message** (`POST /api/settings/external-notification/test`) deliberately bypasses both checks â€” the Owner pressed Send Test, so a silent success would be indistinguishable from misconfiguration.

## Edge cases / quirks
- The header "last delivery" age uses `useNow` to tick every minute â€” UI updates without refetch.
- Marking all read does **not** mark externally delivered notifications as cancelled â€” it's a separate read-state field.
- Quiet hours hold external notifications only — in-app notifications and web push keep arriving.
- An off event toggle or an unconfigured channel leaves the row at `external_status='none'` — it never shows **Sent** unless a transport actually delivered. A quiet-hours send shows **Held** until the flush (2026-10-16; before, it was dropped to `none`).
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
