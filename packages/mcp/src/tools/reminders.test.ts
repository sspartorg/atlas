import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { registerReminderTools } from './reminders.js';
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

// Tool consolidation 2026-07: 4 reminder tools collapsed into 2 —
// crud_reminder (op: create | update | cancel) + search_reminder (with
// optional filter args).
describe('registerReminderTools', () => {
    it('registers crud_reminder + search_reminder', () => {
        const { server, tools } = captureServer();
        registerReminderTools(server, makeFakeApiClient());
        expect([...tools.keys()].sort()).toEqual(['crud_reminder', 'search_reminder'].sort());
    });

    describe('crud_reminder', () => {
        it("op='create' defaults body='' / channel='notification' and forwards the schedule", async () => {
            const { server, tools } = captureServer();
            const setReminder = vi.fn().mockResolvedValue({ id: 1, label: 'ping' });
            registerReminderTools(server, makeFakeApiClient({ setReminder }));
            await tools.get('crud_reminder')!.handler({
                op: 'create',
                label: 'ping',
                schedule: { kind: 'once', at: '2099-01-01T00:00:00Z' },
            });
            expect(setReminder).toHaveBeenCalledWith({
                label: 'ping',
                body: '',
                schedule: { kind: 'once', at: '2099-01-01T00:00:00Z' },
                channel: 'notification',
                created_by_agent_id: null,
            });
        });

        it("op='create' forwards body / channel / created_by_agent_id verbatim when given", async () => {
            const { server, tools } = captureServer();
            const setReminder = vi.fn().mockResolvedValue({ id: 2 });
            registerReminderTools(server, makeFakeApiClient({ setReminder }));
            await tools.get('crud_reminder')!.handler({
                op: 'create',
                label: 'ping',
                body: 'wake up',
                schedule: { kind: 'daily', time_of_day: '08:30' },
                channel: 'external',
                created_by_agent_id: 'agent-news',
            });
            expect(setReminder).toHaveBeenCalledWith({
                label: 'ping',
                body: 'wake up',
                schedule: { kind: 'daily', time_of_day: '08:30' },
                channel: 'external',
                created_by_agent_id: 'agent-news',
            });
        });

        it("op='create' throws when label / schedule missing", async () => {
            const { server, tools } = captureServer();
            registerReminderTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_reminder')!.handler({ op: 'create', label: 'x' }),
            ).rejects.toThrow(/`label` \+ `schedule` are required for op='create'/);
        });

        it("op='update' splits the id off and forwards only fields that were supplied", async () => {
            const { server, tools } = captureServer();
            const updateReminder = vi.fn().mockResolvedValue({ id: 1, label: 'renamed' });
            registerReminderTools(server, makeFakeApiClient({ updateReminder }));
            const result = await tools.get('crud_reminder')!.handler({
                op: 'update',
                id: 1,
                label: 'renamed',
                channel: 'both',
            });
            expect(updateReminder).toHaveBeenCalledWith(1, {
                label: 'renamed',
                channel: 'both',
            });
            const parsed = parseToolResult<{ id: number }>(result);
            expect(parsed.id).toBe(1);
        });

        it("op='update' forwards body and schedule when supplied", async () => {
            const { server, tools } = captureServer();
            const updateReminder = vi.fn().mockResolvedValue({ id: 2 });
            registerReminderTools(server, makeFakeApiClient({ updateReminder }));
            await tools.get('crud_reminder')!.handler({
                op: 'update',
                id: 2,
                body: 'new body',
                schedule: { kind: 'daily', time_of_day: '09:00' },
            });
            expect(updateReminder).toHaveBeenCalledWith(2, {
                body: 'new body',
                schedule: { kind: 'daily', time_of_day: '09:00' },
            });
        });

        it("op='update' throws when id is missing", async () => {
            const { server, tools } = captureServer();
            registerReminderTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_reminder')!.handler({ op: 'update', label: 'x' }),
            ).rejects.toThrow(/`id` is required for op='update'/);
        });

        it("op='cancel' forwards the id", async () => {
            const { server, tools } = captureServer();
            const cancelReminder = vi.fn().mockResolvedValue({ id: 1, status: 'cancelled' });
            registerReminderTools(server, makeFakeApiClient({ cancelReminder }));
            const result = await tools.get('crud_reminder')!.handler({ op: 'cancel', id: 1 });
            expect(cancelReminder).toHaveBeenCalledWith(1);
            const parsed = parseToolResult<{ status: string }>(result);
            expect(parsed.status).toBe('cancelled');
        });

        it("op='cancel' throws when id is missing", async () => {
            const { server, tools } = captureServer();
            registerReminderTools(server, makeFakeApiClient());
            await expect(
                tools.get('crud_reminder')!.handler({ op: 'cancel' }),
            ).rejects.toThrow(/`id` is required for op='cancel'/);
        });
    });

    describe('search_reminder', () => {
        it('returns the full row set when no filter is supplied', async () => {
            const { server, tools } = captureServer();
            const listReminders = vi
                .fn()
                .mockResolvedValue([{ id: 1, label: 'ping' }, { id: 2, label: 'pong' }]);
            registerReminderTools(server, makeFakeApiClient({ listReminders }));
            const result = await tools.get('search_reminder')!.handler({});
            expect(listReminders).toHaveBeenCalledWith({});
            const rows = parseToolResult<Array<{ id: number }>>(result);
            expect(rows).toHaveLength(2);
            expect(rows[0]!.id).toBe(1);
        });

        it('forwards status / channel / since filters to the client', async () => {
            const { server, tools } = captureServer();
            const listReminders = vi.fn().mockResolvedValue([]);
            registerReminderTools(server, makeFakeApiClient({ listReminders }));
            await tools.get('search_reminder')!.handler({
                status: 'active',
                channel: 'external',
                since: '2026-07-01T00:00:00Z',
            });
            expect(listReminders).toHaveBeenCalledWith({
                status: 'active',
                channel: 'external',
                since: '2026-07-01T00:00:00Z',
            });
        });
    });
});
