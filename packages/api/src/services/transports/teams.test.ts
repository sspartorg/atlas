import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-teams-transport-test-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

vi.mock('../../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { teamsTransport } from './teams.js';
import { settingsService } from '../settings.js';
import { truncateAll, closeTestDb } from '../../../tests/_pg-db.js';

const WEBHOOK = 'https://example.invalid/teams/webhook?sig=stub';

beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
});

afterAll(async () => {
    await closeTestDb();
});

describe('teamsTransport.isConfigured', () => {
    it('false when webhook URL missing', async () => {
        const s = await settingsService.getWithSecrets();
        expect(teamsTransport.isConfigured(s)).toBe(false);
    });
    // isConfigured relies on the decrypted webhook URL. The redacted
    // `.get()` returns null for the field even when a value is stored,
    // so callers of isConfigured (external-notifications orchestrator,
    // tests) must use `getWithSecrets()`.
    it('true when webhook URL set (uses getWithSecrets)', async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        const s = await settingsService.getWithSecrets();
        expect(teamsTransport.isConfigured(s)).toBe(true);
    });
    // Regression guard for the Batch-9 redacted read model: `.get()`
    // must never surface the plaintext webhook URL, even after storage.
    it('false against redacted .get() after webhook stored (regression: read model must stay redacted)', async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        const redacted = await settingsService.get();
        expect(redacted.external_notification_webhook_url).toBeNull();
        expect(teamsTransport.isConfigured(redacted)).toBe(false);
    });
});

describe('teamsTransport.send', () => {
    // 2026-07-03 audit round 3: send() takes pre-decrypted settings from
    // the orchestrator now; tests pass the getWithSecrets() snapshot in.
    it('silently no-ops when unconfigured', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const s = await settingsService.getWithSecrets();
        await teamsTransport.send('hi', s);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('POSTs an Adaptive Card JSON body to the configured webhook', async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('OK', { status: 202 }));
        const s = await settingsService.getWithSecrets();
        await teamsTransport.send('hello', s);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toBe(WEBHOOK);
        const init2 = init as RequestInit;
        expect(init2.method).toBe('POST');
        const headers = init2.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        // The Power Automate `PostCardToConversation` action deserializes the
        // body as an Adaptive Card — the `type` + `version` + wrapped TextBlock
        // are what keep it from failing with AdaptiveSerializationException.
        const body = JSON.parse(init2.body as string) as {
            type: string;
            version: string;
            body: Array<{ type: string; text: string; wrap: boolean }>;
        };
        expect(body.type).toBe('AdaptiveCard');
        expect(body.version).toBe('1.4');
        expect(body.body).toEqual([{ type: 'TextBlock', text: 'hello', wrap: true }]);
    });

    it('preserves multi-line messages without truncation (wrap: true)', async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('OK', { status: 202 }));
        const s = await settingsService.getWithSecrets();
        await teamsTransport.send('line one\nline two\nline three', s);
        const init = fetchSpy.mock.calls[0]![1] as RequestInit;
        const body = JSON.parse(init.body as string) as {
            body: Array<{ text: string; wrap: boolean }>;
        };
        expect(body.body[0]!.text).toBe('line one\nline two\nline three');
        expect(body.body[0]!.wrap).toBe(true);
    });

    it('throws when the webhook returns non-2xx', async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('bad request', { status: 400 }),
        );
        const s = await settingsService.getWithSecrets();
        await expect(teamsTransport.send('x', s)).rejects.toThrow(/400/);
    });
});

describe('teamsTransport.test', () => {
    it('records ok=0 + error when no webhook configured', async () => {
        const r = await teamsTransport.test();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('No webhook URL');
        expect((await settingsService.get()).external_notification_last_test_ok).toBe(0);
    });

    it("records ok=1 and the 'Microsoft Teams (Power Automate)' label on success", async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('OK', { status: 202 }));
        const r = await teamsTransport.test();
        expect(r.ok).toBe(true);
        expect(r.endpoint_label).toBe('Microsoft Teams (Power Automate)');
        const s = await settingsService.get();
        expect(s.external_notification_last_test_ok).toBe(1);
        expect(s.external_notification_endpoint_label).toBe('Microsoft Teams (Power Automate)');
    });

    it('records ok=0 + error message when the webhook responds non-2xx', async () => {
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('schema mismatch', { status: 400 }),
        );
        const r = await teamsTransport.test();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('400');
        expect((await settingsService.get()).external_notification_last_test_ok).toBe(0);
    });

    it('uses String(err) when fetch throws a non-Error (line 61 false branch, TMSTR-1)', async () => {
        // Covers `err instanceof Error ? err.message : String(err)` false branch at line 61.
        await settingsService.updateExternalNotificationWebhookUrl(WEBHOOK);
        vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'non-error-fetch-teams';
        });
        const r = await teamsTransport.test();
        expect(r.ok).toBe(false);
        expect(r.error).toBe('non-error-fetch-teams');
    });
});
