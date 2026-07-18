import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

import { buildApp } from '../server.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';

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

// CreateGuardrailRuleSchema: category (enum), rule_text (string min1), detail (nullable), severity (enum)
// category values: 'file_system'|'secrets_credentials'|'git_branches'|'side_effects_network'|'escalation_scope'
// severity values: 'block'|'ask_owner'|'warn'
const VALID_RULE = {
    category: 'secrets_credentials',
    rule_text: 'Never commit secrets or credentials to the repository',
    severity: 'block',
};

describe('GET /api/guardrails', () => {
    it('returns 200 with rules array and published_at', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/guardrails' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toHaveProperty('rules');
        expect(Array.isArray(body.rules)).toBe(true);
        expect(body).toHaveProperty('published_at');
    });
});

describe('POST /api/guardrails', () => {
    it('creates a rule and returns 201', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrails',
            payload: VALID_RULE,
        });
        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ category: 'secrets_credentials', severity: 'block' });
        expect(body.id).toBeDefined();
    });

    it('returns 400 for missing rule_text', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrails',
            payload: { category: 'secrets_credentials', severity: 'block' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid category', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrails',
            payload: { ...VALID_RULE, category: 'not-valid' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('returns 400 for invalid severity', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/guardrails',
            payload: { ...VALID_RULE, severity: 'critical' },
        });
        expect(res.statusCode).toBe(400);
    });
});

describe('PATCH /api/guardrails/:id', () => {
    it('updates a rule and returns 200', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/guardrails',
            payload: VALID_RULE,
        });
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'PATCH',
            url: `/api/guardrails/${id}`,
            payload: { rule_text: 'Updated rule text' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ rule_text: 'Updated rule text' });
    });

    it('returns 404 for missing rule', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/guardrails/99999',
            payload: { title: 'x' },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('DELETE /api/guardrails/:id', () => {
    it('deletes a rule and returns 204', async () => {
        const created = await app.inject({
            method: 'POST',
            url: '/api/guardrails',
            payload: VALID_RULE,
        });
        const { id } = JSON.parse(created.body) as { id: string };

        const res = await app.inject({
            method: 'DELETE',
            url: `/api/guardrails/${id}`,
        });
        expect(res.statusCode).toBe(204);
    });
});

describe('POST /api/guardrails/save', () => {
    it('marks guardrails as saved and returns 200', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/guardrails/save' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ ok: true });
        expect(body.published_at).not.toBeNull();
    });
});
