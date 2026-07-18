import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock lan-origins before any import so every dynamic import sees the mock.
vi.mock('../utils/lan-origins.js', () => ({
    getTrustedBrowserOrigins: vi.fn(() => new Set<string>()),
}));

// ---------------------------------------------------------------------------
// Branch 1: EXPECTED_TOKEN is '' (open mode) — this is the default in tests
// because vitest.config.ts sets ATLAS_MCP_TOKEN=''
// ---------------------------------------------------------------------------
describe('requireMcpToken — open mode (token unset)', () => {
    it('returns immediately without touching reply when token is empty', async () => {
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: {} } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).not.toHaveBeenCalled();
        expect(reply.send).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Branches 2–4: token is set — must reload the module with a non-empty token
// ---------------------------------------------------------------------------
describe('requireMcpToken — token required mode', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubEnv('ATLAS_MCP_TOKEN', 'secret-abc');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('allows request when Origin matches trusted set AND Sec-Fetch-Site is same-origin (branch 2)', async () => {
        // Wire the mock to return a set containing the request origin.
        const { getTrustedBrowserOrigins } = await import('../utils/lan-origins.js');
        vi.mocked(getTrustedBrowserOrigins).mockReturnValue(
            new Set(['http://localhost:4000']),
        );

        const { requireMcpToken } = await import('./mcp-auth.js');
        // Follow-up audit: Origin alone is spoofable by any local HTTP
        // client; the trusted-origin path now requires Sec-Fetch-Site to
        // ALSO be `same-origin` (browser-set, forbidden for JS/non-
        // browser clients to fake). Reflect that in the fixture.
        const req = {
            headers: {
                origin: 'http://localhost:4000',
                'sec-fetch-site': 'same-origin',
            },
        } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).not.toHaveBeenCalled();
        expect(reply.send).not.toHaveBeenCalled();
    });

    it('allows same-origin GET when Sec-Fetch-Site is same-origin and Origin is absent (browser omits Origin on same-origin GETs)', async () => {
        // Real browsers do NOT attach Origin on same-origin GET requests
        // (only on cross-origin, CORS-preflighted, or write requests). The
        // gate must therefore accept `Sec-Fetch-Site: same-origin` alone as
        // proof of a legit same-origin browser fetch — the header is
        // browser-forbidden, so a non-browser client can't fake it, and
        // `same-origin` guarantees the initiator matches the target. Without
        // this, the folder-picker (GET /api/fs/list, /api/fs/home) 401s
        // from the web UI.
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: { 'sec-fetch-site': 'same-origin' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).not.toHaveBeenCalled();
        expect(reply.send).not.toHaveBeenCalled();
    });

    it('rejects when Sec-Fetch-Site is cross-site even if Origin is absent', async () => {
        // The Origin-absent shortcut must ONLY apply for same-origin; a
        // cross-site fetch must still be gated.
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: { 'sec-fetch-site': 'cross-site' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('rejects when Sec-Fetch-Site is same-origin but Origin is present and NOT in trusted set', async () => {
        // Belt-and-braces: if the browser did attach Origin, it must match
        // the trusted set — an untrusted origin can't ride the same-origin
        // signal past the gate.
        const { getTrustedBrowserOrigins } = await import('../utils/lan-origins.js');
        vi.mocked(getTrustedBrowserOrigins).mockReturnValue(
            new Set(['http://localhost:4000']),
        );

        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = {
            headers: {
                origin: 'http://evil.example.com',
                'sec-fetch-site': 'same-origin',
            },
        } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('rejects when Origin is trusted but Sec-Fetch-Site is missing (spoofed origin)', async () => {
        const { getTrustedBrowserOrigins } = await import('../utils/lan-origins.js');
        vi.mocked(getTrustedBrowserOrigins).mockReturnValue(
            new Set(['http://localhost:4000']),
        );

        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: { origin: 'http://localhost:4000' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        // Origin without Sec-Fetch-Site same-origin → treat as untrusted
        // (a real browser would always send Sec-Fetch-Site on same-origin
        // fetch/XHR/WS; only non-browser clients omit it).
        expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('does NOT allow when origin is present but not in trusted set', async () => {
        // Trusted set is empty (default mock); token header also absent → 401.
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: { origin: 'http://evil.example.com' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'unauthorized' }),
        );
    });

    it('allows request when correct X-Atlas-Token header is supplied (branch 3)', async () => {
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: { 'x-atlas-token': 'secret-abc' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).not.toHaveBeenCalled();
        expect(reply.send).not.toHaveBeenCalled();
    });

    it('rejects when token header is present but wrong (branch 4)', async () => {
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: { 'x-atlas-token': 'wrong-token' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'unauthorized',
                error: expect.stringContaining('X-Atlas-Token'),
            }),
        );
    });

    it('rejects with 401 when no token header and no origin (branch 4, bare request)', async () => {
        const { requireMcpToken } = await import('./mcp-auth.js');
        const req = { headers: {} } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'unauthorized' }),
        );
    });

    it('rejects when x-atlas-token header is empty string', async () => {
        const { requireMcpToken } = await import('./mcp-auth.js');
        // An empty string fails the `if (provided && ...)` check → falls through to 401.
        const req = { headers: { 'x-atlas-token': '' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('ignores origin header when its value is empty string', async () => {
        const { requireMcpToken } = await import('./mcp-auth.js');
        // Empty origin falls through the `if (origin && ...)` guard.
        const req = { headers: { origin: '' } } as any;
        const reply = { status: vi.fn().mockReturnThis(), send: vi.fn() } as any;

        await requireMcpToken(req, reply);

        expect(reply.status).toHaveBeenCalledWith(401);
    });
});
