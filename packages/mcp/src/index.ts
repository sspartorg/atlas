#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

// Exported so `index.test.ts` can exercise the bin entrypoint without
// shell-spawning a child process. Side effects (process.exit, stderr log)
// are limited to the catch + the final connect-confirm line.
export async function main(): Promise<void> {
    const config = loadConfig();
    const server = createServer(config);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(
        `[atlas-mcp] connected via stdio (api base: ${config.apiBase}, timeout: ${config.requestTimeoutMs}ms)`,
    );
}

// Run main() when invoked as a script (the bin path in package.json).
// Tests import this module and call main() directly — they skip this guard
// by setting ATLAS_MCP_TEST_NO_AUTORUN=1 before import. The body of the
// guard runs only in the production bin path (never in unit tests) so it
// has no measurable coverage path; the contract is exercised manually
// via `node packages/mcp/dist/index.js`.
/* v8 ignore next 5 */
if (process.env['ATLAS_MCP_TEST_NO_AUTORUN'] !== '1') {
    main().catch((err) => {
        console.error('[atlas-mcp] fatal error:', err);
        process.exit(1);
    });
}
