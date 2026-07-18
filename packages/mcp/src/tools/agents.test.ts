import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerAgentTools } from './agents.js';
import type { IApiClient, IAgentComposite } from '../api-client.js';
import type { IAgent } from '@atlas/shared';

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
            handler: Handler<unknown>
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

const sampleAgent: IAgent = {
    id: 'a1',
    name: 'PO Writer',
    category: 'software-dev',
    cli: 'claude',
    model: 'claude-opus-4-7',
    framework: 'agile-po',
    prompt_md: '# PO Writer',
    prompt_version: 1,
    handoff_prompt_md: 'Hand off when checks pass.',
    status: 'active',
    accent_color: '#007AC9',
    sort_order: 1,
    description: 'Decomposes Epics.',
    designation: 'Product Owner',
    kind: 'performer',
    reviewer_agent_id: null,
    max_rounds: 5,
    requires_item: true,
    schedule_hours: 3,
    concurrent_runs: 1,
    glyph: 'developer_board',
    created_at: '2026-05-18T00:00:00Z',
    updated_at: '2026-05-18T00:00:00Z',
};

const sampleComposite: IAgentComposite = {
    agent: sampleAgent,
    handoff_rules: [
        { id: 1, agent_id: 'a1', target_agent_id: 'a2', kind: 'on-pass', status: 'ready' },
        { id: 2, agent_id: 'a1', target_agent_id: 'owner', kind: 'on-fail', status: 'waiting_for_info' },
    ],
    checklists: [
        { id: 1, agent_id: 'a1', label: 'All stories follow As-a format', sort_order: 0, required: true },
    ],
};

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

// Tool consolidation 2026-07: 8 agent tools + 2 marketplace tools collapsed
// into 3: crud_agent, agent_memory, marketplace_agent. listAgentRuns deleted
// outright (REST route GET /api/agents/:id/runs stays for the Activity tab).
describe('registerAgentTools', () => {
    it('registers crud_agent + agent_memory + marketplace_agent', () => {
        const { server, tools } = captureServer();
        registerAgentTools(server, makeFakeApiClient());
        expect([...tools.keys()].sort()).toEqual(
            ['agent_memory', 'crud_agent', 'marketplace_agent'].sort(),
        );
    });

    describe('crud_agent', () => {
        it("op='search' returns a compact projection of every agent", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(
                server,
                makeFakeApiClient({ listAgents: vi.fn().mockResolvedValue([sampleAgent]) }),
            );
            const result = await tools.get('crud_agent')!.handler({ op: 'search' });
            const rows = parseToolResult<Array<Record<string, unknown>>>(result);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toEqual({
                id: 'a1',
                name: 'PO Writer',
                category: 'software-dev',
                cli: 'claude',
                status: 'active',
                sort_order: 1,
                prompt_version: 1,
            });
        });

        it("op='get' returns the composite payload for the requested id", async () => {
            const { server, tools } = captureServer();
            const getAgent = vi.fn().mockResolvedValue(sampleComposite);
            registerAgentTools(server, makeFakeApiClient({ getAgent }));
            const result = await tools.get('crud_agent')!.handler({ op: 'get', id: 'a1' });
            expect(getAgent).toHaveBeenCalledWith('a1');
            expect(parseToolResult(result)).toEqual(sampleComposite);
        });

        it("op='get' throws when id is missing", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_agent')!.handler({ op: 'get' }),
            ).rejects.toThrow(/`id` is required for op='get'/);
        });

        it("op='create' forwards the payload to the API client", async () => {
            const { server, tools } = captureServer();
            const createAgent = vi.fn().mockResolvedValue(sampleComposite);
            registerAgentTools(server, makeFakeApiClient({ createAgent }));
            const payload = {
                id: 'a1',
                name: 'PO Writer',
                category: 'software-dev',
                cli: 'claude',
                model: 'claude-opus-4-7',
                accent_color: '#007AC9',
                prompt_md: '# PO',
                handoff_rules: [{ target_agent_id: 'a2', kind: 'on-pass', status: 'ready' }],
                checklists: [{ label: 'foo', sort_order: 0, required: true }],
            };
            const result = await tools.get('crud_agent')!.handler({ op: 'create', payload });
            expect(createAgent).toHaveBeenCalledWith(payload);
            expect(parseToolResult(result)).toEqual(sampleComposite);
        });

        it("op='create' throws when payload is missing", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_agent')!.handler({ op: 'create' }),
            ).rejects.toThrow(/`payload` is required for op='create'/);
        });

        it("op='update' forwards id and patch", async () => {
            const { server, tools } = captureServer();
            const updateAgent = vi.fn().mockResolvedValue(sampleComposite);
            registerAgentTools(server, makeFakeApiClient({ updateAgent }));
            await tools.get('crud_agent')!.handler({
                op: 'update',
                id: 'a1',
                payload: { description: 'Updated description', handoff_prompt_md: 'New handoff' },
            });
            expect(updateAgent).toHaveBeenCalledWith('a1', {
                description: 'Updated description',
                handoff_prompt_md: 'New handoff',
            });
        });

        it("op='update' rejects when id or payload is missing", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_agent')!.handler({ op: 'update', id: 'a1' }),
            ).rejects.toThrow(/`id` and `payload` are required for op='update'/);
            await expect(
                tools.get('crud_agent')!.handler({ op: 'update', payload: { name: 'X' } }),
            ).rejects.toThrow(/`id` and `payload` are required for op='update'/);
        });

        it("op='delete' calls client.deleteAgent and returns {deleted, id}", async () => {
            const { server, tools } = captureServer();
            const deleteAgent = vi.fn().mockResolvedValue(undefined);
            registerAgentTools(server, makeFakeApiClient({ deleteAgent }));
            const result = await tools.get('crud_agent')!.handler({ op: 'delete', id: 'a1' });
            expect(deleteAgent).toHaveBeenCalledWith('a1');
            expect(parseToolResult(result)).toEqual({ deleted: true, id: 'a1' });
        });

        it("op='delete' throws when id is missing", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_agent')!.handler({ op: 'delete' }),
            ).rejects.toThrow(/`id` is required for op='delete'/);
        });
    });

    describe('agent_memory', () => {
        const memory = {
            agent_id: 'a1',
            body_md: '# notes',
            version: 4,
            source: 'ai-generated' as const,
            last_run_id: null,
            updated_at: '2026-06-01T00:00:00Z',
        };

        it("op='get' forwards id and returns the memory row", async () => {
            const { server, tools } = captureServer();
            const getAgentMemory = vi.fn().mockResolvedValue(memory);
            registerAgentTools(server, makeFakeApiClient({ getAgentMemory }));
            const result = await tools.get('agent_memory')!.handler({ op: 'get', id: 'a1' });
            expect(getAgentMemory).toHaveBeenCalledWith('a1');
            expect(parseToolResult(result)).toEqual(memory);
        });

        it("op='update' defaults mode='replace' and source='ai-generated'", async () => {
            const { server, tools } = captureServer();
            const updateAgentMemory = vi.fn().mockResolvedValue({
                ...memory,
                body_md: '# new',
                version: 5,
            });
            registerAgentTools(server, makeFakeApiClient({ updateAgentMemory }));
            await tools.get('agent_memory')!.handler({ op: 'update', id: 'a1', body_md: '# new' });
            expect(updateAgentMemory).toHaveBeenCalledWith('a1', {
                body_md: '# new',
                mode: 'replace',
                source: 'ai-generated',
            });
        });

        it("op='update' passes mode='append' + manual-edit source through", async () => {
            const { server, tools } = captureServer();
            const updateAgentMemory = vi.fn().mockResolvedValue(memory);
            registerAgentTools(server, makeFakeApiClient({ updateAgentMemory }));
            await tools.get('agent_memory')!.handler({
                op: 'update',
                id: 'a1',
                body_md: '- lesson',
                mode: 'append',
                source: 'manual-edit',
            });
            expect(updateAgentMemory).toHaveBeenCalledWith('a1', {
                body_md: '- lesson',
                mode: 'append',
                source: 'manual-edit',
            });
        });

        it("op='update' throws when body_md is missing", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(server, makeFakeApiClient());
            await expect(
                tools.get('agent_memory')!.handler({ op: 'update', id: 'a1' }),
            ).rejects.toThrow(/`body_md` is required for op='update'/);
        });
    });

    describe('marketplace_agent', () => {
        const summary = [
            {
                id: 'agent-po-writer',
                name: 'PO Writer',
                category: 'software-dev' as const,
                kind_slug: 'custom' as const,
                summary: 'Breaks epics into stories.',
                accent_color: '#007AC9',
                glyph: 'developer_board',
                version: 2,
                installed: true,
                linked: true,
                upgrade_available: false,
            },
        ];

        it("op='search' forwards filters to searchMarketplaceAgents", async () => {
            const { server, tools } = captureServer();
            const searchMarketplaceAgents = vi.fn().mockResolvedValue(summary);
            registerAgentTools(server, makeFakeApiClient({ searchMarketplaceAgents }));
            await tools.get('marketplace_agent')!.handler({
                op: 'search',
                query: 'po',
                category: 'software-dev',
                limit: 5,
            });
            expect(searchMarketplaceAgents).toHaveBeenCalledWith({
                query: 'po',
                category: 'software-dev',
                limit: 5,
            });
        });

        it("op='search' forwards kind_slug filter when supplied", async () => {
            const { server, tools } = captureServer();
            const searchMarketplaceAgents = vi.fn().mockResolvedValue([]);
            registerAgentTools(server, makeFakeApiClient({ searchMarketplaceAgents }));
            await tools.get('marketplace_agent')!.handler({
                op: 'search',
                kind_slug: 'custom',
            });
            expect(searchMarketplaceAgents).toHaveBeenCalledWith({ kind_slug: 'custom' });
        });

        it("op='get' forwards id and returns the full payload", async () => {
            const { server, tools } = captureServer();
            const full = {
                id: 'agent-po-writer',
                version: 2,
                prompt_md: '# PO',
                memory_template_md: '',
                handoff_rules: [],
                checklists: [],
                manifest: { id: 'agent-po-writer', version: 2 },
                published_at: '2026-07-01T00:00:00Z',
            };
            const getMarketplaceAgent = vi.fn().mockResolvedValue(full);
            registerAgentTools(server, makeFakeApiClient({ getMarketplaceAgent }));
            const result = await tools
                .get('marketplace_agent')!
                .handler({ op: 'get', id: 'agent-po-writer' });
            expect(getMarketplaceAgent).toHaveBeenCalledWith('agent-po-writer');
            expect(parseToolResult(result)).toEqual(full);
        });

        it("op='get' throws when id is missing", async () => {
            const { server, tools } = captureServer();
            registerAgentTools(server, makeFakeApiClient());
            await expect(
                tools.get('marketplace_agent')!.handler({ op: 'get' }),
            ).rejects.toThrow(/`id` is required for op='get'/);
        });
    });
});
