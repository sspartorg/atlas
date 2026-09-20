# 09 — Walk wave B: tasks, sub-tasks, queue, workflows

**Status:** todo
**Depends on:** [task-08](task-08-walk-wave-a-projects-repos.md)
**Scope:** web

## Why

Wave B is where Atlas's domain rules live — the status machine, the workflow
lock, the one-Task-one-branch rule, and the Sub-tasks steps that run a Task's
children inside its own run. These are the rules most easily violated by a
component that hardcodes what the shared machine should decide.

## What to do

Same protocol as [task-08](task-08-walk-wave-a-projects-repos.md): read the
section, keep DevTools open, work the six classes, triage against
`.agents/coming-soon.md`, log without fixing, hard-reload between write and
read.

Sections **B1–B8** of [`checklists/per-page.md`](checklists/per-page.md).

## Wave B specifics

- **Transition legality is the spine of this wave** (check class 4). The rule
  is stricter than "the right options appear": invalid transitions must be
  **absent, not greyed**. Additionally grep every component that renders a
  status control for a hardcoded status list — `.agents/functional-checklist.md:135+`
  documents what "valid" means once the Owner override and the open-children
  rule are both in play. A component with its own transition table is a
  finding even if it currently agrees with the machine, because it will drift.
- **The Owner override is the only bypass.** `?override=1` on
  `PATCH /api/tasks/:id/status`, surfaced as "Mark done anyway?". Confirm it
  exists, works, and is the *only* path that skips the machine.
- **The workflow lock returns 409.** Already proved once in
  [task-07](task-07-sample-tasks-small-medium-large.md); here confirm the UI
  surfaces the reason on every control it affects — status picker, assignee
  picker, and the sub-task inline form.
- **Sub-tasks are never queued for workflows.** `items.workflow_id` is set on
  Tasks only; sub-tasks run inside the Task's run through its Sub-tasks steps.
  The UI must not offer a workflow picker on a sub-task.
- **The repo editor on the Task rail** writes `items.repo_ids`. Changing it on
  a Task with a live run should be rejected; on an idle Task it should persist
  across a hard reload.
- **The workflow builder is the largest single surface.** Walk the node
  palette, the Start inspector and the node inspector separately. The
  validation banner ("Fix before saving") must block a save that would produce
  an unrunnable graph — try an agent node with no agent selected.
- **Run a workflow from the builder** against one of the existing ready Tasks
  rather than creating new fixture.

## Done when

- [ ] Every section B1–B8 has every check either ticked or converted to an
      `F-NNN` row in [findings.md](findings.md)
- [ ] A grep for hardcoded status arrays across `packages/web/src` is recorded
      below with its result; every hit is either justified in the evidence or
      filed as a finding
- [ ] From `draft`, only `ready` and `waiting_for_info` are offered; from
      `done`, nothing forward — paste both observations
- [ ] The 409 lock surfaces a visible reason on status, assign, and sub-task
      controls
- [ ] No workflow picker appears on a sub-task detail page
- [ ] The builder refuses to save an invalid graph, and says what is wrong
- [ ] Console error count per page recorded; no finding fixed during this task

## Evidence

*(filled during execution)*

Hardcoded-status-list grep: ____

| Page | Console errors | Findings filed |
|---|---|---|
| B1 Tasks | | |
| B2 Task New | | |
| B3 Task Detail | | |
| B4 Sub-task Detail | | |
| B5 Queue | | |
| B6 Workflows | | |
| B7 Workflow Builder | | |
| B8 Workflow Run | | |
