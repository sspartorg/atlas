# Task Detail

**Route:** `/tasks/:id` • **Component:** `packages/web/src/pages/TaskDetail.tsx` • **Slug:** `tasks`

## Purpose
Full view of one Task (ADR 0015): its brief (description, acceptance criteria), the Architect's spec, the one PR its workflow run opened, its sub-tasks, links, conversation and activity. The rail is where the Owner queues the Task for a workflow.

## States
- **Loading**: `IssueDetailLoading withBreadcrumb`
- **Not found**: "Task not found" + **Back to Tasks**
- **Populated**: shared `IssueDetailShell` (`pages/issues/IssueDetailShell.tsx`)

## UI elements
**Shell**
- Breadcrumb: Tasks → Task id (mono) + `CopyLinkButton`.
- `EditableTitle` → `PATCH /api/tasks/:id {title}`.
- **3-dots menu** → `IssueDeleteAction` (Delete → `ConfirmDeleteModal`, "every sub-task, comment, and run history will be removed"), then `/tasks`.
- **`AddRelatedMenu`** (`+`): **Add relates-to**, **Add blocked-by** → `LinkPickerDialog` (candidates: every Task and sub-task).

**Body cards** (in order)
- **Description** and **Acceptance criteria** — `EditableMarkdownCard`s → `PATCH /api/tasks/:id`.
- **Spec** — read-only `MarkdownPreview` of `spec_md`; only when non-empty (the Architect step writes it).
- **Pull request** — link to `pr_url`; only when set (the workflow run's End writes it).
- **Sub-tasks** — `WorkItemTable` of `sub_tasks` (id, title, status, labels, assignee, reporter, updated); row → `/sub-tasks/:id`. Rows come in run order (hand-set order, then oldest first). Header **Reorder** (2+ sub-tasks) opens `ReorderSubTasksDialog` (`pages/tasks/`): up / down per row ("Move ATL-3 up"), **Save order** → `PUT /api/tasks/:id/sub-tasks/order`. Header **Add sub-task** opens the inline `AddSubTaskForm` (Title required, Description, Acceptance criteria, Labels with project suggestions) → `POST /api/tasks/:id/sub-tasks`; typed text arms `useDraftGuard`.
- `RelatedItemsCard` — Blocked by / Relates to / Tested by / Pull Requests sections, each hidden while empty. A Task imported by the Jira bridge (ADR 0016) also shows a **Jira** section above Pull Requests: its `jira_issue` link as the key in mono, the issue summary and an open-in-new icon. The link opens the Jira issue in a new tab and has no remove button. The Pull Requests list shows `pull_request` links only. No "Add test link" here (`allowAddTestLink` omitted — a Task isn't a `tested_by` source).
- `ConversationCard` — thread + composer. While the Task is `waiting_for_info` with no assignee and its latest run belongs to a workflow, helper text reads "Replying continues the waiting workflow run." (`ActivityCard.tsx:706`).

**Right rail**
- `DetailsRailCard`: Project, Status (`StatusPickerPopover`, with Override), Assignee (`AssigneePickerPopover`, PO-role agents under **Suggested**; locked while `in_progress`), **Workflow** + **Workflow run** rows (below), Reporter, Priority, Labels (`useProjectLabels`), Total cost (sum of `useItemAgentRuns`), **Branch** / **Path** (`worktree_branch` / `worktree_path`), Created, Updated.
- `ItemWorkflowPanel` (`pages/workflows/ItemWorkflowPanel.tsx`, Tasks only): **Workflow** select — None + the project's `input_kind='item'` workflows → `PUT /api/items/:id/workflow`; "Create a workflow" link when the project has none. **Workflow run** — latest run's status chip (→ `/workflows/:id/runs/:runId`) + **Start now** (`POST /api/workflows/:id/runs`) when a workflow is set and no run is live. **Continue · N open** (contained button, tooltip "Runs the open sub-tasks on the same branch and updates the pull request") when the latest run `completed`, the Task has open sub-tasks (not `in_review`/`done`) and the workflow has a Sub-tasks step → `POST /api/workflows/:id/runs { item_id, from_subtasks: true }`. This is the rework loop: after checking the branch, add a fix sub-task (or move one back to In Progress) and continue. Picking a workflow for a **Draft** Task also moves it to **Ready** (queued).
- Status → **Done** while any `pull_request` link isn't `merged`: `POST /api/issues/task/:id/external-links/refresh` first; still unmerged → **Mark done anyway?** (`ConfirmActionModal`) listing the PRs.
- `ActivityLogCard` — status / assignment / field events.

## Why these affordances exist
- **Sub-tasks on the Task page** — there is no sub-task list page; a Task's sub-tasks are the contents of its one PR, so they live with it.
- **Workflow select in the rail** — only Tasks are queued for workflows (`PUT /api/items/:id/workflow` 400s on a sub-task); sub-tasks run inside the Task's run.
- **Spec / PR as read-only cards** — both are written by the workflow (Architect step, End); the Owner reads them here.

## Hooks used
- `useTaskFull(id)` — `['tasks', id, 'full']` → `GET /api/tasks/:id/full`
- `useTransitionTask`, `useAssignTask`, `useUpdateTask`, `useDeleteTask` (`hooks/useTasks.ts`); `useCreateSubTask` (`hooks/useSubTasks.ts`)
- `useItemAgentRuns(id)`, `useProjectLabels(projectId)`, `useSettings`, `useDraftGuard`
- `ItemWorkflowPanel`: `useWorkflows(projectId)`, `useItemWorkflowRuns(id)`, `useSetItemWorkflow`, `useStartWorkflowRun`

## API endpoints touched
- `GET /api/tasks/:id/full`
- `PATCH /api/tasks/:id` (title, description, acceptance_criteria, priority, labels), `PATCH /api/tasks/:id/status`, `PATCH /api/tasks/:id/assign`, `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/sub-tasks`
- `PUT /api/items/:id/workflow`, `GET /api/items/:id/workflow-runs`, `POST /api/workflows/:id/runs`, `GET /api/workflows?project_id=`
- `POST /api/issues/task/:id/links`, `POST /api/issues/task/:id/external-links/refresh`

## Edge cases / quirks
- **Closing a Task with open sub-tasks** → 422 (`ChildrenNotDoneError`) unless the Override path is used.
- While the Task's workflow run is `running`, status / assign PATCHes 409 (`workflow-lock.ts`); stop the run to take the Task back. A parked run doesn't lock.
- A finished run leaves the Task `in_review` when it opened a PR or any sub-task isn't `done`; the Owner closes the sub-tasks and then the Task after verifying the branch.

## Connectivity
- **Pages**: [Tasks](05-tasks.md), [New Task](06-task-new.md), [Sub-task Detail](10-sub-task-detail.md) (rows), [Workflow Run](35-workflow-run.md) (rail chip), [Analytics — Task](32-analytics-task.md).
- **MCP tools**: `get_item { issue_type: 'task', id }` returns the Task + `sub_tasks` + project + comments + links + activity.
- **Entities**: `task`, `sub_task`, `workflow`, `workflow_run`, `comment`, `issue_event`, `agent`.

## Coming soon on this page
None.

**Closing a verified Task.** Choosing **Done** while only `in_review` sub-tasks block it shows a toast "N sub-task(s) in review — Close them with the Task?" with **Close them too** → the same PATCH with `close_sub_tasks: true`. Any sub-task still open keeps the usual "Cannot close — open children" toast. When the Task's PR merges on GitHub, the Task and its reviewed sub-tasks close by themselves (`external-links.ts` `closeMergedTask`; the scheduler re-checks in-review Tasks' PRs every tick, TTL 5 min). **Path** in Details shows the latest workflow run's worktree while that folder exists.

