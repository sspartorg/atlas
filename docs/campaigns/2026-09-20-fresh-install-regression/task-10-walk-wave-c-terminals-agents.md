# 10 — Walk wave C: terminals, agents, marketplace

**Status:** todo
**Depends on:** [task-09](task-09-walk-wave-b-tasks-workflows.md)
**Scope:** web

## Why

Wave C holds the one path in Atlas that can delete the Owner's own work:
a standalone terminal session runs against a real folder with no worktree, and
`routes/cli-sessions.ts:975` explicitly refuses worktree cleanup for it because
cleanup would `rm -rf` that folder. Teardown keys off `worktree_branch !== null`,
never off `worktree_path`. That guard gets tested here, deliberately, with a
disposable folder.

It also holds the agents surface, where two cross-cutting invariants live:
X2 (every writer into `agents` calls `assertModelInRegistry` first, because
`agents(cli, model)` is a composite FK with `ON DELETE RESTRICT`) and X3
(agent-authored rows must carry `agent_id`, or an author renders as the
literal string "Agent").

## What to do

Same protocol as [task-08](task-08-walk-wave-a-projects-repos.md).
Sections **C1–C12** of [`checklists/per-page.md`](checklists/per-page.md).

## Wave C specifics

### The standalone guard — test it, carefully
Create a **disposable** git repo outside the workspace
(`/tmp/standalone-canary`, `git init`, one commit). Start a standalone session
against it, let it run briefly, then stop it. Afterwards:

```
cd /tmp/standalone-canary && git status && ls -la
```

The folder must be **intact**. If it is gone or emptied, that is the campaign's
worst-case **P0** and the walk stops until it is ruled on.

Never point a standalone session at `~/Work/workspace/atlas-demo-api`, at this
repo, or at anything you would miss.

### Session lifecycle
- **Create** does `ensureWorktree` → stage `.atlas` → run that repo's setup
  script, each step rolling back the previous on failure
  (`cli-sessions.ts:320, 470`). Force a setup failure and confirm the rollback:
  400 `project_setup_failed`, worktree removed, no orphan row.
- **Resume does not re-run the setup script** (`cli-sessions.ts:791`). It
  re-stages `.atlas` only. Confirm by putting a marker file write in the setup
  script and checking it does not reappear after a pause/resume.
- **Stop** stages only the files selected in `StopSessionModal`. Select a
  subset deliberately and confirm the others stay uncommitted.
- The session row is marked `closed` with `finalize_pr_url` and SSE is emitted
  **before** cleanup; transcript ingest and cost computation are awaited after.

### Agents and marketplace
- **X2:** try to save an agent with a `(cli, model)` pair absent from
  `cli_models`. The failure must name the problem, not surface an opaque 500.
- **X3:** a comment written by a running agent must render that agent's name,
  not "Agent". Grep the component for string literals that look like data.
- **Install from the marketplace** and confirm the agent appears in `/agents`
  after invalidation **and** after a hard reload (check class 3). A failed
  install must name which agent failed and why — never a bare count. This is
  the 2026-09-12 bug that shipped.
- **A non-workflow run** (`POST /api/run`, "Run now") gets a throwaway
  `mkdtemp` directory, not a worktree, and rejects `issue_id` with "Runs on an
  item go through a workflow". Confirm both.
- **Dry run** on the Test Run tab streams `dry_run_*` over SSE.

## Done when

- [ ] Every section C1–C12 has every check either ticked or converted to an
      `F-NNN` row in [findings.md](findings.md)
- [ ] **`/tmp/standalone-canary` survives a standalone stop** — paste
      `git status` and `ls -la` from after the stop
- [ ] A forced setup failure on session create rolls back cleanly: 400
      `project_setup_failed`, no worktree left, no session row
- [ ] Pause/resume does **not** re-run the setup script — paste the marker-file
      evidence
- [ ] Stop stages only the selected files
- [ ] An agent saved with an unregistered `(cli, model)` pair fails with a
      named reason, not a 500
- [ ] An agent-authored comment renders the agent's real name
- [ ] A marketplace install appears in `/agents` after a hard reload
- [ ] `POST /api/run` with an `issue_id` is rejected with the documented message
- [ ] Console error count per page recorded; no finding fixed during this task

## Evidence

*(filled during execution)*

| Page | Console errors | Findings filed |
|---|---|---|
| C1 Terminal | | |
| C2 Terminal Session | | |
| C3 Terminal Layout | | |
| C4 Terminal Standalone | | |
| C5 Terminal History | | |
| C6 Agents | | |
| C7 Agent Detail | | |
| C8 Agent Run Detail | | |
| C9 Marketplace | | |
| C10 Marketplace Agent Detail | | |
| C11 Marketplace Workflow Detail | | |
| C12 MCP Tools | | |
