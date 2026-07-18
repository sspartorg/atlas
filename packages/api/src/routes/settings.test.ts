import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({
    eventsRoutes: async () => {
        /* no-op */
    },
    broadcastSSE: vi.fn(),
}));

vi.mock('../services/external-notifications.js', () => ({
    testExternalNotification: vi.fn().mockResolvedValue({ ok: false, message: 'not configured' }),
    sendExternalNotification: vi.fn().mockResolvedValue(undefined),
    isInQuietHours: vi.fn().mockReturnValue(false),
}));

import { buildApp, isValidLogLevel } from '../server.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';
import { testExternalNotification } from '../services/external-notifications.js';

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

describe('POST /api/settings/log-level', () => {
    it('rejects unknown levels with 400', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/log-level',
            payload: { level: 'verbose' },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { kind?: string; error?: string };
        expect(body.kind).toBe('validation_error');
    });

    it('accepts a valid level and reports it applied', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/log-level',
            payload: { level: 'debug' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { level: string; applied: boolean };
        expect(body.level).toBe('debug');
        expect(body.applied).toBe(true);
        // The logger was passed in as `false` (test setup) so we can't assert
        // on app.log.level — the side effect targets the real Pino instance,
        // which is absent in tests. The endpoint contract is what we cover.
    });

    it('mutates process.env.ATLAS_LOG_LEVEL for next-boot persistence', async () => {
        const prev = process.env['ATLAS_LOG_LEVEL'];
        try {
            const res = await app.inject({
                method: 'POST',
                url: '/api/settings/log-level',
                payload: { level: 'warn' },
            });
            expect(res.statusCode).toBe(200);
            expect(process.env['ATLAS_LOG_LEVEL']).toBe('warn');
        } finally {
            if (prev === undefined) delete process.env['ATLAS_LOG_LEVEL'];
            else process.env['ATLAS_LOG_LEVEL'] = prev;
        }
    });

    it('is case-insensitive', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/log-level',
            payload: { level: 'INFO' },
        });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ level: 'info', applied: true });
    });
});

describe('ai_enabled enrichment', () => {
    // ATLAS_AI_ENABLED is read at request time. The Topbar Simulated badge
    // flashes on whenever a PATCH response misses this field (the React Query
    // cache gets replaced with an object where ai_enabled is undefined). Lock
    // every settings response shape to include the derived field.
    let prev: string | undefined;

    beforeEach(() => {
        prev = process.env['ATLAS_AI_ENABLED'];
        process.env['ATLAS_AI_ENABLED'] = 'true';
    });

    afterAll(() => {
        if (prev === undefined) delete process.env['ATLAS_AI_ENABLED'];
        else process.env['ATLAS_AI_ENABLED'] = prev;
    });

    it('GET /api/settings includes ai_enabled', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ai_enabled: boolean };
        expect(body.ai_enabled).toBe(true);
    });

    it('PATCH /api/settings/external-notification includes ai_enabled (provider switch)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_provider: 'teams' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ai_enabled: boolean };
        expect(body.ai_enabled).toBe(true);
    });

    it('PATCH /api/settings/notifications includes ai_enabled', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/notifications',
            payload: { quiet_hours_enabled: 1 },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ai_enabled: boolean };
        expect(body.ai_enabled).toBe(true);
    });

    it('PATCH /api/settings/profile includes ai_enabled', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/profile',
            payload: { owner_name: 'Tester' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ai_enabled: boolean };
        expect(body.ai_enabled).toBe(true);
    });

    it('reports ai_enabled=false when the env var is missing', async () => {
        delete process.env['ATLAS_AI_ENABLED'];
        const res = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ai_enabled: boolean };
        expect(body.ai_enabled).toBe(false);
    });
});

describe('isValidLogLevel', () => {
    it('accepts the six canonical levels', () => {
        for (const l of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
            expect(isValidLogLevel(l)).toBe(true);
        }
    });
    it('rejects unknown strings', () => {
        expect(isValidLogLevel('verbose')).toBe(false);
        expect(isValidLogLevel('')).toBe(false);
        expect(isValidLogLevel('Debug')).toBe(false); // case-sensitive at this layer
    });
});

describe('GET /api/settings', () => {
    it('returns 200 with settings object', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body).toMatchObject({ owner_name: expect.any(String) });
    });
});

describe('POST /api/settings/onboard', () => {
    it('returns 200 with updated settings', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/onboard',
            payload: { owner_name: 'Alice', workspace_path: '/home/alice' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.owner_name).toBe('Alice');
        expect(body.workspace_path).toBe('/home/alice');
    });
});

describe('PATCH /api/settings/constitution', () => {
    it('returns 200 when updating constitution_md', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/constitution',
            payload: { constitution_md: 'Be helpful and honest.' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.constitution_md).toBe('Be helpful and honest.');
    });
});

describe('PATCH /api/settings/external-notification — webhook_url branch', () => {
    it('returns 200 when setting webhook_url; response redacts URL but flags _set', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_webhook_url: 'https://hooks.example.com/xyz' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        // Batch-9 read model: the HTTP-facing response never surfaces
        // plaintext for the webhook URL, even on the PATCH that stored
        // it. The `_set` flag is the UI's signal.
        expect(body.external_notification_webhook_url).toBeNull();
        expect(body.external_notification_webhook_url_set).toBe(true);
    });
});

describe('PATCH /api/settings/external-notification — token and chat_id branches (lines 51-58)', () => {
    it('returns 200 when setting external_notification_token; response redacts token but flags _set', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_token: 'test-token-abc' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        // Batch-9 read model: token stays redacted on write response.
        expect(body.external_notification_token).toBeNull();
        expect(body.external_notification_token_set).toBe(true);
    });

    it('returns 200 when setting external_notification_chat_id (line 57-58)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_chat_id: '123456789' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.external_notification_chat_id).toBe('123456789');
    });
});

describe('POST /api/settings/external-notification/test', () => {
    it('returns 400 when notification service reports not configured', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/external-notification/test',
        });
        // Mock returns { ok: false, message: 'not configured' } → route sends 400
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { ok: boolean; message: string };
        expect(body.ok).toBe(false);
    });
});

describe('GET /api/settings/env', () => {
    it('returns 200 with vars array', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/settings/env' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { vars: unknown[] };
        expect(Array.isArray(body.vars)).toBe(true);
    });
});

describe('PATCH /api/settings/env', () => {
    it('returns 200 when updates array is valid', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/env',
            payload: { updates: [{ key: 'MY_TEST_KEY', value: 'my_val' }] },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { vars: unknown[] };
        expect(Array.isArray(body.vars)).toBe(true);
    });

    it('returns 400 when updates is not a valid array (Zod rejection)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/env',
            payload: { updates: 'not-an-array' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('applies ATLAS_LOG_LEVEL via applyRuntimeLogLevel when env key matches (lines 96-99)', async () => {
        // Setting ATLAS_LOG_LEVEL via PATCH /api/settings/env exercises the
        // `if (u.key === 'ATLAS_LOG_LEVEL' && isValidLogLevel(u.value))` branch
        // on line 97. With logger:false, applyRuntimeLogLevel catches the error
        // internally and continues — so the response is still 200.
        const prev = process.env['ATLAS_LOG_LEVEL'];
        try {
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/settings/env',
                payload: { updates: [{ key: 'ATLAS_LOG_LEVEL', value: 'info' }] },
            });
            expect(res.statusCode).toBe(200);
        } finally {
            if (prev === undefined) delete process.env['ATLAS_LOG_LEVEL'];
            else process.env['ATLAS_LOG_LEVEL'] = prev;
        }
    });
});

describe('POST /api/settings/reset', () => {
    it('returns 200 with { ok: true }', async () => {
        const res = await app.inject({ method: 'POST', url: '/api/settings/reset' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });
    });
});

// ── Additional coverage tests appended for ≥95% line coverage ─────────────

// IMPORTANT: POST /api/settings/reset is destructive — it wipes all projects,
// agents, items, etc. and resets the settings row. Tests that call it must live
// in their own describe so sibling describes that need seeded data are not
// affected. The global beforeEach calls truncateAll() + buildApp(), so each
// describe already starts from a clean slate before seeding its own data.

describe('POST /api/settings/reset — destructive isolation', () => {
    it('wipes seeded projects and flips onboarding_complete back to 0', async () => {
        // Seed: mark onboarding complete + insert a project.
        await testDb
            .updateTable('settings')
            .set({ onboarding_complete: 1, owner_name: 'Seeded' })
            .where('id', '=', 1)
            .execute();
        await testDb
            .insertInto('projects')
            .values({
                id: 'reset-proj',
                name: 'Reset Project',
                issue_key_prefix: 'RST',
                git_path: '',
                git_url: '',
                default_branch: 'main',
                status: 'active',
                clone_status: 'ready',
            })
            .execute();
        await testDb
            .insertInto('project_issue_counters')
            .values({ project_id: 'reset-proj', last_seq: 0 })
            .execute();

        // Verify precondition.
        const before = await testDb
            .selectFrom('projects')
            .select('id')
            .where('id', '=', 'reset-proj')
            .executeTakeFirst();
        expect(before).toBeDefined();

        // RESET.
        const res = await app.inject({ method: 'POST', url: '/api/settings/reset' });
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ ok: true });

        // Project should be gone.
        const afterProject = await testDb
            .selectFrom('projects')
            .select('id')
            .where('id', '=', 'reset-proj')
            .executeTakeFirst();
        expect(afterProject).toBeUndefined();

        // onboarding_complete must be 0 and owner_name reset to 'Owner'.
        const settings = await testDb
            .selectFrom('settings')
            .select(['onboarding_complete', 'owner_name'])
            .where('id', '=', 1)
            .executeTakeFirst();
        expect(settings?.onboarding_complete).toBe(0);
        expect(settings?.owner_name).toBe('Owner');
    });
});

describe('POST /api/settings/onboard — Zod rejection', () => {
    it('returns 400 when owner_name is empty (Zod min(1) violation)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/onboard',
            payload: { owner_name: '', workspace_path: '/home/test' },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { kind?: string };
        expect(body.kind).toBe('validation_error');
    });

    it('returns 400 when workspace_path is missing', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/onboard',
            payload: { owner_name: 'Valid' },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { kind?: string };
        expect(body.kind).toBe('validation_error');
    });

    it('returns 200 with both fields correctly set (re-onboard)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/onboard',
            payload: { owner_name: 'Bob', workspace_path: '/workspace/bob' },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.owner_name).toBe('Bob');
        expect(body.workspace_path).toBe('/workspace/bob');
        expect(body.onboarding_complete).toBe(1);
    });
});

describe('PATCH /api/settings/external-notification — Zod rejection', () => {
    it('returns 400 when provider is an invalid enum value', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_provider: 'slack' },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { kind?: string };
        expect(body.kind).toBe('validation_error');
    });

    it('returns 400 when webhook_url is not a valid URL', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_webhook_url: 'not-a-url' },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { kind?: string };
        expect(body.kind).toBe('validation_error');
    });
});

describe('POST /api/settings/external-notification/test — ok=true (200) path', () => {
    it('returns 200 when notification service reports ok', async () => {
        vi.mocked(testExternalNotification).mockResolvedValueOnce({
            ok: true,
            message: 'Notification sent',
        });
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/external-notification/test',
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { ok: boolean };
        expect(body.ok).toBe(true);
    });
});

describe('GET /api/settings — shape completeness', () => {
    it('returns settings row with all expected top-level keys', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        // Core keys that downstream pages depend on
        expect(body).toHaveProperty('owner_name');
        expect(body).toHaveProperty('workspace_path');
        expect(body).toHaveProperty('onboarding_complete');
        expect(body).toHaveProperty('external_notification_provider');
    });
});

describe('POST /api/settings/test/clear-onboarding', () => {
    it('sets onboarding_complete to 0 and returns { onboarding_complete: 0 }', async () => {
        // Arrange: mark onboarding complete so we have something to clear.
        await testDb
            .updateTable('settings')
            .set({ onboarding_complete: 1 })
            .where('id', '=', 1)
            .execute();

        const before = await testDb
            .selectFrom('settings')
            .select('onboarding_complete')
            .where('id', '=', 1)
            .executeTakeFirstOrThrow();
        expect(before.onboarding_complete).toBe(1);

        // Act.
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/test/clear-onboarding',
        });

        // Assert response.
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { onboarding_complete: number };
        expect(body).toEqual({ onboarding_complete: 0 });

        // Assert DB state — only onboarding_complete changed.
        const after = await testDb
            .selectFrom('settings')
            .select(['onboarding_complete', 'owner_name'])
            .where('id', '=', 1)
            .executeTakeFirstOrThrow();
        expect(after.onboarding_complete).toBe(0);
        // owner_name untouched — default seed value preserved.
        expect(after.owner_name).toBe('Owner');
    });
});

// SETTINGS-EXTRA — branch coverage gaps
describe('PATCH /api/settings/external-notification — null token/chat_id/webhook_url (??null branches)', () => {
    // Lines 53/57/61: `body.x ?? null` — the `?? null` arm fires when the value is null (not just absent).
    it('clears external_notification_token when set to null (covers line 53 ?? null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_token: null },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.external_notification_token).toBeNull();
    });

    it('clears external_notification_chat_id when set to null (covers line 57 ?? null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_chat_id: null },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.external_notification_chat_id).toBeNull();
    });

    it('clears external_notification_webhook_url when set to null (covers line 61 ?? null arm)', async () => {
        const res = await app.inject({
            method: 'PATCH',
            url: '/api/settings/external-notification',
            payload: { external_notification_webhook_url: null },
        });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        expect(body.external_notification_webhook_url).toBeNull();
    });
});

describe('POST /api/settings/log-level — non-string level (covers line 109 false branch)', () => {
    // Line 109: `typeof body?.level === 'string' ? ... : ''`
    // The false arm fires when level is a non-string value (number, object, undefined).
    it('returns 400 when level is a number (non-string → empty string → invalid)', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/api/settings/log-level',
            payload: { level: 42 },
        });
        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body) as { kind: string };
        expect(body.kind).toBe('validation_error');
    });
});
