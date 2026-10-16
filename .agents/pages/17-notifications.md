# Notifications

**Route:** `/notifications` â€¢ **Component:** `packages/web/src/pages/Notifications.tsx` â€¢ **Slug:** `guardrails` (mockups also live there)

## Purpose
Two-tab notifications hub. The **Notification Log** tab is the delivery queue (sent / failed / pending) with retry/cancel/resend controls. The **In-App Feed** tab lists `needs_you` / `update` / `system` items with row-click navigation.

## States
- Per-tab loading + empty + populated states (no page-level loading).
- A metadata subtitle line shows external notification channel status, bot username, and last delivery age.

## UI elements
**Page header**
- **Refresh** icon button → invalidates notifications, agents, settings
- **Notification Settings** button → `/settings?tab=notifications`
- **Mark All Read** button → `markAllRead.mutate()` → toast with count
- On phones (`useIsMobile()`, below `md`) the three actions are icon-only `IconButton`s with a Tooltip + `aria-label` (`Refresh notifications`, `Notification settings`, `Mark all read`), all on one row.
- **Tabs** (controlled via `?tab=`): Notification Log (default) / In-App Feed
- **Load more** (below either tab, only while the last page came back full): both tabs read one feed, 200 rows a page (`useNotificationFeed`, `useInfiniteQuery`); the button fetches the next 200 with `?before=<last id>`.

### Notification Log tab (`NotificationLogTab`)
- Filter pills: All / Sent / Failed / Pending (with counts), in one row that scrolls sideways instead of wrapping (`PillRow`, `role="group"` "Filter deliveries"). Pending counts held rows too.
- **Empty state**: "external notification Is Configured but Quiet" + **Send a Test Message** button (lines 438-534) â†’ `POST /api/settings/external-notification/test`
- Table columns:
  - Timestamp (time + relative day)
  - Event Type (icon + label + `event_type` code)
  - Item (`issue_id` + message; failure reason if failed)
  - Status badge: Sent / Failed / Pending, or **Held · quiet hours** (clock glyph) with `sends HH:MM` under it when `external_deferred_at` is set — the planned time is `settings.quiet_hours_to`
  - Action buttons per status:
    - Sent â†’ **Resend** (line 364) â†’ `POST /api/notifications/:id/resend`
    - Failed â†’ **Retry** (line 375) â†’ same endpoint
    - Pending (held or in flight) â†’ **Cancel** → `POST /api/notifications/:id/cancel`
- **Phones**: one `NotificationCard` per row (`pages/notifications/NotificationCard.tsx`), a 3-zone grid shared with the feed: fixed 32px event icon · middle (event label + status chip on one line, message clamped to 2 lines, mono meta `item id · time · day[ · sends HH:MM]`, failure reason on its own clamped line) · fixed 40px action (Resend / Retry / Cancel). A held card has a gold edge bar.

### In-App Feed tab (`InAppFeedTab`)
- Top alert when `needs_you > 0` ("{N} items need you. Click any rowâ€¦")
- Filter pills: All / Needs You / Updates / System — same sideways-scrolling `PillRow` ("Filter notifications")
- Each row is a `NotificationCard` (all widths): event icon (`EventTypeIcon`) · event label + **Needs you** chip, message (2 lines), mono meta `item id · type · agent · age` · chevron. Unread rows have a blue edge bar. The card is a focusable `role="button"` (Enter/Space open it).
- Clicking marks it read and opens `notificationLinkUrl(row)` (@atlas/shared) — the same chain the web-push click uses: stored `link_url` → `/tasks/:id` · `/sub-tasks/:id` → `/reminders` → `/settings?tab=jira` → `/projects/:id` → `/notifications`. Producers stamp `link_url` at create time (workflow runs `/workflows/:id/runs/:runId`, standalone agent runs `/agents/:id/runs/:runId`, terminal `/terminal/:id`; migration 010 backfilled older rows).
- A reminder card whose row carries `reminder_id` (fires since migration 011) swaps the chevron for a **Snooze reminder** button: Snooze 10 minutes / 1 hour / until tomorrow 9:00 (Owner zone) + **Open Reminders**. Snoozing marks it read. The card itself isn't clickable then (no button inside a button). See [Reminders](21-reminders.md).
- `EventTypeIcon` has an entry per produced `event_type`: `workflow_run`, `agent_completed(_no_item)`, `agent_error(_no_item)`, `ci_failed`, `reminder`, `jira_sync`, `terminal.waiting_for_input`, `autofetch_*` (success/skipped/failed/conflict/disabled). Fills are theme soft tokens, so they flip with dark mode.

## Why these affordances exist
- **Two tabs (Notification Log / In-App Feed)** â€” Notification Log is the diagnostic surface; In-App is the unread inbox. Splitting them prevents diagnostics from drowning actionable items.
- **Per-row Resend / Retry / Cancel** â€” Notifications fail for transient reasons (network, rate-limits); row-level retry beats re-triggering the producing event.
- **Send a Test Message (empty state)** â€” External notification silence is ambiguous (working but quiet vs. misconfigured); the test resolves it.
- **Top alert for `needs_you > 0`** â€” Surfaces urgency without forcing a row scan; matches the dashboard's "awaiting you" signal.
- **Mark All Read** â€” In-app feeds accumulate update/system rows the Owner already saw elsewhere; bulk-clear avoids per-row dismissal.

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
- **In-app notifications are always created** for every run completion (item-attached or freedom-mode, success or error). They appear in the In-App Feed regardless of any toggle. The "always published" invariant.
- **external notification delivery is gated by two checks:**
  1. Per-event toggle in `settings.external_notification_event_toggles` (see Settings → Notifications). Off → the row stays `none`.
  2. `settings.quiet_hours_enabled` — when `1`, a send inside the `quiet_hours_from` / `quiet_hours_to` window is **held** (`pending` + `external_deferred_at`) and the minute tick sends it once the window ends, prefixed `Held during quiet hours · HH:MM`. Nothing is dropped. `from == to` means no window. The row-less MCP `send-external` passthrough is the one path quiet hours still drop (there is no row to hold).
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
- Clicking a web-push notification marks it read (`sw.js` → `POST /api/notifications/:id/read`) before navigating.
- A `needs_you` completion row (`event_type='agent_completed'`) drops out of the In-App Feed and the unread count once its item leaves `waiting_for_info` / `in_review`. `agent_error`, terminal-idle, and item-less `needs_you` rows are unaffected.

## Connectivity
- **Pages**: [Settings â†’ external notification](19-settings.md) â€” header CTA target for configuring the bridge; [Task Detail](07-task-detail.md) and [Sub-task Detail](10-sub-task-detail.md) â€” row "Open" navigation when the notification references an item.
- **Routes**: `POST /api/notifications/:id/resend` â€” separate from the create path because resend preserves the original event metadata; re-creating would lose the audit trail.
- **Entities**: `notification`, `agent` (sender), `task` / `sub_task` (subject).

## Coming soon on this page
None.
