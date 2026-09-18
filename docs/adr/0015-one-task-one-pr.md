# 0015. One Task, One Branch, One PR

**Date:** 2026-09-18
**Status:** Accepted. Supersedes the separate item kinds and the End-node child routing of [0014](0014-workflows-replace-agent-handoffs.md).

## Context

ADR 0014 made a workflow run one item end to end, but at End it routed each child item into *another* workflow. An epic planned into 10 stories became 10 runs, 10 branches and 10 PRs:
- Every PR was half the feature, so nothing could be tested as a whole.
- The Owner could not tell which item sat at which node.
- Merging 10 dependent PRs in the right order was manual work.

The Owner's examples:
1. **Ten bug fixes grouped under one item** should land as one PR they can check out and verify together.
2. **A 10–15 story change** (like ADR 0014 itself) is only testable as one branch.
3. **A daily AI-news article** is a chain of agents with no review. It publishes straight to the project, with no PR.

The rule they gave: the Owner schedules or identifies the work and picks a workflow. The workflow does everything the item needs, including creating and working its child items, and is finished only when every checklist passes. The Owner then verifies the one result.

## Decision

- **Two item kinds.** A **Task** is the top-level item and replaces `epic`. A **Sub-task** is its only child kind. Stories, bugs and sub-bugs and their pages are removed.
- **A Task's workflow run does everything in one worktree, on one branch, and delivers one PR.** Sub-tasks are never assigned to workflows.
- **A new graph node, Sub-tasks**, runs a **sub-workflow** once per matching sub-task of the Task, one at a time, inside the Task's worktree. There are no child branches and no merges.
- **Parallelism comes from Tasks, not sub-tasks.** Each workflow sets `max_parallel_runs`, and each Task run has its own worktree.
- **End can push straight to the default branch** (`push_to_default`) for publish-style workflows that need no review.

### Decisions made with the Owner (2026-09-18)

| Topic | Decision |
|---|---|
| Name | Task + Sub-task |
| Sub-task concurrency | One at a time inside a Task. Speed comes from parallel Tasks. |
| Publish without review | End option: push to the default branch, no PR |
| Branch | Continue on `worktree-workflows-phase-1` and ship v1 and v2 as one change |
| `packages/shared` | Owner-sanctioned edits for this feature: the Task/Sub-task types and schemas, the removal of the story/bug/sub-bug kinds, and the Sub-tasks graph node |

## Design

### Items: migration `037_tasks_and_subtasks.ts`
- `items.type` and `parent_type` move from the `item_type` enum to text + CHECK (`task`, `sub_task`). The trigger enforces two rules: a task has no parent, and a sub-task's parent is a task.
- **Data conversion:**
  - `epic` becomes `task`.
  - `story` and `bug` become `sub_task` under the same parent.
  - An old `sub_task` or `sub_bug` becomes a `sub_task` under its story's task.
  - Bug-only fields are folded into the description as markdown, then dropped.
- `items.created_by_workflow_run_id` is dropped.
- Stored notification deep links are rewritten to `/tasks/:id` and `/sub-tasks/:id`.
- **API:** `/api/tasks` and `/api/sub-tasks` (created under `/api/tasks/:id/sub-tasks`).
- **MCP:** `create_item` takes `task_id` for a sub-task.
- **Web:** `/tasks`, `/tasks/:id` and `/sub-tasks/:id`.

### Workflows: migration `038_workflow_subtasks.ts`
- **`workflow_runs`:**
  - `parent_workflow_run_id`, `parent_node_id`. A sub-task's run is a child row of the Task's run.
- **`workflows`:**
  - `input_kind` gains `sub_task`, which marks a sub-workflow. It is manual only, never dispatched, and its End never delivers.
  - `max_parallel_runs` (1–10) caps the running Task runs per workflow. Parked runs don't hold a slot.
  - `push_to_default`: End pushes `HEAD` to the default branch and opens no PR.

### Graph
- **New node `subtasks`:** `sub_workflow_id` (required) and `label` (optional). It has exactly one pass edge and no fail edge. Allowed only in `input_kind='item'` workflows.
  - **With a label**, it takes the Task's open sub-tasks carrying that label.
  - **Without a label**, it takes the open sub-tasks that no other Sub-tasks node in the graph claims.
  - **Open** means status is neither `in_review` nor `done`, so re-running a Task redoes only unfinished sub-tasks.
- End loses `child_workflow_id` and `test_child_workflow_id`.
- A sub-workflow can't contain a Sub-tasks node, so nesting is one level deep.

### Engine
Children reuse the engine unchanged: spawn, step outcome, loops and park all work the same. What changes:
- **Sub-tasks node:** picks the oldest open matching sub-task and starts a child run. The child shares the parent's branch, worktree and `setup_done`. It re-checks after each child, so sub-tasks created mid-run are picked up. When none are left, it follows the pass edge.
- **Child End:** commits leftovers, sets the sub-task to `in_review` and advances the parent. It never pushes.
- **Child park:** the sub-task parks as usual, with a comment and a notification. The parent run is marked `waiting_for_owner` at the Sub-tasks node, and the Task goes to `waiting_for_info` without a second comment. Replying on either the sub-task or the Task resumes both.
- **Root End gate:** the run is complete only when every sub-task is. An open sub-task created after its step passed (e.g. a fix a later step asked for) sends the run back to the Sub-tasks step that claims it, counted in its own `gate_rounds` budget (capped by `max_loops`, separate from step loops); one that no step claims parks the run at End. Otherwise End delivers once, and the PR body lists every sub-task with its outcome. The Task ends `in_review` while a PR is open or any sub-task is not `done` — the Owner closes the sub-tasks after verifying.
- **Continue after review** (`POST /api/workflows/:id/runs { item_id, from_subtasks: true }`, the Task page's "Continue · N open" button): the Owner adds a fix sub-task, or moves one back to In Progress. The new run starts at the first Sub-tasks node on the Task's existing branch, skipping planning, works only the open sub-tasks, and End pushes onto the same PR and refreshes its description.
- **Queueing:** assigning a workflow to a Draft Task moves it to Ready, because dispatch only picks up Ready Tasks.
- **Order:** sub-tasks run by `items.sort_order` (set by the Owner's Reorder dialog, `PUT /api/tasks/:id/sub-tasks/order`), then oldest first.
- **Closing:** closing a Task whose sub-tasks are all `in_review` can close them too (`close_sub_tasks`, the "Close them too" toast action). When the Task's PR merges, the schedule tick closes its reviewed sub-tasks and then the Task, unless a sub-task is still open.
- **Sharing:** a workflow exports as a zip (`format_version` 1) with its sub-workflows and agents, imports into any project, and can be published to the Marketplace (`published_workflows`, migration 041) for "Use in a project".
- **Cancel** always cancels the root run and its live children.
- **Reconcile** skips a parent whose child is running.
- **Dispatch** starts ready Tasks up to `max_parallel_runs`.

## Consequences

- The Owner verifies one branch per Task and merges one PR. Sub-tasks stay visible as the list of what the PR contains.
- **Hard cut:** story, bug and sub-bug pages, routes and MCP kinds are gone. Existing rows are converted, not lost.
- **Catalog prompts change:**
  - PO Writer creates sub-tasks labelled `dev` or `qa`.
  - Architect writes the Task's spec.
  - Coder and QA work on sub-tasks and read the Task's spec.
  - Automation tests the current branch instead of waiting for a dev PR to merge.
- **Templates:** `delivery` (Task), `build` and `test` (sub-workflows) and `ai-readiness` replace `planning`, `dev` and `qa`.

## Verification (2026-09-18)

Real-agent run on the sandbox project (Claude Sonnet 4.6):
- **Setup:** Task SDB-17 had two Owner-written bug sub-tasks. It ran through a "Bug batch" workflow: Start, then a catch-all Sub-tasks step using the Build sub-workflow (Coder ⇄ Code Reviewer), then End with push + PR.
- **Sequencing:** SDB-18 ran, then SDB-19, both on `atlas/wf/SDB-17` in one worktree, with no wait between sub-tasks.
- **Delivery:** one push and one PR (sandbox #11) with four commits. The PR body lists both sub-tasks.
- **Statuses:** the Task and both sub-tasks ended `in_review`.
- **Tests:** 32/32 sandbox tests pass on the branch.

Full Delivery template on Task SDB-20 ("Remove a todo from the CLI"):
- **Planning:** PO Writer asked its brainstorm questions and parked; one Owner reply resumed it. It created SDB-21 (`dev`) and SDB-22 (`[QA]`, `qa`, `tested_by` → SDB-21), and PO Reviewer passed them.
- **Spec:** the Architect wrote one spec on the Task, with a `### SDB-21` group in its change list.
- **Sub-tasks:** Build ran SDB-21 (Coder → Code Reviewer). Then Test ran SDB-22 (QA Writer → QA Reviewer → Automation → Automation Reviewer) on the same branch, against SDB-21's code.
- **Result:** 11 agent steps, no loops, one PR (sandbox #12, 7 commits), all items `in_review`, $3.98 including the sub-tasks. 47/47 tests pass and every acceptance criterion holds.

Continue after review:
- **Setup:** the Owner added SDB-23 ("Accept `rm` as a short alias") and pressed Continue.
- **Run:** it started at the Build step, with no planning, on `atlas/wf/SDB-20`.
- **Review loop:** Code Reviewer rejected the first attempt because SDB-23's usage change broke a test SDB-21 had added. The Coder fixed it on the second pass.
- **Result:** End pushed onto the same PR #12 (now 10 commits) and refreshed its description to list all three sub-tasks. 50/50 tests pass.

Parallel Tasks and a question inside a sub-task:
- **Setup:** Bug batch set to `max_parallel_runs` 2. Two Tasks were queued together: SDB-24 (a count command) and SDB-26 (an export command whose sub-task told the Coder to ask the Owner for the format first).
- **Parallel:** both runs started within 4 seconds, each on its own branch and worktree (`atlas/wf/SDB-24`, `atlas/wf/SDB-26`).
- **Question:** SDB-27's Coder parked with one comment on the sub-task. The SDB-26 run parked at its Sub-tasks step and the Task went to `waiting_for_info` with no second comment. One Owner reply on the **Task** resumed both, and the Coder built the JSON export the reply asked for.
- **Result:** two PRs (sandbox #13 and #14), each with one commit, and 32/32 tests pass on each branch.

## Skipped (add when needed)

- Parallel sub-tasks inside one Task. They need per-branch worktrees and merge/conflict handling; the Owner chose parallel Tasks instead.
- Nesting deeper than Task → Sub-task.
