# @atlas/api — AI Rules

## Responsibility

Fastify 5 HTTP server on port 4001 (dev) / 5001 (prod). Owns:
- PostgreSQL 16 database (docker compose service `atlas-postgres`, host port 5500; `atlas-postgres-prod` on 5510). Queries via Kysely, migrations via Knex. See `docs/adr/0001-postgres-migration.md` and `docs/adr/0003-kysely-knex-split.md`.
- All REST API routes
- Server-Sent Events (SSE) for agent status streaming
- Business logic (services/)
- Phase 5: CLI agent spawning, external notifications (currently delivered via Telegram)

---

## File Structure Rules

```
src/
├── server.ts           → Entry point. Register plugins + routes. No business logic.
├── db/
│   ├── kysely-client.ts → Exports the `db` singleton (Kysely + pg Pool, max 10). Only file that opens connections.
│   ├── migrations/     → Numbered Knex migrations (`001_baseline.sql` + `001_baseline.ts`, then `002_*.ts` …). Append only.
│   └── seed.ts         → Syncs the on-disk marketplace catalog into `marketplace_agents`. NEVER writes to `agents` — install is marketplace-only (`docs/adr/0007`).
├── routes/             → One file per resource. Register as Fastify plugins. No DB calls here.
│   ├── agents.ts      → GET/POST /api/agents, GET/PATCH/DELETE /api/agents/:id
│   └── ...
└── services/           → Business logic. DB calls live here, not in routes.
    ├── agent-runner.ts       → CLI spawning for one agent run; reports every terminal exit to the workflow engine
    ├── workflow-engine.ts    → Workflow runs (ADR 0014): step chaining, park/resume, End push + PR, dispatch tick
    ├── workflow-lock.ts      → Global preHandler: 409 on item status/assign while a workflow run holds the item
    ├── external-notifications.ts → Provider-agnostic dispatcher (gating + quiet hours)
    └── transports/*.ts       → Per-provider outbound senders (Telegram, Teams)
```

## Route File Pattern

```typescript
import type { FastifyInstance } from 'fastify';
import { CreateAgentSchema } from '@atlas/shared';
import { agentService } from '../services/agents.js';

export async function agentsRoutes(app: FastifyInstance) {
  app.get('/api/agents', async (_req, reply) => {
    return reply.send(agentService.getAll());
  });

  app.post('/api/agents', async (req, reply) => {
    const body = CreateAgentSchema.parse(req.body);  // Validate first
    return reply.status(201).send(agentService.create(body));
  });
}
```

## DB Rules

- `db` is an async Kysely instance over a `pg` Pool — every query is awaited. (It was synchronous better-sqlite3 before the Postgres migration; any code or doc implying sync DB access is stale.)
- All DB operations go through `services/` — never directly in route handlers
- Migrations are append-only numbered Knex files — never edit `001_baseline.sql` / `001_baseline.ts` (the consolidated pre-publish baseline). Future schema changes go in NEW numbered files (`002`, `003`, …).
- Use transactions (`await db.transaction().execute(async (trx) => …)`) for multi-table writes
- Column names are snake_case matching `@atlas/shared` interface field names
- `agents` carries a composite FK `(cli, model) → cli_models(cli, model_name)` with `ON DELETE RESTRICT`. Any new writer into `agents` must call `assertModelInRegistry` first, or a pruned registry row surfaces as an opaque FK 500 (this is exactly how marketplace install broke — see `.agents/api-surface.md`).

## Validation Rules

- Always validate request bodies with Zod schemas from `@atlas/shared` BEFORE any DB operation
- Return HTTP 400 for validation errors, 404 for not-found, 409 for conflicts
- API responses match `@atlas/shared` interfaces exactly (snake_case, no extra fields)

## Status Transition Enforcement

```typescript
import { isValidTransition } from '@atlas/shared';

// In the status PATCH route:
if (!isValidTransition(issueType, current.status, newStatus)) {
  return reply.status(400).send({ error: 'Invalid status transition' });
}

```

The workflow engine (`services/workflow-engine.ts`) writes item status directly for workflow transitions (e.g. `in_progress → done` at End, which is not a status-machine edge) — never add that path to a route. While a `running` workflow run holds an item, `services/workflow-lock.ts` rejects `PATCH …/:id/status` and `…/:id/assign` with 409 for UI and MCP callers alike. Agents never route items; workflows escalate only to the Owner.

## SSE Rules

- SSE endpoint: `GET /api/events`
- Event format: `data: {"type":"agent_status","agentId":"...","runId":"...","status":"in_progress"}\n\n`
- Use Fastify's raw response to write SSE — no buffering
- Event types match `SSEEvent` interface in `@atlas/shared`

## Worktree Lifecycle (workflow-owned)

Worktrees belong to a **workflow run** (ADR 0014), not an item or an agent run. `startWorkflowRun` calls `ensureWorktree({ item: null, branch })` once; every step runs in that directory; End (or stop) makes a safety commit, pushes when `push_code`, opens one PR when `raises_pr`, then `cleanupWorktreeAfterPush` deletes the folder and local branch. The path lives only on `workflow_runs.worktree_path` — never `items.worktree_path` — so nothing else can push or delete it between steps. Remote is the source of truth; the local workspace is disposable.

If push *fails*, cleanup is skipped so manual recovery is possible. A parked run keeps its worktree. The `main.ts` orphan reaper only flips dead runs to `error` and reports them to the engine; it never pushes or deletes. `ensureWorktree`, `pushWorktree`, `openPullRequest` and `cleanupWorktreeAfterPush` each take `withProjectGitLock`, which is not re-entrant — never wrap them in another lock. Terminal sessions (`routes/cli-sessions.ts`) use the same helpers with their own lifecycle.

## What NOT to Do

- No business logic in route handlers (only: validate → call service → return)
- No CORS changes without checking `@fastify/cors` config in `server.ts`
- Never edit existing migration files — always add a new numbered one
- Never return a stored secret from a list/get route. Plaintext leaves the server only through a dedicated, `requireMcpToken`-gated reveal endpoint that logs `{tag:'secret_reveal'}` (`environment-secrets`, `projects/:id/env`, `credentials/:id/token`, `settings/external-notification/reveal-*`)
- No `console.log` — use Fastify's logger: `app.log.info(...)`, `app.log.error(...)`
