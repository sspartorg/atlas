# 0001. Postgres Migration

**Date:** 2026-05-01
**Status:** Accepted

## Context

Atlas originally shipped on SQLite. The single-file engine was convenient for the Phase 1-4 sprint (see `feat(phase-2): data layer, full API, and live Sidenav counts` on 2026-05-11) but accumulated structural limitations as the data model grew:

- The polymorphic side tables (`comments`, `issue_events`, `agent_runs`, `notifications`) needed `ON DELETE CASCADE` against `items(id)`; SQLite's FK support is opt-in per connection and the cascade semantics were not reliable across the worker fleet.
- The Owner search surface and the new `searchItems` MCP tool (B16) needed full-text search backed by `tsvector` / GIN — SQLite's FTS5 was a separate virtual table with its own quirks and could not participate in JSONB filters.
- Multiple processes (the API, the agent runner workers, the MCP host) needed concurrent write access. SQLite's file-level locking serialized those writers and surfaced as visible latency.
- We wanted JSONB columns (handoff rules, settings), partial indexes, recursive CTEs (depends-on cycle detection), and pgvector for the embedding work that landed in Theme 08.

A move to a proper RDBMS was the only way through. The choice was Postgres rather than MySQL or a managed service because the local dev story had to stay one `docker compose up` away — Atlas runs offline on an Owner laptop — and because pgvector + GIN + tsvector all live natively in Postgres.

## Decision

Migrate the entire data layer from SQLite to Postgres 16. Run Postgres via the `atlas-postgres` docker compose service defined in `docker-compose.yml:6` (image `pgvector/pgvector:pg16`). All schema is now Postgres-flavoured DDL; all services connect through Kysely (see ADR 0003). The dev and prod stacks each get their own container (`atlas-postgres` on host port 5500, `atlas-postgres-prod` on host port 5510 — container-internal port is 5432 on both) with separate volumes so `pnpm db:down:purge` cannot wipe prod data.

## Consequences

- Cascade deletes, partial indexes, recursive CTEs, GIN, tsvector, and pgvector are all available natively. The dependency-guard, FTS, and embeddings work would have been infeasible on SQLite.
- Concurrent writers no longer serialize. The agent runner workers, the API, and the MCP host can all hold connections simultaneously.
- The dev environment now requires Docker. Owners who previously ran the app with zero infrastructure must start the container before `pnpm dev`.
- Every legacy SQLite-specific migration was rewritten against Postgres. The cleanup ultimately drove ADR 0002 (the single-baseline squash).
- `priority`, `depends_on`, and the unified `items` table (ADR 0004) all became viable once the engine could carry the constraints.
