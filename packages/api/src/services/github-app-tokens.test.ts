import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mintInstallationToken } from './github-app-tokens.js';

// These tests exercise the pure JWT + HTTP surface of the token minter.
// They never touch the database — the credentials service tests cover the
// DB integration path (`credentials.test.ts::github_app` cases).

function makeKeyPair(): { pem: string } {
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });
    return {
        pem: privateKey.export({ type: 'pkcs1', format: 'pem' }) as string,
    };
}

// The service reads the encrypted PEM through `decrypt()`; we stub the
// crypto module so tests don't need the workspace key file.
vi.mock('./crypto.js', () => ({
    encrypt: (v: string) => `enc(${v})`,
    decrypt: (v: string) => v.replace(/^enc\(/, '').replace(/\)$/, ''),
    fingerprint: (v: string) => `fp:${v.slice(-4)}`,
}));

// Kysely-client stub. mintInstallationToken doesn't touch the DB, but the
// module imports the client anyway; give it a noop.
vi.mock('../db/kysely-client.js', () => ({ db: {} }));

describe('mintInstallationToken', () => {
    const originalFetch = globalThis.fetch;
    let capturedRequests: Array<{ url: string; init: RequestInit }> = [];

    beforeEach(() => {
        capturedRequests = [];
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function installFetchStub(handler: (url: string, init: RequestInit) => Response) {
        globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
            const url = typeof input === 'string' ? input : String(input);
            capturedRequests.push({ url, init });
            return handler(url, init);
        }) as typeof fetch;
    }

    function jsonResponse(body: unknown, status = 200): Response {
        return new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    it('signs a valid RS256 JWT with iss=app_id and calls the correct endpoints', async () => {
        const { pem } = makeKeyPair();
        installFetchStub((url) => {
            if (url.includes('/users/sspartorg/installation')) {
                return jsonResponse({ id: 42 });
            }
            if (url.includes('/app/installations/42/access_tokens')) {
                return jsonResponse({
                    token: 'ghs_test',
                    expires_at: '2026-07-02T18:00:00Z',
                });
            }
            return new Response('unexpected', { status: 500 });
        });

        const result = await mintInstallationToken({
            app_id: 12345,
            app_private_key_encrypted: `enc(${pem})`,
            app_installation_owner: 'sspartorg',
            app_installation_id: null,
        });

        expect(result.token).toBe('ghs_test');
        expect(result.installation_id).toBe(42);
        expect(result.expires_at).toBe('2026-07-02T18:00:00Z');

        // Verify the JWT was signed and carries iss=app_id.
        expect(capturedRequests).toHaveLength(2);
        const authHeader = (capturedRequests[0]!.init.headers as Record<string, string>)[
            'Authorization'
        ];
        expect(authHeader).toMatch(/^Bearer /);
        const jwt = authHeader.replace(/^Bearer /, '');
        const [headerB64, payloadB64, sigB64] = jwt.split('.');
        const header = JSON.parse(Buffer.from(headerB64!, 'base64').toString('utf8'));
        const payload = JSON.parse(Buffer.from(payloadB64!, 'base64').toString('utf8'));
        expect(header.alg).toBe('RS256');
        expect(payload.iss).toBe(12345);
        expect(payload.exp - payload.iat).toBeGreaterThan(9 * 60);
        // Verify the signature actually validates against the matching public key.
        const signingInput = `${headerB64}.${payloadB64}`;
        const sig = Buffer.from(sigB64!.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
        const v = createVerify('RSA-SHA256');
        v.update(signingInput);
        v.end();
        expect(v.verify(pem, sig)).toBe(true);
    });

    it('uses the cached installation id when present (skips /users lookup)', async () => {
        const { pem } = makeKeyPair();
        installFetchStub(() => jsonResponse({ token: 'ghs_cached', expires_at: '2026-07-02T18:00:00Z' }));

        const result = await mintInstallationToken({
            app_id: 12345,
            app_private_key_encrypted: `enc(${pem})`,
            app_installation_owner: 'sspartorg',
            app_installation_id: 99,
        });
        expect(result.installation_id).toBe(99);
        expect(capturedRequests).toHaveLength(1);
        expect(capturedRequests[0]!.url).toContain('/app/installations/99/access_tokens');
    });

    it('falls back to /orgs endpoint when /users returns 404', async () => {
        const { pem } = makeKeyPair();
        installFetchStub((url) => {
            if (url.endsWith('/users/isw-CDM-Next/installation')) {
                return new Response('not found', { status: 404 });
            }
            if (url.endsWith('/orgs/isw-CDM-Next/installation')) {
                return jsonResponse({ id: 77 });
            }
            if (url.endsWith('/app/installations/77/access_tokens')) {
                return jsonResponse({
                    token: 'ghs_org',
                    expires_at: '2026-07-02T18:00:00Z',
                });
            }
            return new Response('unexpected', { status: 500 });
        });

        const result = await mintInstallationToken({
            app_id: 999,
            app_private_key_encrypted: `enc(${pem})`,
            app_installation_owner: 'isw-CDM-Next',
            app_installation_id: null,
        });
        expect(result.installation_id).toBe(77);
        expect(result.token).toBe('ghs_org');
    });

    it('throws on missing App fields', async () => {
        await expect(
            mintInstallationToken({
                app_id: null,
                app_private_key_encrypted: 'x',
                app_installation_owner: 'x',
                app_installation_id: null,
            }),
        ).rejects.toThrow(/missing App fields/);
    });

    it('surfaces the HTTP status when GitHub rejects the mint', async () => {
        const { pem } = makeKeyPair();
        installFetchStub((url) => {
            if (url.includes('/users/sspartorg/installation')) {
                return jsonResponse({ id: 42 });
            }
            return new Response('bad app', { status: 401 });
        });

        await expect(
            mintInstallationToken({
                app_id: 1,
                app_private_key_encrypted: `enc(${pem})`,
                app_installation_owner: 'sspartorg',
                app_installation_id: null,
            }),
        ).rejects.toThrow(/POST.*-> 401/);
    });
});
