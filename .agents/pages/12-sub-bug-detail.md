# Sub-bug Detail

**Route:** `/issues/sub-bugs/:id` • **Component:** `packages/web/src/pages/SubBugDetail.tsx` • **Slug:** `issues`

## Purpose
A defect found while working on a Story. Uses the unified `IssueDetailShell`. Title, description, proposed plan, and all bug fields are editable inline.

## States
- **Resolving**: skeleton while the page scans story sub-bug lists
- **Not found**: "Sub-bug not found" + back button
- **Populated**: shared shell layout

## UI elements
**Breadcrumb**: Projects → project → Issues → parent `STR-NNN` → sub-bug short id. Ends with `CopyLinkButton`.

**Header (via shell)**
- `EditableTitle` — Enter saves via `api.subBugs.update`.
- **3-dots actions menu**: **Clone item…** opens `NewIssueModal` pre-filled with the sub-bug's title (`CLONE <title>`), description, acceptance_criteria, and all bug-specific fields (steps_to_reproduce, expected, actual, frequency, failure_scope); same parent story; status reset to `draft`. After create, a `relates_to` link to the source is attached. Below a divider: **Delete this sub-bug…**.
- **`AddRelatedMenu`** (Jira-style `+` button) on its own row below the title. Options: **Add relates-to**, **Add blocked-by** → opens `LinkPickerDialog`. (Sub-bugs have no natural children.)
- `KindChipDetail kind="sub_bug"`.

**Blocked-by + Relates-to** sections (`RelatedItemsCard`) hide when their link list is empty — `+` menu carries the add path.

**Body cards** (in order)
- `EditableMarkdownCard` "Description".
- `BugBodyCards` — editable Frequency / Failure scope dropdowns, plus editable Acceptance criteria, Steps to reproduce, Expected vs Actual, and Environment cards.

**Right rail**
- `DetailsRailCard` with Project, Parent story (link), Status (`StatusPickerPopover`), Assignee (`AssigneePickerPopover`), Created, Last updated.

**Owner-reply hand-back + PR merge awareness** (shared components)
- `ConversationCard` composer — when the item is `waiting_for_info` with no assignee and the most recent run on it (`useItemAgentRuns`) belongs to an active agent, helper text reads *"Replying hands this back to <Agent> and sets it Ready."* It mirrors the API's owner-reply auto-resume (`commentsService`), so posting really does reassign + re-queue.
- **Pull Requests** rows (`RelatedItemsCard`) carry an **Open** / **Merged** / **Closed** chip from `pr_state`; no chip while the state is unknown (`null`/absent).
- `DetailsRailCard` status picker → **Done** while any `pull_request` link isn't `merged`: first `POST /api/issues/:type/:id/external-links/refresh`; if still unmerged, a **Mark done anyway?** dialog (`ConfirmActionModal`) lists the PRs (`#ref title (state)`) and only **Mark done** transitions. Refresh failure falls back to the loaded links, so the dialog still guards.
- `ItemWorkflowPanel` rows under Assignee (ADR 0014): **Workflow** select (None + the project's `input_kind=item` workflows → `PUT /api/items/:id/workflow`; a **Create a workflow** link when the project has none) and **Workflow run** — latest run's status chip (→ `/workflows/:id/runs/:runId`, from `GET /api/items/:id/workflow-runs`) plus **Start now** (`POST /api/workflows/:id/runs`) when a workflow is set and no run is live. See [Workflow Run](35-workflow-run.md).

## Why these affordances exist
- **Same `BugBodyCards` shape as Bug Detail** — Sub-bugs and bugs share repro semantics; reusing the body components keeps QA agents from special-casing parent-bug vs. sub-bug.
- **Frequency / Failure scope as editable dropdowns** — Triage data captured at detection often needs revision once a Coder confirms the repro; inline edit lets the author correct without leaving the page.
- **Parent story link in rail** — Sub-bugs surface during story implementation; the rail link is the path back to where the regression was observed.
- **Occurrence count / detected timestamp not surfaced in UI** — Kept on the row for export use cases but de-emphasized because the Owner already triages via the parent story; surfacing them invited noise.

## Data resolution
`useSubBugFull(id)` is now the single composite fetch (`SubBugDetail.tsx:29`). The legacy "scan every story's sub-bug list" path is retired — server-side `GET /api/sub-bugs/:id/full` returns the sub-bug + parent story + project + activity in one round-trip.

## Hooks used
- `useSubBugFull(id)` — single composite hook
- `useEpics`, `useProjects`, `useAgents`, `useSettings`
- `useUpdateSubBug`, `useTransitionSubBug`, `useAssignSubBug`, `useDeleteSubBug`
- `useItemAgentRuns(id)` — recent agent runs against this sub-bug
- `useProjectLabels(projectId)` — labels picker

## API endpoints touched
- `GET /api/sub-bugs/:id/full` — single composite endpoint
- `PATCH /api/sub-bugs/:id` (title, description, AC, steps, expected, actual, frequency, failure_scope, labels)
- `PATCH /api/sub-bugs/:id/status`, `PATCH /api/sub-bugs/:id/assign`
- `DELETE /api/sub-bugs/:id`
- `POST /api/issues/sub_bug/:id/external-links/refresh` — synchronous PR-state re-check before Done (via `useRefreshIssueExternalLinks`)

(Legacy `PATCH /:id/plan` retired; agent narrative flows through the comments thread.)

## Edge cases / quirks
- Same "no direct fetch endpoint, scan all stories" pattern as Sub-task Detail.

## Connectivity
- **Pages**: [Bug Detail](11-bug-detail.md) — shared body shape; [Story Detail](09-story-detail.md) — parent rail link; [Sub-task Detail](10-sub-task-detail.md) — sibling resolution pattern.
- **Routes**: `GET /api/stories/:id/sub-bugs` — only fetch path; no `GET /sub-bugs/:id` so the page scans story-by-story until match.
- **MCP tools**: `list_sub_bugs { story_id }` — call a QA agent makes when picking up defects logged against a story it's implementing.
- **Entities**: `sub_bug`, `story` (parent), `agent` (assignee/reporter).

## Coming soon on this page
None.
