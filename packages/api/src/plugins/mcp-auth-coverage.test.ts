/**
 * W12 spec 1 — Integration: global onRequest hook gates every write method
 * through requireMcpToken when ATLAS_MCP_TOKEN is set.
 *
 * This test builds a fresh FastifyInstance with the token env var set before
 * any module loads (vi.hoisted + vi.stubEnv). The gate logic lives in
 * mcp-auth.ts which reads ATLAS_MCP_TOKEN at module-init time.
 */

// Set the token before any module is imported. vi.hoisted() runs before the
// module graph resolves so mcp-auth.ts sees the value when it evaluates
// `const EXPECTED_TOKEN = process.env['ATLAS_MCP_TOKEN'] ?? ''`.
const { TOKEN } = vi.hoisted(() => {
    const TOKEN = 'test-mcp-token-w12';
    process.env['ATLAS_MCP_TOKEN'] = TOKEN;
    return { TOKEN };
});

import { describe, it, expect, vi, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Suppress SSE route so buildApp doesn't require a live SSE socket.
vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => { /* no-op */ },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { closeTestDb } from '../../tests/_pg-db.js';

// Build the app once for all tests in this file.
const app: FastifyInstance = await buildApp({ logger: false });
await app.ready();

afterAll(async () => {
    await app.close();
    await closeTestDb();
    // Restore env so downstream test files start clean.
    process.env['ATLAS_MCP_TOKEN'] = '';
});

const TRUSTED_ORIGIN = 'http://127.0.0.1:4000';

describe('global onRequest MCP-token gate (integration)', () => {
    // -----------------------------------------------------------------------
    // Write methods must be blocked without credentials
    // -----------------------------------------------------------------------
    it('POST without Origin and without X-Atlas-Token → 401 with kind:unauthorized', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/agents',
            payload: {},
        });
        expect(res.statusCode).toBe(401);
        const body = JSON.parse(res.body);
        expect(body.kind).toBe('unauthorized');
    });

    it('PUT without credentials → 401', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/agents/nonexistent',
            payload: {},
        });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).kind).toBe('unauthorized');
    });

    it('PATCH without credentials → 401', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/agents/nonexistent',
            payload: {},
        });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).kind).toBe('unauthorized');
    });

    it('DELETE without credentials → 401', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/agents/nonexistent',
        });
        expect(res.statusCode).toBe(401);
        expect(JSON.parse(res.body).kind).toBe('unauthorized');
    });

    // -----------------------------------------------------------------------
    // Trusted Origin bypasses the gate (local UI path)
    // -----------------------------------------------------------------------
    it('POST with trusted Origin + Sec-Fetch-Site same-origin → not 401 (local UI path)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/agents',
            // Follow-up audit: Origin now requires the browser-set
            // `Sec-Fetch-Site: same-origin` companion header. Real
            // browsers set both automatically on same-origin fetches;
            // this fixture reproduces that pair.
            headers: { origin: TRUSTED_ORIGIN, 'sec-fetch-site': 'same-origin' },
            payload: {},
        });
        // Gate passed; route returns 400/404/etc — anything but 401.
        expect(res.statusCode).not.toBe(401);
    });

    // -----------------------------------------------------------------------
    // Correct X-Atlas-Token bypasses the gate (MCP client path)
    // -----------------------------------------------------------------------
    it('POST with correct X-Atlas-Token → not 401', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/agents',
            headers: { 'x-atlas-token': TOKEN },
            payload: {},
        });
        expect(res.statusCode).not.toBe(401);
    });

    // -----------------------------------------------------------------------
    // GET is never gated regardless of credentials
    // -----------------------------------------------------------------------
    it('GET without any auth header → not 401 (reads are always open)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/agents',
        });
        expect(res.statusCode).not.toBe(401);
    });

    it('GET /api/search without auth → not 401', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/search',
        });
        expect(res.statusCode).not.toBe(401);
    });
});
