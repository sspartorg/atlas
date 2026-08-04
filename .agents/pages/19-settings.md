# Settings

**Route:** `/settings` • **Component:** `packages/web/src/pages/Settings.tsx` • **Slug:** `settings`

## Purpose
6-tab workspace configuration. Tab is URL-controlled via `?tab=profile|environment|secrets|models|notifications|help` (default `profile`). The legacy "Allowed Tools" tab was removed by B14 (`d3cc9bf`) — spawned CLIs now inherit Owner's user-level MCP config wholesale. Legacy `?tab=telegram` URLs redirect to `notifications` so old bookmarks still work.

## States
- **Loading**: page-level spinner while `useSettings().isLoading`
- **Populated**: tab bar + selected tab body

## Tab 1 — Profile (`ProfileTab`)
**Owner profile**
- **Display Name** TextField — `onBlur` → `useUpdateProfile.mutate({owner_name})` → toast "Display name updated"
- **Accent Color** picker — clickable swatches; commits via mutation → toast "Accent color updated"
- **Workspace Folder** — `FolderPicker`; commits via mutation → toast "Workspace folder updated"; shows yellow warning if `projectsCount > 0` ("Existing projects won't auto-migrate")

**Git credentials**
- **Manage Credentials →** link → `/settings/credentials`
- Status box: count + first 3 hosts (or "No credentials yet")

**Reset**
- **Reset Workspace** button → opens `ResetWorkspaceModal`

## Tab 2 — Environment (`EnvironmentTab`)
Info alert explains `.env` mirroring. Variable rows (`EnvVarRow`) show key + "RESTART" badge (if `restart_required`) + description + value field (masked when `secret`, Reveal/Copy toggles otherwise). **Save Changes** → `useUpdateEnv`. **Restart Server** opens a confirm dialog and hits `POST /api/server/restart`.

## Tab 3 — Model Registry (`ModelRegistryTab`)
Three `CliCard` sections (Claude / Copilot / Ollama), rendered from `AGENT_CLIS`. Each model row: `model_name` + optional note + Remove button. Add row commits via `useCreateCliModel` (Enter key in either input triggers Add). Remove opens a confirmation dialog (`ConfirmRemoveModelDialog`); only the confirm button fires `useRemoveCliModel`. Cancel/X close without mutation.

## Tab 4 — Notifications (`NotificationsTab`)
**External Notification Channel** — Atlas sends outbound alerts (reminder fires, agent completions, quiet-hours-respecting notifications) via a provider-agnostic abstraction. This tab is the single UI for picking the provider and filling in its credentials. The dispatcher (`packages/api/src/services/external-notifications.ts`) reads `settings.external_notification_provider` at send time and routes to the matching transport under `services/transports/`.

- **Provider** dropdown — currently supports **Telegram** and **Microsoft Teams**. Switching commits via `useUpdateExternalNotification.mutate({ external_notification_provider })`. The server clears `external_notification_last_test_ok` + `endpoint_label` so the connection pill flips back to Untested for the new transport.
- **Telegram provider fields** — **Bot Token** (masked, Reveal toggle) + **Chat ID**; both `onBlur` commit. Token is encrypted at rest via `settingsService.updateExternalNotificationToken` before storage.
- **Teams provider field** — **Webhook URL** (masked, Reveal toggle) `onBlur` commits; encrypted at rest with the same helper.
- Connection status pill: ok (green) / bad (red) / unknown (gray)
- **Send Test Message** → `POST /api/settings/external-notification/test` → invalidates settings + toast

**Microsoft Teams (Power Automate) flow setup**
Atlas's Teams transport POSTs a v1.4 Adaptive Card JSON object as the entire HTTP body — `packages/api/src/services/transports/teams.ts#buildAdaptiveCard`. The user's Power Automate flow has to deserialize that body and feed it to the `PostCardToConversation` action. Minimal working recipe:

1. **Trigger:** *When an HTTP request is received* — leave the request body schema blank (Power Automate accepts any JSON).
2. **Action 1:** *Initialize variable* — Name `Body`, Type `String`, Value `@{string(triggerBody())}`. (Stringify the WHOLE incoming object, not a sub-field — older guides that map `triggerBody()?['text']` break under the Adaptive Card payload.)
3. **Action 2:** *Post card in a chat or channel* (`PostCardToConversation`) — Post as: Flow bot, Post in: Group chat (or Channel), Recipient: the chat/channel ID, **Adaptive Card**: `@{variables('Body')}`.
4. Save the flow's HTTP POST URL into Settings → External Notification → Webhook URL and hit **Send Test Message**.

The card Atlas sends looks like this — paste into [adaptivecards.io/designer](https://adaptivecards.io/designer/) to preview/tweak:
```json
{
  "type": "AdaptiveCard",
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "version": "1.4",
  "body": [{ "type": "TextBlock", "text": "...", "wrap": true }]
}
```
`wrap: true` is required so multi-line auto-fetch/agent messages render with line breaks preserved. If the flow run fails with `AdaptiveSerializationException: Property 'type' must be 'AdaptiveCard'`, the Body variable is mapped to a sub-field instead of `string(triggerBody())` — fix step 2 of the recipe.

**Per-event notifications** — Switch per key in `EXTERNAL_NOTIFICATION_EVENT_KEYS`; commits → `useUpdateNotifications.mutate({ external_notification_event_toggles })`. Default ON.

**Quiet hours**
- **From** / **To** time inputs (HH:MM, monospace, max 120px)
- **Time Zone** read-only (`settings.quiet_hours_timezone ?? detectedTimezone`)
- On first load, if timezone unset, the page auto-saves the detected timezone.

## Tab 5 — Help & About (`HelpAboutTab`)
**About Atlas** — app version + repository link. **Report a bug** — surfaces the current `ATLAS_FEEDBACK_URL` (from `useEnv()`), an **Open GitHub Issues** button (falls back to the hardcoded upstream URL if the env var is blank), and a **Restore recommended URL** button that PATCHes `/api/settings/env` with the default `https://github.com/sspartorg/atlas/issues`.

The same feedback URL powers the **Report a bug** link in the sidenav footer (`packages/web/src/components/ReportBugLink.tsx`), so this tab and the sidenav share one env var.

## Why these affordances exist
- **`onBlur` save on Profile** — Per-field commit feels instantaneous and removes the "remember to click Save" tax common in settings pages.
- **Workspace folder warning when `projectsCount > 0`** — Moving the workspace abandons cloned repos; the warning forces the Owner to acknowledge the migration cost before submitting.
- **Restart Server** — Several env vars are read once at boot (DB path, port); without a one-button restart the Owner has to remember a shell command to apply the new value.
- **Model Registry editable** — Models change faster than the app releases; pre-validating here means agent pickers never offer an unsupported value.
- **Send Test Message (external notification)** — External notification silently fails (token revoked, chat-id changed); the test turns "is it working?" into a deterministic check.
- **Reset Workspace** — Hard recovery for "everything is wrong"; gated behind a typed phrase because it's destructive and irreversible.

## Modals / drawers
- `ResetWorkspaceModal` — requires typing "RESET"; on confirm → `POST /api/settings/reset` → redirects to `/`. Reset wipes user data (projects, items, agents, credentials, retired prefixes, comments, notifications, runs) and resets `settings` to defaults; reference seed data (`cli_models`, `tool_catalog`, `guardrail_rules`) is preserved so onboarding works.
- **Restart Server** confirm dialog (Environment tab).
- `ConfirmRemoveModelDialog` — Model Registry remove-button companion; busy state disables Cancel/X while `useRemoveCliModel` is pending.

## Hooks used
- `useSettings`, `useUpdateProfile`
- `useEnv`, `useUpdateEnv`, `useRestartServer`
- `useCliModels`, `useCreateCliModel`, `useRemoveCliModel`
- `useUpdateExternalNotification`, `useUpdateNotifications`
- `useCredentials` (Profile tab)
- `useProjects` (for the workspace-change warning)
- `useToast`

## API endpoints touched
- `GET/PATCH /api/settings`
- `GET/PATCH /api/settings/env`
- `POST /api/server/restart`
- `GET/POST/DELETE /api/cli-models`
- `PATCH /api/settings/external-notification`, `POST /api/settings/external-notification/test`
- `PATCH /api/settings/notifications`
- `POST /api/settings/reset`

## Permissions / guards
- Post-onboarding only.
- **Reset Workspace** is destructive and requires explicit confirmation phrase.

## Edge cases / quirks
- Quiet hours support cross-midnight ranges (e.g., 22:00 → 08:00).
- External-notification test result persists in settings (`external_notification_last_test_ok`); reload preserves the connection pill state.
- Editing token or chat_id resets the pill to "Untested" on the server side.

## Connectivity
- **Pages**: [Credentials](20-credentials.md) — Profile tab links here; [Notifications](17-notifications.md) — Notifications tab edits what that page consumes; [Agents](15-agents.md) — Model Registry feeds its dropdowns.
- **Routes**: `POST /api/settings/reset` — destructive workspace nuke, gated behind a typed phrase; `POST /api/server/restart` — exits the process expecting a supervisor (nodemon/PM2) to relaunch, the only mechanism to apply restart-required env changes.
- **Entities**: `settings` (single row), `cli_model`.

## Coming soon on this page
- External-notification Chat-ID detect — see [coming-soon.md](../coming-soon.md).
