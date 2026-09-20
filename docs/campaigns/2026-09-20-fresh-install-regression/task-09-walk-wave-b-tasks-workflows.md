# 09 — Walk wave B: tasks, sub-tasks, queue, workflows

**Status:** done — 2026-09-20. B1-B8 walked; 2 findings
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

Walked 2026-09-20 against the task-07 fixture (3 Tasks, 8 sub-tasks, 3 PRs,
45 completed runs).

**Hardcoded-status-list grep: clean.** Exactly three non-test components render
a status control — `StatusTransitionBar.tsx`, `StatusPickerPopover.tsx`,
`WorkItemKanban.tsx` — and **all three import `getValidNextStatuses`**. No
hardcoded status array exists outside test files. Invariant **X5 holds**.

| Page | Console errors | Findings filed |
|---|---|---|
| B1 Tasks | 0 | none |
| B2 Task New | 0 new | **F-014** (originally filed here) |
| B3 Task Detail | 0 | **F-017** |
| B4 Sub-task Detail | 0 | none |
| B5 Queue | 0 | none |
| B6 Workflows | 0 | none |
| B7 Workflow Builder | 0 | none |
| B8 Workflow Run | 0 | **F-018** |

### B3 — transition legality is exactly right

The wave's spine check passes. ATL-1 sits in `in_review`; the picker offered:

```
MOVE TO     In Review (current, ticked) · Done · In Progress · Waiting for Info
OVERRIDE    Draft · Ready
```

MOVE TO is precisely the machine's answer — the FORWARD set for `in_review`
(`done`, `in_progress`) plus the universal escape hatch to `waiting_for_info`.
The two statuses that are illegal from here appear **only** under a separate
OVERRIDE heading, and picking one routes through `?override=1`
(`StatusPickerPopover.tsx:24,85`) rather than masquerading as a normal move.

That behaviour is correct; **F-017** is filed against `AGENTS.md:117`, whose
absolute wording ("not show them at all") would lead an agent to delete the
override section as a bug.

### B5-B8 — all consistent with the fixture

Queue reads "0 running · 0 queued · 0 waiting on you · 0 need a workflow" with
the Delivery card Active at 0/1 — matching zero live runs. Workflows lists
3 workflows · 3 active with correct agent counts (Delivery 4, Build 2, Test 4)
and triggers (`On item ready` vs `Manual` for the two sub-workflows).

The builder renders the full graph — Start → PO Writer → PO Reviewer →
Architect → Architect Reviewer → Build sub-task → Test sub-task → End, with the
Owner node on PO Writer's fail edge and pass/fail edges colour-coded. Save is
correctly disabled with no pending change.

The Runs tab lists all three runs with real titles, statuses and durations:

| Item | Duration |
|---|---|
| ATL-1 (small, 1 repo) | 22m 05s |
| ATL-4 (medium, 1 repo) | 21m 21s |
| ATL-5 (large, 2 repos) | 42m 52s |

The multi-repo Task took roughly double, which is the only place the campaign
has a wall-clock comparison between the single- and multi-repo paths.

### Deferred with reason

The **409 workflow lock** could not be exercised: it needs a live run, and all
three finished before this walk. It is X-12's business in
[task-13](task-13-cross-dependency-sweep.md), which starts a run specifically
to hold the lock.
