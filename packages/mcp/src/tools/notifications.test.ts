import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NOTIFICATION_TOOLS, registerNotificationTools } from './notifications.js';
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

describe('registerNotificationTools', () => {
    it('registers exactly sendExternalNotification', () => {
        const { server, tools } = captureServer();
        registerNotificationTools(server, makeFakeApiClient());
        expect([...tools.keys()]).toEqual(['sendExternalNotification']);
    });

    describe('sendExternalNotification', () => {
        it('forwards message only when event_key is omitted', async () => {
            const { server, tools } = captureServer();
            const sendExternalNotification = vi.fn().mockResolvedValue({ ok: true });
            registerNotificationTools(
                server,
                makeFakeApiClient({ sendExternalNotification }),
            );
            const result = await tools.get('sendExternalNotification')!.handler({
                message: 'hi',
            });
            expect(sendExternalNotification).toHaveBeenCalledWith({ message: 'hi' });
            const parsed = parseToolResult<{ ok: boolean }>(result);
            expect(parsed.ok).toBe(true);
        });

        it('relays a held send (quiet hours) and says so in its description', async () => {
            const { server, tools } = captureServer();
            const held = { ok: true, sent: false, held: true, notification_id: 9, external_status: 'pending' };
            registerNotificationTools(
                server,
                makeFakeApiClient({ sendExternalNotification: vi.fn().mockResolvedValue(held) }),
            );
            const tool = NOTIFICATION_TOOLS.find((t) => t.name === 'sendExternalNotification')!;
            expect(tool.description).toMatch(/held and sent when the window ends/);
            expect(tool.description).toMatch(/Notification Log, not the in-app feed/);
            const result = await tools.get('sendExternalNotification')!.handler({ message: 'night' });
            expect(parseToolResult(result)).toEqual(held);
        });

        it('forwards event_key when provided', async () => {
            const { server, tools } = captureServer();
            const sendExternalNotification = vi.fn().mockResolvedValue({ ok: true });
            registerNotificationTools(
                server,
                makeFakeApiClient({ sendExternalNotification }),
            );
            await tools.get('sendExternalNotification')!.handler({
                message: 'hi',
                event_key: 'agent.daily-digest',
            });
            expect(sendExternalNotification).toHaveBeenCalledWith({
                message: 'hi',
                event_key: 'agent.daily-digest',
            });
        });
    });
});
