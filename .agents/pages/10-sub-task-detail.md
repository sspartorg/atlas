# Sub-task Detail

**Route:** `/sub-tasks/:id` • **Component:** `packages/web/src/pages/SubTaskDetail.tsx` • **Slug:** `tasks`

## Purpose
One sub-task of a Task (ADR 0015). Sub-tasks are never queued for a workflow of their own: the Task's workflow run works them through its Sub-tasks steps, one at a time on the Task's branch. This page is where the Owner reads, edits and answers them.

## States
- **Loading**: `IssueDetailLoading`
- **Not found**: "Sub-task not found" + **Back to Tasks**
- **Populated**: shared `IssueDetailShell`

## UI elements
**Shell**
- Breadcrumb: Tasks → parent Task id (→ `/tasks/:taskId`) → sub-task id + `CopyLinkButton`.
- `EditableTitle` → `PATCH /api/sub-tasks/:id {title}`.
- **3-dots menu**: **Clone item** — `POST /api/tasks/:taskId/sub-tasks` with `CLONE <title>`, the description, acceptance criteria and labels, then a `relates_to` link back to the source, then navigates to the clone (`SubTaskDetail.tsx` `handleClone`). Below a divider: **Delete** (→ parent Task).
- **`AddRelatedMenu`** (`+`): **Add relates-to**, **Add blocked-by** → `LinkPickerDialog`.

**Body cards**
- **Description**, **Acceptance criteria** — `EditableMarkdownCard` → `PATCH /api/sub-tasks/:id`.
- `RelatedItemsCard` with `allowAddTestLink` — **Tested by** / **Tests** section (`tested_by` twin links) always offers **Add test link**; that picker is restricted to sub-tasks of the same Task (`restrictToTaskId`). Blocked by / Relates to / Pull Requests hide while empty.
- `ConversationCard` — while the sub-task is `waiting_for_info` with no assignee and its latest run is a workflow step, helper text reads "Replying continues the waiting workflow run." The reply resumes the sub-task's run and its Task's run.

**Right rail**
- `DetailsRailCard`: Project, **Task** parent link, Status (with Override), Assignee (locked while `in_progress`), Reporter, Priority, Labels, Total cost, Created, Updated. No Workflow rows and no Branch / Path — the sub-task shares its Task's worktree.
- `ActivityLogCard`.

## Why these affordances exist
- **Labels matter here** — a Sub-tasks step with a label (e.g. `qa`) takes only sub-tasks carrying it; an unlabelled step takes the rest. PO Writer labels its sub-tasks `dev` / `qa`.
- **Test links** — PO Writer pairs every dev sub-task with a `[QA]` twin via `tested_by` (twin → dev).

## Hooks used
- `useSubTaskFull(id)`, `useDeleteSubTask` (`hooks/useSubTasks.ts`)
- `api.subTasks.update / transition / assign / create`, `api.issueLinks.create` directly, invalidating `['tasks']`, `['sub-tasks']`, `['issues']`, `['labels']`
- `useItemAgentRuns(id)`, `useProjectLabels(projectId)`, `useSettings`

## API endpoints touched
- `GET /api/sub-tasks/:id/full` — sub-task + parent `task` + project + links + activity + agents
- `PATCH /api/sub-tasks/:id` (title, description, acceptance_criteria, priority, labels), `PATCH /api/sub-tasks/:id/status`, `PATCH /api/sub-tasks/:id/assign`, `DELETE /api/sub-tasks/:id`
- `POST /api/tasks/:taskId/sub-tasks` + `POST /api/issues/sub_task/:id/links` (Clone)
- `POST /api/issues/sub_task/:id/external-links/refresh` (Done guard)

## Edge cases / quirks
- A sub-task whose run finished is `in_review`, not `done`: the Owner closes it after checking the Task's branch. A Sub-tasks step only picks up sub-tasks that are neither `in_review` nor `done`, so re-running a Task redoes only the unfinished ones.
- Status / assign PATCHes 409 while the sub-task's own workflow run is `running`.
- Creating a sub-task while its Task's run is live is fine: the run picks it up at its Sub-tasks step, or its End gate sends the run back to that step.

## Connectivity
- **Pages**: [Task Detail](07-task-detail.md) (parent; Sub-tasks table), [Workflow Run](35-workflow-run.md) (a sub-task's run).
- **MCP tools**: `get_item { issue_type: 'sub_task', id }` (includes the parent `task`); `create_item { issue_type: 'sub_task', payload: { task_id, … } }`.
- **Entities**: `sub_task`, `task` (parent), `agent`.

## Coming soon on this page
None.
