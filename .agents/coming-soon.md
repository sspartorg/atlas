# Coming Soon / Stubbed Features

Single source of truth for everything that currently lies about being functional. Every stub has: where it lives, what it claims to do, what's missing, and which page doc covers it.

When a stub is shipped (or removed), delete its row here AND update the page doc's "Coming soon on this page" section.

---

## UI elements that toast / disable instead of working

| Feature | Location (file:line) | Page doc | Trigger UI | What it should do | Blocking on |
|---|---|---|---|---|---|
| **Verify credential** | `pages/Credentials.tsx:96-100` and `CredentialRowMenu.tsx:70-85` | [`20-credentials`](pages/20-credentials.md) | Row menu â†’ "Verify now" | Call host (e.g. GitHub) with the stored token to confirm it's still valid + scoped | `POST /api/credentials/:id/verify` endpoint not implemented |
| **Check expiries (bulk)** | `pages/Credentials.tsx:203` | [`20-credentials`](pages/20-credentials.md) | Header button disabled with Tooltip "Coming soon" | Sweep all credentials, refresh expiry windows, surface upcoming expirations | Same backend gap as above |
| **SSH key credential** | `CredentialModal.tsx:278-306` | [`20-credentials`](pages/20-credentials.md) | Kind picker radio (disabled) | Add an SSH key as a credential kind | Backend support for ssh kind |
| **App password credential** | `CredentialModal.tsx:307-335` | [`20-credentials`](pages/20-credentials.md) | Kind picker radio (disabled) | Add Bitbucket-style app password | Backend support for app_password kind |
| **Bulk edit / assign on Project Detail** | `ProjectDetail.tsx` (stub toast routed from a modal trigger) | [`03-project-detail`](pages/03-project-detail.md) | "Bulk edit/assign" entry | Multi-select epics/stories from the Project Detail tabs and apply a batch status/assignee change | Not designed yet |
| **Prompt formatting toolbar** | `PromptTab.tsx:157-183` | [`16-agent-detail`](pages/16-agent-detail.md) | Toolbar icons not wired | Markdown formatting actions in the prompt editor | Editor library decision |
| **Save as run (Test Run tab)** | `TestRunTab.tsx:438-439` | [`16-agent-detail`](pages/16-agent-detail.md) | "Save as run" link â†’ toast "Save as run coming soon" | Persist a test run output as a real `agent_runs` row | Run-from-test API |
| **Test Run â€” full sandboxed prompt** | `TestRunTab.tsx` + `services/dry-run.ts` | [`16-agent-detail`](pages/16-agent-detail.md) | Currently sends only the workspace constitution + a 3-line verification ask via `POST /api/agents/:id/dry-run`. Real CLI launches; output streams; no DB write. | Also ship `agent.prompt_md`, handoff checklist, and a fixture issue context in a sandboxed mode that still skips `agent_runs` insert / status auto-advance / external notification. | Decide sandboxing semantics (separate code path vs. `test` flag on `agent-runner`); fixture-issue picker |
| **External notification Chat-ID detect** | `NotificationsTab.tsx:209-214` | [`19-settings`](pages/19-settings.md) | "Detect" button â†’ toast "Detection not yet wired" | Poll external notification `getUpdates()` and auto-fill chat id | `POST /api/settings/external-notification/detect-chat-id` endpoint |
| **Search â†’ "Create from search"** | `SearchEmptyState.tsx:131` | [`14-search`](pages/14-search.md) | "Create story/bug from search" toast in empty state | One-click create with prefilled fields | New issue creation hooks |
| **Search result navigation (bug / sub-task)** | `SearchResults.tsx:82-83` | [`14-search`](pages/14-search.md) | Clicking a bug/sub-task result falls back to `/issues` instead of detail | Navigate straight to `/issues/bugs/:id` etc. | Add the missing branches |

---

## Notes on simulated mode

`packages/api/src/services/agent-runner.ts:197` â€” when `ATLAS_AI_ENABLED !== 'true'`, agent-runner emits canned output instead of spawning the real CLI. The simulated `output_text` is prefixed with the literal marker `[SIMULATED â€” set ATLAS_AI_ENABLED=true to use real CLI]`. The UI surfaces this state in four places so it can never be mistaken for real output:

- A "Simulated" pill in the topbar when `ai_enabled === false` (visible across the whole app).
- A "Simulated" chip on the run-detail hero next to the status pill.
- A small "Simulated" chip next to each simulated row in the agent's Runs tab.
- A "Simulated" chip on the queue drawer's Currently Executing live log + Last Completed entries.

Detection lives at `packages/web/src/utils/isSimulatedRun.ts`: sniffs `output_text.startsWith('[SIMULATED')` for completed runs, falls back to the global `ai_enabled === false` flag for queued / in-progress runs without output yet. The flag is exposed at `GET /api/settings` (`ai_enabled: boolean`, sourced from `process.env.ATLAS_AI_ENABLED` at every read â€” never persisted).

This is intentional, not a stub; it's used so devs can play with the app without burning CLI credits. To use the real CLI: set `ATLAS_AI_ENABLED=true` in `packages/api/.env` and restart the API. New runs will spawn the real `claude` / `gh copilot` binary; old simulated runs keep their `[SIMULATED â€¦]` chip because the marker persists in their `output_text`.

---

## How to add a new entry here

1. Find or write the stub trigger in the UI.
2. Add a row to the table above with: feature name Â· file:line Â· page doc link Â· trigger description Â· intended behavior Â· what's blocking it.
3. Add a one-liner under the affected page doc's "Coming soon on this page" section that links back here.
