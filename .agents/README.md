# `.agents/` — Atlas Functional Documentation

This folder is the **single source of truth for application behavior** — what every page does, what every button is wired to, every API endpoint, every status transition, every coming-soon stub. It is written for AI agents (and humans) to read **before** answering questions or making changes, so we never have to crawl the whole codebase again to remember how a feature works.

**Always read the relevant file here first.** When in doubt, start at this README and follow the index.

> **Two unrelated "agents".** The folder name `.agents/` predates the Workers → Agents domain rename. The docs in this folder are read by **AI coding agents** (Codex, Cursor, Claude Code, Gemini CLI, Aider, etc.) when they work on this codebase. Atlas's **domain entity** is also now called an *Agent* — the per-issue executor that produces code on the user's behalf, stored in the `agents` table. Two different things that happen to share a word. When the docs say "an agent runs", they mean the product entity; when this README says "for AI agents to read", it means the coding-tool variety.

---

## When to read which file

| Question | File |
|---|---|
| "What does page X do? What are its buttons?" | `pages/<XX-slug>.md` |
| "Which routes exist? Which API does each route call?" | `routes-map.md` |
| "What's the full API surface? Which endpoint returns what?" | `api-surface.md` |
| "What are the entities and how do they relate? What status transitions exist?" | `data-model.md` |
| "How does the system fit together end-to-end?" | `architecture.md` |
| "What features are stubbed / coming soon?" | `coming-soon.md` |
| "What does term X mean in Atlas's domain?" | `glossary.md` |
| "How do I keep these docs in sync when I change code?" | `conventions.md` (and `CLAUDE.md`) |
| "How does the MCP server expose item data to AI agents?" | `mcp.md` |
| "What are the coverage targets, where does CI gate, how do I run tests?" | `testing.md` |
| "How do I smoke-test the MCP server?" | `testing-mcp.md` |
| "Which canonical SDLC roles exist? Which ship enabled?" | `role-catalog.md` |
| "What's the long-term agent-swarm vision? What's shipped vs absent?" | `swarm-architecture.md` |

---

## Index

### Framework (cross-cutting)
- [`architecture.md`](architecture.md) — system diagram, request flow, SSE flow
- [`data-model.md`](data-model.md) — entities, relationships, status machine
- [`api-surface.md`](api-surface.md) — every endpoint, every SSE event, services, migrations
- [`routes-map.md`](routes-map.md) — one row per route → page → hooks → endpoints → modals → coming-soon
- [`coming-soon.md`](coming-soon.md) — every stubbed feature with file:line + intended behavior
- [`glossary.md`](glossary.md) — domain terms in one place
- [`conventions.md`](conventions.md) — how to use & maintain these docs
- [`mcp.md`](mcp.md) — `@atlas/mcp` stdio server for AI item-context tools
- [`freedom-agents.md`](freedom-agents.md) — schedule-driven, no-item agents (`requires_item=false`): wiring, prompt contract, runner guards, seed catalog
- [`role-catalog.md`](role-catalog.md) — A08 SDLC role catalog: the 10 canonical roles, disable-by-default policy, prompt-ownership rules, schema, how to add a role
- [`swarm-architecture.md`](swarm-architecture.md) — C05 long-term swarm vision: capability matrix (shipped vs absent), current fleet, dispatch model overview, future capability gaps
- [`testing.md`](testing.md) — coverage targets, floor exceptions, CI gates, how to run tests
- [`testing-mcp.md`](testing-mcp.md) — MCP smoke test + Inspector walkthrough

### Pages (one file per route)
- [`pages/00-onboarding.md`](pages/00-onboarding.md) — `/onboarding`
- [`pages/01-dashboard.md`](pages/01-dashboard.md) — `/`
- [`pages/02-projects.md`](pages/02-projects.md) — `/projects`
- [`pages/03-project-detail.md`](pages/03-project-detail.md) — `/projects/:id`
- [`pages/04-project-guardrails.md`](pages/04-project-guardrails.md) — `/projects/:id/guard-rails`
- [`pages/05-epics.md`](pages/05-epics.md) — `/epics`
- [`pages/06-epic-new.md`](pages/06-epic-new.md) — `/epics/new`
- [`pages/07-epic-detail.md`](pages/07-epic-detail.md) — `/epics/:id`
- [`pages/08-issues.md`](pages/08-issues.md) — `/issues`
- [`pages/09-story-detail.md`](pages/09-story-detail.md) — `/issues/stories/:id`
- [`pages/10-sub-task-detail.md`](pages/10-sub-task-detail.md) — `/issues/sub-tasks/:id`
- [`pages/11-bug-detail.md`](pages/11-bug-detail.md) — `/issues/bugs/:id`
- [`pages/12-sub-bug-detail.md`](pages/12-sub-bug-detail.md) — `/issues/sub-bugs/:id`
- [`pages/13-queue.md`](pages/13-queue.md) — `/queue`
- [`pages/14-search.md`](pages/14-search.md) — `/search`
- [`pages/15-agents.md`](pages/15-agents.md) — `/agents`
- [`pages/16-agent-detail.md`](pages/16-agent-detail.md) — `/agents/:id`
- [`pages/16a-agent-run-detail.md`](pages/16a-agent-run-detail.md) — `/agents/:id/runs/:runId`
- [`pages/17-notifications.md`](pages/17-notifications.md) — `/notifications`
- [`pages/18-guardrails.md`](pages/18-guardrails.md) — `/guardrails`
- [`pages/19-settings.md`](pages/19-settings.md) — `/settings`
- [`pages/20-credentials.md`](pages/20-credentials.md) — `/settings/credentials`
- [`pages/21-reminders.md`](pages/21-reminders.md) — `/reminders`
- [`pages/22-scratch-pad.md`](pages/22-scratch-pad.md) — `/scratch-pad`
- [`pages/23-terminal.md`](pages/23-terminal.md) — `/terminal`
- [`pages/24-terminal-layout.md`](pages/24-terminal-layout.md) — `/terminal/layout`
- [`pages/25-terminal-history.md`](pages/25-terminal-history.md) — `/terminal/:id/history`
- [`pages/26-terminal-standalone.md`](pages/26-terminal-standalone.md) — `/terminal/standalone`

---

## Update protocol (short version)

Any code change that alters page functionality **must update the corresponding `.agents/` file in the same change**. Full rules live in [`conventions.md`](conventions.md) and a pointer is enforced in `CLAUDE.md`. The shortest version:

- Added/removed a button, tab, modal, filter, drawer → update the page doc's **UI elements** section.
- Added/changed an API endpoint → update `api-surface.md` and every page doc that calls it.
- Added/changed a status transition → update `data-model.md`.
- New page or route → create `pages/<NN-slug>.md`, update `routes-map.md` and this README's index.
- Stub became real, or new stub appeared → update `coming-soon.md` and the affected page doc.

These docs are useless the moment they go stale. Keep them tight.
