import type { FastifyInstance } from 'fastify';
import { readStats } from '../services/perf-stats.js';

// W4 — dev-only perf snapshot endpoint.
//
// GET /api/_perf/routes → JSON array of {method, route, count, p50_ms,
// p95_ms, p99_ms, max_ms, last_status, last_seen_at}, slowest first.
//
// No auth beyond the standard Origin check that gates writes — reads
// are allowed on localhost, and MCP token gates external clients. The
// data is per-process in-memory only, resets on server restart.
//
// Not intended for production observability — this is a lightweight
// dev-time waterfall the UI can render on a debug tab. Prod should
// scrape the `atlas:perf:request` structured log stream instead.

export async function perfRoutes(app: FastifyInstance) {
    app.get('/api/_perf/routes', async (_req, reply) => {
        return reply.send(readStats());
    });
}
