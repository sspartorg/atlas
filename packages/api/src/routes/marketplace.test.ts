import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { marketplaceService } from '../services/marketplace.js';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';

let app: FastifyInstance;

const CATALOG_AGENT_ID = 'test-catalog-coder';
const CLI_ID = 'test-cli-claude-claude-opus-4-7-mkt';
const MODEL_NAME = 'claude-opus-4-7';

// Insert a minimal cli_models row + a marketplace_agents row for use in tests.
// marketplace_agents is truncated by truncateAll, so we re-seed it each time.
async function seedCatalogEntry(): Promise<void> {
    await testDb
        .insertInto('cli_models')
        .values({
            id: CLI_ID,
            cli: 'claude',
            model_name: MODEL_NAME,
            note: null,
            sort_order: 1,
        })
        .onConflict((oc) => oc.columns(['cli', 'model_name']).doNothing())
        .execute();

    await testDb
        .insertInto('marketplace_agents')
        .values({
            id: CATALOG_AGENT_ID,
            name: 'Test Catalog Coder',
            category: 'software-dev',
            cli: 'claude',
            model: MODEL_NAME,
            framework: '',
            prompt_md: 'you are a coder',
            handoff_prompt_md: '',
            description: 'test desc',
            designation: '',
            accent_color: '#007AC9',
            sort_order: 1,
            glyph: 'code',
            role_id: null,
            max_rounds: 5,
            requires_item: true,
            requires_worktree: false,
            push_code: false,
            raises_pr: false,
            status: 'active',
            kind_slug: 'custom',
            settings_json: {},
            schedule_hours: 6,
            schedule_preset: 'every_n_hours',
            schedule_time_of_day: null,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            version: 1,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
}

beforeEach(async () => {
    await truncateAll();
    await seedCatalogEntry();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('GET /api/marketplace/agents', () => {
    it('returns 200 with array including seeded catalog entry', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/marketplace/agents' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
    });

    it('returns filtered results for a valid category', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/marketplace/agents?category=software-dev',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body.some((e: { id: string }) => e.id === CATALOG_AGENT_ID)).toBe(true);
    });

    it('returns 400 for an invalid category', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/marketplace/agents?category=not-valid-category',
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /api/marketplace/agents/:id', () => {
    it('returns 200 for a seeded catalog agent', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}`,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        // getFull returns { agent: {...}, checklists: [...], handoff_rules: [...] }
        expect(body).toMatchObject({ agent: { id: CATALOG_AGENT_ID } });
    });

    it('returns 404 for an unknown catalog id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/marketplace/agents/totally-nonexistent-id',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/marketplace/agents/:id/install', () => {
    it('installs a catalog agent and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/install`,
            payload: {},
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ id: CATALOG_AGENT_ID });
    });

    it('returns 409 SLUG_TAKEN on duplicate install', async () => {
        // First install succeeds
        await app.inject({
            method: 'POST',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/install`,
            payload: {},
        });

        // Second install with same default id → SLUG_TAKEN
        const res = await app.inject({
            method: 'POST',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/install`,
            payload: {},
        });
        expect(res.statusCode).toBe(409);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ kind: 'conflict' });
        expect(body.details).toMatchObject({ code: 'SLUG_TAKEN' });
    });

    it('returns 404 for a nonexistent catalog id', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/marketplace/agents/nonexistent-agent/install',
            payload: {},
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/marketplace/agents/:catalog_id/diff/:agent_id', () => {
    it('returns diff for a matching catalog and local agent', async () => {
        // Install first to create a local agent
        await app.inject({
            method: 'POST',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/install`,
            payload: {},
        });
        const res = await app.inject({
            method: 'GET',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/diff/${CATALOG_AGENT_ID}`,
        });
        // 200 means both exist and diff computed
        expect(res.statusCode).toBe(200);
    });

    it('returns 404 for a nonexistent catalog id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/marketplace/agents/nonexistent/diff/also-nonexistent',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/marketplace/agents/:id/export', () => {
    it('returns 404 for a nonexistent catalog id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/marketplace/agents/nonexistent-export/export',
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 200 with a zip buffer for a seeded catalog id', async () => {
        const res = await app.inject({
            method: 'GET',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/export`,
        });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/zip');
    });
});

describe('defensive re-throw branches (spy-based)', () => {
    it('install: re-throws non-SlugTaken non-NotFound error as 500', async () => {
        const spy = vi
            .spyOn(marketplaceService, 'install')
            .mockRejectedValueOnce(new Error('unexpected DB error'));
        const res = await app.inject({
            method: 'POST',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/install`,
            payload: {},
        });
        expect(res.statusCode).toBe(500);
        spy.mockRestore();
    });

    it('diff: re-throws non-NotFound error as 500', async () => {
        const spy = vi
            .spyOn(marketplaceService, 'diff')
            .mockRejectedValueOnce(new Error('unexpected diff error'));
        const res = await app.inject({
            method: 'GET',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/diff/${CATALOG_AGENT_ID}`,
        });
        expect(res.statusCode).toBe(500);
        spy.mockRestore();
    });

    it('export: re-throws non-NotFound error as 500', async () => {
        const spy = vi
            .spyOn(marketplaceService, 'exportCatalogBundle')
            .mockRejectedValueOnce(new Error('unexpected export error'));
        const res = await app.inject({
            method: 'GET',
            url: `/api/marketplace/agents/${CATALOG_AGENT_ID}/export`,
        });
        expect(res.statusCode).toBe(500);
        spy.mockRestore();
    });
});
