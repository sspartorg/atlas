import type { Knex } from 'knex';

// 2026-06-11 — pg_stat_statements extension.
//
// Forensic audit (Plan 1 of /goal sweep). Required for the EXPLAIN
// harness in `packages/api/src/scripts/explain-top-queries.ts` which
// reads top queries by `total_exec_time` and runs EXPLAIN ANALYZE.
//
// Prereq: `shared_preload_libraries=pg_stat_statements` must already
// be set on the Postgres cluster — that lives in docker-compose.yml's
// `command:` directive for both `postgres` (dev) and `postgres-prod`
// (prod). CREATE EXTENSION cannot install the hooks; it can only
// register the view + functions once the library is preloaded.
//
// Reset on apply so the audit baseline starts from a clean slate —
// any queries the dev environment ran before the migration get
// discarded. Subsequent runs (db:reset, etc.) re-reset.
//
// Idempotent on every DB the migration runner targets (atlas,
// atlas_test, atlas_e2e, atlas_prod). The extension is
// database-scoped; CREATE EXTENSION IF NOT EXISTS is a no-op on
// repeat application.

export async function up(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
        SELECT pg_stat_statements_reset();
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.raw(`
        DROP EXTENSION IF EXISTS pg_stat_statements;
    `);
}
