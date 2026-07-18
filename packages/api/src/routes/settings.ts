import type { FastifyInstance } from 'fastify';
import { settingsService } from '../services/settings.js';
import { testExternalNotification } from '../services/external-notifications.js';
import { envFileService } from '../services/env-file.js';
import {
    OnboardingSchema,
    UpdateProfileSchema,
    UpdateEnvSchema,
    UpdateNotificationsSchema,
    UpdateExternalNotificationSchema,
} from '@atlas/shared';
import { db } from '../db/kysely-client.js';
import { requireMcpToken } from '../plugins/mcp-auth.js';
import { isValidLogLevel } from '../server.js';

// Env keys that must NEVER be writable through the /api/settings/env
// surface. A caller past the write gate could otherwise disable the gate
// itself (clear ATLAS_MCP_TOKEN) or hijack every subprocess this API
// spawns (PATH, NODE_OPTIONS, LD_PRELOAD, PYTHONPATH). Keep this list
// tight — anything security-load-bearing goes here.
const ENV_WRITE_DENYLIST = new Set([
    'ATLAS_MCP_TOKEN',
    'ATLAS_LAN_ACCESS',
    'ATLAS_AI_ENABLED',
    'ATLAS_DATA_DIR',
    'DATABASE_URL',
    'PATH',
    'NODE_OPTIONS',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'PYTHONPATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
]);

export async function settingsRoutes(app: FastifyInstance) {
    app.get('/api/settings', async (_req, reply) => {
        return reply.send(await settingsService.get());
    });

    app.post('/api/settings/onboard', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = OnboardingSchema.parse(req.body);
        return reply
            .status(200)
            .send(await settingsService.onboard(body.owner_name, body.workspace_path));
    });

    app.patch('/api/settings/profile', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = UpdateProfileSchema.parse(req.body);
        return reply.send(await settingsService.updateProfile(body));
    });

    app.patch('/api/settings/constitution', { preHandler: requireMcpToken }, async (req, reply) => {
        // Length-cap + type-guard the payload — previously an unchecked
        // cast, so `{ constitution_md: null }` would 500 on the DB write
        // and a 50 MB string would land in the singleton settings row
        // (which every agent-run prompt reads and templates in). 64k is
        // ample for any real constitution and small enough that a runaway
        // agent-generated payload can't bloat every subsequent CLI call.
        const body = req.body as { constitution_md?: unknown };
        const raw = body?.constitution_md;
        if (typeof raw !== 'string') {
            return reply.status(400).send({
                error: 'constitution_md must be a string',
                kind: 'validation_error',
            });
        }
        if (raw.length > 64_000) {
            return reply.status(400).send({
                error: `constitution_md too long (${raw.length} > 64000)`,
                kind: 'validation_error',
            });
        }
        return reply.send(await settingsService.updateConstitution(raw));
    });

    app.patch(
        '/api/settings/external-notification',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const body = UpdateExternalNotificationSchema.parse(req.body);
            // Apply every provided field in ONE UPDATE — atomic. The
            // previous per-field sequence would, on a mid-sequence failure,
            // leave settings with `provider='teams'` but the old-provider
            // token/webhook still in place, causing the next test-send to
            // post the previous secret to the new provider.
            const settings = await settingsService.updateExternalNotificationBatch({
                external_notification_provider: body.external_notification_provider,
                external_notification_token: body.external_notification_token,
                external_notification_chat_id: body.external_notification_chat_id,
                external_notification_webhook_url: body.external_notification_webhook_url,
            });
            return reply.send(settings);
        },
    );

    app.post(
        '/api/settings/external-notification/test',
        { preHandler: requireMcpToken },
        async (_req, reply) => {
            const result = await testExternalNotification();
            return reply.status(result.ok ? 200 : 400).send(result);
        },
    );

    // Batch-9 enterprise-secrets read model: on-demand reveal for the
    // external-notification token + webhook URL. GET /api/settings
    // returns these fields as `null` regardless of storage state; the
    // UI reads `*_set` booleans to know whether a value is configured,
    // and hits these POST endpoints one-shot when the Owner clicks
    // Reveal. Requires the write-gate — reveal is an authenticated +
    // auditable action.
    app.post(
        '/api/settings/external-notification/reveal-token',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const value = await settingsService.revealExternalNotificationToken();
            if (value === null) {
                return reply.status(404).send({ error: 'No external-notification token stored' });
            }
            req.log.info({ tag: 'secret_reveal', scope: 'external_notification_token' }, 'secret revealed');
            return reply.send({ value });
        },
    );

    app.post(
        '/api/settings/external-notification/reveal-webhook-url',
        { preHandler: requireMcpToken },
        async (req, reply) => {
            const value = await settingsService.revealExternalNotificationWebhookUrl();
            if (value === null) {
                return reply.status(404).send({ error: 'No external-notification webhook URL stored' });
            }
            req.log.info({ tag: 'secret_reveal', scope: 'external_notification_webhook_url' }, 'secret revealed');
            return reply.send({ value });
        },
    );

    app.patch('/api/settings/notifications', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = UpdateNotificationsSchema.parse(req.body);
        return reply.send(await settingsService.updateNotifications(body));
    });

    app.get('/api/settings/env', async (_req, reply) => {
        return reply.send({ vars: envFileService.read() });
    });

    app.patch('/api/settings/env', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = UpdateEnvSchema.parse(req.body);
        // Security: reject keys that would let a caller (already past the
        // write gate) escalate — clearing ATLAS_MCP_TOKEN turns the gate
        // itself off for subsequent request, PATH/NODE_OPTIONS/etc. can be
        // used to hijack any subprocess this server spawns. Zod's
        // UPPER_SNAKE regex is a shape check, not an authorisation check.
        const denied = body.updates.filter((u) => ENV_WRITE_DENYLIST.has(u.key));
        if (denied.length > 0) {
            return reply.status(400).send({
                error: `env keys not writable via API: ${denied.map((d) => d.key).join(', ')}`,
                kind: 'validation_error',
            });
        }
        envFileService.write(body.updates);
        for (const u of body.updates) process.env[u.key] = u.value;
        // P6 — a live ATLAS_LOG_LEVEL edit should take effect on the running
        // logger without a restart. Persist via the env file (so the change
        // survives boot) AND flip the in-memory Pino level so the next log
        // line honours the new threshold. Pino reads `.level` on every log
        // call, so multi-target transports inherit the change without needing
        // to be rebuilt.
        for (const u of body.updates) {
            if (u.key === 'ATLAS_LOG_LEVEL' && isValidLogLevel(u.value)) {
                applyRuntimeLogLevel(app, u.value);
            }
        }
        return reply.send({ vars: envFileService.read() });
    });

    // P6 — live log-level flip without a server restart. Idempotent; PATCH
    // /api/settings/env (above) reuses it when the env edit happens to be the
    // log-level row. The dedicated route is here so a UI control or a script
    // can target it without going through the env-vars surface.
    app.post('/api/settings/log-level', { preHandler: requireMcpToken }, async (req, reply) => {
        const body = req.body as { level?: unknown };
        const raw = typeof body?.level === 'string' ? body.level.toLowerCase() : '';
        if (!isValidLogLevel(raw)) {
            return reply.status(400).send({
                error: `level must be one of trace|debug|info|warn|error|fatal; got ${JSON.stringify(body?.level)}`,
                kind: 'validation_error',
            });
        }
        process.env['ATLAS_LOG_LEVEL'] = raw;
        applyRuntimeLogLevel(app, raw);
        return reply.send({ level: raw, applied: true });
    });

    app.post(
        '/api/settings/test/clear-onboarding',
        { preHandler: requireMcpToken },
        async (_req, reply) => {
            await db
                .updateTable('settings')
                .set({ onboarding_complete: 0 })
                .where('id', '=', 1)
                .execute();
            return reply.status(200).send({ onboarding_complete: 0 });
        },
    );

    app.post('/api/settings/reset', { preHandler: requireMcpToken }, async (_req, reply) => {
        await db.transaction().execute(async (trx) => {
            await trx.deleteFrom('comments').execute();
            await trx.deleteFrom('notifications').execute();
            await trx.deleteFrom('agent_runs').execute();
            await trx.deleteFrom('items').execute();
            await trx.deleteFrom('projects').execute();
            await trx.deleteFrom('credentials').execute();
            await trx.deleteFrom('agent_handoff_rules').execute();
            await trx.deleteFrom('agent_checklists').execute();
            await trx.deleteFrom('agents').execute();
            await trx
                .updateTable('settings')
                .set({
                    owner_name: 'Owner',
                    workspace_path: '',
                    constitution_md: '',
                    external_notification_provider: 'telegram',
                    external_notification_token: null,
                    external_notification_chat_id: null,
                    external_notification_webhook_url: null,
                    onboarding_complete: 0,
                    accent_color: '#2E2E2E',
                    external_notification_event_toggles: '{}',
                    quiet_hours_from: null,
                    quiet_hours_to: null,
                    quiet_hours_timezone: null,
                    external_notification_last_test_ok: null,
                    external_notification_endpoint_label: null,
                })
                .where('id', '=', 1)
                .execute();
        });
        return reply.status(200).send({ ok: true });
    });
}

// P6 — flip the running Pino logger's level without a restart. Pino reads
// `.level` on every log call, so the new threshold is honoured starting
// with the next log line. Multi-target transports inherit the change
// automatically because the level check happens before targets fan out.
function applyRuntimeLogLevel(app: FastifyInstance, level: string): void {
    try {
        (app.log as unknown as { level: string }).level = level;
        app.log.info(`[settings] live log level set to ${level}`);
    } catch (err) /* v8 ignore next */ {
        app.log.warn(
            { err },
            `[settings] failed to apply live log level ${level}; restart may be required`,
        );
    }
}
