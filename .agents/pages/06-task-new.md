# New Task

**Route:** `/tasks/new` • **Component:** `packages/web/src/pages/TaskNew.tsx` • **Slug:** `tasks`

## Purpose
Single-page form to draft a Task and either save it as a draft or submit it (`ready`). Sub-tasks are added later on the Task's detail page, or created by the Task's workflow (PO Writer).

## States
- **Populated**: form; a pending create disables the action buttons.
- No explicit loading or error state — errors surface as a toast.

## UI elements
**Header / breadcrumb**
- Breadcrumb: Tasks → "New Task"; title "Draft a new task"
- Subtitle: `"<assignee.name> will pick this up once you submit"` when an agent is picked, `"<owner_name> will route this once you submit"` for OWNER.

**Info banner** — `taskNewBannerCopy()` (`TaskNew.tsx:49`): names the picked agent, else generic "the agent you assign" copy.

**Form fields**
- **Title** — required, autoFocus; inline error on blur / submit.
- **Description** — multiline, required.
- **Project** — Select, required; pre-filled from `?project=`.
- **Priority** — `low | normal | high | urgent`; default `low`.
- **Reporter** — default `OWNER`; options Owner + active agents.
- **Assignee** — defaults to `agent-po-writer` when installed and active (`TaskNew.tsx:98`), else `OWNER`; `AgentSelect suggestedRole="po"` lists PO-role agents first under **Suggested**.

**Actions** (stay enabled; an invalid click sets `submitAttempted` and shows every field error)
- **Save as draft** — `POST /api/tasks`.
- **Cancel** — `/tasks`.
- **Submit** — `POST /api/tasks` then `PATCH /api/tasks/:id/status {status:'ready'}`.
- Success navigates to `/tasks/:id`.

## Why these affordances exist
- **Draft vs Submit** — a draft stages the Task without making it `ready`; an `item_ready` workflow only picks up `ready` Tasks queued for it.
- **`?project=` pre-fill** — the common entry is from a project context.
- **Assignee default PO Writer** — PO Writer is the agent that splits a Task into sub-tasks.

## Modals / drawers
- **Discard draft?** (`DraftGuardProvider` → `ConfirmActionModal`) — when an app-level navigation (global `g`+`<key>` shortcut, Sidenav row, BottomNav / More sheet) would drop typed text.

## Hooks used
- `useCreateTask()`, `useTransitionTask()` (`hooks/useTasks.ts`)
- `useProjects`, `useAgents`, `useSettings`, `useToast`
- `useDraftGuard(dirty)` — dirty while Title or Description has text (`TaskNew.tsx:108`); also arms `beforeunload`.

## API endpoints touched
- `POST /api/tasks`
- `PATCH /api/tasks/:id/status`

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- **Submitting doesn't start a workflow.** The form sets no `workflow_id`; queue the Task for a workflow from its detail page (rail **Workflow** select) or start one with **Run now** in the builder. The assignee is informational — agents never pick up items on their own (ADR 0014).
- If the `ready` transition fails after a successful create, the toast says "Saved" and the Task stays `draft`.
- "OWNER" is a select sentinel mapped to `null` in the payload.
- The draft guard covers app-level navigation only (`BrowserRouter`, no `useBlocker`); **Cancel**, the breadcrumb and the post-submit redirect leave without asking.
- Browser automation typing at ~4–5 ms per key drops ~1 char per 50 in these controlled fields; set values via the native setter + `input` event or type with a per-key delay (verified 2026-09-14, not an app bug).

## Connectivity
- **Pages**: [Tasks](05-tasks.md) — Cancel target and entry; [Task Detail](07-task-detail.md) — redirect after save.
- **Entities**: `task` (created), `project`, `agent` (reporter / assignee).

## Coming soon on this page
None.
