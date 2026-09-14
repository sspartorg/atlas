// HTTP MCP host — binds the Atlas MCP to a fixed loopback port (4500)
// so that ~/.claude.json carries ONE `atlas` entry (`url:
// http://127.0.0.1:4500/mcp`) that always routes to whichever local
// stack (dev or prod) is currently running.
//
// First-boot-wins: if the second stack starts while the first is still
// up, the EADDRINUSE on port 4500 is caught and the second instance
// runs API-only (web UI + /api/* still work; just no MCP). The user
// stops the running stack to hand MCP over to the other.
//
// Opt-out: set ATLAS_HOST_MCP=false to skip binding entirely on a
// given instance (useful when running headless or testing).

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createHttpMcpHandler, type IHttpMcpHost } from '@atlas/mcp/http-handler';
import type { FastifyBaseLogger } from 'fastify';

const MCP_HOST_PORT = 4500;
const MCP_HOST_BIND = '127.0.0.1';
const MCP_HOST_PATH = '/mcp';

/** Where every local Claude client reaches the Atlas MCP (agent runs pass it via `--mcp-config`). */
export const ATLAS_MCP_URL = `http://${MCP_HOST_BIND}:${MCP_HOST_PORT}${MCP_HOST_PATH}`;

export interface IStartMcpHostOptions {
    apiBase: string;
    mcpToken: string;
    log: FastifyBaseLogger;
    port?: number;
    host?: string;
}

export interface IMcpHostHandle {
    server: HttpServer;
    mcp: IHttpMcpHost;
}

export async function startMcpHost(opts: IStartMcpHostOptions): Promise<IMcpHostHandle | null> {
    if (process.env['ATLAS_HOST_MCP']?.toLowerCase() === 'false') {
        opts.log.info('[mcp] ATLAS_HOST_MCP=false — MCP listener disabled for this stack');
        return null;
    }

    const port = opts.port ?? MCP_HOST_PORT;
    const host = opts.host ?? MCP_HOST_BIND;

    const mcp = await createHttpMcpHandler({
        apiBase: opts.apiBase,
        mcpToken: opts.mcpToken,
        requestTimeoutMs: 15_000,
        // In-process MCP host: there is no bound agent identity here, and
        // there cannot be one — this single listener serves every agent.
        //
        // This comment used to claim each spawned CLI carries its own
        // ATLAS_AGENT_ID. It does not: nothing in the repo sets that var
        // (agent-runner's childEnv is gitInvokeEnv + ollamaEnv only), and it
        // would not help if it did, because the tool handler runs in THIS
        // process, not in the child. So `resolveAgentId` falls back to an
        // optional tool argument the model may omit — which is how agent
        // comments ended up with a null agent_id and rendered as the literal
        // "Agent". `commentsService.create` now resolves the author from the
        // item's live run instead of trusting the caller (see
        // .agents/data-model.md → IComment).
        boundAgentId: '',
    });

    const httpServer = createHttpServer((req, res) => {
        const url = req.url ?? '/';
        const pathOnly = url.split('?')[0] ?? '/';
        if (pathOnly !== MCP_HOST_PATH) {
            res.statusCode = 404;
            res.end('not found');
            return;
        }
        const method = req.method ?? 'GET';
        if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
            res.statusCode = 405;
            res.setHeader('allow', 'GET, POST, DELETE');
            res.end();
            return;
        }
        if (method === 'POST') {
            // Buffer body, parse JSON once, hand the parsed object to the SDK
            // transport (which expects an already-parsed body when invoked via
            // its express-style three-arg signature).
            //
            // Enforce a max body size — 1 MB is far above any legitimate
            // MCP JSON-RPC frame (typical is < 20 KB). Previously any
            // process on 127.0.0.1 could POST a multi-GB body and OOM the
            // API because we buffered the whole payload before auth is
            // checked inside `mcp.handle`. Reject with 413 the moment the
            // running total exceeds the limit; destroy the request so the
            // socket doesn't stay open pumping more bytes.
            const MAX_BODY_BYTES = 1_048_576; // 1 MiB
            const chunks: Buffer[] = [];
            let total = 0;
            let aborted = false;
            req.on('data', (chunk: Buffer) => {
                if (aborted) return;
                total += chunk.length;
                if (total > MAX_BODY_BYTES) {
                    aborted = true;
                    res.statusCode = 413;
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ error: 'request body too large' }));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                if (aborted) return;
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: unknown = undefined;
                if (raw.length) {
                    try {
                        parsed = JSON.parse(raw);
                    } catch {
                        res.statusCode = 400;
                        res.setHeader('content-type', 'application/json');
                        res.end(JSON.stringify({ error: 'invalid JSON body' }));
                        return;
                    }
                }
                void mcp.handle(req, res, parsed).catch((err: unknown) => {
                    opts.log.error({ err }, '[mcp] POST handler failed');
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.end();
                    }
                });
            });
            req.on('error', (err: Error) => {
                opts.log.error({ err }, '[mcp] request stream error');
                if (!res.headersSent) {
                    res.statusCode = 400;
                    res.end();
                }
            });
            return;
        }
        void mcp.handle(req, res).catch((err: unknown) => {
            opts.log.error({ err }, '[mcp] handler failed');
            if (!res.headersSent) {
                res.statusCode = 500;
                res.end();
            }
        });
    });

    return new Promise<IMcpHostHandle | null>((resolve) => {
        const onError = (err: NodeJS.ErrnoException): void => {
            if (err.code === 'EADDRINUSE') {
                opts.log.warn(
                    `[mcp] port ${port} in use — running API-only; MCP is owned by the other stack`,
                );
                void mcp.close();
                resolve(null);
                return;
            }
            opts.log.error({ err }, '[mcp] failed to bind listener');
            void mcp.close();
            resolve(null);
        };
        httpServer.once('error', onError);
        httpServer.listen(port, host, () => {
            httpServer.removeListener('error', onError);
            opts.log.info(
                `[mcp] listener bound at http://${host}:${port}${MCP_HOST_PATH} (apiBase=${opts.apiBase})`,
            );
            resolve({ server: httpServer, mcp });
        });
    });
}

export async function stopMcpHost(handle: IMcpHostHandle | null): Promise<void> {
    if (!handle) return;
    await new Promise<void>((resolve) => {
        handle.server.close(() => resolve());
    });
    await handle.mcp.close();
}
