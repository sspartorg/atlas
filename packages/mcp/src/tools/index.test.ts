import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAllTools } from './index.js';
import type { IApiClient } from '../api-client.js';

function captureServer(): { server: McpServer; names: string[] } {
    const names: string[] = [];
    const server = {
        registerTool: (name: string) => {
            names.push(name);
        },
    } as unknown as McpServer;
    return { server, names };
}

function makeFakeApiClient(): IApiClient {
    return new Proxy(
        {},
        {
            get() {
                return () => Promise.resolve(undefined);
            },
        },
    ) as IApiClient;
}

// Tool consolidation 2026-07: every tool registered through registerAllTools
// is one of the 13 consolidated tools. Old per-action names (listAgents,
// addCommentToItem, transitionItemStatus, etc.) are gone.
describe('registerAllTools', () => {
    it('registers the union of every per-domain consolidated tool set', () => {
        const { server, names } = captureServer();
        registerAllTools(server, makeFakeApiClient());

        // Agents (3): crud_agent + agent_memory + marketplace_agent
        for (const n of ['crud_agent', 'agent_memory', 'marketplace_agent']) {
            expect(names).toContain(n);
        }

        // Items (5): search_item + create_item + get_item + update_item + delete_item
        for (const n of ['search_item', 'create_item', 'get_item', 'update_item', 'delete_item']) {
            expect(names).toContain(n);
        }

        // Projects (2): unchanged
        for (const n of ['listProjects', 'getProject']) {
            expect(names).toContain(n);
        }

        // Reminders (2): crud_reminder + search_reminder
        for (const n of ['crud_reminder', 'search_reminder']) {
            expect(names).toContain(n);
        }

        // Notifications (1): unchanged
        expect(names).toContain('sendExternalNotification');
    });

    it('registers exactly 13 tools total (consolidated surface)', () => {
        const { server, names } = captureServer();
        registerAllTools(server, makeFakeApiClient());
        expect(names).toHaveLength(13);
    });

    it('does not register duplicates across domains', () => {
        const { server, names } = captureServer();
        registerAllTools(server, makeFakeApiClient());
        const unique = new Set(names);
        expect(unique.size).toBe(names.length);
    });

    it('does not register any of the legacy per-action tool names', () => {
        const { server, names } = captureServer();
        registerAllTools(server, makeFakeApiClient());
        for (const legacy of [
            'listAgents',
            'getAgent',
            'createAgent',
            'updateAgent',
            'deleteAgent',
            'getAgentMemory',
            'updateAgentMemory',
            'listAgentRuns',
            'search_marketplace_agents',
            'get_full_marketplace_agent',
            'getEpic',
            'getItemFull',
            'listComments',
            'addCommentToItem',
            'replyToItem',
            'createEpic',
            'createStory',
            'createSubTask',
            'createSubBug',
            'createBug',
            'searchItems',
            'listItemLinks',
            'createItemLink',
            'deleteItemLink',
            'listItemExternalLinks',
            'createItemExternalLink',
            'deleteItemExternalLink',
            'updateItem',
            'transitionItemStatus',
            'assignItem',
            'deleteItem',
            'setReminder',
            'updateReminder',
            'cancelReminder',
            'listReminders',
        ]) {
            expect(names).not.toContain(legacy);
        }
    });
});
