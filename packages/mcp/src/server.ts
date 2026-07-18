import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IMcpConfig } from './config.js';
import { createApiClient } from './api-client.js';
import { registerAllTools } from './tools/index.js';

export function createServer(config: IMcpConfig): McpServer {
    const server = new McpServer(
        { name: 'atlas-mcp', version: '0.1.0' },
        { capabilities: { tools: {} } }
    );
    const client = createApiClient(config);
    registerAllTools(server, client);
    return server;
}
