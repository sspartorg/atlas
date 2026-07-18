import { Client } from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadConfig } from '../config.js';

// Anchor output paths at the repo root, not at packages/api/ — pnpm
// --filter changes CWD into the package which would otherwise route
// e2e-logs/ under packages/api/. Three levels up from
// packages/api/src/scripts/ lands at the repo root.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

// 2026-06-11 — Forensic SQL audit harness.
//
// Reads top queries by `total_exec_time` from pg_stat_statements,
// runs EXPLAIN (GENERIC_PLAN, BUFFERS, FORMAT TEXT) on each, and
// writes a numbered report to e2e-logs/baseline-<ts>/explain.txt.
//
// GENERIC_PLAN (PG 16+) gives a plan for parameterized statements
// without executing them — pg_stat_statements stores queries with
// $1/$2 placeholders, so ANALYZE would need real bindings we don't
// have. GENERIC_PLAN still surfaces the join order, index usage,
// estimated row counts, and seq-scan vs index-scan choices, which
// is exactly what an index-coverage audit needs.
//
// Non-SELECT queries (INSERT/UPDATE/DELETE) are skipped — they show
// up in pg_stat_statements but their plans are less actionable for
// a read-path audit, and explaining a DML statement risks taking
// locks. The user can still see them in the raw `top-queries.txt`
// dump alongside the explained plans.
//
// Invoked from the root via:
//   pnpm --filter @atlas/api exec tsx src/scripts/explain-top-queries.ts
// or directly with the OUT_DIR override:
//   OUT_DIR=e2e-logs/manual-2026-06-11 pnpm --filter @atlas/api ...

interface TopQuery {
    queryid: string;
    query: string;
    calls: string;
    total_exec_time: string;
    mean_exec_time: string;
    rows: string;
    shared_blks_hit: string;
    shared_blks_read: string;
}

const TOP_N = 20;

async function fetchTopQueries(client: Client): Promise<TopQuery[]> {
    const result = await client.query<TopQuery>(
        `SELECT
            queryid::text AS queryid,
            query,
            calls::text AS calls,
            round(total_exec_time::numeric, 2)::text AS total_exec_time,
            round(mean_exec_time::numeric, 2)::text AS mean_exec_time,
            rows::text AS rows,
            shared_blks_hit::text AS shared_blks_hit,
            shared_blks_read::text AS shared_blks_read
        FROM pg_stat_statements
        WHERE query !~* '^\\s*(EXPLAIN|SET|SHOW|RESET|BEGIN|COMMIT|ROLLBACK|DEALLOCATE|FETCH|CLOSE)\\b'
          AND query NOT ILIKE '%pg_stat_statements%'
        ORDER BY total_exec_time DESC
        LIMIT $1`,
        [TOP_N],
    );
    return result.rows;
}

function isSelect(query: string): boolean {
    return /^\s*(WITH\b.*?\bSELECT|SELECT)\b/i.test(query);
}

async function explainQuery(client: Client, query: string): Promise<string> {
    // pg_stat_statements normalises VALUES (...), (...) lists; the raw
    // bracketed form occasionally trips the parser. Strip trailing
    // semicolons (EXPLAIN refuses them when not at statement end).
    const trimmed = query.replace(/;\s*$/, '').trim();
    try {
        const result = await client.query<{ 'QUERY PLAN': string }>(
            `EXPLAIN (GENERIC_PLAN, BUFFERS, FORMAT TEXT) ${trimmed}`,
        );
        return result.rows.map((r) => r['QUERY PLAN']).join('\n');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `[EXPLAIN failed: ${msg}]`;
    }
}

function formatReport(queries: TopQuery[], plans: Array<string | null>): string {
    const lines: string[] = [];
    lines.push('# Forensic EXPLAIN report');
    lines.push(`# Generated: ${new Date().toISOString()}`);
    lines.push(`# Source: pg_stat_statements (top ${TOP_N} by total_exec_time)`);
    lines.push('');
    queries.forEach((q, i) => {
        lines.push('='.repeat(80));
        lines.push(`# ${i + 1}. queryid=${q.queryid}`);
        lines.push(`#   calls=${q.calls}  total_ms=${q.total_exec_time}  mean_ms=${q.mean_exec_time}  rows=${q.rows}`);
        lines.push(`#   shared_blks_hit=${q.shared_blks_hit}  shared_blks_read=${q.shared_blks_read}`);
        lines.push('');
        lines.push('## Query');
        lines.push(q.query.trim());
        lines.push('');
        lines.push('## Plan');
        lines.push(plans[i] ?? '[non-SELECT — skipped]');
        lines.push('');
    });
    return lines.join('\n');
}

async function main(): Promise<void> {
    const config = loadConfig();
    const outDirInput = process.env['OUT_DIR'] ?? `e2e-logs/baseline-${nowSlug()}`;
    const outDir = resolve(REPO_ROOT, outDirInput);
    mkdirSync(outDir, { recursive: true });

    const client = new Client({ connectionString: config.databaseUrl });
    await client.connect();

    let queries: TopQuery[];
    try {
        queries = await fetchTopQueries(client);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('relation "pg_stat_statements" does not exist')) {
            console.error('[explain] pg_stat_statements not installed.');
            console.error('[explain] Run `pnpm db:migrate` (migration 007) after bouncing the postgres container so shared_preload_libraries takes effect.');
            await client.end();
            process.exit(1);
        }
        throw err;
    }

    if (queries.length === 0) {
        console.log('[explain] pg_stat_statements is empty — exercise the app first, then re-run.');
        await client.end();
        writeFileSync(join(outDir, 'explain.txt'), '# pg_stat_statements was empty at capture time\n');
        return;
    }

    const plans: Array<string | null> = [];
    for (const q of queries) {
        if (!isSelect(q.query)) {
            plans.push(null);
            continue;
        }
        plans.push(await explainQuery(client, q.query));
    }

    const report = formatReport(queries, plans);
    const outPath = join(outDir, 'explain.txt');
    writeFileSync(outPath, report);
    console.log(`[explain] wrote ${queries.length} entries to ${outPath}`);

    await client.end();
}

function nowSlug(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

void main().catch((err) => {
    console.error('[explain] fatal:', err);
    process.exit(1);
});
