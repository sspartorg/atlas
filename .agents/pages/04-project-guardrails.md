# Project Guard-rails

**Route:** `/projects/:id/guard-rails` (redirects to `/projects/:id?tab=guardrails`) • **Component:** `packages/web/src/pages/ProjectGuardrails.tsx` • **Slug:** `project` (guardrails state)

## Purpose
Per-project safety rules. The standalone route immediately redirects into the Project Detail page's Guard-rails tab — the real content lives in `ProjectGuardrailsBody`, rendered (lazily) by `project/GuardrailsTab.tsx`.

## States
- **Loading**: `isLoading` → 4× skeleton boxes in a 2×2 grid
- **Empty**: `rules.length === 0` → centred empty state: "No guard-rails yet for this project" + **Add first rule**
- **Populated**: 2-column grid of `RuleCard`

## UI elements
**Tabs** — `Rules  N` (every rule, paused included) / `Scripts  N`.

**Header**
- "Rules every agent must respect inside this project · N active" (N = enabled rules)
- **Add rule** button → opens `RuleDialog` in add mode

**Info card** — shield icon, "Guard-rails are active", "Every task and sub-task under {project} inherits these rules…", and a read-only "Enabled" switch (decorative; it has no handler).

**RuleCard** (per rule)
- Icon (from `rule.icon`), title (bold), body (`whiteSpace: pre-wrap`)
- "Active" / "Paused" badge — paused cards render at 0.6 opacity
- **Switch** (`aria-label` "Pause {title}" / "Resume {title}") → `useToggleProjectGuardrail` → `PATCH …/:id/toggle { enabled: 1|0 }`; a failure toasts "Could not update guard-rail" with the error
- **Edit** icon button (`aria-label` "Edit {title}") → `RuleDialog` in edit mode, seeded with the rule
- **Delete** icon button (`aria-label` "Delete {title}") → `ConfirmActionModal` "Delete this rule?" ("Removes "{title}" from this project. Agents won't see it on their next run.") → `DELETE …/:id`; toasts "Deleted guard-rail — {title}" or "Could not delete guard-rail"

**RuleDialog** (`aria-labelledby` → its heading)
- Heading "Add guard-rail" / "Edit guard-rail"
- **Title** (required), **Rule** (multiline, required). There is no "Applies to" field: no schema key, column or prompt reads one (removed 2026-10-17)
- **Cancel** / **Add rule** (add) or **Save changes** (edit); disabled until title + rule are filled and nothing is pending
- Seeds on every open, so a cancelled draft never leaks into the next open

**Scripts tab (`ProjectGuardrailScriptsTab`)** — project-scoped guardrail scripts. Cards are native buttons → `ScriptModal` edit; **Add script** / **Add first script** → `ScriptModal` add. While loading it shows "Loading…".
- In add mode the modal notes "A project script with the same slug overrides the workspace script" and offers one clickable slug chip per workspace script (`useGuardrailScripts({ enabled: modal open in add mode })` → `GET /api/guardrail-scripts`) that this project doesn't already override. Clicking a chip fills the slug (and the name when empty).
- `ScriptModal`'s **Delete** opens a "Delete this script?" confirm before anything is deleted.
- Empty copy: "No project scripts yet" / "Add a shell script scoped to this project. Org-wide scripts from Atlas Guard-rails apply automatically."

## Why these affordances exist
- **Add rule** — Per-project rules diverge from workspace defaults (e.g., "don't touch `/migrations` in this repo"); a fast add-path keeps the Owner from leaving for the global Guard-rails page just to scope a one-repo rule.
- **Toggle switch per rule** — Rules can become temporarily wrong (e.g., during a planned migration); a toggle preserves the rule body so the Owner can re-enable later instead of re-typing it.
- **Edit / Delete per rule** — a rule's wording drifts with the project; editing in place keeps its id and order.
- **Add first rule (empty state)** — Empty per-project guardrails are common (projects inherit workspace rules); the CTA preempts the assumption that the page is broken.

## Modals / drawers
- `RuleDialog` — add/edit; on success toasts "Added guard-rail — {title}" / "Updated guard-rail — {title}" and closes.
- `ConfirmActionModal` — per-rule delete confirm.
- `ScriptModal` (+ its delete confirm) — Scripts tab.

## Hooks used
- `useProjectGuardrails(projectId)` (default staleTime) — also read by Project Detail for the header pill and the rail
- `useCreateProjectGuardrail`, `useUpdateProjectGuardrail`, `useToggleProjectGuardrail`, `useDeleteProjectGuardrail` (all `(projectId)`)
- Scripts tab: `useProjectGuardrailScripts(projectId)` + create/update/delete mutations; `useGuardrailScripts({ enabled })` for the override-slug chips

## API endpoints touched
- `GET /api/projects/:projectId/guardrails`
- `POST /api/projects/:projectId/guardrails` — payload: `{ title, body_md }` (schema also accepts `icon`, `enabled`, `sort_order`)
- `PATCH /api/projects/:projectId/guardrails/:id` — payload: `{ title, body_md }`
- `PATCH /api/projects/:projectId/guardrails/:id/toggle` — payload: `{ enabled: 1 | 0 }`
- `DELETE /api/projects/:projectId/guardrails/:id`
- `GET/POST/PATCH/DELETE /api/projects/:projectId/guardrail-scripts` (Scripts tab); `GET /api/guardrail-scripts` (workspace slugs offered as overrides in the add modal)

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- The `/projects/:id/guard-rails` URL is a redirect. Adding navigation that targets this path will round-trip the user through Project Detail.
- `enabled` is **numeric** (1 / 0) in the API payload, not boolean.
- The toggle endpoint takes only `{ enabled }`; edits go through the general PATCH.
- A failed rules GET still shows the empty state (no error branch yet).

## Connectivity
- **Pages**: [Project Detail](03-project-detail.md) — parent route; the standalone URL redirects into the tab; its header pill and rail read these rules; [Guard-rails (global)](18-guardrails.md) — workspace-wide rules layered on top of these.
- **Routes**: `PATCH /api/projects/:projectId/guardrails/:id/toggle` — separate from the general PATCH because the toggle is the high-frequency operation and the payload is just `{ enabled }`, not the full rule.
- **Entities**: `project_guardrail` — per-project, lighter shape than `guardrail_rule` (no severity/category enum; just title + body).

## Coming soon on this page
None.
