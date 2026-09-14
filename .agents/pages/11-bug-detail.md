# Bug Detail

**Route:** `/issues/bugs/:id` • **Component:** `packages/web/src/pages/BugDetail.tsx` • **Slug:** `issues`

## Purpose
Standalone bug view (nested under an epic, not a story). Uses the unified `IssueDetailShell`. Title, description, proposed plan, and all bug fields (acceptance criteria, steps to reproduce, expected/actual, frequency, failure scope) are editable inline.

## States
- **Loading**: skeleton
- **Not found**: "Bug not found" + back button
- **Populated**: shared shell layout

## UI elements
**Breadcrumb**: Projects → project → Issues → `EPC-NNN` (link) → bug short id. Ends with `CopyLinkButton`.

**Header (via shell)**
- `EditableTitle` — Enter saves via `useUpdateBug`.
- **3-dots actions menu** (right side of title row): **Clone item…** opens `NewIssueModal` pre-filled with the bug's title (`CLONE <title>`), description, acceptance_criteria, and all bug-specific fields (steps_to_reproduce, expected, actual, frequency, failure_scope); the same parent epic; status reset to `draft`. After create, a `relates_to` link to the source is attached automatically. Below a divider: **Delete this bug…**.
- **`AddRelatedMenu`** (Jira-style `+` button) sits on its own row directly below the title row. Options: **Add relates-to**, **Add blocked-by** → opens `LinkPickerDialog` to attach an existing item. (No natural children for bugs.)
- `KindChipDetail kind="bug"`.

**Blocked-by + Relates-to** sections (rendered by `RelatedItemsCard`) are hidden entirely when the underlying link list is empty; the `+` menu carries the add path in that state.

**Body cards** (in order)
- `EditableMarkdownCard` "Description" — Save → `useUpdateBug`.
- `BugBodyCards` — renders the bug-specific section:
  - **Frequency** / **Failure scope** chips at the top are now editable `Select` dropdowns.
  - `EditableMarkdownCard` for **Acceptance criteria** and **Steps to reproduce**, both rendered as markdown via `MarkdownPreview`.
  - Combined **Expected vs Actual** card with two stacked textareas in edit mode.

**Right rail**
- `DetailsRailCard` — Project (link), Epic parent (link), Status (`StatusPickerPopover`), Assignee (`AssigneePickerPopover`), Created, Last updated.
- `ActivityLogCard` — read-only feed of status changes, reassignments, and field edits, beneath Details.

Below the body, in the main column: `ConversationCard` for comments + compose.

**Owner-reply hand-back + PR merge awareness** (shared components)
- `ConversationCard` composer — when the item is `waiting_for_info` with no assignee and the most recent run on it (`useItemAgentRuns`) belongs to an active agent, helper text reads *"Replying hands this back to <Agent> and sets it Ready."* It mirrors the API's owner-reply auto-resume (`commentsService`), so posting really does reassign + re-queue.
- **Pull Requests** rows (`RelatedItemsCard`) carry an **Open** / **Merged** / **Closed** chip from `pr_state`; no chip while the state is unknown (`null`/absent).
- `DetailsRailCard` status picker → **Done** while any `pull_request` link isn't `merged`: first `POST /api/issues/:type/:id/external-links/refresh`; if still unmerged, a **Mark done anyway?** dialog (`ConfirmActionModal`) lists the PRs (`#ref title (state)`) and only **Mark done** transitions. Refresh failure falls back to the loaded links, so the dialog still guards.
- `ItemWorkflowPanel` rows under Assignee (ADR 0014): **Workflow** select (None + the project's `input_kind=item` workflows → `PUT /api/items/:id/workflow`; a **Create a workflow** link when the project has none) and **Workflow run** — latest run's status chip (→ `/workflows/:id/runs/:runId`, from `GET /api/items/:id/workflow-runs`) plus **Start now** (`POST /api/workflows/:id/runs`) when a workflow is set and no run is live. See [Workflow Run](35-workflow-run.md).

## Why these affordances exist
- **Frequency / Failure scope as editable dropdowns** — QA agents and the Owner discover these properties as reproduction evolves; promoting them above the body fields signals they're triage-critical, not optional. Dropdowns enforce the controlled vocabulary the status machine and reports rely on.
- **Steps to reproduce as ordered list** — Bug repro is intrinsically ordered; rendering as `<ol>` prevents authors from accidentally shuffling steps when reformatting.
- **Combined Expected vs Actual card** — These two fields are read together (the diff is the bug); side-by-side editing reduces mistakes from editing one without the other.
- **Epic parent link in rail** — Bugs are children of epics (not stories); the rail provides the only navigation back to where the bug surfaced from.

## Hooks used
- `useBugFull(id)` — single composite hook returning bug + project + epic + activity (`BugDetail.tsx:30`)
- `useEpics`, `useProjects`, `useAgents`, `useSettings`
- `useUpdateBug`, `useTransitionBug`, `useAssignBug`, `useDeleteBug`
- `useItemAgentRuns(id)` — recent agent runs against this bug
- `useProjectLabels(projectId)` — labels picker

(Legacy `PATCH /:id/plan` retired; agent narrative flows through the comments thread.)

## API endpoints touched
- `GET /api/bugs/:id/full` — single composite endpoint
- `PATCH /api/bugs/:id` (title, description, AC, steps, expected, actual, frequency, failure_scope, labels)
- `PATCH /api/bugs/:id/status`, `PATCH /api/bugs/:id/assign`
- `DELETE /api/bugs/:id`
- `POST /api/issues/bug/:id/external-links/refresh` — synchronous PR-state re-check before Done (via `useRefreshIssueExternalLinks`)

## Edge cases / quirks
- Epic short id is constructed by string-replacing the bug's id prefix (same convention as Story Detail).

## Connectivity
- **Pages**: [Issues](08-issues.md) — list / kanban entry; [Epic Detail](07-epic-detail.md) — parent rail link; [Sub-bug Detail](12-sub-bug-detail.md) — sibling shape with the same `BugBodyCards`.
- **Routes**: `PATCH /api/bugs/:id` — single endpoint for any body-field edit (frequency, scope, AC, steps, expected, actual); centralized server-side validation keeps the schema authoritative.
- **MCP tools**: `list_bugs { project_id?, epic_id? }`, `get_epic_tree` — QA Writer reviewing open bugs in a project pulls `list_bugs` then walks each bug's parent epic for context.
- **Entities**: `bug`, `epic` (parent), `agent` (assignee/reporter).

## Coming soon on this page
None.
