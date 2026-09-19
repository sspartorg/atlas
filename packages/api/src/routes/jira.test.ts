import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => undefined,
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { closeTestDb, truncateAll } from '../../tests/_pg-db.js';

let app: FastifyInstance;

beforeEach(async () => {
    await truncateAll();
    app = await buildApp({ logger: false });
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('/api/integrations/jira', () => {
    it('saves the config and never echoes the API token', async () => {
        const put = await app.inject({
            method: 'PUT',
            url: '/api/integrations/jira',
            payload: {
                site_url: 'https://acme.atlassian.net/',
                email: 'me@acme.test',
                api_token: 'tok-123',
                poll_interval_minutes: 30,
            },
        });
        expect(put.statusCode).toBe(200);
        expect(put.body).not.toContain('tok-123');

        const get = await app.inject({ method: 'GET', url: '/api/integrations/jira' });
        const cfg = JSON.parse(get.body) as Record<string, unknown>;
        expect(cfg).toMatchObject({
            site_url: 'https://acme.atlassian.net',
            api_token_set: true,
            poll_interval_minutes: 30,
        });
        expect(get.body).not.toContain('tok-123');
    });

    it('rejects a non-https site URL and a too-short poll interval', async () => {
        for (const payload of [
            { site_url: 'not a url' },
            { site_url: 'http://acme.atlassian.net' },
            { site_url: 'file:///etc/passwd' },
            { poll_interval_minutes: 1 },
            { label_workflows: [{ label: 'x', project_id: null, workflow_id: null }] },
        ]) {
            const res = await app.inject({ method: 'PUT', url: '/api/integrations/jira', payload });
            expect(res.statusCode).toBe(400);
        }
    });

    it('tests the connection against Jira', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ displayName: 'Sam' }), { status: 200 }))
        );
        try {
            const res = await app.inject({
                method: 'POST',
                url: '/api/integrations/jira/test',
                payload: {
                    site_url: 'https://acme.atlassian.net',
                    email: 'me@acme.test',
                    api_token: 'tok',
                },
            });
            expect(res.statusCode).toBe(200);
            expect(JSON.parse(res.body)).toEqual({ ok: true, display_name: 'Sam' });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('asks for credentials before a sync', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/integrations/jira/sync' });
        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toMatchObject({ kind: 'credentials_missing' });
    });
});
