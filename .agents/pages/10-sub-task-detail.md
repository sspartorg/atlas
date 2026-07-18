# Sub-task Detail

**Route:** `/issues/sub-tasks/:id` • **Component:** `packages/web/src/pages/SubTaskDetail.tsx` • **Slug:** `issues`

## Purpose
Single sub-task view. Uses the unified `IssueDetailShell`. Title, description, proposed plan, and acceptance criteria are editable inline.

## States
- **Resolving**: skeleton while the page scans stories to find this sub-task
- **Not found**: "Sub-task not found" + back button
- **Populated**: shared shell layout

## UI elements
**Breadcrumb**: Projects → project → Issues → parent `STR-NNN` → sub-task short id. Ends with `CopyLinkButton`.

**Header (via shell)**
- `EditableTitle` — Enter saves via `api.subTasks.update`.
- **3-dots actions menu**: **Clone item…** opens `NewIssueModal` pre-filled with the sub-task's title (`CLONE <title>`), description, and acceptance_criteria; same parent story; status reset to `draft`. After create, a `relates_to` link to the source is attached. Below a divider: **Delete this sub-task…**.
- **`AddRelatedMenu`** (Jira-style `+` button) on its own row below the title. Options: **Add relates-to**, **Add blocked-by** → opens `LinkPickerDialog`. (Sub-tasks have no natural children.)
- `KindChipDetail kind="sub_task"`.

**Blocked-by + Relates-to** sections (`RelatedItemsCard`) hide when their link list is empty — `+` menu carries the add path.

**Body cards** (in order)
- `EditableMarkdownCard` "Description".
- `EditableMarkdownCard` "Acceptance criteria" — body renders as `<ul>` via `renderBody`.

**Right rail**
- `DetailsRailCard` with Project, Parent story (link), Status (`StatusPickerPopover`), Assignee (`AssigneePickerPopover`), Rounds (A04 — `X / Y` against the assignee's `max_rounds`; hidden when no assignee; clickable → `ResetRoundsPopover` so Owner can wipe the counter and give the agent a fresh budget), Created, Last updated.

## Why these affordances exist
- **EditableTitle + EditableMarkdownCards** — Sub-tasks are the smallest implementation unit; agents (or the Owner) refine them as the work uncovers details. Inline edit keeps the iteration tight without bouncing through a modal.
- **Acceptance criteria card** — A sub-task without acceptance criteria can't be marked done deterministically; surfacing the field as a first-class card pressures the author to fill it before agent hand-off.
- **Parent story link in rail** — Sub-tasks share context with siblings on the parent; the rail link is the fastest path back to that context.
- **Status picker with bidirectional ready ↔ in_progress ↔ blocked** — Sub-tasks use a simpler 4-state machine where work can stall and resume; the popover exposes those backward moves so the Owner can record blockers without overriding.

## Data resolution
`useSubTaskFull(id)` is now the single composite fetch (`SubTaskDetail.tsx:48`). The legacy "scan every story's sub-task list" path is retired — server-side `GET /api/sub-tasks/:id/full` returns the sub-task + parent story + project + activity in one round-trip.

## Hooks used
- `useSubTaskFull(id)` — single composite hook
- `useEpics`, `useProjects`, `useAgents`, `useSettings`
- `useUpdateSubTask`, `useTransitionSubTask`, `useAssignSubTask`, `useDeleteSubTask`
- `useItemAgentRuns(id)` — recent agent runs against this sub-task
- `useProjectLabels(projectId)` — labels picker

## API endpoints touched
- `GET /api/sub-tasks/:id/full` — single composite endpoint
- `PATCH /api/sub-tasks/:id` (title, description, acceptance_criteria, labels)
- `PATCH /api/sub-tasks/:id/status`, `PATCH /api/sub-tasks/:id/assign`
- `DELETE /api/sub-tasks/:id`

(Legacy `PATCH /:id/plan` retired; agent narrative flows through the comments thread.)

## Edge cases / quirks
- No direct sub-task fetch endpoint; resolution scans every story's sub-task list until the id matches. Slow if you have many stories.

## Connectivity
- **Pages**: [Story Detail](09-story-detail.md) — parent rail link and the canonical entry; [Issues](08-issues.md) — list/kanban that lands here; [Sub-bug Detail](12-sub-bug-detail.md) — sibling resolution pattern.
- **Routes**: `GET /api/stories/:id/sub-tasks` — only fetch path; the page scans story-by-story because there's no `GET /sub-tasks/:id` (the URL contract is "sub-tasks are addressed through their story"). Future direct-fetch route would replace the scan.
- **MCP tools**: `list_sub_tasks { story_id }` — Coder agent's call to enumerate siblings under a story; mirrors what the parent story's sub-items card renders.
- **Entities**: `sub_task`, `story` (parent), `agent` (assignee).

## Coming soon on this page
None.
