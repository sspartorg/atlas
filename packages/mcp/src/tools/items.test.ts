import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ITEM_TOOLS, registerItemTools } from './items.js';
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

// Tool consolidation 2026-07: 17 item tools collapsed into 5
// (search_item / create_item / get_item / update_item / delete_item).
// update_item is a discriminated tool keyed by `action`.

describe('ITEM_TOOLS registration', () => {
    it('registers exactly the 5 consolidated item tools', () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        expect([...tools.keys()].sort()).toEqual(
            ['create_item', 'delete_item', 'get_item', 'search_item', 'update_item'].sort(),
        );
    });

    it("update_item description documents every action and update_item's action discriminator", () => {
        const entry = ITEM_TOOLS.find((t) => t.name === 'update_item');
        expect(entry).toBeDefined();
        for (const action of [
            'patch_fields',
            'change_status',
            'assign',
            'add_comment',
            'add_link',
            'remove_link',
            'add_external_link',
            'remove_external_link',
            'remove_history',
        ]) {
            expect(entry!.description).toMatch(new RegExp(`'${action}'|"${action}"`));
        }
    });
});

describe('search_item', () => {
    it('forwards query + top_k and returns the FTS hits', async () => {
        const { server, tools } = captureServer();
        const searchItems = vi.fn().mockResolvedValue([
            {
                issue_type: 'epic',
                issue_id: 'ATL-1',
                title: 'Onboarding revamp',
                description: 'Source: jira-INT-401',
                rank: 0.92,
            },
        ]);
        registerItemTools(server, makeFakeApiClient({ searchItems }));
        const result = await tools.get('search_item')!.handler({ query: 'INT-401', top_k: 5 });
        expect(searchItems).toHaveBeenCalledWith('INT-401', 5);
        expect(parseToolResult(result)).toEqual([
            {
                issue_type: 'epic',
                issue_id: 'ATL-1',
                title: 'Onboarding revamp',
                description: 'Source: jira-INT-401',
                rank: 0.92,
            },
        ]);
    });

    it('omits top_k when not provided', async () => {
        const { server, tools } = captureServer();
        const searchItems = vi.fn().mockResolvedValue([]);
        registerItemTools(server, makeFakeApiClient({ searchItems }));
        await tools.get('search_item')!.handler({ query: 'INT-401' });
        expect(searchItems).toHaveBeenCalledWith('INT-401', undefined);
    });
});

describe('create_item', () => {
    it("issue_type='epic' forwards to client.createEpic", async () => {
        const { server, tools } = captureServer();
        const createEpic = vi.fn().mockResolvedValue({ id: 'E1' });
        registerItemTools(server, makeFakeApiClient({ createEpic }));
        await tools
            .get('create_item')!
            .handler({ issue_type: 'epic', payload: { project_id: 'p1', title: 'epic' } });
        expect(createEpic).toHaveBeenCalledWith({ project_id: 'p1', title: 'epic' });
    });

    it("issue_type='story' forwards to client.createStory", async () => {
        const { server, tools } = captureServer();
        const createStory = vi.fn().mockResolvedValue({ id: 'S1' });
        registerItemTools(server, makeFakeApiClient({ createStory }));
        await tools
            .get('create_item')!
            .handler({ issue_type: 'story', payload: { epic_id: 'E1', title: 'story' } });
        expect(createStory).toHaveBeenCalledWith({ epic_id: 'E1', title: 'story' });
    });

    it("issue_type='sub_task' forwards to client.createSubTask and lifts sub_task_status alias to status", async () => {
        const { server, tools } = captureServer();
        const createSubTask = vi.fn().mockResolvedValue({ id: 'ST1' });
        registerItemTools(server, makeFakeApiClient({ createSubTask }));
        await tools.get('create_item')!.handler({
            issue_type: 'sub_task',
            payload: { story_id: 'S1', title: 't', sub_task_status: 'todo' },
        });
        expect(createSubTask).toHaveBeenCalledWith({
            story_id: 'S1',
            title: 't',
            status: 'todo',
        });
    });

    it("issue_type='sub_task' works without sub_task_status (no alias lift needed)", async () => {
        const { server, tools } = captureServer();
        const createSubTask = vi.fn().mockResolvedValue({ id: 'ST2' });
        registerItemTools(server, makeFakeApiClient({ createSubTask }));
        await tools.get('create_item')!.handler({
            issue_type: 'sub_task',
            payload: { story_id: 'S1', title: 'no status given' },
        });
        expect(createSubTask).toHaveBeenCalledWith({ story_id: 'S1', title: 'no status given' });
    });

    it("issue_type='sub_bug' forwards to client.createSubBug", async () => {
        const { server, tools } = captureServer();
        const createSubBug = vi.fn().mockResolvedValue({ id: 'SB1' });
        registerItemTools(server, makeFakeApiClient({ createSubBug }));
        await tools
            .get('create_item')!
            .handler({ issue_type: 'sub_bug', payload: { story_id: 'S1', title: 'crash' } });
        expect(createSubBug).toHaveBeenCalledWith({ story_id: 'S1', title: 'crash' });
    });

    it("issue_type='bug' forwards to client.createBug", async () => {
        const { server, tools } = captureServer();
        const createBug = vi.fn().mockResolvedValue({ id: 'B1' });
        registerItemTools(server, makeFakeApiClient({ createBug }));
        await tools
            .get('create_item')!
            .handler({ issue_type: 'bug', payload: { epic_id: 'E1', title: 'bug' } });
        expect(createBug).toHaveBeenCalledWith({ epic_id: 'E1', title: 'bug' });
    });

    it("forwards `labels` on create through to the API client", async () => {
        const { server, tools } = captureServer();
        const createStory = vi.fn().mockResolvedValue({ id: 'S1' });
        registerItemTools(server, makeFakeApiClient({ createStory }));
        await tools.get('create_item')!.handler({
            issue_type: 'story',
            payload: {
                epic_id: 'E1',
                title: 'labelled story',
                labels: ['CER_Stories', 'backend'],
            },
        });
        expect(createStory).toHaveBeenCalledWith({
            epic_id: 'E1',
            title: 'labelled story',
            labels: ['CER_Stories', 'backend'],
        });
    });
});

describe('get_item', () => {
    it('forwards (issue_type, id) to client.getItemFull', async () => {
        const { server, tools } = captureServer();
        const getItemFull = vi.fn().mockResolvedValue({ item: { id: 'S1' }, comments: [] });
        registerItemTools(server, makeFakeApiClient({ getItemFull }));
        const result = await tools
            .get('get_item')!
            .handler({ issue_type: 'story', id: 'S1' });
        expect(getItemFull).toHaveBeenCalledWith('story', 'S1');
        const parsed = parseToolResult<{ item: { id: string } }>(result);
        expect(parsed.item.id).toBe('S1');
    });
});

describe('update_item', () => {
    it("action='patch_fields' passes patch through to client.updateItem", async () => {
        const { server, tools } = captureServer();
        const updateItem = vi
            .fn()
            .mockResolvedValue({ id: 'ATL-2', title: 'new title', priority: 'high' });
        registerItemTools(server, makeFakeApiClient({ updateItem }));
        const result = await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'patch_fields',
            patch: { title: 'new title', priority: 'high' },
        });
        expect(updateItem).toHaveBeenCalledWith('story', 'ATL-2', {
            title: 'new title',
            priority: 'high',
        });
        const parsed = parseToolResult<{ id: string }>(result);
        expect(parsed.id).toBe('ATL-2');
    });

    it("action='patch_fields' forwards a `labels` array through to updateItem", async () => {
        const { server, tools } = captureServer();
        const updateItem = vi.fn().mockResolvedValue({ id: 'ATL-2' });
        registerItemTools(server, makeFakeApiClient({ updateItem }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'patch_fields',
            patch: { labels: ['CER_Stories'] },
        });
        expect(updateItem).toHaveBeenCalledWith('story', 'ATL-2', {
            labels: ['CER_Stories'],
        });
    });

    it("action='patch_fields' surfaces per-type Zod rejections from the API", async () => {
        const { server, tools } = captureServer();
        const updateItem = vi.fn().mockRejectedValue(new Error('Atlas API 400 ...'));
        registerItemTools(server, makeFakeApiClient({ updateItem }));
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'epic',
                id: 'ATL-1',
                action: 'patch_fields',
                patch: { spec_md: 'epics do not accept spec_md' },
            }),
        ).rejects.toThrow(/Atlas API 400/);
    });

    it("action='change_status' forwards status to transitionItemStatus (override always false at MCP boundary)", async () => {
        const { server, tools } = captureServer();
        const transitionItemStatus = vi.fn().mockResolvedValue({ id: 'ATL-2', status: 'in_progress' });
        registerItemTools(server, makeFakeApiClient({ transitionItemStatus }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'change_status',
            status: 'in_progress',
        });
        // Batch 5 audit: MCP boundary always passes `false` for override
        // (was previously `a.override` which permitted the Owner-only
        // status-machine bypass through any MCP-token holder).
        expect(transitionItemStatus).toHaveBeenCalledWith(
            'story',
            'ATL-2',
            'in_progress',
            false,
            null,
        );
    });

    it("action='change_status' rejects override=true at the MCP boundary", async () => {
        const { server, tools } = captureServer();
        const transitionItemStatus = vi.fn().mockResolvedValue({ id: 'ATL-2', status: 'done' });
        registerItemTools(server, makeFakeApiClient({ transitionItemStatus }));
        // Batch 5 audit: previously `override: true` would bypass the
        // status-machine + P16 assertChildrenDone guard. Now rejected.
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'ATL-2',
                action: 'change_status',
                status: 'done',
                override: true,
            }),
        ).rejects.toThrow(/Owner-only/);
        expect(transitionItemStatus).not.toHaveBeenCalled();
    });

    it("action='change_status' forwards the calling agent_id as the audit actor", async () => {
        const { server, tools } = captureServer();
        const transitionItemStatus = vi.fn().mockResolvedValue({ id: 'ATL-2', status: 'in_review' });
        registerItemTools(server, makeFakeApiClient({ transitionItemStatus }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'change_status',
            status: 'in_review',
            agent_id: 'agent-po-reviewer',
        });
        expect(transitionItemStatus).toHaveBeenCalledWith(
            'story',
            'ATL-2',
            'in_review',
            false,
            'agent-po-reviewer',
        );
    });

    it("action='assign' forwards assignee_agent_id (string or null)", async () => {
        const { server, tools } = captureServer();
        const assignItem = vi
            .fn()
            .mockResolvedValueOnce({ id: 'ATL-2', assignee_agent_id: 'agent-coder' })
            .mockResolvedValueOnce({ id: 'ATL-2', assignee_agent_id: null });
        registerItemTools(server, makeFakeApiClient({ assignItem }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'assign',
            assignee_agent_id: 'agent-coder',
        });
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'assign',
            assignee_agent_id: null,
        });
        expect(assignItem).toHaveBeenNthCalledWith(1, 'story', 'ATL-2', 'agent-coder', null);
        expect(assignItem).toHaveBeenNthCalledWith(2, 'story', 'ATL-2', null, null);
    });

    it("action='assign' forwards the calling agent_id as the audit actor", async () => {
        const { server, tools } = captureServer();
        const assignItem = vi.fn().mockResolvedValue({ id: 'ATL-2', assignee_agent_id: 'agent-qa-writer' });
        registerItemTools(server, makeFakeApiClient({ assignItem }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'ATL-2',
            action: 'assign',
            assignee_agent_id: 'agent-qa-writer',
            agent_id: 'agent-po-reviewer',
        });
        expect(assignItem).toHaveBeenCalledWith(
            'story',
            'ATL-2',
            'agent-qa-writer',
            'agent-po-reviewer',
        );
    });

    it("action='add_comment' forwards the payload to client.addComment", async () => {
        const { server, tools } = captureServer();
        const addComment = vi.fn().mockResolvedValue({ id: 99 });
        registerItemTools(server, makeFakeApiClient({ addComment }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'add_comment',
            body: 'hello',
            author: 'agent',
            agent_id: 'agent-coder',
        });
        expect(addComment).toHaveBeenCalledWith({
            issue_type: 'story',
            issue_id: 'S1',
            body: 'hello',
            author: 'agent',
            agent_id: 'agent-coder',
        });
    });

    it("action='add_comment' defaults agent_id to null when not provided and forces author='agent'", async () => {
        const { server, tools } = captureServer();
        const addComment = vi.fn().mockResolvedValue({ id: 100 });
        registerItemTools(server, makeFakeApiClient({ addComment }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'add_comment',
            body: 'no agent id',
        });
        // Batch 5 audit: MCP boundary forces author='agent'. Previously a
        // caller could pass author='owner' and forge an Owner-authored
        // comment; now the field is normalized before crossing the API.
        expect(addComment).toHaveBeenCalledWith({
            issue_type: 'story',
            issue_id: 'S1',
            body: 'no agent id',
            author: 'agent',
            agent_id: null,
        });
    });

    it("action='add_link' creates a link via client.createItemLink", async () => {
        const { server, tools } = captureServer();
        const createItemLink = vi.fn().mockResolvedValue({ id: 1 });
        registerItemTools(server, makeFakeApiClient({ createItemLink }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'add_link',
            to_id: 'S2',
            relation_type: 'depends_on',
        });
        expect(createItemLink).toHaveBeenCalledWith({
            from_type: 'story',
            from_id: 'S1',
            to_id: 'S2',
            relation_type: 'depends_on',
        });
    });

    it("action='remove_link' deletes an item-link by link_id", async () => {
        const { server, tools } = captureServer();
        const deleteItemLink = vi.fn().mockResolvedValue(undefined);
        registerItemTools(server, makeFakeApiClient({ deleteItemLink }));
        const result = await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'remove_link',
            link_id: 42,
        });
        expect(deleteItemLink).toHaveBeenCalledWith(42);
        expect(parseToolResult(result)).toEqual({ deleted: true, link_id: 42 });
    });

    it("action='add_external_link' forwards the payload to client.createItemExternalLink", async () => {
        const { server, tools } = captureServer();
        const createItemExternalLink = vi.fn().mockResolvedValue({ id: 7, url: 'u' });
        registerItemTools(server, makeFakeApiClient({ createItemExternalLink }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'add_external_link',
            link_kind: 'pull_request',
            url: 'https://github.com/o/r/pull/3',
            title: 'feat: thing',
        });
        expect(createItemExternalLink).toHaveBeenCalledWith({
            issue_type: 'story',
            issue_id: 'S1',
            link_kind: 'pull_request',
            url: 'https://github.com/o/r/pull/3',
            title: 'feat: thing',
        });
    });

    it("action='remove_external_link' deletes an external-link by link_id", async () => {
        const { server, tools } = captureServer();
        const deleteItemExternalLink = vi.fn().mockResolvedValue(undefined);
        registerItemTools(server, makeFakeApiClient({ deleteItemExternalLink }));
        const result = await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'remove_external_link',
            link_id: 99,
        });
        expect(deleteItemExternalLink).toHaveBeenCalledWith(99);
        expect(parseToolResult(result)).toEqual({ deleted: true, link_id: 99 });
    });

    it("action='remove_history' forwards item + before_time + resolved agent id to client.pruneItemHistory", async () => {
        const prev = process.env['ATLAS_AGENT_ID'];
        process.env['ATLAS_AGENT_ID'] = 'agent-coder';
        try {
            const { server, tools } = captureServer();
            const pruneItemHistory = vi
                .fn()
                .mockResolvedValue({
                    comments_deleted: 4,
                    events_deleted: 7,
                    owner_comments_preserved: 0,
                });
            registerItemTools(server, makeFakeApiClient({ pruneItemHistory }));
            const result = await tools.get('update_item')!.handler({
                issue_type: 'epic',
                id: 'JDA-1',
                action: 'remove_history',
                before_time: '2026-06-01T00:00:00Z',
            });
            // Bound MCP identity is forwarded to the client so the API
            // route can attribute the audit event (2026-07-03 audit).
            expect(pruneItemHistory).toHaveBeenCalledWith(
                'epic',
                'JDA-1',
                '2026-06-01T00:00:00Z',
                'agent-coder',
            );
            expect(parseToolResult(result)).toEqual({
                comments_deleted: 4,
                events_deleted: 7,
                owner_comments_preserved: 0,
            });
        } finally {
            if (prev === undefined) delete process.env['ATLAS_AGENT_ID'];
            else process.env['ATLAS_AGENT_ID'] = prev;
        }
    });

    it('throws when an action is missing its required fields', async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'add_comment',
            }),
        ).rejects.toThrow(/`body` is required for action='add_comment'/);
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'change_status',
            }),
        ).rejects.toThrow(/`status` is required for action='change_status'/);
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'add_link',
            }),
        ).rejects.toThrow(/`to_id` \+ `relation_type` are required for action='add_link'/);
    });

    it("action='patch_fields' throws when patch is missing", async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'patch_fields',
            }),
        ).rejects.toThrow(/`patch` is required for action='patch_fields'/);
    });

    it("action='assign' throws when assignee_agent_id is not provided", async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'assign',
            }),
        ).rejects.toThrow(/`assignee_agent_id` is required for action='assign'/);
    });

    it("action='remove_link' throws when link_id is missing", async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'remove_link',
            }),
        ).rejects.toThrow(/`link_id` is required for action='remove_link'/);
    });

    it("action='add_external_link' throws when link_kind or url is missing", async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'add_external_link',
                url: 'https://github.com/o/r/pull/1',
                // link_kind missing
            }),
        ).rejects.toThrow(/`link_kind` \+ `url` are required for action='add_external_link'/);
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'add_external_link',
                link_kind: 'pull_request',
                // url missing
            }),
        ).rejects.toThrow(/`link_kind` \+ `url` are required for action='add_external_link'/);
    });

    it("action='remove_external_link' throws when link_id is missing", async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'story',
                id: 'S1',
                action: 'remove_external_link',
            }),
        ).rejects.toThrow(/`link_id` is required for action='remove_external_link'/);
    });

    it("action='remove_history' throws when before_time is missing", async () => {
        const { server, tools } = captureServer();
        registerItemTools(server, makeFakeApiClient());
        await expect(
            tools.get('update_item')!.handler({
                issue_type: 'epic',
                id: 'JDA-1',
                action: 'remove_history',
            }),
        ).rejects.toThrow(/`before_time` is required for action='remove_history'/);
    });

    it("action='add_external_link' omits title when not provided", async () => {
        const { server, tools } = captureServer();
        const createItemExternalLink = vi.fn().mockResolvedValue({ id: 8, url: 'u2' });
        registerItemTools(server, makeFakeApiClient({ createItemExternalLink }));
        await tools.get('update_item')!.handler({
            issue_type: 'story',
            id: 'S1',
            action: 'add_external_link',
            link_kind: 'pull_request',
            url: 'https://github.com/o/r/pull/5',
        });
        expect(createItemExternalLink).toHaveBeenCalledWith({
            issue_type: 'story',
            issue_id: 'S1',
            link_kind: 'pull_request',
            url: 'https://github.com/o/r/pull/5',
        });
    });
});

describe('delete_item', () => {
    it('returns {deleted:true, issue_type, id} on success', async () => {
        const { server, tools } = captureServer();
        const deleteItem = vi.fn().mockResolvedValue(undefined);
        registerItemTools(server, makeFakeApiClient({ deleteItem }));
        const result = await tools.get('delete_item')!.handler({
            issue_type: 'sub_bug',
            id: 'ATL-99',
        });
        expect(deleteItem).toHaveBeenCalledWith('sub_bug', 'ATL-99');
        const parsed = parseToolResult<{ deleted: boolean; issue_type: string; id: string }>(
            result,
        );
        expect(parsed).toEqual({ deleted: true, issue_type: 'sub_bug', id: 'ATL-99' });
    });

    it('propagates 404 errors from the client', async () => {
        const { server, tools } = captureServer();
        const deleteItem = vi.fn().mockRejectedValue(new Error('Atlas API 404'));
        registerItemTools(server, makeFakeApiClient({ deleteItem }));
        await expect(
            tools.get('delete_item')!.handler({ issue_type: 'story', id: 'missing' }),
        ).rejects.toThrow(/404/);
    });
});
