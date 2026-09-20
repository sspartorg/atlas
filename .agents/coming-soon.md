# Coming Soon / Stubbed Features

Single source of truth for everything that currently lies about being functional. Every stub has: where it lives, what it claims to do, what's missing, and which page doc covers it.

When a stub is shipped (or removed), delete its row here AND update the page doc's "Coming soon on this page" section.

---

## UI elements that toast / disable instead of working

| Feature | Location (file:line) | Page doc | Trigger UI | What it should do | Blocking on |
|---|---|---|---|---|---|
| **SSH key credential** | `CredentialModal.tsx:278-306` | [`20-credentials`](pages/20-credentials.md) | Kind picker radio (disabled) | Add an SSH key as a credential kind | Backend support for ssh kind |
| **App password credential** | `CredentialModal.tsx:307-335` | [`20-credentials`](pages/20-credentials.md) | Kind picker radio (disabled) | Add Bitbucket-style app password | Backend support for app_password kind |
| **Prompt formatting toolbar** | `PromptTab.tsx:157-183` | [`16-agent-detail`](pages/16-agent-detail.md) | Toolbar icons not wired | Markdown formatting actions in the prompt editor | Editor library decision |
| **Save as run (Test Run tab)** | `TestRunTab.tsx:438-439` | [`16-agent-detail`](pages/16-agent-detail.md) | "Save as run" link â†’ toast "Save as run coming soon" | Persist a test run output as a real `agent_runs` row | Run-from-test API |
| **Test Run â€” full sandboxed prompt** | `TestRunTab.tsx` + `services/dry-run.ts` | [`16-agent-detail`](pages/16-agent-detail.md) | Currently sends only the workspace constitution + a 3-line verification ask via `POST /api/agents/:id/dry-run`. Real CLI launches; output streams; no DB write. | Also ship `agent.prompt_md`, handoff checklist, and a fixture issue context in a sandboxed mode that still skips `agent_runs` insert / status auto-advance / external notification. | Decide sandboxing semantics (separate code path vs. `test` flag on `agent-runner`); fixture-issue picker |
| **Search → "Create from search"** | `Search.tsx:138-140` (`createType`) | [`14-search`](pages/14-search.md) | Empty state's **Create a Task / Sub-task** button → toast "Create from search is not wired up yet." | One-click create with prefilled fields | New item creation from search |

---

## Notes on simulated mode

`packages/api/src/services/agent-runner.ts:197` â€” when `ATLAS_AI_ENABLED !== 'true'`, agent-runner emits canned output instead of spawning the real CLI. The simulated `output_text` is prefixed with the literal marker `[SIMULATED â€” set ATLAS_AI_ENABLED=true to use real CLI]`. The UI surfaces this state in three places so it can never be mistaken for real output:

- A "Simulated" pill in the topbar when `ai_enabled === false` (visible across the whole app).
- A "Simulated" chip on the run-detail hero next to the status pill.
- A small "Simulated" chip next to each simulated row in the agent's Runs tab.

Detection lives at `packages/web/src/utils/isSimulatedRun.ts`: sniffs `output_text.startsWith('[SIMULATED')` for completed runs, falls back to the global `ai_enabled === false` flag for queued / in-progress runs without output yet. The flag is exposed at `GET /api/settings` (`ai_enabled: boolean`, sourced from `process.env.ATLAS_AI_ENABLED` at every read â€” never persisted).

This is intentional, not a stub; it's used so devs can play with the app without burning CLI credits. To use the real CLI: set `ATLAS_AI_ENABLED=true` in `packages/api/.env` and restart the API. New runs will spawn the real `claude` / `gh copilot` binary; old simulated runs keep their `[SIMULATED â€¦]` chip because the marker persists in their `output_text`.

---

## How to add a new entry here

1. Find or write the stub trigger in the UI.
2. Add a row to the table above with: feature name Â· file:line Â· page doc link Â· trigger description Â· intended behavior Â· what's blocking it.
3. Add a one-liner under the affected page doc's "Coming soon on this page" section that links back here.

---

## Sweep — 2026-09-20 (campaign task-21)

Four rows were **deleted, not re-dated**: *Verify credential*, *Check expiries (bulk)*, *Bulk edit / assign on Project Detail* and the external-notification *Chat-ID detect* button. None of those controls exists in the source any more — they were **removed**, not deferred, and their `Location` columns pointed at code that had moved on. `CredentialRowMenu.tsx:14-23` now has exactly Edit and Delete; `Credentials.tsx:182-194` has only Add credential.

This is the sweep `conventions.md` prescribes when a UI file is deleted, and it had not been run — the same drift the B14 autonomous-tab rip-out produced. A stale row here is worse than a missing one: the triage rule tells a tester *"a stub is not a bug"*, so a row for a deleted control teaches them to ignore a real absence.

**6 rows remain.** Anything citing this file's count should use that number, not the "eleven" several docs still repeat.
