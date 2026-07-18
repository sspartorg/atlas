# Project Guard-rails

**Route:** `/projects/:id/guard-rails` (redirects to `/projects/:id?tab=guardrails`) • **Component:** `packages/web/src/pages/ProjectGuardrails.tsx` • **Slug:** `project` (guardrails state)

## Purpose
Per-project safety rules. The standalone route immediately redirects into the Project Detail page's Guard-rails tab — the real content lives in `ProjectGuardrailsBody` (lines 231-415) which is rendered as `GuardrailsTab` by `ProjectDetail`.

## States
- **Loading**: `isLoading` → 4× skeleton boxes in a 2×2 grid (lines 353-362)
- **Empty**: `rules.length === 0` → large centered empty state + "Add your first rule" CTA (lines 364-403)
- **Populated**: 2-column grid of `RuleCard` (lines 404-410)

## UI elements
**Header**
- Description copy: "Rules every agent must respect…" + active rule count (lines 252-263)
- **Add rule** button (lines 265-285) → opens `AddRuleDialog`

**Guard-rails active info card** (lines 288-351) — shield icon, summary line, read-only Enabled badge.

**RuleCard** (per rule)
- Icon (from `rule.icon`)
- Title (bold)
- Body markdown (`whiteSpace: pre-wrap`)
- "Active" / "Paused" badge — paused cards rendered at 0.6 opacity
- "Applies to" label (only shown if `rule.applies_to` is set)
- **Toggle switch** (lines 113-119) → `useToggleProjectGuardrail` mutation; sends `{ enabled: 1|0 }`

**AddRuleDialog**
- Title field (required)
- Rule body field (multiline, required)
- Applies-to field (optional)
- **Cancel** / **Add rule** buttons; Add disabled until title + body present and not pending

**Empty state**
- Shield icon, copy "No guard-rails yet for this project", **Add first rule** button.

## Why these affordances exist
- **Add rule** — Per-project rules diverge from workspace defaults (e.g., "don't touch `/migrations` in this repo"); a fast add-path keeps the Owner from leaving for the global Guard-rails page just to scope a one-repo rule.
- **Toggle switch per rule** — Rules can become temporarily wrong (e.g., during a planned migration); a toggle preserves the rule body so the Owner can re-enable later instead of re-typing it.
- **Applies-to field** — Some rules only apply to a path or a kind of action; without scoping copy, agents would over-apply (e.g., refusing to touch the whole repo because of a rule meant for `/secrets`).
- **Add first rule (empty state)** — Empty per-project guardrails are common (projects inherit workspace rules); the CTA preempts the assumption that the page is broken.

## Modals / drawers
- `AddRuleDialog` — open/close at page level. On success, toasts `"Added guard-rail — {title}"` and clears the form.

## Hooks used
- `useProjectGuardrails(projectId)` — staleTime 15s
- `useCreateProjectGuardrail(projectId)`
- `useToggleProjectGuardrail(projectId)`

## API endpoints touched
- `GET /api/projects/:projectId/guardrails`
- `POST /api/projects/:projectId/guardrails` — payload: `{ title, body_md, applies_to?, icon, enabled, sort_order }`
- `PATCH /api/projects/:projectId/guardrails/:id/toggle` — payload: `{ enabled: 1 | 0 }`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- The `/projects/:id/guard-rails` URL is a redirect. Adding navigation that targets this path will round-trip the user through Project Detail.
- `enabled` is **numeric** (1 / 0) in the API payload, not boolean.
- The toggle endpoint takes only `{ enabled }`, not the full rule. Editing title/body needs a different mutation (currently no edit-in-place — delete + re-add).

## Connectivity
- **Pages**: [Project Detail](03-project-detail.md) — parent route; the standalone URL redirects into the tab; [Guard-rails (global)](18-guardrails.md) — workspace-wide rules layered on top of these.
- **Routes**: `PATCH /api/projects/:projectId/guardrails/:id/toggle` — separate from the general PATCH because the toggle is the high-frequency operation and the payload is just `{ enabled }`, not the full rule.
- **Entities**: `project_guardrail` — per-project, lighter shape than `guardrail_rule` (no severity/category enum; just title + body + scope).

## Coming soon on this page
None.
