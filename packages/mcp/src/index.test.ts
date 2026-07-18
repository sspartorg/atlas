import { afterEach, describe, expect, it, vi } from 'vitest';

// vi.mock hoists ABOVE imports — anything the factory closes over must
// be declared via vi.hoisted so it lives at the same level. Plain top-
// level `const` would TDZ-error because the factory runs before the
// const init.
const mocks = vi.hoisted(() => {
    const connect = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const StdioServerTransport = vi.fn().mockImplementation(function () {
        return { __kind: 'stdio-transport' };
    });
    const loadConfig = vi.fn(() => ({
        apiBase: 'http://api.test',
        requestTimeoutMs: 5000,
        mcpToken: 'test-token',
    }));
    const createServer = vi.fn(() => ({ connect, close }));
    return {
        connect,
        close,
        StdioServerTransport,
        loadConfig,
        createServer,
    };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: mocks.StdioServerTransport,
}));

vi.mock('./config.js', () => ({
    loadConfig: mocks.loadConfig,
}));

vi.mock('./server.js', () => ({
    createServer: mocks.createServer,
}));

import { main } from './index.js';

afterEach(() => {
    vi.clearAllMocks();
});

describe('main', () => {
    it('loads config, creates the server, opens a stdio transport, and connects', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await main();
        } finally {
            errSpy.mockRestore();
        }
        expect(mocks.loadConfig).toHaveBeenCalledTimes(1);
        expect(mocks.createServer).toHaveBeenCalledWith({
            apiBase: 'http://api.test',
            requestTimeoutMs: 5000,
            mcpToken: 'test-token',
        });
        expect(mocks.StdioServerTransport).toHaveBeenCalledTimes(1);
        expect(mocks.connect).toHaveBeenCalledTimes(1);
    });

    it('emits a connection-confirmed message to stderr after connect resolves', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await main();
        const msg = String(errSpy.mock.calls.at(-1)?.[0] ?? '');
        errSpy.mockRestore();
        expect(msg).toContain('[atlas-mcp] connected via stdio');
        expect(msg).toContain('api base: http://api.test');
        expect(msg).toContain('timeout: 5000ms');
    });

    it('propagates errors from server.connect (the bin guard logs + exits; not exercised here)', async () => {
        mocks.connect.mockImplementationOnce(async () => {
            throw new Error('transport boom');
        });
        await expect(main()).rejects.toThrow('transport boom');
    });
});
