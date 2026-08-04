import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/environment-secrets', () => {
    it('returns 200 with empty vars array on fresh DB', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/environment-secrets',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { vars: unknown[] };
        expect(Array.isArray(body.vars)).toBe(true);
        expect(body.vars).toHaveLength(0);
    });

    // Batch-9 read model: the LIST endpoint is metadata-only and the
    // plaintext never crosses it. This test previously asserted the
    // pre-Batch-9 shape (`value: 'hello'` straight off the list), so making
    // it pass again would have meant re-exposing every secret on an
    // unauthenticated-ish read — the exact regression the hardening removed.
    // Assert the current contract in both halves instead.
    it('lists secrets as metadata only, never the plaintext', async () => {
        await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 'MY_SECRET', value: 'hello' }] },
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/environment-secrets',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            vars: Array<{ key: string; has_value: boolean; updated_at: string }>;
        };
        expect(Array.isArray(body.vars)).toBe(true);
        const entry = body.vars.find((v) => v.key === 'MY_SECRET');
        expect(entry).toBeDefined();
        expect(entry!.has_value).toBe(true);
        expect(entry!.updated_at).toBeTruthy();
        // The whole point: no plaintext anywhere in the payload.
        expect(entry).not.toHaveProperty('value');
        expect(res.body).not.toContain('hello');
    });

    it('reveals a single secret on the explicit per-key endpoint', async () => {
        await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 'MY_SECRET', value: 'hello' }] },
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/environment-secrets/MY_SECRET/value',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ key: 'MY_SECRET', value: 'hello' });
    });

    it('returns 404 revealing a key that does not exist', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/environment-secrets/NOPE/value',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PUT /api/environment-secrets', () => {
    it('replaces all secrets and returns 200 with the new list', async () => {
        // Seed two secrets
        await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: {
                vars: [
                    { key: 'A_KEY', value: 'aval' },
                    { key: 'B_KEY', value: 'bval' },
                ],
            },
        });

        // Replace with one new secret (A_KEY and B_KEY removed, C_KEY added)
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 'C_KEY', value: 'cval' }] },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { vars: Array<{ key: string }> };
        // In the full suite both PUTs use the same atlas_test DB via `db`.
        // C_KEY must be present; A_KEY and B_KEY must not be.
        const keys = body.vars.map((v) => v.key);
        expect(keys).toContain('C_KEY');
        expect(keys).not.toContain('A_KEY');
        expect(keys).not.toContain('B_KEY');
    });

    it('returns 400 when vars is not an array', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: 'not-an-array' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 when a row key is not UPPER_SNAKE_CASE', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 'lowercase_key', value: 'x' }] },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 on duplicate keys in the same payload', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: {
                vars: [
                    { key: 'DUPE', value: 'x' },
                    { key: 'DUPE', value: 'y' },
                ],
            },
        });
        expect(res.statusCode).toBe(400);
    });

    it('accepts an empty vars array to clear all secrets', async () => {
        // Seed one first
        await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 'TEMP', value: 'val' }] },
        });
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [] },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { vars: unknown[] };
        expect(body.vars).toHaveLength(0);
    });

    it('returns 400 when a row has a non-string key (lines 32-35)', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 123, value: 'some-value' }] },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toMatch(/string key and value/);
    });

    it('returns 400 when a row has a non-string value (lines 32-35)', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            payload: { vars: [{ key: 'MY_KEY', value: null }] },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toMatch(/string key and value/);
    });

    it('returns 400 when request body is null (covers !raw branch on line 22)', async () => {
        // Sending JSON `null` as the body hits the `!raw` check before the
        // `!Array.isArray(raw.vars)` check — a distinct branch from the
        // "vars is not array" test above which sends `{ vars: 'not-an-array' }`.
        const res = await app.inject({
            method: 'PUT',
            url: '/api/environment-secrets',
            headers: { 'content-type': 'application/json' },
            payload: Buffer.from('null'),
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toBe('Expected { vars: Array<{key,value}> }');
    });
});
