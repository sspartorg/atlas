import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, testDb, closeTestDb } from '../../tests/_pg-db.js';

let app: FastifyInstance;

// cli_models is NOT in truncateAll() — it's a registry table seeded by migrations.
// This file truncates it explicitly so tests start with an empty registry and
// can assert on counts without clashing with the seed data.
async function truncateCliModels() {
    await sql`TRUNCATE cli_models RESTART IDENTITY CASCADE`.execute(testDb);
}

beforeEach(async () => {
    await truncateAll();
    await truncateCliModels();
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

const VALID_MODEL = {
    cli: 'claude' as const,
    model_name: 'claude-opus-4-7',
};

describe('GET /api/cli-models', () => {
    it('returns 200 with empty array on fresh registry', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/api/cli-models',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(Array.isArray(body)).toBe(true);
        expect(body).toHaveLength(0);
    });

    it('returns 200 with models after insert', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        const res = await app.inject({
            method: 'GET',
            url: '/api/cli-models',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Array<{ model_name: string }>;
        expect(body).toHaveLength(1);
        expect(body[0]!.model_name).toBe(VALID_MODEL.model_name);
    });
});

describe('POST /api/cli-models', () => {
    it('creates a model entry and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body) as { cli: string; model_name: string };
        expect(body).toMatchObject({ cli: 'claude', model_name: VALID_MODEL.model_name });
    });

    it('returns 400 for missing cli', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: { model_name: 'something' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid cli value', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: { cli: 'openai', model_name: 'gpt-4' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 409 for duplicate cli + model_name', async () => {
        await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: { ...VALID_MODEL, note: 'duplicate' },
        });
        expect(res.statusCode).toBe(409);
    });

    it('returns 409 when service throws with "unique" in message (the /unique/i.test arm on line 18)', async () => {
        // The catch block has:  e.code === '23505' || /unique/i.test(e.message ?? '')
        // The DB always returns code '23505' on constraint violations, so the
        // /unique/i branch is only reachable if code is absent. Spy on the
        // service to throw a fake unique-message error without a pg code.
        const { cliModelsService } = await import('../services/cli-models.js');
        const spy = vi
            .spyOn(cliModelsService, 'create')
            .mockRejectedValueOnce(
                Object.assign(new Error('unique constraint violated'), { code: undefined }),
            );

        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        expect(res.statusCode).toBe(409);
        spy.mockRestore();
    });

    it('re-throws when service throws a non-unique error (covers the throw err branch)', async () => {
        // Spy on cliModelsService.create to throw a generic error (not a unique violation)
        // This forces the `throw err` branch (the else of the unique-check if).
        const { cliModelsService } = await import('../services/cli-models.js');
        const genericError = Object.assign(new Error('unexpected DB error'), { code: 'ECONNRESET' });
        const spy = vi
            .spyOn(cliModelsService, 'create')
            .mockRejectedValueOnce(genericError);

        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        // Fastify catches the re-thrown error and returns 500
        expect(res.statusCode).toBe(500);
        spy.mockRestore();
    });

    it('re-throws when service throws an error with null message and non-unique code (covers e.message ?? "" null coalesce + throw branch)', async () => {
        // e.code !== '23505' AND e.message is null/undefined →
        //   /unique/i.test(e.message ?? '') = /unique/i.test('') = false → throw err (→ 500)
        // This exercises the `?? ''` nullish branch when code is not 23505.
        const { cliModelsService } = await import('../services/cli-models.js');
        // Plain object with no code and null message — exercises both the null-coalesce and throw branches
        const noCodeNoMsgError = { code: undefined, message: null as unknown as string };
        const spy = vi
            .spyOn(cliModelsService, 'create')
            .mockRejectedValueOnce(noCodeNoMsgError as unknown as Error);

        const res = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        // /unique/i.test('') = false → throw err → Fastify catches and returns 500
        expect(res.statusCode).toBe(500);
        spy.mockRestore();
    });
});

describe('PATCH /api/cli-models/:id', () => {
    it('updates the note and returns 200', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        expect(created.statusCode).toBe(201);
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/cli-models/${id}`,
            payload: { note: 'updated note' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ note: 'updated note' });
    });

    it('returns 404 for missing model', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/cli-models/00000000-0000-0000-0000-000000000000',
            payload: { note: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for extra unknown fields (strict schema)', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/cli-models/${id}`,
            payload: { injected: 'evil' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('DELETE /api/cli-models/:id', () => {
    it('deletes a model and returns 204', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/cli-models/${id}`,
        });
        expect(res.statusCode).toBe(204);
    });

    it('returns 204 even for a non-existent id (idempotent delete)', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/cli-models/00000000-0000-0000-0000-000000000000',
        });
        // DELETE is idempotent — the service does not throw on missing row
        expect(res.statusCode).toBe(204);
    });
});

// Regression — 2026-09-12. `agents` has ON DELETE RESTRICT on (cli, model), so
// Postgres already blocked removing a model an installed agent used. Catalog
// rows in `marketplace_agents` have no such FK, so removing a model only they
// referenced succeeded silently and then made those entries uninstallable.
describe('DELETE /api/cli-models/:id — in-use guard', () => {
    it('refuses with 409 when a marketplace catalog entry still names the model', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/cli-models',
            payload: VALID_MODEL,
        });
        const { id } = JSON.parse(created.body) as { id: string };

        await testDb
            .insertInto('marketplace_agents')
            .values({
                id: 'test-catalog-in-use',
                name: 'In-use catalog entry',
                category: 'software-dev',
                cli: VALID_MODEL.cli,
                model: VALID_MODEL.model_name,
                framework: '',
                prompt_md: '',
                description: '',
                designation: '',
                accent_color: '#007AC9',
                sort_order: 1,
                glyph: 'code',
                role_id: null,
                status: 'active',
                kind_slug: 'custom',
                settings_json: {},
                version: 1,
            })
            .onConflict((oc) => oc.column('id').doNothing())
            .execute();

        const res = await app.inject({ method: 'DELETE', url: `/api/cli-models/${id}` });
        expect(res.statusCode).toBe(409);
        const body = JSON.parse(res.body);
        expect(body.details.code).toBe('MODEL_IN_USE');
        expect(body.details.marketplace_agents).toContain('test-catalog-in-use');

        // Still there — the refusal must not have deleted it anyway.
        const rows = await testDb
            .selectFrom('cli_models')
            .select('id')
            .where('id', '=', id)
            .execute();
        expect(rows).toHaveLength(1);
    });
});
