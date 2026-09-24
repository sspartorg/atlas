# Architecture

Atlas is a single-owner desktop-style web app for managing AI agents that operate on git repos. It runs entirely on the owner's machine. There is no auth, no multi-user, no cloud database.

---

## Package layout (pnpm monorepo)

```
         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
         â”‚                       @atlas/shared                       â”‚
         â”‚   types Â· constants Â· status-machine Â· Zod schemas         â”‚
         â”‚   (depends only on `zod`; imported by api AND web)         â”‚
         â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                      â–²                                â–²
                      â”‚ imports                        â”‚ imports
                      â”‚                                â”‚
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚           @atlas/api            â”‚     â”‚         @atlas/web         â”‚
   â”‚  Fastify Â· Kysely + pg Â·         â”‚ â”€â”€â–¶ â”‚  React Â· MUI Â· React Router â”‚
   â”‚  Knex (migrations) Â·             â”‚HTTP â”‚  TanStack Query Â· Vite      â”‚
   â”‚  Croner Â· child_process Â· zod    â”‚ SSE â”‚  (no DB, no fs access)      â”‚
   â”‚  + SSE                           â”‚     â”‚                             â”‚
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Hard rule:** `@atlas/web` never imports from `@atlas/api`. They communicate only through `packages/web/src/api/api.ts` over HTTP + SSE.

---

## Dev vs prod local stacks

Atlas runs two isolated local stacks side-by-side. The `ATLAS_ENV` env var
(default `dev`) routes `load-env.ts` (api) and `vite.config.ts` (web) to the
matching env file and downstream config:

| Surface | Dev (default, `pnpm dev`) | Prod (`pnpm prod`) |
|---|---|---|
| Web port | 4000 | 5000 |
| API port | 4001 | 5001 |
| MCP port | 4500 (shared, first-boot-wins) | 4500 |
| Postgres host port | 5500 | 5510 |
| Container | `atlas-postgres` | `atlas-postgres-prod` |
| Data volume | `atlas-pg` | `atlas-pg-prod` |
| DB name | `atlas` | `atlas_prod` |
| Env file | `.env` | `.env.prod` |

Web reads `WEB_PORT`; API reads `API_PORT` (each with a `PORT` fallback for
E2E). Process diagram below shows the dev stack; prod is the same shape with
the ports / container swapped.

## Process model

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                      Owner's machine (single process tree)             â”‚
â”‚                                                                        â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”‚
â”‚  â”‚   Vite dev server    â”‚         â”‚     Fastify API server         â”‚   â”‚
â”‚  â”‚   (Port 4000 dev /   â”‚         â”‚     (Port 4001 dev /           â”‚   â”‚
â”‚  â”‚    5000 prod)        â”‚         â”‚      5001 prod)                â”‚   â”‚
â”‚  â”‚   serves @atlas/web â”‚ â—€â”€HTTPâ”€â–¶â”‚                                â”‚   â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜         â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚   â”‚
â”‚                                   â”‚  â”‚ Kysely â†’ pg.Pool         â”‚  â”‚   â”‚
â”‚                                   â”‚  â”‚ Postgres 16 (docker;     â”‚  â”‚   â”‚
â”‚                                   â”‚  â”‚  service `atlas-postgresâ”‚  â”‚   â”‚
â”‚                                   â”‚  â”‚  on :5500, or            â”‚  â”‚   â”‚
â”‚                                   â”‚  â”‚  atlas-postgres-prod on â”‚  â”‚   â”‚
â”‚                                   â”‚  â”‚  :5510 in prod)          â”‚  â”‚   â”‚
â”‚                                   â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚   â”‚
â”‚                                   â”‚                                â”‚   â”‚
â”‚                                   â”‚  spawn child_process per task: â”‚   â”‚
â”‚                                   â”‚   â€¢ agent-runner   (claude/   â”‚   â”‚
â”‚                                   â”‚     copilot CLI)               â”‚   â”‚
â”‚                                   â”‚   â€¢ clone-runner    (git)      â”‚   â”‚
â”‚                                   â”‚   â€¢ reclone-runner  (git)      â”‚   â”‚
â”‚                                   â”‚   â€¢ delete-runner   (rm -rf)   â”‚   â”‚
â”‚                                   â”‚   â€¢ auto-fetch-runner (git)    â”‚   â”‚
â”‚                                   â”‚                                â”‚   â”‚
â”‚                                   â”‚  Croner schedules (in-memory   â”‚   â”‚
â”‚                                   â”‚   registry) for project auto-  â”‚   â”‚
â”‚                                   â”‚   fetch + a 1-min setInterval  â”‚   â”‚
â”‚                                   â”‚   poller for workflow reconcileâ”‚   â”‚
â”‚                                   â”‚   + dispatch; both catch up    â”‚   â”‚
â”‚                                   â”‚   missed fires on boot         â”‚   â”‚
â”‚                                   â”‚                                â”‚   â”‚
â”‚                                   â”‚  external notification delivery (HTTPS to   â”‚   â”‚
â”‚                                   â”‚   api.external notification.org)            â”‚   â”‚
â”‚                                   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

### Cross-platform notes

Every spawn point in the process model is a cross-platform binary:

- `docker` / `docker compose` â€” invoked by `src/scripts/db-up.ts` and `db-down.ts` (pure Node, no PowerShell).
- `git` â€” invoked directly by `clone-runner.ts`, `reclone-runner.ts`, `auto-fetch-runner.ts`, `git-status.ts`, `git-verify.ts`. `clone-runner` and `reclone-runner` set `GIT_TERMINAL_PROMPT=0` + the GCM-suppressing env vars so credential helpers never pop UI.
- `rm -rf` is implemented via `fs.rm({ recursive, force })` in `delete-runner.ts`.
- `explorer.exe` / `open` / `xdg-open` â€” branched per `process.platform` in the `POST /api/projects/:id/repos/:repoId/reveal` handler (ADR 0018: a project has no folder; its repos do).
- `claude` / `gh` (the agent CLIs) â€” Atlas assumes the user has the right one on `PATH`; the `cli` column on each agent picks which.
- `cli = 'ollama'` is **not** a third binary. Ollama serves an Anthropic-compatible API, so Atlas spawns the same `claude` binary and repoints it with `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` from `services/ollama-env.ts` (base URL configurable via `ATLAS_OLLAMA_BASE_URL`, default `http://localhost:11434`). Consequences worth knowing: Ollama runs share Claude's argv, stream-json parsing, `--session-id`/`--resume`, and `~/.claude/projects` transcripts; they record `total_cost_usd = 0`; and the env overlay must always be spread **after** `gitInvokeEnv` so a host `ANTHROPIC_API_KEY` can't divert a free local run to Anthropic. Branch on `CLI_DIALECT` from `@atlas/shared`, never on the raw `cli` value.
- Agent runs on an item (`issueId != null`; `agent-runner.spawnCli`, claude + ollama dialects) are isolated from the Owner's personal Claude Code config. They add `--setting-sources project,local --strict-mcp-config --mcp-config <Atlas MCP only>` (`claudeIsolationArgs`), so no `~/.claude` hooks, plugins, user CLAUDE.md or `~/.claude.json` MCP servers load, while worktree `.claude/commands/atlas-*` still resolve. The prompt stays on stdin because `--mcp-config` is variadic and would swallow a positional prompt. Runs with no item (project-level workflow steps, ad-hoc runs) are exempt because scouts depend on Owner-scoped MCP servers (Playwright plugin, claude.ai Atlassian). Copilot runs are not isolated. Every agent run's child env also carries `ATLAS_API_URL=http://127.0.0.1:<API_PORT>` for `.atlas/scripts` validators. Terminal sessions (`cli-session-host.ts`) and dry runs are unchanged.

Auto-fetch runs in Node on every OS â€” `auto-fetch-runner.ts` calls the typed `performAutoFetch()` in `services/auto-fetch.ts`, which shells out to `git` via `execFile`. The previous PowerShell holdout (`auto-fetch.ps1`) was retired in C01.

The CORS allowlist + `requireMcpToken` trusted-browser-origin set are computed from `utils/lan-origins.ts`. When `ATLAS_LAN_ACCESS=true`, the helper walks `os.networkInterfaces()` for non-loopback non-link-local IPv4 addresses and adds `http://<ip>:${WEB_PORT}` (dev 4000 / prod 5000) to both sets, plus the machine's mDNS name `http://<hostname>.local:${WEB_PORT}` (lowercased, one `.local` suffix) so LAN browsers can use the friendly name instead of an IP. Vite mirrors this with `server.allowedHosts: ['.local']`. The boot log lists what got added.

### Security â€” write gate & origin allowlist

> **G-023 (2026-09-21) â€” the write gate is defence-in-depth, not a security
> boundary.** A request carrying `Sec-Fetch-Site: same-origin` passes it
> without a token, and *any* local client can set that header â€” proven with
> curl against a running API: `DELETE /api/credentials/<id>` returns 401
> without it and reaches the handler with it. No header-based check can fix
> this, because nothing in an HTTP request distinguishes a browser from a
> local process. It does still stop naive callers and, with CORS, cross-origin
> pages. A hostile process running as the Owner can read `ATLAS_MCP_TOKEN`
> from `.env` regardless, so the token is no stronger against that threat.
> Closing it needs a same-origin bootstrap setting an HttpOnly
> `SameSite=Strict` cookie â€” an Owner decision, not an improvisation.

The API has exactly one auth gate: a global Fastify `onRequest` hook (`server.ts:76â€“80`) that delegates to `requireMcpToken` (`plugins/mcp-auth.ts`) for every `POST/PUT/PATCH/DELETE`. The same `getAllowedOrigins()` set feeds `@fastify/cors`, so CORS preflight and the gate agree.

**What is checked**

| Method | Gate runs? | Origin check | Token check |
|---|---|---|---|
| `GET` (reads, SSE) | no | n/a | n/a |
| `POST`/`PUT`/`PATCH`/`DELETE` | yes | `Origin âˆˆ getTrustedBrowserOrigins()` | `X-Atlas-Token === ATLAS_MCP_TOKEN` |

**What is allowed**

1. **Empty token (`ATLAS_MCP_TOKEN=""`)** â€” gate is bypassed entirely. **Reaching this state now takes `ATLAS_MCP_TOKEN_OPEN=1`**: `main.ts` generates a 48-byte token at boot when the var is empty and persists it to the root env file, so a fresh install is closed by default (F-021). Only the e2e suite and the Lighthouse workflow opt out, because they write over plain HTTP with no browser headers.
2. **Trusted browser origin** â€” `Origin` header matches the static set (`http://localhost:${WEB_PORT}`, `http://127.0.0.1:${WEB_PORT}` â€” dev 4000 / prod 5000) plus, when `ATLAS_LAN_ACCESS=true`, the host's non-loopback IPv4s.
3. **Matching token header** â€” `X-Atlas-Token` equals `ATLAS_MCP_TOKEN`. This is the path the MCP server uses for write-side calls.

**What is rejected**

Anything else â†’ `401 unauthorized`. The most common case: a second device on the same LAN whose `Origin` is not in the trusted set because `ATLAS_LAN_ACCESS` was left at the default (`false`).

**Trade-off when `ATLAS_LAN_ACCESS=true`**

Any device on the host's LAN can write â€” fine for home Wi-Fi, **do not enable on public networks**. The boot log (`[security] ATLAS_LAN_ACCESS=true â€” trusting LAN origins ...`) lists every IP the helper added so the Owner can audit. VPN / virtual adapter IPs are intentionally included; flip the flag back to `false` if any of them is reachable from somewhere the Owner doesn't control.

## Request flow (typical mutation)

```
User clicks button in web
        â”‚
        â–¼
useMutation in hook (e.g. useTransitionTask)
        â”‚
        â–¼
api.tasks.transition(id, status)         â† packages/web/src/api/api.ts
        â”‚
        â–¼  fetch(PATCH /api/tasks/:id/status)
        â”‚
        â–¼
Fastify route handler                       â† packages/api/src/routes/tasks.ts
        â”‚
        â–¼
Zod schema parse (from @atlas/shared)
        â”‚
        â–¼
Service layer                               â† packages/api/src/services/tasks.ts
        â”‚       isValidTransition(...)      â† @atlas/shared/status-machine
        â–¼
Kysely query (pg)
        â”‚
        â–¼
Response (snake_case JSON, matches @atlas/shared types)
        â”‚
        â–¼
React Query invalidates relevant keys (['tasks'], ['issues'], ...)
        â”‚
        â–¼
UI refetches and re-renders
```

If the same mutation should ALSO notify external notification or fire an SSE event, the service layer triggers it after the DB write.

Before the handler, a global `preHandler` (`services/workflow-lock.ts`) returns 409 for `PATCH …/:id/status` and `…/:id/assign` while a `running` workflow run holds the item — the engine is the only writer of that item's status and assignee until the run parks or stops.

---

## Workflow runs (agent kickoff)

Agents never start themselves and never route items (ADR 0014, `docs/adr/0014-workflows-replace-agent-handoffs.md`). A **workflow** (`workflows` row: graph of Start / Agent / Owner / Sub-tasks / End nodes joined by pass and fail connections) starts a **workflow run**, and `services/workflow-engine.ts` drives it. Since ADR 0015 (`docs/adr/0015-one-task-one-pr.md`) the item is a **Task**: its run does everything, including its sub-tasks, in one worktree on one branch, and delivers once.

```
start (manual POST /api/workflows/:id/runs, dispatch tick, End kick, generate-ai-scaffold)
   │  startWorkflowRun: deps gate once · insert workflow_runs (graph_snapshot, one live run per item)
   │  Task → in_progress · ensureWorktree({item:null, branch}) once when use_worktree
   ▼
goTo(node after Start)
   ├─ agent node → spawnNode: items.assignee_agent_id = agent · spawnAgentRun({workflowRun})
   │     CLI runs in the shared worktree, commits, ends with an atlas-outcome block
   │     runner: completeRun / errorRun / setup_failed / stop / sweep / reaper → onStepFinished
   │        done (+ required checklist passed) → pass connection → goTo(next)   (no tick wait)
   │        NB the checklist is the agent's own self-report. Since ADR 0020 the
   │        binding check is the verification gate at End, not this block.
   │        rejected / checklist failed        → fail connection, loop_count+1 (past max_loops → park)
   │        asked_question / no outcome / error → park
   │        cancelled                          → cancel run
   ├─ owner node → park
   ├─ subtasks node → runNextSubtask: oldest open sub-task of the Task matching the node's label
   │     (open = not in_review / done; no label = sub-tasks no labelled node claims)
   │     → child run of node.sub_workflow_id: parent_workflow_run_id set, same branch + worktree,
   │       sub-task → in_progress, its steps run exactly like the above
   │     child End → commit leftovers · sub-task → in_review · no push → runNextSubtask again
   │     child park → Task run parks at this node (Task → waiting_for_info, no second comment)
   │     none left → pass connection
   └─ end node → End gate (Task runs with Sub-tasks nodes): open claimed sub-task → back to its
                  Sub-tasks node (loop_count+1) · open unclaimed sub-task → park
                  finishRun: commit leftovers · ADR 0020 verification gate per repo (runs the
                  project's own typecheck/lint/test script in that checkout; fail OR unavailable
                  skips the repo and parks at End with its output) · push run branch (push_code)
                  or default branch (push_to_default) · PR (raises_pr; body lists the sub-tasks)
                  · cleanup
                  Task → in_review (PR or any sub-task not done) | done · kick dispatch

park   → run waiting_for_owner · item waiting_for_info, no assignee · comment + one notification · worktree kept
resume → Owner comment on the item (comments.ts) or POST /api/workflow-runs/:id/resume
          owner node: follow its pass connection · agent node: re-run it with loop_count = 0
          sub-task reply: resume the child run + flip the Task run back to running
          Task reply at a Sub-tasks node: resume the waiting child run
stop   → POST /api/workflow-runs/:id/stop, or stop / delete of a step run (a child's stop stops its Task run):
          cancel the run + live children · push (no PR) · Task and child's sub-task waiting_for_info
```

**The one-minute tick** (`services/agent-schedule-registry.ts`, started from `main.ts`) only *starts* runs and repairs them: stuck-run watchdog → reminders → GitHub App token refresh → `reconcileWorkflowRuns` (parks a `running` run with no live step for 10 min) → `tickWorkflowDispatch`. Dispatch starts, per active workflow, the oldest `ready` Tasks queued for it (`items.workflow_id`, `trigger='item_ready'`) until `max_parallel_runs` top-level runs are `running` — each Task in its own worktree — or a scheduled fire (`trigger='schedule'`, croner on `cron_expr`). Parked runs don't hold a slot. Sub-workflows (`input_kind='sub_task'`) are never dispatched; reconcile skips a Task run whose child is `running`.

**Failure paths that bypass `completeRun`** all report the step so the run can't hang: `sweepStuckRuns`, the `setup_failed` branch, `POST /api/run/:id/stop`, `DELETE /api/run/:id`, and the `main.ts` orphan reaper (`failOrphanedRuns` flips dead runs to `error`, then `onStepFinished`; it no longer pushes or deletes worktrees). `reconcileWorkflowRuns` is the backstop for anything else, including an API restart between steps.

**Git ops and locks.** `ensureWorktree` / `pushWorktree` / `openPullRequest` / `cleanupWorktreeAfterPush` each take `withProjectGitLock`, which is not re-entrant — the engine never wraps them. The worktree path lives only on `workflow_runs`, never on `items.worktree_path`.

**Concurrency.** `agent_runs_one_live_per_item` (migration 003) allows one `queued` / `in_progress` step per item; `workflow_runs_one_live_per_item` (035) allows one `running` / `waiting_for_owner` workflow run per item and covers the gaps between steps. Parallelism comes from Tasks (`max_parallel_runs`), never from sub-tasks: a Task run has at most one live child, so no two steps ever share a worktree at once.

**Ad-hoc runs.** `POST /api/run` (Run-now dialog) spawns one agent with no item in a temp dir: no worktree, no routing, no push. It exists to try a prompt.

Off-switches: set the workflow `inactive` (dispatch skips it), take the Task off the workflow (`PUT /api/items/:id/workflow {workflow_id:null}`), or stop the run.

---

## SSE flow (real-time updates)

```
Web client                              API server (single process)
    â”‚                                       â”‚
    â”‚ GET /api/events  (long-lived)         â”‚
    â”‚â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¶â”‚
    â”‚                                       â”‚   client added to in-memory
    â”‚                                       â”‚   Set<(SSEEvent) => void>
    â”‚                                       â”‚   (routes/events.ts)
    â”‚                                       â”‚
    â”‚                                       â”‚   30s heartbeat â”€â”€â”€â”€â”
    â”‚ data: { "type":"heartbeat" }          â”‚                     â”‚
    â”‚â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚ â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
    â”‚                                       â”‚
    â”‚                                       â”‚   spawn agent-runner
    â”‚                                       â”‚     â”œâ”€â”€ stdout/stderr â†’ SSE
    â”‚                                       â”‚     â”‚   "agent_output"
    â”‚                                       â”‚     â””â”€â”€ on exit â†’ SSE
    â”‚                                       â”‚         "run_completed"
    â”‚ data: { "type":"agent_output", ... } â”‚
    â”‚â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
    â”‚                                       â”‚
    â”‚                                       â”‚   auto-fetch-runner fires
    â”‚                                       â”‚     via Croner â†’ SSE
    â”‚                                       â”‚     "autofetch_status"
    â”‚ data: { "type":"autofetch_status",...}â”‚
    â”‚â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”‚
```

**Events emitted today** (full catalogue lives in `api-surface.md`):

- Agent run lifecycle: `agent_status`, `agent_output`, `agent_error`, `run_queued`, `run_completed`, `run_error`
- Workflows (ADR 0014): `workflow_run_updated` (`workflowId`, `workflowRunId`, `workflowRunStatus`, `nodeId`, `issueId?`, `parentWorkflowRunId?` on a sub-task's run) on start, every node move, park, End and stop; the web invalidates `['workflows']`, `['workflow-queue']`, `['workflow-run', id]` (and `['workflow-run', parentWorkflowRunId]`), `['workflow-runs', workflowId]`, `['item-workflow-runs', issueId]`. `run_completed` / `run_error` / `agent_status` also invalidate `['workflow-run']` so a run view's step list refreshes
- Data mutations (push instead of poll): `counts_changed`, `notification_created`, `notification_updated`
- Clone: `clone_status`, `clone_output`, `clone_completed`, `clone_error`
- Reclone: `reclone_status`, `reclone_output`, `reclone_completed`, `reclone_error`
- Delete: `delete_status`, `delete_output`, `delete_error`
- Auto-fetch: `autofetch_status`, `autofetch_output`, `autofetch_completed`
- **Theme 08 â€” Memory regeneration**: `memory_regenerated`
- Commit discipline: `commit_verification`

SSE state is **in-memory only**. Restarting the API drops all subscribers; web clients auto-reconnect.

## Autonomous and project-level runs (Theme 09 / 09b)

Scouts (`kind_slug` ∈ `ai-news | market-research | regulations | jira-to-epic`) and project agents (`agent-ai-readiness`, `agent-knowledge-base`) have no schedule of their own. They run as a step of an `input_kind='none'` workflow:

- **Scheduled** — `trigger='schedule'`; `schedule_preset` + time / weekday materialise to `workflows.cron_expr` (`materializeCron`) and `next_run_at` (croner, `settings.quiet_hours_timezone`). The dispatch tick starts one project-level run when due.
- **Manual** — `POST /api/workflows/:id/runs` with no body.
- **Prompt** — `prompt-builder` renders the constitution, the role with `{{ key }}` substitution against `settings_json` and the outcome contract, then either `# Project Context` (name, description, guardrails, every Task + spec, commit discipline) when the workflow has a project, or a `# Project-level Run` paragraph when it doesn't, then output instructions and self-memory. A **gate step** (ADR 0021) spawns nothing at all: it runs a `guardrail_scripts` body per repo, writes the verdict to `run_gate_results`, and takes the pass edge on exit 0 or the fail edge (to a fixer agent, with the script's output posted on the item as its contract) otherwise. Each script first looks for the project's own tooling and skips what is not declared; `gate-perf` and `gate-visual` then fall through to Atlas's own probes at `.atlas/probes/*.mjs`, staged into the worktree by `probes-assembler.ts`, so the 100ms/200ms budgets and the three-viewport visual check apply to projects that ship no perf or visual tooling of their own. A probe that cannot run — no `start` script, no browser, the app never opened its port — prints why and exits 0, because absence of evidence is not a failure (ADR 0020). Agent steps read `.atlas/outcome.md`, `.atlas/self-memory.md` and `.atlas/changed-files.md` from the working directory — the last is the branch diff against the merge-base, staged so an agent does not rediscover it by crawling the repo.
- **Created items** — Tasks a scout creates (Jira import, market research) land as `draft` and stay put; nothing routes them (End-node child routing was removed by ADR 0015). The Owner queues them for a Task workflow.

**Settings flow**: PATCH `/api/agents/:id` carries `settings_json`. The route looks up `kind_slug` (incoming OR current), grabs the schema via `getAgentSettingsSchema(kind_slug)`, and runs `.safeParse()`; failures return 400 with structured `detail`.

### "Generate AI scaffold" (AI Readiness workflow)

```
Owner clicks "Generate AI scaffold" on Project Detail
            │
            ▼
POST /api/projects/:id/generate-ai-scaffold
  - precondition: clone_status='ready' + credential_id set (else 409)
  - find the project's "AI Readiness" workflow, or createFromTemplate('ai-readiness')
    (installs agent-ai-readiness if missing; input none, worktree + push + PR)
  - startWorkflowRun(workflow.id, null) → 202 { run_id, workflow_id }
            │
            ▼
workflow-engine: branch atlas/wf/<runId8>, ensureWorktree once, spawn the single agent node
            │
            ▼
agent run (project-level: item_id null, project_id set, cwd = run worktree)
  - reads project + Tasks via Atlas MCP, detects the stack
  - writes the missing scaffold files, bootstraps spec-kit, commits
  - ends with an atlas-outcome block (no push, no gh)
            │
            ▼
End: push branch · open PR · cleanup worktree · one notification
     (event_key 'agent.run_finished_no_item', per-event toggle + quiet hours)
```

The agent does NOT run typecheck/test/build — the PR review IS the validation. It never overwrites files on `origin/main` and creates no Atlas items. Push and PR use the project's stored credential through the engine's per-call git config.

### Freshness model: push primary, focus-refetch fallback, short cache

There is **no periodic polling** in the web today. Liveness comes from three channels:

1. **SSE invalidation** while the tab is foreground â€” service-layer mutations call `broadcastSSE()` after every DB write, the web's `useSSE` handler maps each event to a TanStack Query `invalidateQueries(...)` call, the affected hook refetches.
2. **`refetchOnWindowFocus`** + **`refetchOnReconnect`** â€” TanStack Query defaults catch any drift after a tab has been backgrounded long enough that SSE may have raced an auto-reconnect.
3. **Bounded staleness via `staleTime: 30 s` + `gcTime: 5 min`** (`packages/web/src/App.tsx` QueryClient defaults). A navigation within 30 s paints from cache and skips the network entirely; SSE still drops cached entries the moment data actually changes server-side, so the 30 s window only ever holds data that was correct the last time the server said so. This replaced the previous "every read is treated as stale" model, which was re-firing the same query on every page mount and pushing cold reload past 1.5 s.

A few hooks override the global defaults with `staleTime: Infinity` + `refetchOnMount: false` because their data only changes through local mutations (which write through `setQueryData` / `invalidateQueries` immediately) or SSE: `useSettings`, `useSidenavCounts`, `useAgents`, `useProjects`. `useAiEnabled` is a passthrough that calls `useSettings` so it never double-fetches the same `['settings']` key.

If you add a new mutation in the API, you MUST `broadcastSSE()` after the DB write (typically `counts_changed`, or a more specific event if one fits). Otherwise the UI will not update until the user switches tabs. See `AGENTS.md` self-update rules.

### Page-chunk prefetch on hover

`packages/web/src/utils/prefetchRoute.ts` exposes `prefetchRoute(key)` which dynamically imports the page's lazy chunk. `Sidenav`, `BottomNav`, and `MoreSheet` call it from `onPointerEnter` on each nav item, so by the time the user actually clicks, the chunk is already resolved. Each chunk is primed at most once per session. Combined with Vite's `optimizeDeps.include` (which pre-bundles MUI, react-router, react-query and the React runtime), this turns subsequent navigations into pure render exercises rather than module-fetch waterfalls.

---

## Subprocess lifecycle

All long-running work runs in spawned subprocesses, never inline in the request handler. Inline execution would block the Fastify worker and lose the granular stdout/stderr the SSE stream relies on for progress feedback.

| Runner | Spawns | Inputs | Outputs |
|---|---|---|---|
| `agent-runner.ts` | `claude` or `copilot` CLI (`cli = ollama` spawns `claude` with the Ollama env overlay) | prompt built from agent `prompt_md` + issue context; `.atlas/*` staged in the workflow worktree or a temp dir | stdout â†’ `agent_output` SSE; on exit, cost + outcome persisted and the step reported to `workflow-engine.onStepFinished` |
| `clone-runner.ts` | `git clone` | repo URL, credential (decrypted in-memory), target path | output â†’ `clone_output` SSE; on success, project `clone_status` â†’ cloned |
| `reclone-runner.ts` | `rm -rf` + `git clone` | project_id | sequence of SSE events |
| `delete-runner.ts` | `rm -rf` (workspace folder) | project_id | SSE events |
| `auto-fetch-runner.ts` | `git fetch` | scheduled via Croner from `project_schedules` | SSE events + external notification on auth failure |

Auth-failure escalation: `auto-fetch-runner.ts` detects HTTP 401/403 in git output and queues a external notification through the notifications service (respects quiet hours).

### Terminal PTY streaming (WebSocket, not SSE)

Terminal sessions are the one subprocess surface that does NOT stream over SSE. `services/cli-session-host.ts` keeps each `claude`/`copilot` CLI alive in a ConPTY and pipes bytes over WS `/api/cli/sessions/:id/stream` (binary frames both ways). Every PTY byte is also parsed into a per-session `@xterm/headless` mirror (`services/terminal-screen-state.ts`); live broadcast happens in the mirror's write callback, and a browser attach replays `serialize()` of the mirror as its first frame. That ordering (feed callbacks FIFO with the attach flush marker) guarantees an attaching browser sees every byte exactly once — inside the snapshot or live, never both — and the snapshot is always a well-formed VT stream with no embedded DSR queries, laid out at the pinned `TERMINAL_COLS × TERMINAL_ROWS` grid (120×30, `@atlas/shared`) that PTY, mirror, and every browser pane share for the whole session lifetime (no resize path exists; panes scale their font to fit). The browser side (`TerminalXterm.tsx`) is a dumb pipe: raw frame bytes go straight into xterm.js's stateful parser, with no client-side decoding or buffering. SSE still carries the session's metadata events (`cli_session_status`, cost rollups) — bytes and metadata ride separate channels.

---

## Onboarding gate

`packages/web/src/App.tsx:61-88` defines a route guard:

- `!settings.onboarding_complete` â†’ forces `/onboarding`, blocks all other routes
- `settings.onboarding_complete && pathname === '/onboarding'` â†’ forces `/`

Everything inside `AppShell` (Sidenav + Topbar + Outlet) is post-onboarding only. The gate exists because every other surface assumes a workspace path and an Owner name; rendering them without those values produces broken empty states rather than a useful first-run experience.

---

## Navigation loading curtain

Inside the AppShell, the scrollable content `Box` (`packages/web/src/App.tsx`) renders two siblings working together:

1. `<Suspense key={location.pathname} fallback={<BrandedFallback />}><Outlet /></Suspense>` â€” the React Router outlet, with the Suspense boundary **keyed by `pathname`**. Keying forces a fresh Suspense boundary on every path change, so React shows the fallback for the full duration of the lazy-chunk load instead of keeping the previous page visible (React 18's default "stay on the old state on update suspension" behavior).
2. `<NavigationCurtain />` (`packages/web/src/components/shell/NavigationCurtain.tsx`) â€” a URL-driven overlay that paints `<BrandedFallback />` for 350 ms on every **`pathname`** change. Query-param changes (`?tab=`, `?status=`, etc.) deliberately do not trigger it.

Both are keyed by `pathname` only, with deliberate division of labour:

- **Path change** (sidenav â†’ Agents, row click â†’ detail page, programmatic `navigate()`): keyed Suspense remounts the boundary and paints `BrandedFallback` for the full chunk-load duration; the curtain overlays a 350 ms flash on top for snappy click feedback. Both fire.
- **Same-path tab / filter change** (`?tab=`, `?status=`, search filters): neither mechanism fires. The page stays mounted, scroll position and form state are preserved, and tab content swaps via local `useState` (see in-page tab strategy below) rather than going through React Router on the click path.

Together they guarantee a visible loader the moment the user navigates to a new page, while keeping tab switches and filter changes feeling instant and stateful.

The curtain is an overlay (`position: absolute`, not a route remount). The keyed Suspense, by contrast, *does* unmount the previous page on path change â€” that's correct, because the previous page is no longer relevant.

Modal-gated `<Suspense fallback={null}>` boundaries inside pages (e.g. `ProjectDetail` delete / env-secrets modals, `Issues` new-issue modal, `Credentials` edit modal) are intentionally untouched â€” they open via component-local `useState`, not navigation, and a full-screen logo behind a dialog backdrop would be wrong.

---

## In-page tab strategy: lifted data + Container + Content split

Pages with tab strips (`ProjectDetail`, `AgentDetail`, `Notifications`) split every tab into a lightweight **Container** and a heavy **Content** component, gated by `useDeferredMount`. **The parent page owns all data fetching for every tab** â€” Containers and Content components never call `useQuery` themselves; they receive data as props.

### How a tab click flows

1. Tab state is driven by `useTabParam` (`packages/web/src/hooks/useTabParam.ts`), a thin `useState` wrapper. The initial value is read once from `window.location.search` (deep links to `?tab=â€¦` still work). Clicking a tab is a single `useState` update â€” no `useSearchParams`, no `useLocation`, no router subscription anywhere on the click path. (`AppShell`, `Sidenav`, `Topbar` all consume router state; routing the click through the URL was re-rendering the whole shell.)
2. The parent unmounts the previous tab's Container and mounts the next tab's Container. **No new `fetch` request fires** â€” the data is already in the parent's TanStack Query observers.
3. The Container synchronously returns a per-tab `<TabNameSkeleton />`. React commits, the browser paints the skeleton.
4. After `useDeferredMount` fires (`setTimeout(0)` from a `useEffect`), the Container re-renders. For tabs the parent had to fetch (`OverviewTab`, `TasksTab`, `MemoryTab`, both Notifications tabs), the Container also waits for `data !== undefined` from props. The first time the page is mounted the wait is for the parent's initial fetches; subsequent tab swaps see data immediately.
5. The Container renders `<TabNameContent data={â€¦} {...rest} />` â€” pure render, no fetch, no chunk download.

### Data fetched in each parent

- `AgentDetail`: `useAgent(id)`, `useAgents()`, `useAgentRuns(id)`, `useAgentMemory(id)`. The last one is lifted from the old `MemoryTab`.
- `ProjectDetail`: `useProject(id)`, `useAgents()`, `useSettings()`, `useProjectCounts(id)`, `useIssues({ projectId: id })`. The Tasks tab's rows (`tasks` + a client-side `sub_task_count`) and the rail's active agents are derived from the one issue-tree fetch.
- `Notifications`: `useSettings()`, `useNotifications({ external_status: 'sent', limit: 1 })` (top stamp), `useNotifications({ limit: 200 })` (single dataset both tabs filter client-side), `useAgents()`. The `{ limit: 200 }` set and `useAgents` are lifted from the two tabs.

### Page-level Refresh button

`packages/web/src/components/RefreshButton.tsx` is a small icon-button component that takes `{ onRefresh, isFetching, tooltipLabel }`. Each tabbed page renders one in its header and wires `onRefresh` to `queryClient.invalidateQueries` for the relevant prefixes, plus `useIsFetching` (predicate or queryKey) for the spinner state. Because the parent owns the queries, this single button refetches everything every tab consumes.

### Why this layout

- React 18 does not yield between a synchronous state update and the commit. Without `useDeferredMount`, the heavy Content render happens on the click frame and blocks paint. With it, the skeleton paints first; the heavy mount happens on a later macrotask, off the clickâ†’paint loop.
- Lifting fetches removes per-tab fetch latency and per-tab chunk-download latency (the prior `lazyNamed` split has been dropped on `GuardrailsTabContent`, `MemoryTabContent`, `PromptTabContent`; they are now eager-imported). After the first paint, tab swap is purely a render exercise.
- The parent chrome (`ProjectHeader`, `ProjectRightRail`, `AgentHero`, `AgentSidebar`) is wrapped in `React.memo` and receives `useCallback`-stabilised handler props from the parent. A tab click no longer re-walks 800+ LOC of header/sidebar JSX.
- Conditional rendering of the active tab body (`{currentTab === 'tasks' && <TasksTab … />}`) is intentional: a previous "mount-all + CSS hide" attempt made hidden tabs re-render on every parent update, which turned heavy panels into perceptible lag.
- `AgentDetail.setTab` is **not** wrapped in `useTransition` â€” wrapping would tell React to keep the old tab body visible until the new one is ready, which produces a different "click does nothing for a second" feel.

### Trade-offs accepted

- A page reload returns to the tab's default value (the URL no longer reflects the current tab while the user is on the page).
- Browser back does not restore tab state.
- Initial page load is heavier: every lifted query fires in parallel on parent mount instead of one-per-tab on click.
- Initial bundle for `AgentDetail` and `ProjectDetail` is larger now that the four previously-lazy Content components ship eagerly.
- In-page links that previously navigated to `?tab=â€¦` (e.g. the "Guard-rails active" badge in `ProjectHeader`) now call the same `setTab` callback the tab strip uses; they are buttons, not `RouterLink`s.

### File layout

For every tab `TabName.tsx`, there is a sibling `TabNameContent.tsx`. The Container holds the per-tab skeleton, the `useDeferredMount` gate, and the prop-passthrough to Content. The Content holds all the heavy JSX. Local component state (e.g. `GuardrailsTabContent`'s `draft`, `MemoryTabContent`'s editor state) lives inside Content; the Container only re-evaluates the skeleton gate on tab activation.

---

## Bundle size baseline

Captured 2026-05-27 at commit `dd90e93` (B02 verification pass) against the
`packages/web/vite.config.ts` settings (`manualChunks` for mui / query / router,
`sourcemap: false`, `optimizeDeps` pre-bundle list). Pages are code-split via
`lazyNamed`; modals are individually chunked.

| Chunk | Raw (KiB) | Gzip (KiB) |
|---|---:|---:|
| `mui` (vendor) | 401.50 | 122.89 |
| `index` (app shell + theme + components used app-wide) | 359.13 | 104.25 |
| `router` (vendor) | 41.81 | 14.92 |
| `query` (vendor) | 39.23 | 11.60 |
| `AgentDetail` (largest page) | 79.12 | 21.18 |
| `ProjectDetail` | 34.56 | 9.52 |
| `Search` | 31.42 | 8.70 |
| `Settings` | 29.15 | 8.96 |
| `NewProjectModal` (largest modal) | 27.74 | 8.07 |
| `IssueDetailShell` | 23.10 | 7.06 |
| `Queue` | 21.25 | 6.09 |
| `Notifications` | 20.99 | 5.91 |
| `Dashboard` | 17.90 | 5.47 |
| `Agents` | 17.62 | 6.10 |
| `Projects` | 17.37 | 6.05 |

Initial cached core (mui + index + router + query) â‰ˆ **254 KiB gzip** (was 243
KiB at 2026-05-23 `8dfcd40` â€” `+4.5%` from MUI minor uptake + app-shell growth
across A04 / A05 / Theme 09b shipments). All chunks remain well under any
single-chunk budget (largest is `mui` at 122.89 KiB gzip). Refresh this table
when `manualChunks` strategy changes. Treat a >10% growth on any cached-core
chunk as a regression worth tracing â€” those bytes hit every cold load. Lazy
pages may move more freely; the only notable lazy-page mover this pass was
`AgentDetail` (17.19 â†’ 21.18 KiB gzip, `+23%`) which absorbed the A04
reset-rounds banner and A05 Freedom-run pill on the Runs tab.

---

## Storage layout

- **Database**: SQLite file (`atlas.db`) inside the workspace folder selected during onboarding. Schema in `packages/api/src/db/migrations/*.sql` (11 migrations as of writing â€” see `api-surface.md`).
- **Repos**: cloned under the workspace folder, one subfolder per project.
- **`.env`**: the API mirrors the `settings.env` table into a `.env` file in the server folder on every save (powered by `packages/api/src/services/env-file.ts`).
- **External notification secrets**: token stored encrypted at rest (AES-256-GCM); decrypted only in-memory by `services/external notification.ts`.
- **Git credentials**: same encryption approach â€” `credentials` table + `services/credentials.ts`.

---

## Key non-obvious invariants

- The status machine is the **only** authority on valid transitions. UI hides invalid actions; API rejects invalid PATCHes. Both call `isValidTransition()` / `getValidNextStatuses()` from `@atlas/shared`.
- Workflows escalate **only** to the Owner (park â†’ `waiting_for_info`); agents never route items. The engine is the only writer of an item's status + assignee while its workflow run is `running` (`workflow-lock.ts` 409s the PATCH routes, UI and MCP alike).
- `ATLAS_AI_ENABLED=false` puts `agent-runner.ts` into a simulated mode that emits canned output ending in an `atlas-outcome: done` block, so workflows still advance â€” used for development without burning CLI credits.
- Clones run with credentials injected via `http.extraheader` (Basic auth), NOT via URL-embedded credentials, because Windows Git Credential Manager will leak URL-embedded tokens.
