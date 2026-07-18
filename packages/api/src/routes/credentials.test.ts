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
}, 30_000);

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

const VALID_CREDENTIAL = {
    label: 'My GitHub Token',
    token: 'ghp_1234567890abcdef',
};

describe('GET /api/credentials', () => {
    it('returns 200 with empty array when no credentials', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/credentials' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns credentials after creating one', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const res = await app.inject({ method: 'GET', url: '/api/credentials' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBe(1);
        expect(body[0]).toMatchObject({ label: 'My GitHub Token' });
        // Token is NOT returned in list (masked / absent)
        expect(body[0].token).toBeUndefined();
    });
});

describe('POST /api/credentials', () => {
    it('creates a credential and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ label: 'My GitHub Token' });
        expect(body.id).toBeDefined();
    });

    it('returns 400 for missing label', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: { token: 'ghp_1234567890abcdef' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for token that is too short (< 8 chars)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: { label: 'My Token', token: 'short' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for missing token', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: { label: 'My Token' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/credentials/:id', () => {
    it('returns 200 for an existing credential', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const createdBody = JSON.parse(created.body) as { id: string };
        const res = await app.inject({
            method: 'GET',
            url: `/api/credentials/${createdBody.id}`,
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ id: createdBody.id });
    });

    it('returns 404 for a missing credential', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/credentials/no-such-id',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('PATCH /api/credentials/:id', () => {
    it('updates a credential label and returns 200', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/credentials/${id}`,
            payload: { label: 'Updated Label' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ label: 'Updated Label' });
    });

    it('updates token when patch.token is provided (CRED-TOKEN-1)', async () => {
        // Covers `if (patch.token)` true branch in credentialsService.update
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/credentials/${id}`,
            payload: { token: 'ghp_new_token_value_xyz' },
        });
        expect(res.statusCode).toBe(200);
    });

    it('returns 404 for a missing credential', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/credentials/no-such-id',
            payload: { label: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/credentials/:id', () => {
    it('deletes a credential and returns 204', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        const res = await app.inject({
            method: 'DELETE',
            url: `/api/credentials/${id}`,
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 404 for a missing credential', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/credentials/no-such-id',
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 404 on double-delete', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        await app.inject({ method: 'DELETE', url: `/api/credentials/${id}` });
        const second = await app.inject({ method: 'DELETE', url: `/api/credentials/${id}` });
        expect(second.statusCode).toBe(404);
    });
});

// Post-audit regression tests: the API layer must strip encrypt-at-rest
// ciphertext (token_encrypted, token_fingerprint) before serialising a
// credential over the wire. The service-level rowToCredential emits them
// for internal decrypt paths; every route handler wraps in
// `stripSecretsForApi` before `reply.send`. Any regression that echoes
// ciphertext into a 200 response defeats the whole encrypt-at-rest boundary.
describe('secret stripping on API responses', () => {
    it('GET /api/credentials strips token_encrypted + token_fingerprint', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const res = await app.inject({ method: 'GET', url: '/api/credentials' });
        const body = JSON.parse(res.body) as Array<{
            token_encrypted: unknown;
            token_fingerprint: unknown;
        }>;
        expect(body[0]?.token_encrypted).toBeNull();
        expect(body[0]?.token_fingerprint).toBeNull();
    });

    it('GET /api/credentials/:id strips token_encrypted + token_fingerprint', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        const res = await app.inject({ method: 'GET', url: `/api/credentials/${id}` });
        const body = JSON.parse(res.body) as {
            token_encrypted: unknown;
            token_fingerprint: unknown;
        };
        expect(body.token_encrypted).toBeNull();
        expect(body.token_fingerprint).toBeNull();
    });

    it('POST /api/credentials strips ciphertext from its 201 response', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as {
            token_encrypted: unknown;
            token_fingerprint: unknown;
        };
        expect(body.token_encrypted).toBeNull();
        expect(body.token_fingerprint).toBeNull();
    });

    it('PATCH /api/credentials/:id strips ciphertext on the 200 response even when rotating a token', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/credentials/${id}`,
            payload: { token: 'ghp_rotated_token_xxxxxxx' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            token_encrypted: unknown;
            token_fingerprint: unknown;
        };
        expect(body.token_encrypted).toBeNull();
        expect(body.token_fingerprint).toBeNull();
    });
});
