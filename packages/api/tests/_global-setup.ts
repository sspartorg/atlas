// Vitest globalSetup. Runs ONCE before any test file loads. Responsible for:
//   1. Computing the test DATABASE_URL (default: atlas_test on the local PG).
//   2. Ensuring the test DB exists (CREATE DATABASE if missing).
//   3. Running Knex migrations against it.
//
// The actual `DATABASE_URL` override is set by vitest.config.ts `test.env`
// so it lands in the test process's `process.env` BEFORE any service module
// imports `kysely-client.ts`. This setup just ensures the DB on the other
// end is ready.

import pg from 'pg';
import Knex from 'knex';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_TEST_URL = 'postgres://atlas:atlas@localhost:5500/atlas_test';

function parseDbName(url: string): { adminUrl: string; dbName: string } {
    // postgres://user:pass@host:port/dbname
    const u = new URL(url);
    const dbName = u.pathname.replace(/^\//, '');
    u.pathname = '/postgres'; // connect to maintenance DB for CREATE DATABASE
    return { adminUrl: u.toString(), dbName };
}

async function ensureDatabase(testUrl: string): Promise<void> {
    const { adminUrl, dbName } = parseDbName(testUrl);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
        const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
        if (r.rowCount === 0) {
            // CREATE DATABASE can't be parameterised; safe because dbName is from
            // our own DATABASE_URL, not user input.
            await admin.query(`CREATE DATABASE "${dbName}"`);
        }
    } finally {
        await admin.end();
    }
}

async function runMigrations(testUrl: string): Promise<void> {
    const knex = Knex({
        client: 'pg',
        connection: testUrl,
        migrations: {
            directory: path.join(__dirname, '..', 'src', 'db', 'migrations'),
            extension: 'ts',
            loadExtensions: ['.ts'],
            tableName: '_knex_migrations',
        },
        pool: { min: 0, max: 2 },
    });
    try {
        await knex.migrate.latest();
    } finally {
        await knex.destroy();
    }
}

export default async function setup(): Promise<() => Promise<void>> {
    const testUrl = process.env['DATABASE_URL'] ?? DEFAULT_TEST_URL;
    if (!testUrl.includes('_test')) {
        // Guardrail: refuse to nuke a non-test DB by accident.
        throw new Error(
            `vitest globalSetup refuses to run migrations against ${testUrl} — DB name must contain '_test'.`,
        );
    }
    await ensureDatabase(testUrl);
    await runMigrations(testUrl);

    return async () => {
        // Teardown — no-op for now; the test DB persists between runs so reruns
        // skip the CREATE/migrate cost.
    };
}
