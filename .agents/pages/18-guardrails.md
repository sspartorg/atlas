# Guard-rails (Workspace)

**Route:** `/guardrails` • **Component:** `packages/web/src/pages/Guardrails.tsx` • **Slug:** `guardrails`

## Purpose
Workspace-wide safety rules grouped by category. Add / edit / delete rules; preview "dirty" changes; bulk-save.

## Tabs (Updated 2026-07-01: page has 2 tabs, not a single-page layout)
The page uses a MUI `Tabs` component with **local `useState`** (no URL `?tab=` deep-link):
- **Rules `{N}`** — categories grid + right rail + sticky save bar. Tab label includes live count: `Rules  ${totalRules}`.
- **Scripts `{N}`** — renders `GuardrailScriptsTab`. Tab label includes live count: `Scripts  ${scripts.length}`.

Default tab is `rules`. Switching tabs is purely local state; there is no URL change.

## States
- **Loading**: spinner (also shown forever if `GET /api/guardrails` fails — no error branch yet)
- **Populated**: tabs header + tab content + modal

## UI elements
**Header**
- Title + description (explains block / ask_owner / warn severities)
- Stats line: `{N} categories · {M} rules · {P} dirty`

**Tabs bar** — MUI scrollable `Tabs` with `Rules N` and `Scripts N` tabs.

**Categories** (Rules tab only) — one card per `GUARDRAIL_CATEGORIES` value (file_system, secrets_credentials, git_branches, side_effects_network, escalation_scope).

`GuardrailCategoryCard`:
- Per-rule rows (`GuardrailRuleRow`, a native `<button>` via `ButtonBase`) showing rule text + optional detail + severity chip. Workspace rules have no enabled flag
- **Add rule** button per category → `openAdd(category)` → opens `GuardrailModal`
- Clicking (or Enter/Space on) a row → `openEdit(rule)` → `GuardrailModal` in edit mode. Delete lives only inside that modal (trash icon → "Delete this rule?" confirm, which names the category by its label, e.g. "Side Effects & Network")

**Right rail (`GuardrailRightRail`)** — help / info copy.

**Sticky action bar**
- Status text: "{N} rule(s) changed this session · Saved {T} by Owner" ("by Owner" is hard-coded)
- **Discard** → clears the dirty counter only (does not roll back edits) → toast "Dirty marker cleared"
- **Save Guard-rails** → `handleSaveAll()` → `POST /api/guardrails/save` → toast "Guard-rails saved"; a failure toasts "Could not save guard-rails" with the error. Each add/edit/delete already persisted; Save only stamps `published_at`

## Why these affordances exist
- **Category grouping** — Rules cluster by risk surface; matches the Owner's mental model so "what does this agent do with secrets" is answered by one card.
- **Severity (block / ask_owner / warn)** — Not every rule is a hard stop; severity lets the Owner encode preference ("ask me before touching prod") without forcing refusal-only rules.
- **Per-rule edit / delete** — Rules drift as the workspace evolves; inline edit preserves history more than delete-and-recreate.
- **Sticky Save bar** — Rules are reviewed in batch; the dirty counter + bulk save matches "I'm tightening security today" without per-rule mutation noise.
- **Backtick-wrapping hint** — Agents parse rule bodies; emphasizing the convention prevents rules that look human-readable but get ignored by the prompt-builder.

## Modals / drawers
**`GuardrailModal`** (dialog named by its heading "Add rule" / "Edit rule"; close button `aria-label` "Close")
- Category picker: one `ButtonBase` button per category with `aria-pressed`
- Rule text field (required) — explains backtick-wrapping for code refs
- Optional Detail field
- Severity picker: three `ButtonBase` cards with `aria-pressed`; chips read BLOCK / ASK OWNER / WARN
- Validation / server error alert. A failed delete keeps the modal open with the error (it used to close silently)
- **Cancel** / **Add rule** (+ icon) or **Save changes** (no icon) — calls `POST /api/guardrails` or `PATCH /api/guardrails/:id`

**Scripts tab (`GuardrailScriptsTab`)** — script cards are native buttons → `ScriptModal`; "Loading…" while loading; `ScriptModal` **Delete** asks "Delete this script?" before deleting.

## Hooks used
- `useGuardrails` (`GET /guardrails`)
- `useGuardrailScripts` — feeds the Scripts tab count + `GuardrailScriptsTab` content
- `useCreateGuardrail`, `useUpdateGuardrail`, `useDeleteGuardrail`, `useSaveGuardrails`
- `useNow` (60s tick for "saved N min ago")

## API endpoints touched
- `GET /api/guardrails`
- `POST /api/guardrails`
- `PATCH /api/guardrails/:id`
- `DELETE /api/guardrails/:id`
- `POST /api/guardrails/save`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- **Discard** only clears the *session dirty counter*; it does NOT roll back actual mutations. This is a known quirk (see coming-soon list) — be careful if a user expects Discard to undo.
- The dirty counter increments on add / edit / delete and **is cleared on Save** — `Guardrails.tsx:92` calls `setDirtyCount(0)` inside `handleSaveAll`. (This doc previously claimed the opposite; corrected 2026-09-20.) **Discard** is the genuine quirk: it clears the counter without rolling back mutations.
- `relativeTime()` for the "saved at" label is the shared one from `utils/time.ts` ("14m ago").
- `DELETE /api/guardrails/:id` returns 204 even for an unknown id.

## Connectivity
- **Pages**: [Project Guard-rails](04-project-guardrails.md) — per-project variant layered on top of these; [Settings](19-settings.md) — adjacent admin surface.
- **Routes**: `POST /api/guardrails/save` — bulk commit endpoint distinct from individual PATCH because the Owner reviews multiple rules together and a single transaction makes "revert this session" tractable (today only partially implemented; see coming-soon).
- **Entities**: `guardrail_rule` — workspace-wide; `project_guardrail` is the related per-project shape on a different page.

## Coming soon on this page
- Discard behavior (currently misleading) — see [coming-soon.md](../coming-soon.md).
