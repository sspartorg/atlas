# Glossary

Domain terms used throughout Atlas. One line each. When in doubt, this file wins over assumptions from training data.

| Term | Meaning |
|---|---|
| **Owner** | The single human running the app. Implicit — there is no users table. Defaults to the name typed in onboarding. Workflows escalate (park) to the Owner only; agents never route items. |
| **Agent** | An AI worker profile: a CLI choice (`claude` / `copilot` / `ollama`), model, effort, prompt (`prompt_md`), memory and checklists. Carries no schedule, routing or git flags (ADR 0014) — it runs only as a workflow step or an ad-hoc run. Installed from the marketplace catalog; none are seeded. |
| **Agent category** | One of `software-dev | marketing | content | design`. Drives card grouping on the Agents page. |
| **CLI** | The command-line tool an agent invokes â€” `claude` (Anthropic), `copilot` (GitHub), or `ollama`. Mapped in `agent-runner.ts`. `ollama` is not a separate binary: it runs Claude Code against Ollama's Anthropic-compatible API on `ATLAS_OLLAMA_BASE_URL` (default `http://localhost:11434`), so it shares Claude's argv, transcripts, and resume behaviour and costs $0. See **CLI dialect**. |
| **CLI dialect** | Which binary + argv shape a `cli` value actually speaks â€” `claude` or `copilot`. `CLI_DIALECT` in `@atlas/shared` maps `ollama â†’ claude`. Always branch on the dialect, never on the raw `cli` value, or Ollama silently falls into the Copilot path. |
| **Model** | A model identifier registered under a CLI (e.g., `claude-opus-4-7`, `gpt-5.5-coder`). Maintained in Settings â†’ Model Registry. Only registered models appear in agent pickers. |
| **Framework** | A label on each agent indicating its operating style (e.g., "Anthropic PO Framework"). Influences prompt assembly. Does not change behavior on its own. |
| **Epic** | Top-level work unit, scoped to a Project. The assigned agent (PO Writer by default; any agent the Owner picks on the New Epic page) breaks it into Stories. Agent narrative lands in the comments thread (one auto-comment per agent persona at run end). |
| **Story** | Child of an Epic. Carries a spec (`spec_md`), acceptance criteria, optional PR URL, points, and the full status machine. |
| **SubTask** | Child of a Story. Uses a simpler 4-state machine: `ready â†” in_progress â†” done` plus `blocked`. |
| **SubBug** | A defect found while working on a Story; child of the Story. Uses the same status machine as Story/Bug (minus `in_spec`). |
| **Bug** | A standalone defect on a Project (not necessarily under any Story). Has body fields rendered by `BugBodyCards`. |
| **Run** | One invocation of an Agent. Stored in `agent_runs`. Status `queued \| in_progress \| completed \| error \| cancelled \| setup_failed`. Either a workflow **step** (`workflow_run_id` + `node_id` set) or an ad-hoc `POST /api/run` with no item. |
| **Queue** | The set of pending and in-flight runs across all agents. Surface lives at `/queue`. |
| **Guard-rail** | A safety rule. Two scopes: workspace-wide (`guardrails` table, `/guardrails` page) and per-project (`project_guardrails` table, surfaced on the Project Detail â†’ Guard-rails tab). |
| **Severity (guard-rail)** | `block` (agent must refuse), `ask_owner` (agent must ping you first), `warn` (agent proceeds but flags). |
| **Constitution** | Markdown blob in `settings.constitution_md` â€” a workspace-wide preamble injected into every agent's prompt. Edited in Settings. |
| **Quiet hours** | A daily window during which external notification deliveries are batched into a 09:00 digest instead of fired immediately. Configured per workspace in Settings â†’ external notification. |
| **Workflow** | An Owner-designed graph (`workflows` row, ReactFlow builder) of Start, Agent, Owner and End nodes joined by pass / fail connections. Owns project, input (`item` or `none`), trigger (`manual` / `schedule` / `item_ready`), worktree / push / PR, `max_loops` and the child workflow. Replaced per-agent handoffs and schedules (ADR 0014). |
| **Workflow run** | One execution of a workflow over one item or the project (`workflow_runs`). Owns one worktree + branch (`atlas/wf/<id>`) for all its steps and delivers one push + one PR at End. Status `running \| waiting_for_owner \| completed \| cancelled \| error`. At most one live run per item. |
| **Step** | One agent node executed inside a workflow run — an ordinary `agent_runs` row with `workflow_run_id` + `node_id`. The next step spawns as soon as the previous one reports, with no scheduler wait. |
| **Pass / fail connection** | Graph edges. The engine follows a step's pass connection on `atlas-outcome: done` (with every required checklist row passed) and its fail connection on `rejected` or a failed checklist. Pass connections can't form a loop; fail connections may loop back, counted by `loop_count` against `max_loops`. |
| **Owner node** | A graph node that parks the run for Owner review; the Owner's reply (comment or resume) continues along its pass connection. |
| **Park** | The engine handing a workflow run to the Owner: run `waiting_for_owner`, item `waiting_for_info` with no assignee, a comment + notification, worktree kept. Caused by `asked_question`, a missing outcome, an error, the loop limit, an Owner node or a missing agent. An Owner comment on the item (or `POST /api/workflow-runs/:id/resume`) resumes it. |
| **Child workflow** | The End node's `child_workflow_id`. Items created during the run (children of the run's item, or stamped `created_by_workflow_run_id`) are queued for it as `ready` at End, e.g. Planning → Development. |
| **Outcome block** | The fenced `atlas-outcome` block every agent ends with (`done` / `rejected` / `asked_question`, plus `summary`, `reason`, `checklist`). Contract staged as `.atlas/outcome.md`; the engine routes on it. |
| **Handoff / Round / Freedom mode** | Retired terms (ADR 0014, migration 036) for per-agent on-pass / on-fail routing, the per-item run cap and no-item agents on a schedule. Now: pass / fail connections, `max_loops`, and a workflow with `input_kind='none'`. |
| **Tool catalog** | Read-only directory of the Atlas MCP tools (`tool_catalog`), re-synced from `@atlas/mcp` registrations on every boot. No per-agent enforcement. |
| **Auto-fetch** | A scheduled `git fetch` per project. Configured via the AutoFetchScheduleModal; jobs registered in `services/schedule-registry.ts`. |
| **Conflict policy / dirty guard / idle guard / agents guard** | Per-schedule rules that decide whether to skip a fire if the worktree is dirty / an agent is running / etc. |
| **Reclone** | Wipe the worktree and re-clone the same git URL with the same credential. Useful after auth-credential rotation. |
| **Workspace** | The root folder selected during onboarding. Holds the SQLite DB (`atlas.db`) and every project's worktree. |
| **ATL-001** (and similar) | Stable display IDs computed from creation order. Used in headers and tables. Format: `ATL-` for projects, `EPC-` for epics, `STR-` for stories, etc. |
| **AppShell** | The post-onboarding layout: Sidenav (left) + Topbar (top) + Outlet for the routed page. Lives in `App.tsx`. |
| **In-app feed** | Notifications surfaced inside the app (`/notifications` â†’ In-App tab). Separate stream from external notification deliveries. |
| **`waiting_for_info`** | Status of an item whose workflow run parked with the Owner (or that the Owner set by hand). Reachable from any non-`done` status. |
| **`ATLAS_AI_ENABLED`** | Env flag. When not `true`, `agent-runner.ts` emits canned output instead of spawning a real CLI â€” used for dev without CLI cost. |
