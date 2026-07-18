# Epic New

**Route:** `/epics/new` • **Component:** `packages/web/src/pages/EpicNew.tsx` • **Slug:** `epics`

## Purpose
Single-page form to draft an epic and either save as draft or submit it to PO Writer. Submitting transitions the new epic to `ready_for_po` so PO Writer can pick it up.

## States
- **Populated**: form rendered; mutation pending disables both action buttons (lines 390, 409)
- No explicit loading or error state — errors surfaced via toast.

## UI elements
**Header / breadcrumb**
- Breadcrumb: Epics → "New Epic"
- Title: "Draft a new epic"
- Subtitle: dynamic — `"<assignee.name> will pick this up once you submit"` when an agent is selected, `"<owner_name> will route this once you submit"` when assignee is OWNER. (Theme 04 — was hardcoded to "PO Writer".)

**Info banner** — "tips_and_updates" icon + copy describing what the assigned agent will do; copy adapts to the Assignee dropdown.

**Form fields**
- **Title** — TextField, autoFocus, **required** (`required` prop + inline `error`/`helperText` on blur or submit).
- **Description** — multiline TextField, **required** (inline error on blur or submit).
- **Project** — Select; **required**; pre-filled from `?project=` query param. Renders inline error below the Select when invalid.
- **Priority** — Select; options `low | normal | high | urgent`; default `low`.
- **Reporter** — Select; default `OWNER`; options = Owner + active agents.
- **Assignee** — Select; defaults to `OWNER` (Theme 04 — was hardcoded to PO Writer; any agent or the Owner can be the initial assignee).

**Actions** — both buttons stay enabled regardless of form validity. Clicking with invalid fields sets `submitAttempted=true`, which surfaces all per-field errors and aborts the submit.
- **Save as draft** — `submit('draft')`; disabled only while the mutation is pending.
- **Cancel** — navigates to `/epics`.
- **Submit** — `submit('submit')`; creates epic then transitions to `ready`.

## Why these affordances exist
- **Save as draft vs. Submit** — Drafts stage an epic without committing PO Writer; Submit is the explicit hand-off that transitions to `ready_for_po`. Splitting them prevents accidental agent spawns.
- **`?project=` pre-fill** — The most common entry is from a project's "New Epic" affordance; re-picking the project would be a tax.
- **Reporter default OWNER** — Manually-created epics are Owner-reported; agent-created epics stamp themselves.
- **Assignee default OWNER** — Theme 04 dropped the PO-Writer hardcoded default. The owner picks the receiving agent explicitly; the API has always supported any assignee, the UI just used to pre-bias toward PO Writer.
- **submitAttempted gate** — Buttons stay enabled but invalid submits surface all errors at once; faster than blocking on a per-field dirty check.

## Modals / drawers
None.

## Hooks used
- `useCreateEpic()` — `POST /api/epics`
- `useTransitionEpic()` — `PATCH /api/epics/:id/status`
- `useProjects`, `useAgents`, `useSettings`
- `useToast`

## API endpoints touched
- `POST /api/epics`
- `PATCH /api/epics/:id/status`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Assignee auto-selects PO Writer via case-insensitive name match `w.name.toLowerCase().includes('po writer')` (line 45). If PO Writer is renamed, the default falls back to `OWNER`.
- If the transition to `ready_for_po` fails after a successful create, the toast says "Saved" (not the original "Submitted") and the epic stays in `draft` (lines 72-74).
- "OWNER" is rendered as a special select value mapped to `null` in the create payload.

## Connectivity
- **Pages**: [Epics](05-epics.md) — Cancel target and the only entry point that doesn't pre-fill `?project=`; [Epic Detail](07-epic-detail.md) — the redirect target after successful submit.
- **Routes**: `POST /api/epics` then `PATCH /api/epics/:id/status` — two-call submit (create draft → transition to `ready_for_po`); if the transition fails the epic stays as draft so the Owner doesn't lose the body.
- **Entities**: `epic` (created), `project` (FK), `agent` (reporter + assignee FKs).

## Coming soon on this page
None.
