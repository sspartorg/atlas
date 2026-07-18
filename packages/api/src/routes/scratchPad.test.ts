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
import type { IScratchPad } from '@atlas/shared';

let app: FastifyInstance;

// P12 — REST tests for the Scratch Pad. The page autosaves while open, so
// PATCH is the most exercised verb in real life; the GET/POST/DELETE round
// out the surface. Each test gets a fresh DB via `truncateAll`.
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

describe('scratchPad routes', () => {
    it('GET /api/scratch-pad returns [] when the table is empty', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/scratch-pad' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as IScratchPad[];
        expect(body).toEqual([]);
    });

    it('POST /api/scratch-pad creates an empty tile when called with no body', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/scratch-pad', payload: {} });
        expect(res.statusCode).toBe(201);
        const tile = JSON.parse(res.body) as IScratchPad;
        expect(tile.id).toBeTruthy();
        expect(tile.title).toBe('');
        expect(tile.body_md).toBe('');
        expect(tile.created_at).toBeTruthy();
        expect(tile.updated_at).toBeTruthy();
    });

    it('POST /api/scratch-pad respects a caller-minted id', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { id: 'tile-abc', title: 'Hello', body_md: '# header' },
        });
        expect(res.statusCode).toBe(201);
        const tile = JSON.parse(res.body) as IScratchPad;
        expect(tile.id).toBe('tile-abc');
        expect(tile.title).toBe('Hello');
        expect(tile.body_md).toBe('# header');
    });

    it('GET /api/scratch-pad lists rows newest-first', async () => {
        const a = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { title: 'A' },
        });
        const tileA = JSON.parse(a.body) as IScratchPad;
        // Bump tileB so its updated_at is strictly greater than tileA's.
        await new Promise((r) => setTimeout(r, 25));
        const b = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { title: 'B' },
        });
        const tileB = JSON.parse(b.body) as IScratchPad;

        const res = await app.inject({ method: 'GET', url: '/api/scratch-pad' });
        expect(res.statusCode).toBe(200);
        const list = JSON.parse(res.body) as IScratchPad[];
        expect(list).toHaveLength(2);
        expect(list[0]!.id).toBe(tileB.id);
        expect(list[1]!.id).toBe(tileA.id);
    });

    it('GET /api/scratch-pad/:id returns the tile', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { title: 'one' },
        });
        const tile = JSON.parse(created.body) as IScratchPad;

        const res = await app.inject({ method: 'GET', url: `/api/scratch-pad/${tile.id}` });
        expect(res.statusCode).toBe(200);
        const got = JSON.parse(res.body) as IScratchPad;
        expect(got.id).toBe(tile.id);
        expect(got.title).toBe('one');
    });

    it('GET /api/scratch-pad/:id returns 404 for an unknown id', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/scratch-pad/does-not-exist' });
        expect(res.statusCode).toBe(404);
    });

    it('PATCH /api/scratch-pad/:id updates body_md and bumps updated_at', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { title: 'edit me', body_md: 'first' },
        });
        const tile = JSON.parse(created.body) as IScratchPad;

        await new Promise((r) => setTimeout(r, 25));
        const res = await app.inject({
            method: 'PATCH',
            url: `/api/scratch-pad/${tile.id}`,
            payload: { body_md: 'second' },
        });
        expect(res.statusCode).toBe(200);
        const updated = JSON.parse(res.body) as IScratchPad;
        expect(updated.id).toBe(tile.id);
        expect(updated.title).toBe('edit me');
        expect(updated.body_md).toBe('second');
        expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
            new Date(tile.updated_at).getTime(),
        );
    });

    it('PATCH /api/scratch-pad/:id rejects an empty body with 400', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { title: 't' },
        });
        const tile = JSON.parse(created.body) as IScratchPad;

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/scratch-pad/${tile.id}`,
            payload: {},
        });
        expect(res.statusCode).toBe(400);
    });

    it('PATCH /api/scratch-pad/:id returns 404 for an unknown id', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/scratch-pad/nope',
            payload: { title: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });

    it('DELETE /api/scratch-pad/:id removes the row', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/scratch-pad',
            payload: { title: 'remove' },
        });
        const tile = JSON.parse(created.body) as IScratchPad;

        const del = await app.inject({
            method: 'DELETE',
            url: `/api/scratch-pad/${tile.id}`,
        });
        expect(del.statusCode).toBe(204);

        const row = await testDb
            .selectFrom('scratch_pad')
            .selectAll()
            .where('id', '=', tile.id)
            .executeTakeFirst();
        expect(row).toBeUndefined();
    });

    it('DELETE /api/scratch-pad/:id returns 404 for an unknown id', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/scratch-pad/missing',
        });
        expect(res.statusCode).toBe(404);
    });
});
