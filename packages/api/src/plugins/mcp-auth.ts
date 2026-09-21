import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@atlas/shared';
import { getTrustedBrowserOrigins } from '../utils/lan-origins.js';

/**
 * Shared secret expected on every write request that originates outside the
 * local web UI. Reads (GET) are never gated.
 *
 * Read per request, not captured at module load. `main.ts` mints a token when
 * the env var is empty, and it does so after this module has been imported
 * (`server.js` pulls it in transitively), so a module-level constant would
 * freeze the empty value and leave the gate open for the process lifetime.
 * A per-request read costs nothing and removes the ordering trap.
 */
function expectedToken(): string {
    return (process.env['ATLAS_MCP_TOKEN'] ?? '').trim();
}

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
 *   1. If ATLAS_MCP_TOKEN is unset/empty → allow (fully-open mode). Reaching
 *      this through `main.ts` now requires ATLAS_MCP_TOKEN_OPEN=1, since an
 *      empty token is otherwise replaced with a generated one at boot.
 *   2. Else if `Sec-Fetch-Site: same-origin` is present AND either Origin is
 *      absent (browsers omit it on same-origin GETs) or Origin is trusted
 *      → allow. This is what lets the web UI work without a token.
 *
 *      **G-023 — read this before relying on it.** This branch is a
 *      convenience for the browser, NOT a security boundary, and the comment
 *      here used to claim otherwise ("cannot be set by ... a non-browser
 *      client"). That is false. "Forbidden header" in the Fetch spec means
 *      *browser JavaScript* may not set it; curl, a script, or any spawned
 *      CLI sets it freely. Proven on 2026-09-21 against a running API:
 *
 *          GET  /api/credentials/<id>/token                     -> 401
 *          GET  ... -H 'Sec-Fetch-Site: same-origin'            -> 400  (handler reached)
 *          DELETE /api/credentials/<id>                         -> 401
 *          DELETE ... -H 'Sec-Fetch-Site: same-origin'          -> 404  (handler reached)
 *
 *      So one header reaches every gated route. No header-based check can
 *      fix this: nothing an HTTP request carries distinguishes a browser
 *      from a local process, and tightening the Origin arm only means
 *      forging two headers instead of one.
 *
 *      What this gate DOES buy, honestly: it stops a naive or accidental
 *      local caller, and it keeps a cross-origin page from driving the API
 *      (that is the Origin check plus CORS, which do hold). What it does NOT
 *      do is defend against a hostile process running as the Owner — and
 *      such a process can read `ATLAS_MCP_TOKEN` out of `.env` anyway, so
 *      the token is no stronger against that threat.
 *
 *      Closing it properly needs the browser to prove itself with a secret:
 *      a same-origin bootstrap setting an HttpOnly `SameSite=Strict` cookie,
 *      after which this branch can be deleted. Baking the token into the web
 *      bundle is NOT the answer — with `ATLAS_LAN_ACCESS=true` the bundle is
 *      served to the LAN and the token goes with it. That is an Owner-level
 *      architecture decision, tracked as G-023, not something to improvise.
 *
 *      AGENTS.md's domain rules say Atlas is single-owner with no auth, so
 *      this being defence-in-depth rather than a boundary is consistent with
 *      the product — it just has to be described accurately.
 *   3. Else compare X-Atlas-Token against ATLAS_MCP_TOKEN.
 */
export async function requireMcpToken(
    req: FastifyRequest,
    reply: FastifyReply
): Promise<void> {
    const expected = expectedToken();
    if (!expected) return;

    const origin = (req.headers['origin'] as string | undefined) ?? '';
    const secFetchSite = (req.headers['sec-fetch-site'] as string | undefined) ?? '';
    // G-023 — this admits the browser without a token. It does NOT prove the
    // caller is a browser: any local client can set this header. See the
    // block comment above for what that does and does not buy.
    if (secFetchSite === 'same-origin') {
        if (!origin || getTrustedBrowserOrigins().has(origin)) return;
    }

    const provided = (req.headers['x-atlas-token'] as string | undefined) ?? '';
    if (tokensMatch(provided, expected)) return;

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
