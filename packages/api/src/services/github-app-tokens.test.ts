import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mintInstallationToken, refreshCredential, refreshExpiring } from './github-app-tokens.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

// `mintInstallationToken` is pure JWT + HTTP. `refreshCredential` and
// `refreshExpiring` persist against the real `credentials` table, so those
// suites use the shared Postgres fixture.

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

const originalFetch = globalThis.fetch;
let capturedRequests: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
    capturedRequests = [];
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

afterAll(async () => {
    await closeTestDb();
});

// `handler` may return a Response or any Response-shaped object — the
// error-body tests need one whose `.text()` rejects, which `new Response`
// cannot express.
function installFetchStub(handler: (url: string, init: RequestInit) => unknown) {
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

describe('mintInstallationToken', () => {
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
            if (url.endsWith('/users/acme-org/installation')) {
                return new Response('not found', { status: 404 });
            }
            if (url.endsWith('/orgs/acme-org/installation')) {
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
            app_installation_owner: 'acme-org',
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

function makePem(): string {
    return makeKeyPair().pem;
}

/** Insert a github_app credential row straight into the fixture DB. */
async function insertAppCredential(over: {
    id: string;
    pem: string;
    app_id?: number;
    app_installation_owner?: string;
    app_installation_id?: number | null;
    app_slug?: string | null;
    expires_at?: string | null;
}): Promise<void> {
    await testDb
        .insertInto('credentials')
        .values({
            id: over.id,
            label: `App ${over.id}`,
            host: 'github',
            kind: 'github_app',
            username: 'x-access-token',
            scope: '',
            app_id: over.app_id ?? 12345,
            app_private_key_encrypted: `enc(${over.pem})`,
            app_installation_owner: over.app_installation_owner ?? 'sspartorg',
            app_installation_id: over.app_installation_id ?? 42,
            app_slug: over.app_slug ?? null,
            expires_at: over.expires_at ?? null,
        })
        .execute();
}

function readCredential(id: string) {
    return testDb
        .selectFrom('credentials')
        .select([
            'token_encrypted',
            'token_fingerprint',
            'expires_at',
            'app_installation_id',
            'app_slug',
        ])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
}

describe('mintInstallationToken — error paths', () => {
    it('re-throws a non-404 failure from the installation lookup instead of trying /orgs', async () => {
        // The /orgs fallback exists for "this owner is an org, not a user".
        // A 500 or a 401 means something else is wrong; retrying against
        // /orgs would mask it and produce a confusing second error.
        installFetchStub((url) => {
            if (url.includes('/users/sspartorg/installation')) {
                return new Response('boom', { status: 500 });
            }
            return new Response('should not be reached', { status: 418 });
        });

        await expect(
            mintInstallationToken({
                app_id: 12345,
                app_private_key_encrypted: `enc(${makePem()})`,
                app_installation_owner: 'sspartorg',
                app_installation_id: null,
            }),
        ).rejects.toThrow(/GET \/users\/sspartorg\/installation -> 500/);
        expect(capturedRequests).toHaveLength(1);
    });

    it('still surfaces the HTTP status when draining the error body throws', async () => {
        // The body drain is there to stop undici socket leaks, not to
        // produce a value. If it rejects (aborted/truncated response) the
        // caller must still get GhApiError with the real status, not an
        // opaque "body stream" error that hides which call failed.
        installFetchStub(() => ({
            ok: false,
            status: 503,
            text: () => Promise.reject(new Error('body stream already read')),
        }));

        await expect(
            mintInstallationToken({
                app_id: 12345,
                app_private_key_encrypted: `enc(${makePem()})`,
                app_installation_owner: 'sspartorg',
                app_installation_id: 7,
            }),
        ).rejects.toThrow(/POST \/app\/installations\/7\/access_tokens -> 503/);
    });
});

describe('refreshCredential', () => {
    beforeEach(async () => {
        await truncateAll();
    });

    it('persists the encrypted token, fingerprint, expiry and installation id', async () => {
        // This row IS the credential every git push and PR open authenticates
        // with. If the write half of the refresh silently no-ops, the stored
        // token expires an hour later and every repo operation starts failing.
        const pem = makePem();
        await insertAppCredential({ id: 'cred-persist', pem, app_slug: 'atlas-bot' });
        installFetchStub((url) => {
            if (url.endsWith('/app/installations/42/access_tokens')) {
                return jsonResponse({ token: 'ghs_fresh', expires_at: '2026-09-21T19:00:00.000Z' });
            }
            return new Response('unexpected', { status: 500 });
        });

        await refreshCredential('cred-persist');

        const row = await readCredential('cred-persist');
        expect(row.token_encrypted).toBe('enc(ghs_fresh)');
        expect(row.token_fingerprint).toBe('fp:resh');
        expect(Number(row.app_installation_id)).toBe(42);
        expect(new Date(row.expires_at as unknown as string).toISOString()).toBe(
            '2026-09-21T19:00:00.000Z',
        );
        // app_slug was already set — no second /app round-trip.
        expect(row.app_slug).toBe('atlas-bot');
        expect(capturedRequests.map((r) => r.url)).toEqual([
            'https://api.github.com/app/installations/42/access_tokens',
        ]);
    });

    it('backfills app_slug from GET /app when the row has none', async () => {
        // Without the slug `buildGitConfig` can't compose the bot's commit
        // identity, so commits made by a workflow run get attributed to the
        // developer running the API instead of the App.
        const pem = makePem();
        await insertAppCredential({ id: 'cred-slug', pem, app_slug: null });
        installFetchStub((url) => {
            if (url.endsWith('/app')) return jsonResponse({ slug: 'atlas-bot', name: 'Atlas Bot' });
            if (url.endsWith('/app/installations/42/access_tokens')) {
                return jsonResponse({ token: 'ghs_slug', expires_at: '2026-09-21T19:00:00.000Z' });
            }
            return new Response('unexpected', { status: 500 });
        });

        await refreshCredential('cred-slug');

        const row = await readCredential('cred-slug');
        expect(row.app_slug).toBe('atlas-bot');
        expect(row.token_encrypted).toBe('enc(ghs_slug)');
        expect(capturedRequests.some((r) => r.url.endsWith('/app'))).toBe(true);
    });

    it('leaves app_slug null when GET /app answers without a slug', async () => {
        const pem = makePem();
        await insertAppCredential({ id: 'cred-noslug', pem, app_slug: null });
        installFetchStub((url) => {
            if (url.endsWith('/app')) return jsonResponse({ name: 'Atlas Bot' });
            return jsonResponse({ token: 'ghs_noslug', expires_at: '2026-09-21T19:00:00.000Z' });
        });

        await refreshCredential('cred-noslug');

        const row = await readCredential('cred-noslug');
        expect(row.app_slug).toBeNull();
        expect(row.token_encrypted).toBe('enc(ghs_noslug)');
    });

    it('still persists the token when the app_slug backfill fails', async () => {
        // Slug backfill is cosmetic; the token is not. A 403 on /app must
        // not cost the Owner a working credential.
        const pem = makePem();
        await insertAppCredential({ id: 'cred-slugfail', pem, app_slug: null });
        installFetchStub((url) => {
            if (url.endsWith('/app')) return new Response('forbidden', { status: 403 });
            return jsonResponse({ token: 'ghs_ok', expires_at: '2026-09-21T19:00:00.000Z' });
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await refreshCredential('cred-slugfail');

        const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
        expect(warnings.some((w) => w.includes('could not backfill app_slug for cred-slugfail'))).toBe(
            true,
        );
        const row = await readCredential('cred-slugfail');
        expect(row.token_encrypted).toBe('enc(ghs_ok)');
        expect(row.app_slug).toBeNull();
    });

    it('throws when the credential id does not exist', async () => {
        await expect(refreshCredential('nope')).rejects.toThrow(/credential nope not found/);
    });

    it('refuses to mint against a pat credential', async () => {
        // A PAT row has no App key; minting against it would either crash
        // deep in `decrypt` or, worse, overwrite the Owner's stored PAT.
        await testDb
            .insertInto('credentials')
            .values({
                id: 'cred-pat',
                label: 'GH PAT',
                host: 'github',
                kind: 'pat',
                username: 'x-access-token',
                scope: 'repo',
                token_encrypted: 'enc(ghp_x)',
                token_fingerprint: 'fp:hp_x',
            })
            .execute();

        await expect(refreshCredential('cred-pat')).rejects.toThrow(
            /credential cred-pat is kind 'pat', not 'github_app'/,
        );
        const row = await readCredential('cred-pat');
        expect(row.token_encrypted).toBe('enc(ghp_x)');
    });
});

describe('refreshExpiring', () => {
    const NOW = Date.parse('2026-09-21T12:00:00.000Z');

    beforeEach(async () => {
        await truncateAll();
    });

    it('refreshes rows with no expiry or expiring inside the pre-warm window, and skips the rest', async () => {
        // This sweep is what keeps a long workflow run from hitting an
        // expired token mid-push. Sweeping too little breaks pushes;
        // sweeping everything every tick burns GitHub's App rate limit.
        const pem = makePem();
        await insertAppCredential({ id: 'cred-never', pem, expires_at: null, app_slug: 's' });
        await insertAppCredential({
            id: 'cred-soon',
            pem,
            app_installation_id: 43,
            app_slug: 's',
            // 10 min out — inside the 15 min pre-warm window.
            expires_at: '2026-09-21T12:10:00.000Z',
        });
        await insertAppCredential({
            id: 'cred-later',
            pem,
            app_installation_id: 44,
            app_slug: 's',
            // 50 min out — must be left alone.
            expires_at: '2026-09-21T12:50:00.000Z',
        });
        installFetchStub(() =>
            jsonResponse({ token: 'ghs_swept', expires_at: '2026-09-21T13:00:00.000Z' }),
        );

        const result = await refreshExpiring(NOW);

        expect(result).toEqual({ refreshed: 2, errors: 0 });
        expect((await readCredential('cred-never')).token_encrypted).toBe('enc(ghs_swept)');
        expect((await readCredential('cred-soon')).token_encrypted).toBe('enc(ghs_swept)');
        expect((await readCredential('cred-later')).token_encrypted).toBeNull();
    });

    it('counts a failing credential as an error without aborting the sweep', async () => {
        // One revoked App must not stop every other credential from being
        // pre-warmed — that is the whole point of allSettled here.
        const pem = makePem();
        await insertAppCredential({ id: 'cred-bad', pem, app_installation_id: 91, app_slug: 's' });
        await insertAppCredential({ id: 'cred-good', pem, app_installation_id: 92, app_slug: 's' });
        installFetchStub((url) => {
            if (url.includes('/app/installations/91/')) {
                return new Response('revoked', { status: 401 });
            }
            return jsonResponse({ token: 'ghs_survivor', expires_at: '2026-09-21T13:00:00.000Z' });
        });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await refreshExpiring(NOW);

        const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
        expect(result).toEqual({ refreshed: 1, errors: 1 });
        expect(warnings.some((w) => w.includes('refresh of cred-bad failed'))).toBe(true);
        // The warn line must not carry the GitHub response body/ids.
        expect(warnings.join(' ')).not.toMatch(/revoked/);
        expect((await readCredential('cred-good')).token_encrypted).toBe('enc(ghs_survivor)');
        expect((await readCredential('cred-bad')).token_encrypted).toBeNull();
    });

    it('returns zeroes when nothing is due', async () => {
        const pem = makePem();
        await insertAppCredential({
            id: 'cred-fresh',
            pem,
            app_slug: 's',
            expires_at: '2026-09-21T13:30:00.000Z',
        });
        const result = await refreshExpiring(NOW);
        expect(result).toEqual({ refreshed: 0, errors: 0 });
    });
});
