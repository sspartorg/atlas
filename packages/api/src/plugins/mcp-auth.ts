import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@atlas/shared';
import { getTrustedBrowserOrigins } from '../utils/lan-origins.js';

/**
 * Shared secret expected on every write request that originates outside the
 * local web UI. Reads (GET) are never gated. When the env var is empty (the
 * default in fresh dev environments), the gate is fully open — this preserves
 * out-of-the-box developer experience without requiring config.
 */
const EXPECTED_TOKEN = process.env['ATLAS_MCP_TOKEN'] ?? '';

/**
 * Constant-time equality on the token bytes. V8's `===` short-circuits at
 * the first mismatched byte, which leaks response-time information a caller
 * can use to recover the token byte-by-byte. `timingSafeEqual` compares the
 * full buffer regardless of where the mismatch is. Length is checked up-front
 * (timingSafeEqual throws on length mismatch); the same-length branch runs
 * in constant time.
 */
export function tokensMatch(provided: string, expected: string): boolean {
    if (!provided || !expected) return false;
    const p = Buffer.from(provided, 'utf-8');
    const e = Buffer.from(expected, 'utf-8');
    if (p.length !== e.length) return false;
    return timingSafeEqual(p, e);
}

/**
 * Fastify preHandler — attach to routes that must not be reachable from
 * arbitrary local HTTP clients (writes; sensitive GETs like /api/fs/*).
 * Returns 401 if the token is required and missing/mismatched.
 *
 * Resolution order:
 *   1. If ATLAS_MCP_TOKEN is unset/empty → allow (degraded / first-run mode).
 *   2. Else if `Sec-Fetch-Site: same-origin` is present (Sec-Fetch-* are
 *      forbidden headers — set by the browser, cannot be set by JS or a
 *      non-browser client) AND either
 *        (a) Origin is absent — this is a same-origin GET; browsers omit
 *            Origin by spec, and Sec-Fetch-Site: same-origin proves the
 *            initiator's origin matches the target's, so an empty Origin
 *            is trustworthy here; OR
 *        (b) Origin is in the trusted set — same-origin write or CORS
 *            fetch where the browser did attach Origin.
 *      → allow. Sec-Fetch-Site is the tamper-proof anchor; the Origin
 *      check when present filters LAN misconfiguration edge cases.
 *   3. Else compare X-Atlas-Token against ATLAS_MCP_TOKEN.
 */
export async function requireMcpToken(
    req: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    if (!EXPECTED_TOKEN) return;

    const origin = (req.headers['origin'] as string | undefined) ?? '';
    const secFetchSite = (req.headers['sec-fetch-site'] as string | undefined) ?? '';
    // Sec-Fetch-Site is a browser-forbidden header — its presence proves
    // a real browser initiated the request. `same-origin` proves the
    // initiator's origin matches the target's, so an absent Origin
    // (which browsers omit on same-origin GETs) is safe here.
    if (secFetchSite === 'same-origin') {
        if (!origin || getTrustedBrowserOrigins().has(origin)) return;
    }

    const provided = (req.headers['x-atlas-token'] as string | undefined) ?? '';
    if (tokensMatch(provided, EXPECTED_TOKEN)) return;

    // W4 — typed envelope. Legacy `detail` field kept for any external MCP
    // client that was reading it; the new `kind: 'unauthorized'` is what the
    // web client (and any new caller) branches on.
    const body: ApiErrorBody & { detail: string } = {
        error: 'Write requests to this API require a matching X-Atlas-Token header.',
        kind: 'unauthorized',
        detail:
            'Write requests to this API require a matching X-Atlas-Token header. ' +
            'Set ATLAS_MCP_TOKEN in the MCP server env to the same value as on the API.',
    };
    await reply.status(401).send(body);
}
