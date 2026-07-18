# Glossary

Domain terms used throughout Atlas. One line each. When in doubt, this file wins over assumptions from training data.

| Term | Meaning |
|---|---|
| **Owner** | The single human running the app. Implicit â€” there is no users table. Defaults to the name typed in onboarding. Agents escalate to Owner only. |
| **Agent** | An AI agent profile: a CLI choice (`claude` / `copilot`), a model, a prompt (`prompt_md`), and configured handoff rules + allowed tools. 10 are seeded across 4 categories. |
| **Agent category** | One of `software-dev | marketing | content | design`. Drives card grouping on the Agents page. |
| **CLI** | The actual command-line tool an agent invokes â€” `claude` (Anthropic) or `copilot` (GitHub). Mapped in `agent-runner.ts`. |
| **Model** | A model identifier registered under a CLI (e.g., `claude-opus-4-7`, `gpt-5.5-coder`). Maintained in Settings â†’ Model Registry. Only registered models appear in agent pickers. |
| **Framework** | A label on each agent indicating its operating style (e.g., "Anthropic PO Framework"). Influences prompt assembly. Does not change behavior on its own. |
| **Epic** | Top-level work unit, scoped to a Project. The assigned agent (PO Writer by default; any agent the Owner picks on the New Epic page) breaks it into Stories. Agent narrative lands in the comments thread (one auto-comment per agent persona at run end). |
| **Story** | Child of an Epic. Carries a spec (`spec_md`), acceptance criteria, optional PR URL, points, and the full status machine. |
| **SubTask** | Child of a Story. Uses a simpler 4-state machine: `ready â†” in_progress â†” done` plus `blocked`. |
| **SubBug** | A defect found while working on a Story; child of the Story. Uses the same status machine as Story/Bug (minus `in_spec`). |
| **Bug** | A standalone defect on a Project (not necessarily under any Story). Has body fields rendered by `BugBodyCards`. |
| **Run** | One invocation of an Agent on an Issue. Stored in `agent_runs`. Has status (`queued | running | completed | failed | cancelled`). |
| **Queue** | The set of pending and in-flight runs across all agents. Surface lives at `/queue`. |
| **Guard-rail** | A safety rule. Two scopes: workspace-wide (`guardrails` table, `/guardrails` page) and per-project (`project_guardrails` table, surfaced on the Project Detail â†’ Guard-rails tab). |
| **Severity (guard-rail)** | `block` (agent must refuse), `ask_owner` (agent must ping you first), `warn` (agent proceeds but flags). |
| **Constitution** | Markdown blob in `settings.constitution_md` â€” a workspace-wide preamble injected into every agent's prompt. Edited in Settings. |
| **Quiet hours** | A daily window during which external notification deliveries are batched into a 09:00 digest instead of fired immediately. Configured per workspace in Settings â†’ external notification. |
| **Handoff** | An agent's exit logic: a free-form prompt + a checklist + two routes (all-checks-pass / any-check-fail â†’ which agent to assign to, which status to set). Edited in Agent Detail â†’ Handoffs. |
| **Allowed tools** | The set of MCP/tool names an agent is permitted to call. Edited per-agent in Agent Detail â†’ Allowed Tools; viewed cross-agent (read-only) in Settings â†’ Allowed Tools. |
| **Tool catalog** | The list of tools the system knows about, with descriptions, grouped (e.g., Files, API, Database). Seeded in `db/seed.ts`. |
| **Auto-fetch** | A scheduled `git fetch` per project. Configured via the AutoFetchScheduleModal; jobs registered in `services/schedule-registry.ts`. |
| **Conflict policy / dirty guard / idle guard / agents guard** | Per-schedule rules that decide whether to skip a fire if the worktree is dirty / an agent is running / etc. |
| **Reclone** | Wipe the worktree and re-clone the same git URL with the same credential. Useful after auth-credential rotation. |
| **Workspace** | The root folder selected during onboarding. Holds the SQLite DB (`atlas.db`) and every project's worktree. |
| **ATL-001** (and similar) | Stable display IDs computed from creation order. Used in headers and tables. Format: `ATL-` for projects, `EPC-` for epics, `STR-` for stories, etc. |
| **AppShell** | The post-onboarding layout: Sidenav (left) + Topbar (top) + Outlet for the routed page. Lives in `App.tsx`. |
| **In-app feed** | Notifications surfaced inside the app (`/notifications` â†’ In-App tab). Separate stream from external notification deliveries. |
| **`waiting_for_info`** | Status used when an agent is blocked on Owner input. Reachable from any non-terminal state on Story/Bug/Epic/SubBug. |
| **`ATLAS_AI_ENABLED`** | Env flag. When not `true`, `agent-runner.ts` emits canned output instead of spawning a real CLI â€” used for dev without CLI cost. |
