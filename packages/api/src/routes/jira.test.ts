import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => undefined,
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { closeTestDb, testDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

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
            // Retired here: sources belong to a project (migration 010), and
            // the schema is .strict(), so a stale caller gets a 400 rather
            // than a silently ignored field.
            { sources: [] },
            // Replaced by sources (ADR 0017).
            { jql: 'project = X' },
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

// Migration 010 — a source is a query + workflow + repos combo belonging to a
// project, not an entry in a global array on the singleton config.
describe('/api/projects/:projectId/jira-sources', () => {
    beforeEach(async () => {
        await insertProject('p1', 'ATL');
    });

    async function create(payload: unknown) {
        return app.inject({
            method: 'POST',
            url: '/api/projects/p1/jira-sources',
            payload,
        });
    }

    it('creates, lists in creation order, patches and deletes', async () => {
        const first = await create({ jql: 'project = ATL', repo_ids: ['p1'] });
        expect(first.statusCode).toBe(201);
        const second = await create({ jql: 'labels = infra', repo_ids: ['p1'] });
        expect(second.statusCode).toBe(201);

        const list = await app.inject({ method: 'GET', url: '/api/projects/p1/jira-sources' });
        const rows = JSON.parse(list.body) as { id: number; jql: string }[];
        expect(rows.map((r) => r.jql)).toEqual(['project = ATL', 'labels = infra']);
        // The id IS the global order, so it must ascend with creation.
        expect(rows[0]!.id).toBeLessThan(rows[1]!.id);

        const patched = await app.inject({
            method: 'PATCH',
            url: `/api/projects/p1/jira-sources/${rows[0]!.id}`,
            payload: { jql: 'project = ATL AND labels = api' },
        });
        expect(patched.statusCode).toBe(200);
        // Editing must not re-order: that would change which project wins an
        // ambiguous issue.
        expect(JSON.parse(patched.body)).toMatchObject({
            id: rows[0]!.id,
            jql: 'project = ATL AND labels = api',
        });

        const del = await app.inject({
            method: 'DELETE',
            url: `/api/projects/p1/jira-sources/${rows[1]!.id}`,
        });
        expect(del.statusCode).toBe(204);
        const after = await app.inject({ method: 'GET', url: '/api/projects/p1/jira-sources' });
        expect(JSON.parse(after.body)).toHaveLength(1);
    });

    // Every write bails the same way on an unknown project, so every write
    // needs the assertion — the early return is its own statement in each.
    it.each([
        ['POST', '/api/projects/nope/jira-sources', { jql: 'project = ATL', repo_ids: ['p1'] }],
        ['PATCH', '/api/projects/nope/jira-sources/1', { jql: 'project = ATL' }],
        ['DELETE', '/api/projects/nope/jira-sources/1', undefined],
        ['GET', '/api/projects/nope/jira-sources', undefined],
    ])('404s %s on an unknown project', async (method, url, payload) => {
        const res = await app.inject({
            method: method as 'POST' | 'PATCH' | 'DELETE' | 'GET',
            url,
            ...(payload ? { payload } : {}),
        });
        expect(res.statusCode).toBe(404);
    });

    it('404s on an unknown source', async () => {
        expect(
            (
                await app.inject({
                    method: 'DELETE',
                    url: '/api/projects/p1/jira-sources/99999',
                })
            ).statusCode
        ).toBe(404);
        expect(
            (
                await app.inject({
                    method: 'PATCH',
                    url: '/api/projects/p1/jira-sources/99999',
                    payload: { jql: 'project = ATL' },
                })
            ).statusCode
        ).toBe(404);
    });

    // A runaway config would run 50+ JQLs against someone's Jira every poll.
    it('refuses more than 50 sources in one project', async () => {
        for (let i = 0; i < 50; i++) {
            expect((await create({ jql: `project = ATL AND x = ${i}`, repo_ids: ['p1'] })).statusCode).toBe(201);
        }
        const over = await create({ jql: 'project = ATL AND x = 50', repo_ids: ['p1'] });
        expect(over.statusCode).toBe(409);
        expect(JSON.parse(over.body).error).toMatch(/at most 50/);
    });

    it('rejects an empty repo list and a repo of another project', async () => {
        expect((await create({ jql: 'project = ATL', repo_ids: [] })).statusCode).toBe(400);
        expect((await create({ jql: 'project = ATL', repo_ids: ['not-mine'] })).statusCode).toBe(
            400
        );
    });

    it('goes with the project', async () => {
        await create({ jql: 'project = ATL', repo_ids: ['p1'] });
        await testDb.deleteFrom('projects').where('id', '=', 'p1').execute();
        const left = await testDb.selectFrom('jira_sources').selectAll().execute();
        expect(left).toHaveLength(0);
    });
});
