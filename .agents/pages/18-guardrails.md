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
- **Loading**: spinner (lines 104-110)
- **Populated**: tabs header + tab content + modal (lines 115-276)

## UI elements
**Header**
- Title + description (explains block / ask_owner / warn severities)
- Stats line: `{N} categories · {M} rules · {P} dirty`

**Tabs bar** — MUI scrollable `Tabs` with `Rules N` and `Scripts N` tabs (lines 159-172).

**Categories** (Rules tab only) — one card per `GUARDRAIL_CATEGORIES` value (file_system, secrets_credentials, git_branches, side_effects_network, escalation_scope).

`GuardrailCategoryCard`:
- Per-rule rows showing rule body + severity chip + enabled state
- **Add rule** button per category → `openAdd(category)` → opens `GuardrailModal`
- **Edit rule** per row → `openEdit(rule)` → opens `GuardrailModal` in edit mode
- **Delete rule** per row → confirmation → `handleDelete()` (lines 87-92)

**Right rail (`GuardrailRightRail`)** — help / info copy.

**Sticky action bar** (lines 188-236)
- Status text: "{N} rule(s) changed this session · Saved {T} by Owner"
- **Discard** (line 213) → clears the dirty counter only (does not roll back edits) → toast "Dirty marker cleared"
- **Save Guard-rails** (line 221) → `handleSaveAll()` (lines 94-98) → `POST /api/guardrails/save` → toast "Guard-rails saved"

## Why these affordances exist
- **Category grouping** — Rules cluster by risk surface; matches the Owner's mental model so "what does this agent do with secrets" is answered by one card.
- **Severity (block / ask_owner / warn)** — Not every rule is a hard stop; severity lets the Owner encode preference ("ask me before touching prod") without forcing refusal-only rules.
- **Per-rule edit / delete** — Rules drift as the workspace evolves; inline edit preserves history more than delete-and-recreate.
- **Sticky Save bar** — Rules are reviewed in batch; the dirty counter + bulk save matches "I'm tightening security today" without per-rule mutation noise.
- **Backtick-wrapping hint** — Agents parse rule bodies; emphasizing the convention prevents rules that look human-readable but get ignored by the prompt-builder.

## Modals / drawers
**`GuardrailModal`** (lines 238-244)
- Category radio buttons (one per category)
- Rule text field (required) — explains backtick-wrapping for code refs (lines 177-193)
- Optional Detail field
- Severity radio buttons: BLOCK / ASK_OWNER / WARN
- Validation error alert
- **Cancel** / **Add Rule** (or **Save Changes**) — calls `POST /api/guardrails` or `PATCH /api/guardrails/:id`

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
- The dirty counter increments on add / edit / delete but doesn't decrement on Save — it only clears via Discard. So immediately after a Save you'll still see "{N} dirty" until you click Discard.
- `relativeTime()` for the "saved at" label is a local helper (lines 23-35), not the shared one.

## Connectivity
- **Pages**: [Project Guard-rails](04-project-guardrails.md) — per-project variant layered on top of these; [Settings](19-settings.md) — adjacent admin surface.
- **Routes**: `POST /api/guardrails/save` — bulk commit endpoint distinct from individual PATCH because the Owner reviews multiple rules together and a single transaction makes "revert this session" tractable (today only partially implemented; see coming-soon).
- **Entities**: `guardrail_rule` — workspace-wide; `project_guardrail` is the related per-project shape on a different page.

## Coming soon on this page
- Discard behavior (currently misleading) — see [coming-soon.md](../coming-soon.md).
