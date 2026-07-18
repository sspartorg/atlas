# Reminders

**Route:** `/reminders` â€¢ **Component:** `packages/web/src/pages/Reminders.tsx` â€¢ **Sidenav:** under ALERTS & ADMIN.

## Purpose
One-page reminder list with create + cancel. Reminders fire as in-app notifications and (optionally) external notifications, on the same per-minute scheduler as agents. Single-section page with an Active list and an optional History section behind a toggle.

## States
- Loading (single spinner before first list).
- Empty â€” Hero empty state (`HeroEmptyState`) "No active reminders" with a one-line nudge: "Use New reminder to add one yourself, or ask Claude to set one for you."
- Populated â€” list of reminder rows.
- History toggle off by default; turning it on reveals a "History" subsection with cancelled + completed rows in a muted background.

## UI elements
**Page header**
- **Refresh** button (`RefreshButton`) â†’ refetch.
- **Show history** switch â†’ toggles the History subsection.
- **New reminder** button (line 122) â†’ opens `NewReminderModal`.

**Reminder row (`ReminderRow`)**
- Label (bold) + optional body (subtitle, single-line ellipsis).
- Schedule kind chip (`once` / `daily` / `weekly` / `cron`) + human-formatted schedule (`formatSchedule()` at line 377).
- Channel icon: notification bell, external notification send icon, or both.
- Relative next-fire time (`relativeFromNow()` at line 404; tooltip carries the absolute timestamp).
- Status chip: `active` (green) / `paused` (amber) / `cancelled` (rose) / `completed` (blue).
- **Cancel** icon button â€” only on `active` or `paused` rows in the Active list, never in History.

## Why these affordances exist
- **Single-page list (no tabs)** â€” reminders are flatter than notifications; one Active + collapsible History keeps the surface minimal.
- **Schedule kinds shown verbatim with a helper for cron** â€” `cron` reminders keep the raw expression so the Owner can copy/edit; the other kinds get a human-readable line.
- **Cancel is per-row + irreversible** â€” confirm dialog warns: "You can't restore it â€” set a new reminder if you need it again." History is the audit trail.
- **Owner + MCP both create** â€” `New reminder` modal is for the Owner; the MCP tool `setReminder` is for Claude sessions doing it on the Owner's behalf.

## Modals / drawers
- `NewReminderModal` (`pages/reminders/NewReminderModal.tsx`) — form with the following fields (Updated 2026-07-01: corrected from stale “title + cron” description):
  - **Label** (required text field, max 200 chars) — not “title”
  - **Body** (optional multiline text)
  - **Schedule** — 4-way `RadioGroup`: `Once` / `Daily` / `Weekly` / `Cron`. A context-sensitive sub-field appears below the radio buttons depending on the selected kind:
    - `Once` → `datetime-local` picker (“When”)
    - `Daily` → time picker (“Time”)
    - `Weekly` → time picker + weekday checkboxes (Mon–Sun)
    - `Cron` → free-text cron expression field (only appears when Cron is selected)
  - **Channel** — `RadioGroup`: In-app / External Notification / Both
  - Modal also doubles as an **edit** modal: when `editing` prop is set it hydrates from the existing row and dispatches `PATCH` instead of `POST`.
- Cancel-confirmation `Dialog` inline at lines 168-198.

## Hooks used
- `useReminders()` â€” list query (`['reminders']`).
- `useCreateReminder()` â€” create mutation (invalidates list on success).
- `useCancelReminder()` â€” cancel mutation (invalidates list on success).
- `useSetPageTitle('Reminders')`.
- `useToast()` â€” success / failure feedback on cancel.

## API endpoints touched
- `GET /api/reminders` â€” list.
- `POST /api/reminders` â€” create (gated by `requireMcpToken`).
- `DELETE /api/reminders/:id` â€” cancel (gated by `requireMcpToken`).

## MCP tools that touch this page
- `listReminders` â€” read.
- `setReminder` â€” create (Claude can ask the Owner to set one, or Owner can ask Claude).
- `cancelReminder` â€” cancel by id.

## Permissions / guards
- Post-onboarding only.
- Cancel is no-op for `cancelled` / `completed` rows (button hidden).

## Edge cases / quirks
- `next_fire_at` uses `tabular-nums` so the column doesn't shift between rows.
- The per-minute scheduler is the same one that fires agent runs â€” a reminder firing doesn't block agent dispatch and vice versa.
- The `formatSchedule()` helper is also exported and reused in `NewReminderModal`'s preview row.

## Connectivity
- **Pages**: [Notifications](17-notifications.md) â€” where reminder-fires land (in-app feed + Notification Log); [Settings â†’ external notification](19-settings.md) â€” required for the external notification channel to deliver.
- **Routes**: the create + cancel routes are gated by `requireMcpToken`; the list route is open.
- **Entities**: `reminder`, `notification` (one is produced per fire).

## Coming soon on this page
None.
