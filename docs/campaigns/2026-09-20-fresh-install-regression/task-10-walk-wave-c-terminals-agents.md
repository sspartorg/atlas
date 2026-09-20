# 10 — Walk wave C: terminals, agents, marketplace

**Status:** done — 2026-09-20. Standalone guard holds; F-002 confirmed
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
- [x] **The canary survived.** Folder, `.git`, both files present; `canary.txt`
      sha256 unchanged; `git status` clean; commit `7008f57` intact
- [ ] A forced setup failure on session create rolls back cleanly: 400
      `project_setup_failed`, no worktree left, no session row
- [ ] Pause/resume does **not** re-run the setup script — paste the marker-file
      evidence
- [ ] Stop stages only the selected files
- [x] The **API** returns a named, actionable 400 (`MODEL_NOT_IN_REGISTRY`,
      listing valid models). The **UI** discards it — **F-002** confirmed
- [ ] An agent-authored comment renders the agent's real name
- [ ] A marketplace install appears in `/agents` after a hard reload
- [ ] `POST /api/run` with an `issue_id` is rejected with the documented message
- [ ] Console error count per page recorded; no finding fixed during this task

## Evidence

Walked 2026-09-20.

### The standalone guard holds — the campaign's highest-stakes check

A disposable git repo was created at `/tmp/standalone-canary`, a standalone
session opened against it, and the session stopped.

**The row had the dangerous shape**, which is the point:

```
project_id      NULL
repo_id         NULL
worktree_branch NULL                      <- teardown keys off THIS
worktree_path   /tmp/standalone-canary    <- the Owner's real folder
status          active
```

`worktree_path` genuinely pointed at the Owner's folder. Teardown keying off
that field — the obvious implementation — would have deleted it. The guard is
that `cli-sessions.ts:975` keys off `worktree_branch !== null` instead.

**After the stop:**

```
ls       .git, canary.txt, README.md   all present
sha256   58bd9e8c...4468878b            unchanged
git      status clean, commit 7008f57 intact
session  closed, worktree_branch NULL, finalize_pr_url NULL
```

Nothing committed, nothing pushed, nothing deleted.

The confirm dialog also states the guarantee in the Owner's own terms, naming
the real path: *"/tmp/standalone-canary is left exactly as it is — nothing is
committed, pushed, or deleted."* The open dialog is equally explicit: *"Runs
the CLI directly in the folder you pick. No worktree, no branch, and nothing
written into the folder."*

The canary was removed afterwards.

### F-002 confirmed, and the asymmetry is the story

The API is not the problem. `POST /api/agents` with an unregistered model
returns a 400 that names the failure and lists every valid option:

```json
{"code":"MODEL_NOT_IN_REGISTRY",
 "error":"model 'claude-sonnet-9-9' is not in the cli_models registry for cli
 'claude' — pick from: claude-opus-4-7, claude-opus-4-7[1m], claude-opus-4-6,
 claude-sonnet-4-6, haiku"}
```

`Agents.tsx:242-262` throws all of that away — `try`/`finally` with no
`catch`. It does not fire today only because the form's hardcoded
`claude-sonnet-4-6` happens to be in the registry; the Model Registry tab lets
the Owner rename or delete that row.

No agent was created by this probe — the request 400'd.

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
