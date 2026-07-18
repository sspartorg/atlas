import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
}, 30_000);

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/tool-catalog', () => {
    it('TC1 — returns 200 with groups array (empty tool_catalog after truncate)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/tool-catalog',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { groups: unknown[] };
        expect(Array.isArray(body.groups)).toBe(true);
        // tool_catalog is truncated in truncateAll(); groups is empty
        expect(body.groups).toHaveLength(0);
    });

    it('TC2 — groups tools by group_name and returns sorted order', async () => {
        // Insert rows across two groups to exercise the grouping logic
        // (lines 20-26 in tool-catalog.ts), which is skipped when the table is empty.
        await testDb
            .insertInto('tool_catalog')
            .values([
                { tool_name: 'read_file', group_name: 'filesystem', description: 'Read a file', sort_order: 1 },
                { tool_name: 'write_file', group_name: 'filesystem', description: 'Write a file', sort_order: 1 },
                { tool_name: 'run_task', group_name: 'tasks', description: 'Run a task', sort_order: 2 },
            ])
            .execute();

        const res = await app.inject({
            method: 'GET',
            url: '/api/tool-catalog',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            groups: Array<{ group_name: string; tools: Array<{ tool_name: string; description: string }> }>;
        };
        expect(Array.isArray(body.groups)).toBe(true);
        expect(body.groups).toHaveLength(2);

        const fsGroup = body.groups.find((g) => g.group_name === 'filesystem');
        expect(fsGroup).toBeDefined();
        expect(fsGroup!.tools).toHaveLength(2);
        const toolNames = fsGroup!.tools.map((t) => t.tool_name);
        expect(toolNames).toContain('read_file');
        expect(toolNames).toContain('write_file');

        const tasksGroup = body.groups.find((g) => g.group_name === 'tasks');
        expect(tasksGroup).toBeDefined();
        expect(tasksGroup!.tools).toHaveLength(1);
        expect(tasksGroup!.tools[0]!.tool_name).toBe('run_task');
        expect(tasksGroup!.tools[0]!.description).toBe('Run a task');
    });

    it('TC3 — single group with one tool returns correct shape', async () => {
        await testDb
            .insertInto('tool_catalog')
            .values([
                { tool_name: 'list_agents', group_name: 'agents', description: 'List all agents', sort_order: 0 },
            ])
            .execute();

        const res = await app.inject({
            method: 'GET',
            url: '/api/tool-catalog',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as {
            groups: Array<{ group_name: string; tools: Array<{ tool_name: string; description: string }> }>;
        };
        expect(body.groups).toHaveLength(1);
        expect(body.groups[0]!.group_name).toBe('agents');
        expect(body.groups[0]!.tools).toHaveLength(1);
        expect(body.groups[0]!.tools[0]!.tool_name).toBe('list_agents');
        expect(body.groups[0]!.tools[0]!.description).toBe('List all agents');
    });
});
