// HTTP transport entry point for the Atlas MCP. Used by the API process
// (packages/api/src/plugins/mcp-host.ts) to expose the same tool surface
// as the stdio entry (./index.ts) but reachable over HTTP at a fixed port.
//
// Returns a request handler that accepts Node `IncomingMessage` /
// `ServerResponse` plus an optional parsed JSON body. The handler is
// stateless (no per-session ID); each call is independent.

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from './server.js';
import type { IMcpConfig } from './config.js';

export type HttpMcpRequestHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
) => Promise<void>;

export interface IHttpMcpHost {
    handle: HttpMcpRequestHandler;
    close: () => Promise<void>;
}

export async function createHttpMcpHandler(config: IMcpConfig): Promise<IHttpMcpHost> {
    // The SDK's StreamableHTTPServerTransport in stateless mode throws
    // "Stateless transport cannot be reused across requests" on the second
    // hit (see webStandardStreamableHttp.js: `_hasHandledRequest` guard).
    // Hono's getRequestListener wrapper swallows that throw and emits a
    // silent 500, which is why pre-fix every client appeared broken with
    // no log entry. Spin up a fresh server + transport per request and
    // tear them down when the response closes.
    return {
        handle: async (req, res, parsedBody) => {
            const server = createServer(config);
            const transport = new StreamableHTTPServerTransport({});
            res.on('close', () => {
                void transport.close().catch(() => undefined);
                void server.close().catch(() => undefined);
            });
            // Type assertion: StreamableHTTPServerTransport satisfies
            // Transport at runtime but the SDK's
            // `onclose: (() => void) | undefined` accessor doesn't narrow
            // to the interface's `onclose?: () => void` under strict
            // optional-property checking.
            await server.connect(transport as unknown as Transport);
            await transport.handleRequest(req, res, parsedBody);
        },
        close: async () => {
            // No persistent state — every request owns its own server +
            // transport, torn down on `res.close`.
        },
    };
}
