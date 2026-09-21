import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

// The refresh route's job is classifying what GitHub said, not talking to it.
// Mocking the minting call lets each failure mode be asserted exactly.
const tokens = vi.hoisted(() => ({ refreshCredential: vi.fn(async () => undefined) }));
vi.mock('../services/github-app-tokens.js', () => tokens);

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';

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
// credential over the wire. The service-level rowToCredential emits it
// for internal decrypt paths; every route handler wraps in
// `stripSecretsForApi` before `reply.send`. Any regression that echoes
// ciphertext into a 200 response defeats the whole encrypt-at-rest boundary.
//
// 2026-09-12: `token_fingerprint` is deliberately NOT stripped. It is the
// masked display string (prefix + dots + last 4) the Credentials table's
// Fingerprint column, the saved-view detail and "Copy fingerprint" all
// render. Nulling it made every one of those blank.
describe('secret stripping on API responses', () => {
    it('GET /api/credentials strips token_encrypted but keeps token_fingerprint', async () => {
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
        expect(body[0]?.token_fingerprint).toBe('ghp_••••••••••••••••cdef');
    });

    it('GET /api/credentials/:id strips token_encrypted but keeps token_fingerprint', async () => {
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
        expect(body.token_fingerprint).toBe('ghp_••••••••••••••••cdef');
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
        expect(body.token_fingerprint).toBe('ghp_••••••••••••••••cdef');
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
        // Rotation re-fingerprints: last 4 of 'ghp_rotated_token_xxxxxxx'.
        expect(body.token_fingerprint).toBe('ghp_••••••••••••••••xxxx');
    });
});

// Regression — 2026-09-12. The Credentials modal's eye icon toggled the
// input `type` over a field that was never hydrated: every read route strips
// the ciphertext and no reveal endpoint existed, so "show" showed nothing.
describe('GET /api/credentials/:id/token', () => {
    it('returns the decrypted PAT', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({ method: 'GET', url: `/api/credentials/${id}/token` });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ id, value: VALID_CREDENTIAL.token });
    });

    it('returns 404 for an unknown id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/credentials/00000000-0000-0000-0000-000000000000/token',
        });
        expect(res.statusCode).toBe(404);
    });
});

// ─── github_app branches ────────────────────────────────────────────────────
//
// A real github_app credential needs a PEM on disk and a live GitHub call, so
// the row is inserted directly and the minting call is mocked. What is under
// test here is the route's own classification logic, which is where the
// security-relevant decision lives: how much of GitHub's reply reaches the
// caller.

async function insertApp(id = 'cred-app-1'): Promise<string> {
    await testDb
        .insertInto('credentials')
        .values({
            id,
            label: 'Bot App',
            host: 'github',
            kind: 'github_app',
            username: 'x-access-token',
            scope: '',
            app_id: 123456,
            // `credentials_kind_fields_check` requires all three for a
            // github_app row — the schema refuses a half-built App credential,
            // which is why this fixture carries a placeholder ciphertext.
            app_private_key_encrypted: 'v1:placeholder-not-a-real-key',
            app_installation_owner: 'acme-org',
        } as never)
        .execute();
    return id;
}

describe('credential kind guards', () => {
    it('refuses to reveal a github_app token — it rotates and is not actionable', async () => {
        const id = await insertApp();
        const res = await app.inject({ method: 'GET', url: `/api/credentials/${id}/token` });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/only pat credentials/i);
    });

    it('refuses to refresh a pat — there is nothing to mint', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/credentials',
            payload: VALID_CREDENTIAL,
        });
        const { id } = JSON.parse(created.body) as { id: string };
        const res = await app.inject({ method: 'POST', url: `/api/credentials/${id}/refresh` });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/only github_app credentials/i);
    });

    it('returns 404 refreshing an unknown credential', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/credentials/00000000-0000-0000-0000-000000000000/refresh',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/credentials/:id/refresh — classifying GitHub failures', () => {
    beforeEach(() => {
        tokens.refreshCredential.mockReset();
        tokens.refreshCredential.mockResolvedValue(undefined as never);
    });

    it('turns a 401 into an actionable 400 about the key and app id', async () => {
        const id = await insertApp();
        tokens.refreshCredential.mockRejectedValueOnce(
            new Error('[github-app-tokens] POST /access_tokens -> 401: {"message":"A JSON web token could not be decoded"}'),
        );
        const res = await app.inject({ method: 'POST', url: `/api/credentials/${id}/refresh` });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/private key and app id/i);
    });

    it('does NOT echo GitHub\'s response body back to the caller', async () => {
        // The body can carry installation topology and rate-limit correlation
        // ids. The route keeps the prefix and the status and drops the rest;
        // this is the assertion that stops a future "improve the error
        // message" change from pasting the whole reply through.
        const id = await insertApp();
        tokens.refreshCredential.mockRejectedValueOnce(
            new Error('[github-app-tokens] GET /installation -> 403: {"message":"SECRET-TOPOLOGY-DETAIL"}'),
        );
        const res = await app.inject({ method: 'POST', url: `/api/credentials/${id}/refresh` });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).not.toMatch(/SECRET-TOPOLOGY-DETAIL/);
    });

    it('turns a 404 into a 400 naming the installation owner as the thing to check', async () => {
        const id = await insertApp();
        tokens.refreshCredential.mockRejectedValueOnce(
            new Error('[github-app-tokens] GET /orgs/acme-org/installation -> 404: {"message":"Not Found"}'),
        );
        const res = await app.inject({ method: 'POST', url: `/api/credentials/${id}/refresh` });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/app_installation_owner/);
    });

    it('re-throws an error carrying no GitHub status rather than mislabelling it 400', async () => {
        // A DNS failure or a bug in our own code is not the Owner's
        // misconfiguration, and calling it one sends them hunting in the
        // wrong place.
        const id = await insertApp();
        tokens.refreshCredential.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.github.com'));
        const res = await app.inject({ method: 'POST', url: `/api/credentials/${id}/refresh` });
        expect(res.statusCode).toBe(500);
    });

    it('returns the refreshed row with ciphertext stripped on success', async () => {
        const id = await insertApp();
        const res = await app.inject({ method: 'POST', url: `/api/credentials/${id}/refresh` });
        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        expect(body.id).toBe(id);
        expect(body.app_private_key_encrypted).toBeUndefined();
        expect(body.token_encrypted).toBeNull();
        expect(tokens.refreshCredential).toHaveBeenCalledWith(id);
    });
});
