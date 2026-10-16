# Reminders

**Route:** `/reminders` • **Component:** `packages/web/src/pages/Reminders.tsx` • **Sidenav:** under ALERTS & ADMIN.

## Purpose
One-page reminder list with create, edit, pause / resume, snooze, cancel and delete. Reminders fire as in-app notifications and (optionally) external notifications, on the same per-minute scheduler as agents. Daily, weekly and cron schedules run in the Owner's time zone (`settings.quiet_hours_timezone`, the browser zone Settings auto-saves; the subtitle names it, or "server time" when unset). Active list always; History behind a toggle.

## States
- Loading: skeleton rows (`aria-busy`) before the first list; a skeleton while history loads.
- Error: `Alert` "Could not load reminders: <message>" (history: "Could not load history: …") — before 2026-10-16 a failed load showed the "No active reminders" hero.
- Empty — Hero empty state (`HeroEmptyState`) "No active reminders" with "Use New reminder to add one yourself, or ask Claude to set one for you."
- Populated — active + paused reminders (`GET /api/reminders?status=active,paused`).
- History toggle off by default. On: a "History" region (always, once on — "No finished reminders yet." under the section's description when empty) with cancelled + completed rows, most recently finished first, fetched only then (`?status=cancelled,completed&limit=50&offset=N`), with **Show more history** while a full page came back.

## UI elements
**Page header**
- **Refresh** (`RefreshButton`) → refetch the live list (and history when shown).
- **Show history** switch → toggles (and lazily loads) the History region. On phones its visible label is the shorter "History" (accessible name stays "Show history") so Refresh + the switch fit on the title's row; the subtitle runs full width below (`PageHeader`).
- **New reminder** button (desktop) / FAB (mobile) → `NewReminderModal`.

**Reminder row (`ReminderRow`)** — desktop (md+): one grid line — label (+ body), schedule chip + human schedule (`formatSchedule()`), channel icons, time line, status chip, ⋮. Below md: a card — row 1 label (2-line clamp) + status chip; row 2 schedule chip + schedule + channel icons; row 3 time line (+ expand chevron on history) + ⋮, with 32px reserved on the right so the ⋮ (pinned 8px in) never touches the chevron. No spacer boxes. Cards sit 8px apart; on phones the page keeps room under the last card for the FAB.
- Status chip: neutral fill + a coloured dot from `STATUS_PALETTE` (active = done green, paused = waiting amber, completed = ready blue, cancelled = draft grey) — works in both themes and meets AA.
- Every absolute time on the page — the Time line tooltip, "Once on …", the fire log — is in the **Owner zone** (`settings.quiet_hours_timezone`), not the browser's (`formatAt`). Relative times tick every minute (`useNow`), and an open page refreshes when a reminder fires (`notification_created` invalidates `['reminders']`).
- Time line (mono): active "Next in 3h"; paused "Paused · last fired 2h ago" / "Paused · never fired"; history "Completed 3d ago · fired 4×" / "Cancelled 2h ago · last fired 1d ago" (never a stale next-fire). Tooltip = absolute time.
- **History section**: set off from the live list by a divider, with a "History" heading and the line "Cancelled and completed reminders. Open one to see when it fired." History rows sit on the page surface (`ATLAS_PALETTE.pageBg`) at full opacity. Tapping one (a button with `aria-expanded`) expands an inline **fire log**, lazy-loaded from `GET /api/reminders/:id/fires`: one entry per fire, separated by hairlines — the time on line 1, then **Push …** and **External …** status chips (sent green, failed red, held / sending amber, off grey) on line 2; a failed external send adds its reason in red, clamped to two lines — tap it (a button with `aria-expanded`) for the rest. Fires from before the log existed aren't listed.
- **⋮ menu** (`Actions for <label>`), only the valid items: Edit (active/paused) · Pause (active) / Resume (paused) · Snooze 10 minutes / 1 hour / until tomorrow 9:00 (active, paused, completed — snoozing a completed one-shot revives it) · Cancel reminder (active/paused) · Delete (cancelled/completed).
- "Tomorrow 9:00" is 9:00 in the Owner's zone (`pages/reminders/snooze.ts`).

## Why these affordances exist
- **Single-page list (no tabs)** — one Active list + an on-demand History keeps the surface minimal and keeps history off the first load.
- **Schedule kinds shown verbatim with a helper for cron** — `cron` reminders keep the raw expression; other kinds get a human line.
- **Cancel is soft, Delete is hard** — Cancel keeps the row as history (confirm: "It will stop firing and move to history…"); Delete removes a finished row for good (confirm: "It will be removed from history for good. Notifications it already sent stay in your feed.").
- **Owner + MCP both act** — the page for the Owner; `crud_reminder` / `search_reminder` for Claude.

## Modals / drawers
- `NewReminderModal` (`pages/reminders/NewReminderModal.tsx`), mounted only while open:
  - **Label** (required, max 200, counter "N/200"; Create is disabled while it is blank) · **Body** (optional) · **Schedule** `Once` (datetime-local, read as wall time **in the Owner zone**, helper "In <zone>") / `Daily` (time) / `Weekly` (time + weekdays) / `Cron` (expression) · **Channel** In-app / External Notification / Both.
  - Validation (`role=alert` under the form): "Pick a date and time.", "Pick a time in the future." (a past Once), "Pick a time.", "Pick at least one weekday.", "Enter a cron expression."; a cron the server rejects shows its 400 reason ("Invalid cron expression \"…\": …"). **External Notification** alone means no in-app feed card: the fire's row is log-only (`in_app=false`) — on the Notification Log and the fire log, not the feed, the unread badge or web push.
  - Focus lands on **Label** when it opens (the dialog's focus trap used to leave it on the paper, so a keyboard user had to Tab in).
  - Doubles as the **edit** modal (`editing` prop → `PATCH`).
- Cancel and Delete confirmation dialogs (`ConfirmDialog` in `Reminders.tsx`).

## Hooks used
- `useReminders()` — live list (`['reminders','live']`, `status=active,paused`).
- `useReminderHistory(enabled)` — infinite query (`['reminders','history']`, 50 per page).
- `useReminderFires(id, enabled)` — fire log (`['reminders', id, 'fires']`).
- `useCreateReminder()`, `useUpdateReminder()`, `useCancelReminder()`, `useSetReminderPaused()`, `useSnoozeReminder()`, `useDeleteReminder()` — all invalidate `['reminders']`.
- `useSettings()` (Owner zone), `useIsMobile()`, `useToast()`, `useSetPageTitle('Reminders')`.

## API endpoints touched
- `GET /api/reminders?status=…&limit=&offset=` — lists.
- `GET /api/reminders/:id/fires` — fire log.
- `POST /api/reminders` — create. `PATCH /api/reminders/:id` — edit / pause / resume.
- `POST /api/reminders/:id/snooze` — snooze.
- `DELETE /api/reminders/:id` — cancel; `DELETE /api/reminders/:id?hard=1` — delete (409 unless cancelled/completed).

## MCP tools that touch this page
- `search_reminder` — read.
- `crud_reminder` — `op: create | update | cancel | pause | resume | snooze` (snooze takes `minutes`).

## Also on the Notifications page
- An external-only reminder's fires show on the Notification Log tab only (held / sent / failed like any outward send), not in the In-App Feed.
- An in-app feed card for a reminder fire (`notifications.reminder_id` set) carries a **Snooze reminder** button instead of the chevron: the same three snooze choices plus **Open Reminders**. Snoozing marks the card read. The card itself isn't a button there (it holds one). Older reminder rows without `reminder_id` stay plain link cards.

## Permissions / guards
- Post-onboarding only.
- Writes are gated by `requireMcpToken` (trusted browser origins pass).
- Only `active` rows fire; paused rows are skipped and the claim CAS also requires `status='active'`.

## Edge cases / quirks
- A reminder has no event key, so Settings → Notifications toggles never hold back or skip its external send; only quiet hours delay it.
- Resume recomputes `next_fire_at` from now — slots missed while paused are not replayed.
- A snoozed recurring reminder fires once at the snooze time, then returns to its schedule.
- A reminder firing doesn't block agent dispatch and vice versa (same minute tick).
- `formatSchedule(r, zone)` is exported for the unit tests; the modal has no preview row.

## Connectivity
- **Pages**: [Notifications](17-notifications.md) — where fires land (feed + log; feed cards can snooze); [Settings → Notifications](19-settings.md) — the Owner time zone and the external channel.
- **Entities**: `reminder`, `notification` (one per fire, linked by `reminder_id`).

## Coming soon on this page
None.
