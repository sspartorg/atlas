import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { IApiClient } from '../api-client.js';
import type { ToolRegistration } from '../registrations.js';

function toToolResult(payload: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
}

// Theme 07 — projects exposed read-only via MCP. An agent that's deciding
// which surface to land work on, or that needs the project's git path /
// guardrails to compile its prompt, reads from here.
export const PROJECT_TOOLS: ToolRegistration[] = [
    {
        name: 'listProjects',
        title: 'List all projects',
        description:
            'Return every project in the workspace. Each row carries id, name, issue_key_prefix, ' +
            'default_branch, git_url, git_path. Use this to discover scope before deciding where ' +
            'an item should land.',
        group_name: 'PROJECTS',
        sort_order: 40,
        inputSchema: {},
        handler: async (_args, { client }) => toToolResult(await client.listProjects()),
    },
    {
        name: 'getProject',
        title: 'Get one project by id',
        description:
            'Return a single project payload. Useful when an item references a project_id and ' +
            'the agent needs the path / branch / guardrails context.',
        group_name: 'PROJECTS',
        sort_order: 41,
        inputSchema: { id: z.string().min(1) },
        handler: async ({ id }: { id: string }, { client }) =>
            toToolResult(await client.getProject(id)),
    },
];

export function registerProjectTools(server: McpServer, client: IApiClient): void {
    for (const t of PROJECT_TOOLS) {
        server.registerTool(
            t.name,
            { title: t.title, description: t.description, inputSchema: t.inputSchema },
            (args) => t.handler(args, { client }),
        );
    }
}
