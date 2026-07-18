# 0003. Kysely / Knex Split

**Date:** 2026-05-01
**Status:** Accepted

## Context

The Postgres migration (ADR 0001) forced a choice about the query layer. Atlas's API surface is large (19 plugin files in `packages/api/src/routes/`, dozens of service modules in `packages/api/src/services/`) and the team writes nearly every query by hand — there is no ORM imposing entity classes on top of the schema. The query layer therefore had to satisfy two distinct workloads:

1. **Runtime queries** — the hot path. Type-safe joins, async/await, columns inferred from the schema, snake_case throughout. Read-heavy. Needs to push type errors back to the IDE the moment a developer references a column that does not exist or selects a shape the route's Zod schema cannot validate.
2. **Schema migrations** — the cold path. Battle-tested DDL operations, ordered application, transactional rollback, a migration-tracking table, and a CLI that fits into `pnpm db:migrate`.

Kysely was the obvious answer for (1): its query builder is fully type-safe against a generated `DB` interface (see `packages/api/src/db/kysely-client.ts:1` and `:18`), it composes well in service code, and the snake_case columns project straight into TypeScript interfaces without a transformation layer. But Kysely's migration story is intentionally minimal — it does not own DDL the way Knex does.

Knex is the opposite trade-off: weak typing at the query layer (we already had Kysely for that) but a mature migration runner with ordered numbered files, a `_knex_migrations` tracking table, transactional DDL, and well-understood semantics for up/down. The two libraries do not conflict — they connect to the same Postgres database via the same pool.

## Decision

Use **Kysely** for every runtime query in `packages/api/src/services/` and `packages/api/src/routes/`. Use **Knex** exclusively for schema migrations under `packages/api/src/db/migrations/`. The two coexist: Kysely's client is built in `packages/api/src/db/kysely-client.ts`; Knex's config lives in `packages/api/src/db/knex-config.ts` and the migration runner is `packages/api/src/db/run-migrations.ts`. Neither library appears in the other's domain — no Kysely calls inside a migration file, no Knex calls inside a service.

## Consequences

- Runtime queries are fully type-checked. Adding a column to the schema requires regenerating the Kysely types; queries that reference removed columns fail at compile time.
- Migrations get the mature Knex runner, including `_knex_migrations` tracking and transactional DDL.
- Two query libraries to learn. New contributors see two import shapes (`db` for Kysely, the knex builder inside migration files) and must remember which is which.
- The Kysely `DB` interface is hand-maintained against `001_baseline.sql` plus any `002_*.ts` migration that lands. There is no automatic schema-to-types codegen; drift between the schema and the type is possible if someone forgets the corresponding `types.ts` edit.
- The two libraries share the same connection pool. There is no isolation overhead beyond the two ESM imports.
