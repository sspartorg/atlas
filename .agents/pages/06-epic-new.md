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
- **Assignee** — Select; defaults to `agent-po-writer` when that agent is installed and active, otherwise `OWNER`. The default is derived until the Owner picks, because agents load after first render. Options list PO-role agents (`role_id === 'po'`) first under a **Suggested** group, then Owner and the rest under **Everyone else** (`AgentSelect suggestedRole="po"`; no grouping when no PO agent is active).

**Actions** — both buttons stay enabled regardless of form validity. Clicking with invalid fields sets `submitAttempted=true`, which surfaces all per-field errors and aborts the submit.
- **Save as draft** — `submit('draft')`; disabled only while the mutation is pending.
- **Cancel** — navigates to `/epics`.
- **Submit** — `submit('submit')`; creates epic then transitions to `ready`.

## Why these affordances exist
- **Save as draft vs. Submit** — Drafts stage an epic without committing PO Writer; Submit is the explicit hand-off that transitions to `ready_for_po`. Splitting them prevents accidental agent spawns.
- **`?project=` pre-fill** — The most common entry is from a project's "New Epic" affordance; re-picking the project would be a tax.
- **Reporter default OWNER** — Manually-created epics are Owner-reported; agent-created epics stamp themselves.
- **Assignee default PO Writer (if installed)** — The PO Writer is the agent that breaks an epic down, so a new epic lands on it by default; without it the Owner routes the epic.
- **submitAttempted gate** — Buttons stay enabled but invalid submits surface all errors at once; faster than blocking on a per-field dirty check.

## Modals / drawers
- **Discard draft?** (`DraftGuardProvider` → `ConfirmActionModal`) — shown when a typed draft would be dropped by an app-level navigation: the global `g`+`<key>` shortcuts, a Sidenav row, or the mobile BottomNav / More sheet. **Cancel** keeps editing; **Discard** proceeds with the navigation.

## Hooks used
- `useCreateEpic()` — `POST /api/epics`
- `useTransitionEpic()` — `PATCH /api/epics/:id/status`
- `useProjects`, `useAgents`, `useSettings`
- `useToast`
- `useDraftGuard(dirty)` — dirty while Title or Description has non-blank text; registers a `beforeunload` prompt (reload / tab close) and marks the draft for the in-app guard.

## API endpoints touched
- `POST /api/epics`
- `PATCH /api/epics/:id/status`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- Assignee auto-selects PO Writer by id (`agent-po-writer`), not name — a renamed PO Writer is still the default; a paused or uninstalled one falls back to `OWNER`.
- If the transition to `ready_for_po` fails after a successful create, the toast says "Saved" (not the original "Submitted") and the epic stays in `draft` (lines 72-74).
- "OWNER" is rendered as a special select value mapped to `null` in the create payload.
- The draft guard covers app-level navigation only. The app runs on `<BrowserRouter>`, so react-router's `useBlocker` is unavailable; in-page exits (**Cancel**, the breadcrumb, the post-submit redirect) are deliberate and leave without asking.
- Fast synthetic typing (zero-delay `keyboard.type`) used to lose ~1 char per 50 in any controlled field because the Topbar `HeaderMascot` Lottie loop contends for the main thread. Fixed 2026-09-14: `usePauseWhileTyping` pauses the mascot while an input / textarea / contenteditable has focus and resumes it when focus leaves editable content (skipped under prefers-reduced-motion).

## Connectivity
- **Pages**: [Epics](05-epics.md) — Cancel target and the only entry point that doesn't pre-fill `?project=`; [Epic Detail](07-epic-detail.md) — the redirect target after successful submit.
- **Routes**: `POST /api/epics` then `PATCH /api/epics/:id/status` — two-call submit (create draft → transition to `ready_for_po`); if the transition fails the epic stays as draft so the Owner doesn't lose the body.
- **Entities**: `epic` (created), `project` (FK), `agent` (reporter + assignee FKs).

## Coming soon on this page
None.
