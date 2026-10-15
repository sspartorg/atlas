import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../routes/events.js', () => ({ eventsRoutes: async () => undefined, broadcastSSE: vi.fn() }));

import { buildApp } from '../server.js';
import { environmentSecretsService } from '../services/environment-secrets.js';
import { jiraSync } from '../services/jira-sync.js';
import { projectEnvFileService } from '../services/project-env-file.js';
import { settingsService } from '../services/settings.js';
import { closeTestDb, truncateAll } from '../../tests/_pg-db.js';
import { insertProject } from '../../tests/_items.js';

let app: FastifyInstance;
const PASS = 'correct horse';

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });

beforeEach(async () => {
    await truncateAll();
    app = await buildApp({ logger: false });
    await app.ready();
});

afterAll(async () => {
    if (app) await app.close();
    await closeTestDb();
});

describe('/api/secrets-bundle', () => {
    it('moves every secret to a fresh install, merging and skipping projects it does not have', async () => {
        await insertProject('p1', 'ATL');
        await insertProject('p2', 'GON');
        await environmentSecretsService.replaceAll([{ key: 'SHARED_A', value: 'a' }]);
        await projectEnvFileService.dbUpsert('p1', [{ key: 'DB_URL', value: 'postgres://x' }]);
        await projectEnvFileService.dbUpsert('p2', [{ key: 'GONE_KEY', value: 'g' }]);
        await jiraSync.saveConfig({ site_url: 'https://acme.atlassian.net', email: 'me@acme.test', api_token: 'jira-tok' });
        await settingsService.updateExternalNotificationBatch({
            external_notification_provider: 'telegram',
            external_notification_token: 'bot-tok',
            external_notification_chat_id: '42',
        });

        const exported = await post('/api/secrets-bundle/export', { passphrase: PASS });
        expect(exported.statusCode).toBe(200);
        const bundle = exported.json();
        expect(JSON.stringify(bundle)).not.toContain('postgres://x');

        // The new machine: ATL only, with a key of its own.
        await truncateAll();
        await insertProject('p9', 'ATL');
        await projectEnvFileService.dbUpsert('p9', [{ key: 'LOCAL_ONLY', value: 'keep' }]);

        const wrong = await post('/api/secrets-bundle/import', { passphrase: 'not the one', bundle });
        expect(wrong.statusCode).toBe(400);

        const res = await post('/api/secrets-bundle/import', { passphrase: PASS, bundle });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            shared: 1,
            projects: [{ prefix: 'ATL', keys: 1 }],
            skipped_projects: ['GON'],
            jira: true,
            notification: true,
        });

        expect(await environmentSecretsService.list()).toEqual([{ key: 'SHARED_A', value: 'a' }]);
        expect(new Map((await projectEnvFileService.dbList('p9')).map((v) => [v.key, v.value]))).toEqual(
            new Map([
                ['DB_URL', 'postgres://x'],
                ['LOCAL_ONLY', 'keep'],
            ]),
        );
        expect(await jiraSync.revealToken()).toBe('jira-tok');
        const s = await settingsService.getWithSecrets();
        expect([s.external_notification_provider, s.external_notification_token, s.external_notification_chat_id]).toEqual([
            'telegram',
            'bot-tok',
            '42',
        ]);
    });

    it('refuses a tampered file and a file from a newer Atlas', async () => {
        await environmentSecretsService.replaceAll([{ key: 'SHARED_A', value: 'a' }]);
        const bundle = (await post('/api/secrets-bundle/export', { passphrase: PASS })).json();
        const flipped = Buffer.from(bundle.data, 'base64');
        flipped[0] = flipped[0]! ^ 0xff;
        const tampered = await post('/api/secrets-bundle/import', { passphrase: PASS, bundle: { ...bundle, data: flipped.toString('base64') } });
        expect(tampered.statusCode).toBe(400);
        const newer = await post('/api/secrets-bundle/import', { passphrase: PASS, bundle: { ...bundle, version: bundle.version + 1 } });
        expect(newer.statusCode).toBe(400);
        expect(newer.json().error).toMatch(/newer Atlas/);
        const notABundle = await post('/api/secrets-bundle/import', { passphrase: PASS, bundle: { hello: 1 } });
        expect(notABundle.statusCode).toBe(400);
        expect(await environmentSecretsService.list()).toEqual([{ key: 'SHARED_A', value: 'a' }]);
    });

    it('file wins on a shared key both have; a key only this machine has is kept', async () => {
        await environmentSecretsService.replaceAll([{ key: 'BOTH', value: 'from-file' }]);
        const bundle = (await post('/api/secrets-bundle/export', { passphrase: PASS })).json();
        await environmentSecretsService.replaceAll([
            { key: 'BOTH', value: 'local' },
            { key: 'LOCAL_ONLY', value: 'mine' },
        ]);
        expect((await post('/api/secrets-bundle/import', { passphrase: PASS, bundle })).statusCode).toBe(200);
        expect(new Map((await environmentSecretsService.list()).map((v) => [v.key, v.value]))).toEqual(
            new Map([
                ['BOTH', 'from-file'],
                ['LOCAL_ONLY', 'mine'],
            ]),
        );
    });

    it("a bundle without Jira or a channel leaves this machine's Jira and channel alone", async () => {
        const bundle = (await post('/api/secrets-bundle/export', { passphrase: PASS })).json();
        await jiraSync.saveConfig({ site_url: 'https://acme.atlassian.net', email: 'me@acme.test', api_token: 'keep-me' });
        await settingsService.updateExternalNotificationBatch({ external_notification_token: 'keep-bot', external_notification_chat_id: '7' });
        const res = await post('/api/secrets-bundle/import', { passphrase: PASS, bundle });
        expect(res.json()).toMatchObject({ jira: false, notification: false });
        expect(await jiraSync.revealToken()).toBe('keep-me');
        expect((await settingsService.getWithSecrets()).external_notification_token).toBe('keep-bot');
    });

    it('refuses a short passphrase', async () => {
        const res = await post('/api/secrets-bundle/export', { passphrase: 'short' });
        expect(res.statusCode).toBe(400);
    });
});
