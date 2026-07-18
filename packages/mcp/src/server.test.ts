import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';

describe('createServer', () => {
    it('wires McpServer with the given config and registers tools without throwing', () => {
        const server = createServer({
            apiBase: 'http://api.test',
            requestTimeoutMs: 5000,
        });
        // McpServer exposes `connect` for transport binding; this is the
        // smoke we need — the constructor walked through registerAllTools
        // (covering tools/index.ts) without crashing.
        expect(server).toBeDefined();
        expect(typeof (server as unknown as { connect: unknown }).connect).toBe('function');
    });
});
