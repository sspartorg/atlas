# New Task

**Route:** `/tasks/new` • **Component:** `packages/web/src/pages/TaskNew.tsx` • **Slug:** `tasks`

## Purpose
Single-page form to draft a Task and either save it as a draft or submit it. Submit with a **Workflow** picked queues the Task on it, so it just runs; the project's default workflow is preselected. Sub-tasks are added later on the Task's detail page, or created by the Task's workflow (PO Writer).

## States
- **Populated**: form; a pending create disables the action buttons.
- No explicit loading or error state — errors surface as a toast.

## UI elements
**Header / breadcrumb**
- Breadcrumb: Tasks → "New Task"; title "Draft a new task"
- Subtitle: `"<workflow.name> will start once you submit"` when a workflow is picked, else `"Nothing runs until the Task is queued for a workflow"`. It used to name the assignee ("PO Writer will pick this up"), which promised something that never happened — agents don't pick items up (ADR 0014).

**Info banner** — `taskNewBannerCopy(workflowName)`: "<workflow> starts as soon as you submit…" with a workflow, else "With no workflow picked, nothing runs until you queue the Task for one from its page."

**Form fields**
- **Title** — required, autoFocus; inline error on blur / submit.
- **Description** — multiline, required.
- **Project** — Select, required; pre-filled from `?project=`.
- **Repos** — shown whenever the picked project has any repo (ADR 0018): `RepoSelect` multi-select, the project's **first** repo preselected, order = pick order, helper "First repo holds specs and other Task-wide files." Always sent as `repo_ids`. With a project selected and nothing picked, Save/Submit are disabled; a project with no repos shows an info alert pointing at its Repos tab instead of the picker.
- **Priority** — `low | normal | high | urgent`; default `low`.
- **Workflow** — Select, always shown: **None — save for later** + every `input_kind='item'` workflow that is global or the picked project's (the rule the API enforces). Preselects the project's `default_workflow_id` (set on Project Detail → Setup) when it is still one of the options; changing the project resets it to that project's default. The preselection is the **only** place the default is applied — the server never falls back to it, so Jira imports keep their source's workflow (ADR 0016).
- **Reporter** — default `OWNER`; options Owner + active agents.
- **Assignee** — defaults to `agent-po-writer` when installed and active (`TaskNew.tsx:98`), else `OWNER`; `AgentSelect suggestedRole="po"` lists PO-role agents first under **Suggested**.

**Actions** (stay enabled; an invalid click sets `submitAttempted` and shows every field error)
- **Save as draft** — `POST /api/tasks`, **never** with `workflow_id`: a draft is never queued, whatever the Workflow select says.
- **Cancel** — `/tasks`.
- **Submit** with a workflow — `POST /api/tasks {…, workflow_id}`: the API queues it in the same request (`ready`, `workflow_id` set, `queued_for_workflow` event); toast "Submitted — <workflow> is starting". No separate status call.
- **Submit** with None — `POST /api/tasks` then `PATCH /api/tasks/:id/status {status:'ready'}` (Ready, but nothing picks it up until it is queued).
- Success navigates to `/tasks/:id`.

## Why these affordances exist
- **Draft vs Submit** — a draft stages the Task without making it `ready` or queueing it; an `item_ready` workflow only picks up `ready` Tasks queued for it.
- **Workflow select + project default** — submitting used to start nothing: the Owner had to open the Task and pick a workflow in its rail. Small changes can use the `quick` template (Coder → Code Reviewer → tests gate → PR) instead of the full Delivery pipeline.
- **`?project=` pre-fill** — the common entry is from a project context.
- **Assignee default PO Writer** — PO Writer is the agent that splits a Task into sub-tasks.

## Modals / drawers
- **Discard draft?** (`DraftGuardProvider` → `ConfirmActionModal`) — when an app-level navigation (global `g`+`<key>` shortcut, Sidenav row, BottomNav / More sheet) would drop typed text.

## Hooks used
- `useCreateTask()`, `useTransitionTask()` (`hooks/useTasks.ts`)
- `useProjects`, `useProjectRepos(projectId)`, `useWorkflows()` (filtered client-side), `useAgents`, `useSettings`, `useToast`
- `useDraftGuard(dirty)` — dirty while Title or Description has text (`TaskNew.tsx:108`); also arms `beforeunload`.

## API endpoints touched
- `GET /api/projects/:id/repos` — once a project is picked
- `GET /api/workflows`
- `POST /api/tasks` (`repo_ids`; `workflow_id` on Submit with a workflow)
- `PATCH /api/tasks/:id/status` (Submit with no workflow)

## Permissions / guards
- Post-onboarding only.

## Edge cases / quirks
- **The assignee is informational** — agents never pick up items on their own (ADR 0014); the workflow is what runs.
- A bad `workflow_id` (deleted since the list loaded, or moved project) fails the whole create with the API's 404/400 toast — nothing is saved, since the API validates before inserting.
- Submit with None: if the `ready` transition fails after a successful create, the toast says "Saved" and the Task stays `draft`.
- "OWNER" is a select sentinel mapped to `null` in the payload.
- The draft guard covers app-level navigation only (`BrowserRouter`, no `useBlocker`); **Cancel**, the breadcrumb and the post-submit redirect leave without asking.
- Browser automation typing at ~4–5 ms per key drops ~1 char per 50 in these controlled fields; set values via the native setter + `input` event or type with a per-key delay (verified 2026-09-14, not an app bug).

## Connectivity
- **Pages**: [Tasks](05-tasks.md) — Cancel target and entry; [Task Detail](07-task-detail.md) — redirect after save.
- **Entities**: `task` (created), `project`, `agent` (reporter / assignee).

## Coming soon on this page
None.
