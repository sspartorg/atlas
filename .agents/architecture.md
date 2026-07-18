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
â”‚                                   â”‚   fetch + per-agent setIntervalâ”‚   â”‚
â”‚                                   â”‚   registry for scheduled       â”‚   â”‚
â”‚                                   â”‚   auto-dispatch; both catch up â”‚   â”‚
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
- `explorer.exe` / `open` / `xdg-open` â€” branched per `process.platform` in the `POST /api/projects/:id/reveal` handler.
- `claude` / `gh` (the agent CLIs) â€” Atlas assumes the user has the right one on `PATH`; the `cli` column on each agent picks which.

Auto-fetch runs in Node on every OS â€” `auto-fetch-runner.ts` calls the typed `performAutoFetch()` in `services/auto-fetch.ts`, which shells out to `git` via `execFile`. The previous PowerShell holdout (`auto-fetch.ps1`) was retired in C01.

The CORS allowlist + `requireMcpToken` trusted-browser-origin set are computed from `utils/lan-origins.ts`. When `ATLAS_LAN_ACCESS=true`, the helper walks `os.networkInterfaces()` for non-loopback non-link-local IPv4 addresses and adds `http://<ip>:${WEB_PORT}` (dev 4000 / prod 5000) to both sets. The boot log lists what got added.

### Security â€” write gate & origin allowlist

The API has exactly one auth gate: a global Fastify `onRequest` hook (`server.ts:76â€“80`) that delegates to `requireMcpToken` (`plugins/mcp-auth.ts`) for every `POST/PUT/PATCH/DELETE`. The same `getAllowedOrigins()` set feeds `@fastify/cors`, so CORS preflight and the gate agree.

**What is checked**

| Method | Gate runs? | Origin check | Token check |
|---|---|---|---|
| `GET` (reads, SSE) | no | n/a | n/a |
| `POST`/`PUT`/`PATCH`/`DELETE` | yes | `Origin âˆˆ getTrustedBrowserOrigins()` | `X-Atlas-Token === ATLAS_MCP_TOKEN` |

**What is allowed**

1. **Empty token (`ATLAS_MCP_TOKEN=""`)** â€” gate is bypassed entirely. First-run / single-user local mode. Unsafe for anything reachable beyond loopback.
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
useMutation in hook (e.g. useTransitionStory)
        â”‚
        â–¼
api.stories.transition(id, status)         â† packages/web/src/api/api.ts
        â”‚
        â–¼  fetch(PATCH /api/stories/:id/status)
        â”‚
        â–¼
Fastify route handler                       â† packages/api/src/routes/stories.ts
        â”‚
        â–¼
Zod schema parse (from @atlas/shared)
        â”‚
        â–¼
Service layer                               â† packages/api/src/services/stories.ts
        â”‚       isValidTransition(...)      â† @atlas/shared/status-machine
        â–¼
better-sqlite3 prepared statement
        â”‚
        â–¼
Response (snake_case JSON, matches @atlas/shared types)
        â”‚
        â–¼
React Query invalidates relevant keys (['stories'], ['issues'], ...)
        â”‚
        â–¼
UI refetches and re-renders
```

If the same mutation should ALSO notify external notification or fire an SSE event, the service layer triggers it after the DB write.

---

## Auto-dispatch (agent kickoff)

Auto-dispatch is **scheduler-driven only**. The owner's stance: items run on the agent's schedule, not the moment they're assigned. Setting an item to `ready` does NOT kick off a run â€” it adds the item to the agent's ready-queue, which the next scheduled tick consumes.

The scheduler lives in `services/agent-schedule-registry.ts` as a **single clock-driven poller** (one `setInterval`, ticks every 60s, first tick aligned to the next wall-clock minute). It works in two phases:

1. **Boot reseed (`reseedAllActiveAgentsOnBoot`).** Runs once from `main.ts` before the poller starts. For every active agent with `schedule_hours > 0`, overwrites `agents.next_run_at` with `computeNextSlot(now, schedule_hours)` â€” the next clock-aligned slot from the current wall time. A 1h agent restarted at 3:42 PM gets `next_run_at = 4:00 PM`; a 6h agent restarted at 3:42 PM gets 6:00 PM. This re-anchors the schedule on every restart and recovers from clock skew, stale rows, or cadence edits that didn't propagate.

2. **Cron tick (`tickAgentScheduler`).** Every minute, selects active agents where `next_run_at <= now` (minute precision). For each:
   - Counts live runs (queued + in_progress) and subtracts from `concurrent_runs` for the dispatch capacity. At capacity â†’ hold the clock, retry next minute.
   - Selects up to `capacity` items with `assignee_agent_id = agent.id AND status = 'ready'`. **No ready items â†’ hold the clock** (don't advance `next_run_at`); the next minute re-checks. Owner rule: only spend a tick when there's actual work.
   - When capacity + queue both hold: stamp `last_run_at = now`, advance `next_run_at = computeNextSlot(now, schedule_hours)`, then call `maybeAutoDispatch(itemId)` (in `services/agent-dispatcher.ts`) for each ready item. The dispatcher's four preconditions (status=ready, has assignee, agent active, no live run) are checked again before spawning the CLI via `spawnAgentRun()`.

A brand-new agent created mid-run (e.g. via MCP) with no `next_run_at` is lazy-seeded inside the tick to the next future slot, so it waits one natural slot before its first fire.

The runner itself advances the item `ready â†’ in_progress` at run start (so the queue and detail pages reflect in-flight work); the existing completion path advances `in_progress â†’ in_review`; an errored run advances `in_progress â†’ waiting_for_info` so the failure surfaces in the Queue's "waiting on you" section instead of stranding the item.

Off-switches:

- Set the agent to `inactive` â€” the dispatcher skips with reason `agent_inactive` and the scheduler skips the agent entirely.
- Set `schedule_hours` to 0 â€” the scheduler treats the agent as ineligible (`status=active && schedule_hours > 0` is the gate).
- Move the item out of `ready` (or unassign) â€” the precondition no longer holds.

Manual `POST /api/run` flows through the same `spawnAgentRun`, so user-clicked "Run now" gets the same `ready â†’ in_progress` advance and the error-path `in_progress â†’ waiting_for_info` as a scheduled dispatch.

Every step in the scheduler logs to console with the `[agent-schedule]` prefix â€” if dispatches aren't happening, the API server log is the canonical place to look for "not eligible" / "at capacity" / "no ready items" / dispatch result.

**Known concurrency gap (deferred):** there is no DB-level uniqueness on `(item_id, agent_id)` for live run statuses. The race window is the time between `agent-dispatcher.ts`'s live-run SELECT and `agent-runner.ts`'s `agent_runs` INSERT (â‰ª1s). With scheduler-only dispatch (no on-assign + on-transition fan-out), the race window is much narrower than it would be otherwise â€” two simultaneous ticks for the same agent would need to land in the same millisecond. The proper fix is a partial unique index migration, tracked separately.

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
    â”‚                                       â”‚         "agent_completed"
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
- Data mutations (push instead of poll): `counts_changed`, `notification_created`, `notification_updated`
- Clone: `clone_status`, `clone_output`, `clone_completed`, `clone_error`
- Reclone: `reclone_status`, `reclone_output`, `reclone_completed`, `reclone_error`
- Delete: `delete_status`, `delete_output`, `delete_error`
- Auto-fetch: `autofetch_status`, `autofetch_output`, `autofetch_completed`
- **Theme 08 â€” Memory regeneration**: `memory_regenerated`

SSE state is **in-memory only**. Restarting the API drops all subscribers; web clients auto-reconnect.

## Autonomous agent scheduling (Theme 09)

```
            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
            â”‚  agents row                         â”‚
            â”‚   kind_slug âˆˆ {ai-news,             â”‚
            â”‚     market-research, regulations,   â”‚
            â”‚     jira-to-epic, custom}           â”‚
            â”‚   settings_json (JSONB)             â”‚
            â”‚   cron_expr (nullable)              â”‚
            â”‚   requires_item = false             â”‚
            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â”‚
                             â–¼
            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
            â”‚  computeNextAgentSlot(now, agent)   â”‚
            â”‚   if cron_expr set:                 â”‚
            â”‚     new Cron(expr).nextRun(now)     â”‚
            â”‚   else:                             â”‚
            â”‚     preset-driven math              â”‚
            â”‚     (every_n_hours / daily / etc.)  â”‚
            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â”‚
                             â–¼
            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
            â”‚  agent-schedule-registry tick (1m)  â”‚
            â”‚   freedom-mode branch:              â”‚
            â”‚     - capacity check                â”‚
            â”‚     - spawnAgentRun(id, null, null) â”‚
            â”‚     - update next_run_at            â”‚
            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                             â”‚
                             â–¼
            â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
            â”‚  prompt-builder freedom-run path    â”‚
            â”‚   - constitution                    â”‚
            â”‚   - role with {{key}} substitution  â”‚
            â”‚     against settings_json           â”‚
            â”‚   - freedom-run preamble            â”‚
            â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**Settings flow**: PATCH `/api/agents/:id` carries `settings_json` + `cron_expr`. The route looks up `kind_slug` (incoming OR current), grabs the schema via `getAgentSettingsSchema(kind_slug)`, and runs `.safeParse()`; cron validated via `new Cron(...)` in a try/catch. Failures return 400 with structured `detail`. The web tab (`AutonomousSettingsTab.tsx`) renders a typed form per kind, with a JSON-textarea fallback for `custom`.

## Project-scope agent runs (Theme 09b â€” AI-Readiness Agent)

A third `agent_runs` lifecycle alongside item-attached and freedom-mode. Used by the AI-Readiness Agent to operate on a Atlas project rather than a single item.

```
Owner clicks "Generate AI scaffold" on Project Detail
            â”‚
            â–¼
POST /api/projects/:id/generate-ai-scaffold
  - precondition: clone_status='ready' + credential_id set (else 409)
  - spawnAgentRun({ agentId: 'agent-ai-readiness', projectId: id })
            â”‚
            â–¼
agent-runner project-scope branch
  - inserts agent_runs row (item_id null, project_id set)
  - cwd = project.git_path
  - if project.credential_id: write tmp git config with
    http.extraheader Basic auth, set GIT_CONFIG_GLOBAL on the
    spawn env (unlinks on child exit)
            â”‚
            â–¼
prompt-builder project-scope preamble
  - constitution + agent role + project context (name, description,
    guardrails_md, every epic + spec_md) + commit-discipline
    section + output instructions
            â”‚
            â–¼
Claude Code spawn (cwd=project.git_path) â€” runs the 9-step protocol:
  1. getProject / listEpics / getEpic via Atlas MCP (PRD context)
  2. detect stack from package.json / pyproject.toml / etc.
  3. git fetch origin main; checkout -B atlas/ai-readiness
  4. existence check via git ls-tree origin/main for each of 7 files
  5. generate each missing file (tailored to detected stack)
  6. commit (Conventional + Refs: <project-id>)
  7. git push -u origin atlas/ai-readiness (auth via tmp config)
  8. gh pr create â†’ capture PR URL
  9. emit final [ai-readiness] PR opened: <url> line
            â”‚
            â–¼
SSE run_completed; in-app notification always
created; external notification delivered under
event_key='agent.run_finished_no_item'
(subject to per-event toggle + quiet hours)
```

The agent does NOT run typecheck/test/build â€” the PR review IS the validation. It NEVER force-pushes, NEVER overwrites files on `origin/main`, NEVER creates Atlas items. Auth split: `git push` uses the project's stored PAT (via tmp config); `gh pr create` uses the local user's `gh auth login` state (separate token).

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
| `agent-runner.ts` | `claude` or `copilot` CLI | prompt built from agent `prompt_md` + issue context | stdout â†’ `agent_output` SSE; on exit, status transition |
| `clone-runner.ts` | `git clone` | repo URL, credential (decrypted in-memory), target path | output â†’ `clone_output` SSE; on success, project `clone_status` â†’ cloned |
| `reclone-runner.ts` | `rm -rf` + `git clone` | project_id | sequence of SSE events |
| `delete-runner.ts` | `rm -rf` (workspace folder) | project_id | SSE events |
| `auto-fetch-runner.ts` | `git fetch` | scheduled via Croner from `project_schedules` | SSE events + external notification on auth failure |

Auth-failure escalation: `auto-fetch-runner.ts` detects HTTP 401/403 in git output and queues a external notification through the notifications service (respects quiet hours).

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
4. After `useDeferredMount` fires (`setTimeout(0)` from a `useEffect`), the Container re-renders. For tabs the parent had to fetch (`OverviewTab`, `EpicsTab`, `IssuesTab`, `MemoryTab`, both Notifications tabs), the Container also waits for `data !== undefined` from props. The first time the page is mounted the wait is for the parent's initial fetches; subsequent tab swaps see data immediately.
5. The Container renders `<TabNameContent data={â€¦} {...rest} />` â€” pure render, no fetch, no chunk download.

### Data fetched in each parent

- `AgentDetail`: `useAgent(id)`, `useAgents()`, `useAgentRuns(id)`, `useAgentMemory(id)`. The last one is lifted from the old `MemoryTab`.
- `ProjectDetail`: `useProject(id)`, `useEpics(id)`, `useStories({ projectId: id })`, `useBugs({ projectId: id })`, `useAgents()`, `useSettings()`, `useProjectCounts(id)`, `useIssues({ projectId: id })`. The last two are lifted from `OverviewTab` / `IssuesTab`.
- `Notifications`: `useSettings()`, `useNotifications({ external_status: 'sent', limit: 1 })` (top stamp), `useNotifications({ limit: 200 })` (single dataset both tabs filter client-side), `useAgents()`. The `{ limit: 200 }` set and `useAgents` are lifted from the two tabs.

### Page-level Refresh button

`packages/web/src/components/RefreshButton.tsx` is a small icon-button component that takes `{ onRefresh, isFetching, tooltipLabel }`. Each tabbed page renders one in its header and wires `onRefresh` to `queryClient.invalidateQueries` for the relevant prefixes, plus `useIsFetching` (predicate or queryKey) for the spinner state. Because the parent owns the queries, this single button refetches everything every tab consumes.

### Why this layout

- React 18 does not yield between a synchronous state update and the commit. Without `useDeferredMount`, the heavy Content render happens on the click frame and blocks paint. With it, the skeleton paints first; the heavy mount happens on a later macrotask, off the clickâ†’paint loop.
- Lifting fetches removes per-tab fetch latency and per-tab chunk-download latency (the prior `lazyNamed` split has been dropped on `IssuesTabContent`, `GuardrailsTabContent`, `MemoryTabContent`, `PromptTabContent`; they are now eager-imported). After the first paint, tab swap is purely a render exercise.
- The parent chrome (`ProjectHeader`, `ProjectRightRail`, `AgentHero`, `AgentSidebar`) is wrapped in `React.memo` and receives `useCallback`-stabilised handler props from the parent. A tab click no longer re-walks 800+ LOC of header/sidebar JSX.
- Conditional rendering of the active tab body (`{currentTab === 'epics' && <EpicsTab â€¦ />}`) is intentional: a previous "mount-all + CSS hide" attempt made hidden tabs re-render on every parent update, which turned heavy panels into perceptible lag.
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
- **Git credentials**: same encryption story â€” `credentials` table + `services/credentials.ts`.

---

## Key non-obvious invariants

- The status machine is the **only** authority on valid transitions. UI hides invalid actions; API rejects invalid PATCHes. Both call `isValidTransition()` / `getValidNextStatuses()` from `@atlas/shared`.
- Agent escalation is **only** to the Owner â€” never to another agent. Enforced at the assign endpoint and in the UI's assignee picker.
- `ATLAS_AI_ENABLED=false` puts `agent-runner.ts` into a simulated mode that emits canned output (line 192) â€” used for development without burning CLI credits.
- Clones run with credentials injected via `http.extraheader` (Basic auth), NOT via URL-embedded credentials, because Windows Git Credential Manager will leak URL-embedded tokens.
