# Agents

**Route:** `/agents` • **Component:** `packages/web/src/pages/Agents.tsx` • **Slug:** `agents`

## Purpose
Grid of all agent cards, grouped by category. Per-card actions: open, edit, pause/resume, disable, duplicate, delete, favorite. Header **Add Agent** dialog creates a new agent.

## States
- **Loading**: 6-card skeleton grid (lines 277-320)
- **Error**: `AgentsErrorBanner` if runs API fails while agents exist (lines 269-275)
- **Empty (no agents)**: hero with **Browse the Marketplace** CTA
- **No matches**: filter empty state (lines 355-369)
- **Populated**: grouped category sections (lines 371-417)

## UI elements
**Header**
- **Add Agent** button (line 256) → opens Add-Agent dialog (lines 426-531)

**Filters (`AgentFilterChips`)**
- Category chips: software-dev / marketing / content / design + Favorites
- **Role dropdown** (A08) — narrows to one of the 10 SDLC roles (PO / Spec Writer / Engineer / QA / Architect / Tester / Automation / DevOps / Security / Designer) on top of the category filter. Selecting a specific role excludes autonomous agents (`role_id` NULL) entirely; `All roles` keeps them visible. Per-role counts are computed client-side from `useAgents()` data — no separate fetch.
- Sort dropdown: last-run / queue-depth / category-role

**Card grid (`AgentCategorySection` → `AgentCard`)**
- Agent accent dot + name + `designation · category` sub-label. A08 — when `designation` is empty, `agentSubtitle()` in `agentViewModel.ts` now falls back to the SDLC role label (via `SDLC_ROLE_LABELS[role_id]`) before dropping to category alone. Autonomous agents (`role_id` NULL) still render category alone when designation is empty.
- Star toggle (line 383) → `favorites.toggle(w.id)` (localStorage)
- Card click → `/agents/:id`
- ⋯ Card menu (`AgentCardMenu`):
  - Open / Edit → `/agents/:id`
  - Duplicate → opens `DuplicateAgentModal`
  - Pause/Resume → toggles `status` (PATCH /agents/:id)
  - Disable/Enable → toggles `status` (PATCH /agents/:id)
  - Delete → confirmation, then `DELETE /agents/:id`

**Browse the Marketplace** button (empty state) → navigates to `/agents/marketplace`. The marketplace is the only install path; each install creates an `agents` row with `marketplace_source_id` set so the catalog's upgrade / detach / reinstall affordances stay accurate. The prior "Install the Default Agents" button (and the `POST /api/agents/restore-defaults` server endpoint behind it) was removed on 2026-06-04 — it bulk-installed all `AGENT_SEEDS` entries without marketplace back-links, duplicating the same "graveyard" anti-pattern boot-time auto-install had.

## Why these affordances exist
- **Add Agent (header)** — Creating agents is part of an active workflow ("I need a marketing agent now"), not a one-time setup; header-pin keeps it close.
- **Category grouping** — Prevents mixing "code agents" with "content agents" in a single scan.
- **Star (favorites)** — The Owner reuses 2-3 agents constantly; favoriting pulls them into a dedicated chip filter.
- **Pause/Resume per agent** — Pause-without-delete preserves config so the Owner can resume after fixing the prompt instead of re-creating.
- **Duplicate** — Fastest way to specialize a prompt (e.g., "Coder, but for Python"); from-scratch creation re-types the prompt body.
- **Browse the Marketplace (empty state)** — When the Agents list is empty (fresh install or after deletes), the CTA points the Owner at the marketplace rather than offering a bulk re-install. Every agent install is an explicit per-entry choice, which keeps the agents list curated and the marketplace's `is_installed` / `upgrade_available` flags meaningful.

## Modals / drawers
- `DuplicateAgentModal` (line 419) — opens with `duplicateAgent` state; on confirm calls `POST /agents/:id/duplicate`.
- **Add Agent dialog** (lines 426-531) — fields: name, category, CLI, model, accent_color; calls `POST /agents` (line 158).

## Hooks used
- `useAgents()` — `GET /agents`
- `useUpdateAgent()`
- `useRoles()` — `GET /roles`. A08. Infinite cache (the catalog changes only via migration). Surfaces labels for the Role dropdown; the dropdown itself only needs the slug list from `SDLC_ROLES` so a network failure on this hook doesn't break filtering.
- `useAgentFavorites()` — localStorage
- `useQuery(['runs', 'agents-page'])` — no polling. Invalidated via SSE `run_queued` / `agent_status` / `run_completed`.

## API endpoints touched
- `GET /api/agents`
- `GET /api/roles` (A08 — Role dropdown labels + counts)
- `GET /api/run?limit=500`
- `POST /api/agents`
- `PATCH /api/agents/:id`
- `DELETE /api/agents/:id`
- `POST /api/agents/:id/duplicate`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Runs query is event-driven (SSE). Sort-by-last-run may still re-order when a run finishes, but no longer at a fixed 5s cadence.
- Favorites are persisted in localStorage only — they don't sync across machines.
- Add-Agent dialog's CLI / model dropdowns are populated from the `cli_models` registry; if Settings → Model Registry is empty, the model dropdown will be empty.

## Connectivity
- **Pages**: [Agent Detail](16-agent-detail.md) — card click target; [Queue](13-queue.md) — drawer "Full trace" lands back here; [Settings → Model Registry](19-settings.md) — populates the Add Agent dialog's model dropdown.
- **Routes**: `POST /agents/:id/duplicate` — separate from POST/create because duplicating preserves the prompt body, reviewer prompt, handoff rules, and checklists in one transaction; doing this client-side would re-issue four+ calls.
- **Entities**: `agent`, `agent_handoff_rule`, `cli_model` (for the model picker).

## Coming soon on this page
None.
