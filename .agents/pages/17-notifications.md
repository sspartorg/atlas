# Notifications

**Route:** `/notifications` â€¢ **Component:** `packages/web/src/pages/Notifications.tsx` â€¢ **Slug:** `guardrails` (mockups also live there)

## Purpose
Two-tab notifications hub. The **Notification Log** tab is the delivery queue (sent / failed / pending) with retry/cancel/resend controls. The **In-App Feed** tab lists `needs_you` / `update` / `system` items with row-click navigation.

## States
- Per-tab loading + empty + populated states (no page-level loading).
- A metadata subtitle line shows external notification channel status, bot username, and last delivery age.

## UI elements
**Page header**
- **Notification Settings** button (line 90) â†’ `/settings?tab=notifications`
- **Mark All Read** button (line 99) â†’ `markAllRead.mutate()` â†’ toast with count
- **Tabs** (controlled via `?tab=`): Notification Log (default) / In-App Feed

### Notification Log tab (`NotificationLogTab`)
- Filter pills: All / Sent / Failed / Pending (with counts)
- **Empty state**: "external notification Is Configured but Quiet" + **Send a Test Message** button (lines 438-534) â†’ `POST /api/settings/external-notification/test`
- Table columns:
  - Timestamp (time + relative day)
  - Event Type (icon + label + `event_type` code)
  - Item (`issue_id` + message; failure reason if failed)
  - Status badge: Sent / Failed / Pending
  - Action buttons per status:
    - Sent â†’ **Resend** (line 364) â†’ `POST /api/notifications/:id/resend`
    - Failed â†’ **Retry** (line 375) â†’ same endpoint
    - Pending â†’ **Cancel** (line 390) â†’ `POST /api/notifications/:id/cancel`

### In-App Feed tab (`InAppFeedTab`)
- Top alert when `needs_you > 0` ("{N} items need you. Click any rowâ€¦")
- Filter pills: All / Needs You / Updates / System
- Row layout: Agent chip (or Atlas badge) | Issue ID badge | Message | Issue type + failure reason | **Open** button (if `issue_id`) | relative time
- **Open** navigates to the matching detail (`/issues/stories/:id`, `/epics/:id`, or `/issues` fallback)

## Why these affordances exist
- **Two tabs (Notification Log / In-App Feed)** â€” Notification Log is the diagnostic surface; In-App is the unread inbox. Splitting them prevents diagnostics from drowning actionable items.
- **Per-row Resend / Retry / Cancel** â€” Notifications fail for transient reasons (network, rate-limits); row-level retry beats re-triggering the producing event.
- **Send a Test Message (empty state)** â€” External notification silence is ambiguous (working but quiet vs. misconfigured); the test resolves it.
- **Top alert for `needs_you > 0`** â€” Surfaces urgency without forcing a row scan; matches the dashboard's "awaiting you" signal.
- **Mark All Read** â€” In-app feeds accumulate update/system rows the Owner already saw elsewhere; bulk-clear avoids per-row dismissal.

## Modals / drawers
None.

## Hooks used
- `useNotifications()` (per-tab filters + counts)
- `useMarkAllRead`, `useResendNotification`, `useCancelNotification`
- `useAgents` (for agent chip resolution)
- `useNow` (60s tick for relative-time aging)

## API endpoints touched
- `GET /api/notifications?external_status=â€¦&limit=200`
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
  1. `settings.quiet_hours_enabled` â€” when `1`, no external notification is sent inside the configured `quiet_hours_from` / `quiet_hours_to` window. This applies to **every** external notification path (orchestrator, agent self-route, MCP-driven). When `0`, the time fields are ignored even if populated.
  2. Per-event toggle in `settings.external_notification_event_toggles` â€” covers four user-facing event keys (see Settings â†’ external notification).
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
- Quiet hours suppress external notifications only â€” in-app notifications keep arriving.

## Connectivity
- **Pages**: [Settings â†’ external notification](19-settings.md) â€” header CTA target for configuring the bridge; [Issues](08-issues.md) and [Epic Detail](07-epic-detail.md) â€” row "Open" navigation when the notification references an entity.
- **Routes**: `POST /api/notifications/:id/resend` â€” separate from the create path because resend preserves the original event metadata; re-creating would lose the audit trail.
- **Entities**: `notification`, `agent` (sender), `epic` / `story` / `bug` / `sub_task` / `sub_bug` (subject).

## Coming soon on this page
None.
