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
    // Two vitest processes on the same test DB TRUNCATE each other's rows
    // mid-test. Hold a session advisory lock (on the maintenance DB, so it
    // doesn't block CREATE DATABASE) for the whole run: a second run waits
    // for the first instead of failing at random.
    const { adminUrl, dbName } = parseDbName(testUrl);
    const runLock = new Client({ connectionString: adminUrl });
    await runLock.connect();
    const lockKey = `atlas-vitest:${dbName}`;
    const got = await runLock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
    if (!got.rows[0]?.ok) {
        console.warn(`[vitest] another api test run holds ${dbName}; waiting for it to finish…`);
        await runLock.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    }

    await ensureDatabase(testUrl);
    await runMigrations(testUrl);

    return async () => {
        // The test DB persists between runs so reruns skip the CREATE/migrate
        // cost; ending the session releases the run lock.
        await runLock.end();
    };
}
