import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerProjectTools } from './projects.js';
import type { IApiClient } from '../api-client.js';

type Handler<T = unknown> = (input: T) => Promise<CallToolResult>;

interface CapturedTool {
    name: string;
    config: { title?: string; description?: string; inputSchema?: unknown };
    handler: Handler<unknown>;
}

function captureServer(): { server: McpServer; tools: Map<string, CapturedTool> } {
    const tools = new Map<string, CapturedTool>();
    const server = {
        registerTool: (
            name: string,
            config: CapturedTool['config'],
            handler: Handler<unknown>,
        ) => {
            tools.set(name, { name, config, handler });
        },
    } as unknown as McpServer;
    return { server, tools };
}

function parseToolResult<T = unknown>(r: CallToolResult): T {
    const block = r.content[0];
    if (!block || block.type !== 'text') throw new Error('Expected text block');
    return JSON.parse(block.text) as T;
}

function makeFakeApiClient(overrides: Partial<IApiClient> = {}): IApiClient {
    const notStubbed = (name: string) => () => {
        throw new Error(`api-client method "${name}" not stubbed for this test`);
    };
    return new Proxy(overrides, {
        get(target, prop: string) {
            if (prop in target) return (target as Record<string, unknown>)[prop];
            return notStubbed(prop);
        },
    }) as IApiClient;
}

describe('registerProjectTools', () => {
    it('registers listProjects + getProject', () => {
        const { server, tools } = captureServer();
        registerProjectTools(server, makeFakeApiClient());
        expect([...tools.keys()].sort()).toEqual(['getProject', 'listProjects']);
    });

    describe('listProjects', () => {
        it('calls client.listProjects() and returns the rows', async () => {
            const { server, tools } = captureServer();
            const listProjects = vi
                .fn()
                .mockResolvedValue([{ id: 'p1', name: 'P1' }]);
            registerProjectTools(server, makeFakeApiClient({ listProjects }));
            const result = await tools.get('listProjects')!.handler({});
            expect(listProjects).toHaveBeenCalledTimes(1);
            const rows = parseToolResult<Array<{ id: string }>>(result);
            expect(rows[0]!.id).toBe('p1');
        });
    });

    describe('getProject', () => {
        it('forwards the id and returns the project row', async () => {
            const { server, tools } = captureServer();
            const getProject = vi.fn().mockResolvedValue({ id: 'p1', name: 'P1' });
            registerProjectTools(server, makeFakeApiClient({ getProject }));
            const result = await tools.get('getProject')!.handler({ id: 'p1' });
            expect(getProject).toHaveBeenCalledWith('p1');
            const parsed = parseToolResult<{ id: string }>(result);
            expect(parsed.id).toBe('p1');
        });
    });
});
