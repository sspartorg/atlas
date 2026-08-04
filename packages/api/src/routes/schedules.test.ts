import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

// Mock the auto-fetch runner (spawns a background process)
vi.mock('../services/auto-fetch-runner.js', () => ({
    runAutoFetch: vi.fn().mockResolvedValue(undefined),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    await insertProject('p1', 'ATL');
    if (!app) {
        app = await buildApp({ logger: false });
        await app.ready();
    }
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

// ProjectScheduleSchema: preset (enum: 'hourly'|'every_4h'|'daily'|'weekly'|'custom'),
// enabled, time_of_day (HH:MM), weekday (int 0-6 | null), cron_expression (string min1),
// skip_if_dirty, pause_while_agents_active, conflict_policy ('skip'|'stash'|'abort')
const VALID_SCHEDULE = {
    preset: 'daily',
    enabled: true,
    time_of_day: '09:00',
    weekday: null,
    cron_expression: '0 9 * * *',
    skip_if_dirty: false,
    pause_while_agents_active: false,
    conflict_policy: 'skip',
};

describe('GET /api/schedules', () => {
    it('returns 200 with array of enabled schedules', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/schedules' });
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(JSON.parse(res.body))).toBe(true);
    });
});

describe('GET /api/projects/:id/schedule', () => {
    it('returns 200 with default schedule for existing project', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/projects/p1/schedule' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('enabled');
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/projects/no-such/schedule' });
        expect(res.statusCode).toBe(404);
    });
});

describe('PUT /api/projects/:id/schedule', () => {
    it('creates/updates schedule and returns 200', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: VALID_SCHEDULE,
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('enabled');
        expect(body.enabled).toBe(true);
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/projects/no-such/schedule',
            payload: VALID_SCHEDULE,
        });
        expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid preset', async () => {
        const res = await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: { ...VALID_SCHEDULE, preset: 'not-valid' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('disables a schedule when enabled:false', async () => {
        // First enable
        await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: VALID_SCHEDULE,
        });
        // Then disable
        const res = await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: { ...VALID_SCHEDULE, enabled: false },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).enabled).toBe(false);
    });

    it('returns 400 when preset=custom and cron_expression is invalid (lines 38-41)', async () => {
        // materializeCron throws for invalid custom cron expressions
        const res = await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: {
                ...VALID_SCHEDULE,
                preset: 'custom',
                cron_expression: 'not-a-valid-cron',
            },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toMatch(/[Ii]nvalid/);
    });

    it('returns 400 when preset=weekly and weekday is null (materializeCron weekly branch)', async () => {
        // materializeCron throws when preset=weekly and weekday is null
        const res = await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: {
                ...VALID_SCHEDULE,
                preset: 'weekly',
                weekday: null,
            },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { error: string };
        expect(body.error).toMatch(/weekly/);
    });
});

describe('DELETE /api/projects/:id/schedule', () => {
    it('deletes schedule and returns 200 ok', async () => {
        // Create first
        await app.inject({
            method: 'PUT',
            url: '/api/projects/p1/schedule',
            payload: VALID_SCHEDULE,
        });
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/projects/p1/schedule',
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ ok: true });
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'DELETE',
            url: '/api/projects/no-such/schedule',
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('POST /api/projects/:id/schedule/fire', () => {
    it('fires auto-fetch and returns 202', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/p1/schedule/fire',
        });
        expect(res.statusCode).toBe(202);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('autofetch_id');
    });

    it('returns 404 for missing project', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/projects/no-such/schedule/fire',
        });
        expect(res.statusCode).toBe(404);
    });
});
