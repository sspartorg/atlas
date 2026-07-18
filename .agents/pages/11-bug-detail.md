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
  - `EditableMarkdownCard` for **Acceptance criteria** (renders as `<ul>`) and **Steps to reproduce** (renders as `<ol>`).
  - Combined **Expected vs Actual** card with two stacked textareas in edit mode.

**Right rail**
- `DetailsRailCard` — Project (link), Epic parent (link), Status (`StatusPickerPopover`), Assignee (`AssigneePickerPopover`), Rounds (A04 — `X / Y` against the assignee's `max_rounds`; hidden when no assignee; clickable → `ResetRoundsPopover` so Owner can wipe the counter and give the agent a fresh budget), Created, Last updated.
- `ActivityLogCard` — read-only feed of status changes, reassignments, and field edits, beneath Details.

Below the body, in the main column: `ConversationCard` for comments + compose.

## Why these affordances exist
- **Frequency / Failure scope as editable dropdowns** — QA agents and the Owner discover these properties as reproduction evolves; promoting them above the body fields signals they're triage-critical, not optional. Dropdowns enforce the controlled vocabulary the status machine and reports rely on.
- **Steps to reproduce as ordered list** — Bug repro is intrinsically ordered; rendering as `<ol>` prevents authors from accidentally shuffling steps when reformatting.
- **Combined Expected vs Actual card** — These two fields are read together (the diff is the bug); side-by-side editing reduces mistakes from editing one without the other.
- **Epic parent link in rail** — Bugs are children of epics (not stories); the rail provides the only navigation back to where the bug surfaced from.

## Hooks used
- `useBugFull(id)` — single composite hook returning bug + project + epic + activity (`BugDetail.tsx:30`)
- `useEpics`, `useProjects`, `useAgents`, `useSettings`
- `useUpdateBug`, `useTransitionBug`, `useAssignBug`, `useDeleteBug`, `useResetRoundsBug`
- `useItemAgentRuns(id)` — recent agent runs against this bug
- `useProjectLabels(projectId)` — labels picker

(Legacy `PATCH /:id/plan` retired; agent narrative flows through the comments thread.)

## API endpoints touched
- `GET /api/bugs/:id/full` — single composite endpoint
- `PATCH /api/bugs/:id` (title, description, AC, steps, expected, actual, frequency, failure_scope, labels)
- `PATCH /api/bugs/:id/status`, `PATCH /api/bugs/:id/assign`
- `POST /api/bugs/:id/reset-rounds`, `DELETE /api/bugs/:id`

## Edge cases / quirks
- Epic short id is constructed by string-replacing the bug's id prefix (same convention as Story Detail).

## Connectivity
- **Pages**: [Issues](08-issues.md) — list / kanban entry; [Epic Detail](07-epic-detail.md) — parent rail link; [Sub-bug Detail](12-sub-bug-detail.md) — sibling shape with the same `BugBodyCards`.
- **Routes**: `PATCH /api/bugs/:id` — single endpoint for any body-field edit (frequency, scope, AC, steps, expected, actual); centralized server-side validation keeps the schema authoritative.
- **MCP tools**: `list_bugs { project_id?, epic_id? }`, `get_epic_tree` — QA Writer reviewing open bugs in a project pulls `list_bugs` then walks each bug's parent epic for context.
- **Entities**: `bug`, `epic` (parent), `agent` (assignee/reporter).

## Coming soon on this page
None.
