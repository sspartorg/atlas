import { Kysely, PostgresDialect } from 'kysely';
import type { LogEvent as KyselyLogEvent } from 'kysely';
import pg from 'pg';
import { loadConfig } from '../config.js';
import type { DB } from './types.js';

const { Pool } = pg;

function createPool(): pg.Pool {
    const config = loadConfig();
    return new Pool({
        connectionString: config.databaseUrl,
        max: 10,
        idleTimeoutMillis: 30_000,
    });
}

let pool: pg.Pool | null = null;
let kysely: Kysely<DB> | null = null;

function getPool(): pg.Pool {
    if (!pool) pool = createPool();
    return pool;
}

function getDb(): Kysely<DB> {
    if (!kysely) {
        kysely = new Kysely<DB>({
            dialect: new PostgresDialect({ pool: getPool() }),
            log: buildKyselyLog(),
        });
    }
    return kysely;
}

// Audit 2026-06-09 — Kysely query-timing log.
//
// Two modes:
//   - ATLAS_PERF=1: log every query (level=query) at info via stderr.
//   - ATLAS_SLOW_QUERY_MS=<n> (default 100): always log queries
//     ≥ n ms at warn via stderr regardless of ATLAS_PERF.
//
// Writes structured JSON so it can be grepped + fed back into the
// baseline ndjson. No pino here — kysely-client is initialized once
// at boot before the fastify logger exists.
function buildKyselyLog(): (event: KyselyLogEvent) => void {
    const perfEnabled = process.env['ATLAS_PERF'] === '1';
    const slowThresholdMs = Number(process.env['ATLAS_SLOW_QUERY_MS'] ?? 100);
    return (event) => {
        if (event.level !== 'query' && event.level !== 'error') return;
        const durationMs = Math.round(event.queryDurationMillis * 100) / 100;
        const slow = durationMs >= slowThresholdMs;
        if (event.level === 'query' && !perfEnabled && !slow) return;
        const sql = event.query.sql;
        const truncatedSql = sql.length > 400 ? `${sql.slice(0, 400)}…` : sql;
        const fields = {
            tag: 'atlas:perf:query',
            level: event.level,
            duration_ms: durationMs,
            slow,
            sql: truncatedSql,
            params: event.query.parameters.slice(0, 10),
        };
        process.stderr.write(`${JSON.stringify(fields)}\n`);
    };
}

export async function closeDb(): Promise<void> {
    if (kysely) {
        await kysely.destroy();
        kysely = null;
    }
    pool = null;
}

// Kysely uses class-private fields, which a generic Proxy can't forward. Make
// `db` a lazy getter so the first import doesn't connect, but subsequent
// `db.selectFrom(...)` calls go directly to the underlying instance.
let _dbCache: Kysely<DB> | null = null;
export const db: Kysely<DB> = new Proxy({} as Kysely<DB>, {
    get(_t, prop) {
        if (!_dbCache) _dbCache = getDb();
        const v = (_dbCache as unknown as Record<string | symbol, unknown>)[prop];
        return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(_dbCache) : v;
    },
});
