import { createSign } from 'node:crypto';
import { db } from '../db/kysely-client.js';
import { encrypt, decrypt, fingerprint } from './crypto.js';

// Mint short-lived GitHub App installation tokens from a stored
// `credentials` row (kind = 'github_app'). Uses only `node:crypto` — no
// external JWT library — so the surface stays tiny and there's nothing to
// keep patched. Mirrors the shape of the local
// `tools/atlas-bot/mint-installation-token.js` PoC that we already
// smoke-tested against api.github.com.
//
// Public API:
//   - mintInstallationToken(row)     : raw JWT + POST /access_tokens, returns { token, expires_at, installation_id }
//   - refreshCredential(id)          : mint + persist encrypted token, fingerprint, expires_at, installation_id
//   - refreshExpiring(nowMs)         : batch-refresh github_app rows expiring within PRE_WARM_MS
//
// Invariants:
//   - The PEM never leaves this module unencrypted. `decrypt()` runs
//     synchronously against the same workspace key used for PATs.
//   - Tokens returned to callers via `credentialsService.getToken()` are
//     bytes-for-bytes what GitHub minted; no massaging.
//   - Errors from GitHub are re-thrown with a `[github-app-tokens]` prefix
//     and the HTTP status so failures surface in log lines that the
//     shutdown-safe tick handler already catches.

/** Pre-warm anything expiring in ≤ 15 minutes on the scheduler tick. */
const PRE_WARM_MS = 15 * 60_000;

/** Lazy refresh threshold: if a token expires in less than this, `getToken` re-mints. */
export const LAZY_REFRESH_MS = 5 * 60_000;

interface GithubAppCredentialRow {
    id: string;
    app_id: number | null;
    app_private_key_encrypted: string | null;
    app_installation_owner: string | null;
    app_installation_id: number | null;
    app_slug: string | null;
    expires_at: string | null;
}

interface MintedInstallationToken {
    token: string;
    expires_at: string;
    installation_id: number;
}

// Node 15.7+ has native base64url; we require >= 20.
function b64url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
}

function buildJwt(appId: number, pem: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    // node-postgres returns bigint (OID 20) as a JS string by default;
    // coerce to Number so JWT `iss` serialises as a JSON number, matching
    // GitHub's App-auth spec. GitHub App ids are ~7 digits — well within
    // Number.MAX_SAFE_INTEGER, no precision loss.
    const payload = {
        iat: now - 60, // 60s clock-skew backdate per GitHub docs
        exp: now + 9 * 60, // 9 min (max 10)
        iss: Number(appId),
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const sig = signer.sign(pem);
    return `${signingInput}.${b64url(sig)}`;
}

const GH_HEADERS = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'atlas/github-app-tokens',
} as const;

// One helper for GET/POST — same auth, same headers, same error shape.
// Callers (`GhApiError`) can inspect `status` instead of substring-parsing
// the message. Never embeds the raw response body in the Error message —
// GitHub echoes installation ids, correlation ids, and rate-limit hints
// there, none of which belong in stdout logs.
export class GhApiError extends Error {
    constructor(public readonly method: 'GET' | 'POST', public readonly pathname: string, public readonly status: number) {
        super(`[github-app-tokens] ${method} ${pathname} -> ${status}`);
        this.name = 'GhApiError';
    }
}

async function ghApi<T>(
    method: 'GET' | 'POST',
    pathname: string,
    jwt: string,
    jsonBody?: unknown,
): Promise<T> {
    const init: RequestInit = {
        method,
        headers: {
            ...GH_HEADERS,
            'Authorization': `Bearer ${jwt}`,
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(jsonBody ?? {}) } : {}),
    };
    const r = await fetch(`https://api.github.com${pathname}`, init);
    if (!r.ok) {
        // Drain and discard the body — reading it prevents socket leaks
        // on undici, but the contents don't belong in our error path.
        await r.text().catch(() => '');
        throw new GhApiError(method, pathname, r.status);
    }
    return (await r.json()) as T;
}

const ghGet = <T>(pathname: string, jwt: string) => ghApi<T>('GET', pathname, jwt);
const ghPost = <T>(pathname: string, jwt: string, body: unknown) =>
    ghApi<T>('POST', pathname, jwt, body);

/**
 * Mint a fresh installation token for the given github_app credential row.
 * The token is scoped to every repo the App's installation can reach on
 * `app_installation_owner`; we deliberately don't pass a `repositories`
 * filter so the caller can use the same credential across all their repos
 * (matches the "multiple bots, per-project selection" answer from the plan).
 */
export async function mintInstallationToken(
    row: Pick<GithubAppCredentialRow, 'app_id' | 'app_private_key_encrypted' | 'app_installation_owner' | 'app_installation_id'>,
): Promise<MintedInstallationToken> {
    if (row.app_id == null || !row.app_private_key_encrypted || !row.app_installation_owner) {
        throw new Error('[github-app-tokens] credential row is missing App fields');
    }

    const pem = decrypt(row.app_private_key_encrypted);
    const jwt = buildJwt(Number(row.app_id), pem);

    // Resolve installation id lazily. The `GET /users/:owner/installation`
    // endpoint returns the installation for a user account when the App is
    // installed there; the same shape applies for orgs via
    // `GET /orgs/:owner/installation`. We try the user endpoint first
    // (matches personal accounts like sspartorg) and fall back to the
    // org endpoint on 404. Uses GhApiError.status (not string-match) so
    // the fallback survives message-format changes.
    let installationId = row.app_installation_id;
    if (installationId == null) {
        try {
            const inst = await ghGet<{ id: number }>(
                `/users/${encodeURIComponent(row.app_installation_owner)}/installation`,
                jwt,
            );
            installationId = inst.id;
        } catch (userErr) {
            if (userErr instanceof GhApiError && userErr.status === 404) {
                const inst = await ghGet<{ id: number }>(
                    `/orgs/${encodeURIComponent(row.app_installation_owner)}/installation`,
                    jwt,
                );
                installationId = inst.id;
            } else {
                throw userErr;
            }
        }
    }

    const tokenResp = await ghPost<{ token: string; expires_at: string }>(
        `/app/installations/${installationId}/access_tokens`,
        jwt,
        {},
    );

    return { token: tokenResp.token, expires_at: tokenResp.expires_at, installation_id: installationId };
}

/**
 * Mint a token for the given credential id and persist it back to the row
 * (encrypted token, fingerprint, expires_at, cached installation_id).
 * Throws if the credential is missing or of the wrong kind.
 */
export async function refreshCredential(credentialId: string): Promise<void> {
    const row = await db
        .selectFrom('credentials')
        .select([
            'id',
            'kind',
            'app_id',
            'app_private_key_encrypted',
            'app_installation_owner',
            'app_installation_id',
            'app_slug',
        ])
        .where('id', '=', credentialId)
        .executeTakeFirst();
    if (!row) throw new Error(`[github-app-tokens] credential ${credentialId} not found`);
    if (row.kind !== 'github_app') {
        throw new Error(`[github-app-tokens] credential ${credentialId} is kind '${row.kind}', not 'github_app'`);
    }

    const minted = await mintInstallationToken(row);

    // Best-effort backfill of `app_slug` for rows created before migration
    // 024 (or where `app-config.json` did not carry a slug). Without the
    // slug, `buildGitConfig` can't compose the bot's git commit identity
    // and commits end up attributed to the developer running the API.
    // A single extra API call, only on rows still missing the slug — once
    // filled it's cached forever on the row.
    let backfilledSlug: string | null = null;
    if (!row.app_slug && row.app_id != null && row.app_private_key_encrypted) {
        try {
            // Reuse a JWT signed with the same key (mintInstallationToken
            // just did the RSA sign — a fresh sign here is cheap but
            // wasted work). Coerce app_id to Number in case pg returned
            // the bigint column as a string (see buildJwt comment).
            const pem = decrypt(row.app_private_key_encrypted);
            const jwt = buildJwt(Number(row.app_id), pem);
            const app = await ghGet<{ slug?: string; name?: string }>('/app', jwt);
            if (typeof app.slug === 'string' && app.slug.length > 0) {
                backfilledSlug = app.slug;
            }
        } catch (err) {
            // Non-fatal: the token still works, bot-identity commits just
            // stay attributed to the dev until we can fetch the slug.
            const rawMsg = err instanceof Error ? err.message : String(err);
            const safeMsg = rawMsg.split(/:\s+/)[0] ?? rawMsg;
            // eslint-disable-next-line no-console
            console.warn(
                `[github-app-tokens] could not backfill app_slug for ${credentialId}: ${safeMsg}`,
            );
        }
    }

    const patch: Record<string, unknown> = {
        token_encrypted: encrypt(minted.token),
        token_fingerprint: fingerprint(minted.token),
        expires_at: minted.expires_at,
        app_installation_id: minted.installation_id,
    };
    if (backfilledSlug) patch['app_slug'] = backfilledSlug;
    await db
        .updateTable('credentials')
        .set(patch as never)
        .where('id', '=', credentialId)
        .execute();
}

/**
 * Sweep every github_app credential whose token is missing or expires
 * within PRE_WARM_MS and refresh them. Called from `tickAgentScheduler`
 * every 60s. Errors on individual rows are logged but do not stop the
 * sweep — one bad credential shouldn't block the rest.
 */
export async function refreshExpiring(nowMs: number = Date.now()): Promise<{ refreshed: number; errors: number }> {
    const cutoff = new Date(nowMs + PRE_WARM_MS).toISOString();
    const rows = await db
        .selectFrom('credentials')
        .select('id')
        .where('kind', '=', 'github_app')
        .where((eb) =>
            eb.or([
                eb('expires_at', 'is', null),
                eb('expires_at', '<', cutoff),
            ]),
        )
        .execute();

    // Run refreshes concurrently — installation tokens cluster in the
    // pre-warm window (all mint at ~1h intervals), so a serial sweep
    // blocks the scheduler tick for N × 300-500ms on any batch >1.
    // Promise.allSettled preserves the "one bad credential shouldn't
    // block the rest" contract.
    const results = await Promise.allSettled(
        rows.map((r) => refreshCredential(r.id).then(() => r.id)),
    );
    let refreshed = 0;
    let errors = 0;
    results.forEach((res, i) => {
        if (res.status === 'fulfilled') {
            refreshed++;
        } else {
            errors++;
            const err = res.reason;
            const rawMsg = err instanceof Error ? err.message : String(err);
            const safeMsg = rawMsg.split(/:\s+/)[0] ?? rawMsg;
            // reason: rows[i] is guaranteed to exist because results
            // and rows have the same length (Promise.allSettled preserves
            // order).
            // eslint-disable-next-line no-console
            console.warn(
                `[github-app-tokens] refresh of ${rows[i]!.id} failed: ${safeMsg}`,
            );
        }
    });
    return { refreshed, errors };
}

export const githubAppTokens = {
    mintInstallationToken,
    refreshCredential,
    refreshExpiring,
};
