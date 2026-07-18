import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Knex } from 'knex';

// Baseline schema, squashed from migrations 001-068 on 2026-06-03. The DDL
// lives in the sibling `001_baseline.sql` so future schema diffs are readable
// SQL rather than a JS template literal.
//
// Regenerate the sibling file by applying every migration against a clean
// Postgres DB, then dumping `pg_dump --schema-only --no-owner --no-acl
// --exclude-table='_knex_migrations*'` and stripping the two psql meta
// commands (`\restrict` / `\unrestrict`).

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function up(knex: Knex): Promise<void> {
    const sql = readFileSync(join(__dirname, '001_baseline.sql'), 'utf8');
    await knex.raw(sql);
}

export async function down(_knex: Knex): Promise<void> {
    // Baseline rollback is intentionally a no-op. Use `pnpm db:down:purge` to
    // wipe the volume; reversing every CREATE in dependency order is brittle
    // and we never need it for a single-owner local dev DB.
}
