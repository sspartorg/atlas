import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

// vi.mock hoists ABOVE imports — anything the factory closes over must be
// declared via vi.hoisted so it lives at the same level. Plain top-level
// `const` would TDZ-error because the factory runs before the const init.
const mocks = vi.hoisted(() => {
    const transportClose = vi.fn(async () => undefined);
    const transportHandle = vi.fn(async () => undefined);
    const TransportCtor = vi.fn().mockImplementation(function () {
        return {
            close: transportClose,
            handleRequest: transportHandle,
        };
    });
    const serverConnect = vi.fn(async () => undefined);
    const serverClose = vi.fn(async () => undefined);
    const createServerMock = vi.fn(() => ({
        connect: serverConnect,
        close: serverClose,
    }));
    return {
        transportClose,
        transportHandle,
        TransportCtor,
        serverConnect,
        serverClose,
        createServerMock,
    };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
    StreamableHTTPServerTransport: mocks.TransportCtor,
}));

vi.mock('./server.js', () => ({
    createServer: mocks.createServerMock,
}));

import { createHttpMcpHandler } from './http-handler.js';

const CONFIG = {
    apiBase: 'http://api.test',
    requestTimeoutMs: 5000,
    mcpToken: 'test-token',
};

// Minimal req/res stubs — only the surface the SDK transport touches is
// required, and we mock the transport itself, so an EventEmitter-shaped
// `res` with a captured `close` listener is enough.
interface CloseListener {
    handler: () => void | Promise<void>;
}

function makeReqRes() {
    const closeListeners: CloseListener[] = [];
    const res = {
        on: (event: string, handler: () => void) => {
            if (event === 'close') closeListeners.push({ handler });
        },
        emit(event: 'close') {
            if (event === 'close') {
                for (const l of closeListeners) void l.handler();
            }
        },
    } as unknown as ServerResponse & { emit: (e: 'close') => void };
    const req = {} as IncomingMessage;
    return { req, res };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('createHttpMcpHandler', () => {
    it('returns an object exposing handle + close', async () => {
        const host = await createHttpMcpHandler(CONFIG);
        expect(typeof host.handle).toBe('function');
        expect(typeof host.close).toBe('function');
    });

    it('handle: builds a fresh server + transport, connects, then dispatches the request', async () => {
        const host = await createHttpMcpHandler(CONFIG);
        const { req, res } = makeReqRes();
        await host.handle(req, res, { jsonrpc: '2.0', method: 'tools/list', id: 1 });
        expect(mocks.createServerMock).toHaveBeenCalledWith(CONFIG);
        expect(mocks.TransportCtor).toHaveBeenCalledTimes(1);
        expect(mocks.serverConnect).toHaveBeenCalledTimes(1);
        expect(mocks.transportHandle).toHaveBeenCalledTimes(1);
        const [actualReq, actualRes, parsedBody] = mocks.transportHandle.mock.calls[0]!;
        expect(actualReq).toBe(req);
        expect(actualRes).toBe(res);
        expect(parsedBody).toEqual({ jsonrpc: '2.0', method: 'tools/list', id: 1 });
    });

    it('handle: tears down server + transport when the response closes', async () => {
        const host = await createHttpMcpHandler(CONFIG);
        const { req, res } = makeReqRes();
        await host.handle(req, res);
        (res as unknown as { emit: (e: 'close') => void }).emit('close');
        // The teardown is fire-and-forget — give microtasks a chance.
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.transportClose).toHaveBeenCalled();
        expect(mocks.serverClose).toHaveBeenCalled();
    });

    it('handle: swallows teardown errors so the response close path never throws', async () => {
        mocks.transportClose.mockRejectedValueOnce(new Error('transport teardown boom'));
        mocks.serverClose.mockRejectedValueOnce(new Error('server teardown boom'));
        const host = await createHttpMcpHandler(CONFIG);
        const { req, res } = makeReqRes();
        await host.handle(req, res);
        (res as unknown as { emit: (e: 'close') => void }).emit('close');
        await Promise.resolve();
        await Promise.resolve();
        expect(mocks.transportClose).toHaveBeenCalled();
        expect(mocks.serverClose).toHaveBeenCalled();
    });

    it('handle: creates an INDEPENDENT server + transport per request (stateless guard)', async () => {
        const host = await createHttpMcpHandler(CONFIG);
        const a = makeReqRes();
        const b = makeReqRes();
        await host.handle(a.req, a.res);
        await host.handle(b.req, b.res);
        expect(mocks.createServerMock).toHaveBeenCalledTimes(2);
        expect(mocks.TransportCtor).toHaveBeenCalledTimes(2);
        expect(mocks.transportHandle).toHaveBeenCalledTimes(2);
    });

    it('close: is a no-op (per-request teardown owns lifecycle)', async () => {
        const host = await createHttpMcpHandler(CONFIG);
        await expect(host.close()).resolves.toBeUndefined();
    });
});
