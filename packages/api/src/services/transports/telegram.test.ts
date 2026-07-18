import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-telegram-transport-test-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

vi.mock('../../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

import { telegramTransport } from './telegram.js';
import { settingsService } from '../settings.js';
import { truncateAll, closeTestDb } from '../../../tests/_pg-db.js';

beforeEach(async () => {
    await truncateAll();
    vi.restoreAllMocks();
});

afterAll(async () => {
    await closeTestDb();
});

describe('telegramTransport.isConfigured', () => {
    it('false when token + chat id missing', async () => {
        const s = await settingsService.getWithSecrets();
        expect(telegramTransport.isConfigured(s)).toBe(false);
    });
    // isConfigured relies on the decrypted bot token. The redacted
    // `.get()` returns null for the field even when a value is stored,
    // so callers of isConfigured (external-notifications orchestrator,
    // tests) must use `getWithSecrets()`.
    it('true when both set (uses getWithSecrets)', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        const s = await settingsService.getWithSecrets();
        expect(telegramTransport.isConfigured(s)).toBe(true);
    });
    // Regression guard for the Batch-9 redacted read model: `.get()`
    // must never surface the plaintext bot token, even after storage.
    it('false against redacted .get() after token stored (regression: read model must stay redacted)', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        const redacted = await settingsService.get();
        expect(redacted.external_notification_token).toBeNull();
        expect(telegramTransport.isConfigured(redacted)).toBe(false);
    });
});

describe('telegramTransport.send', () => {
    // 2026-07-03 audit round 3: send() now takes pre-decrypted settings as
    // its second arg (the orchestrator threads its own fetch result down
    // to avoid a double DB roundtrip + a narrow token-rotation race). The
    // tests pass whatever `getWithSecrets()` returns as the second arg.
    it('silently no-ops when unconfigured', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const s = await settingsService.getWithSecrets();
        await telegramTransport.send('hi', s);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('POSTs to api.telegram.org/sendMessage when configured', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('{}', { status: 200 }));
        const s = await settingsService.getWithSecrets();
        await telegramTransport.send('hello', s);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0]!;
        expect(String(url)).toContain('api.telegram.org/bot123:abc/sendMessage');
        const body = JSON.parse((init as RequestInit).body as string) as {
            chat_id: string;
            text: string;
        };
        expect(body.chat_id).toBe('-100');
        expect(body.text).toBe('hello');
    });

    it('throws on non-2xx response (transport-level failure)', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 401 }));
        const s = await settingsService.getWithSecrets();
        await expect(telegramTransport.send('x', s)).rejects.toThrow(/401/);
    });

    it('uses the passed-in settings — does NOT re-fetch (round-3 audit invariant)', async () => {
        // Regression guard for the double-fetch removal: the transport
        // must consume the settings object it was given, not go back to
        // the DB. Store one value, then hand send() a stale-but-different
        // pre-decrypted settings snapshot; the request should use the
        // stale token, proving the transport didn't re-fetch.
        await settingsService.updateExternalNotificationToken('current:token');
        await settingsService.updateExternalNotificationChatId('-100');
        const fetchSpy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('{}', { status: 200 }));
        // Build a snapshot with a DIFFERENT token than what's stored.
        const s = await settingsService.getWithSecrets();
        const stale = { ...s, external_notification_token: 'stale:token' };
        await telegramTransport.send('hi', stale);
        const [url] = fetchSpy.mock.calls[0]!;
        // If the transport re-fetched, it would have used 'current:token'.
        // The stale snapshot's token is what actually hits the wire.
        expect(String(url)).toContain('bot stale:token'.replace(' ', ''));
    });
});

describe('telegramTransport.test', () => {
    it('records ok=0 + error when no config', async () => {
        const r = await telegramTransport.test();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('No Telegram token');
        expect((await settingsService.get()).external_notification_last_test_ok).toBe(0);
    });

    it('records ok=1 and @endpoint_label on success', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            if (String(url).includes('/getMe')) {
                return new Response(
                    JSON.stringify({ ok: true, result: { username: 'AtlasBot' } }),
                    { status: 200 },
                );
            }
            return new Response('{}', { status: 200 });
        });
        const r = await telegramTransport.test();
        expect(r.ok).toBe(true);
        expect(r.endpoint_label).toBe('@AtlasBot');
        const s = await settingsService.get();
        expect(s.external_notification_last_test_ok).toBe(1);
        expect(s.external_notification_endpoint_label).toBe('@AtlasBot');
    });

    it('returns null endpoint_label when /getMe fails (silent)', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            if (String(url).includes('/getMe')) return new Response('nope', { status: 500 });
            return new Response('{}', { status: 200 });
        });
        const r = await telegramTransport.test();
        expect(r.ok).toBe(true);
        expect(r.endpoint_label).toBeNull();
    });

    it('returns null endpoint_label when /getMe fetch throws (network error)', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
            if (String(url).includes('/getMe')) throw new Error('ENOTFOUND api.telegram.org');
            return new Response('{}', { status: 200 });
        });
        const r = await telegramTransport.test();
        expect(r.ok).toBe(true);
        expect(r.endpoint_label).toBeNull();
    });

    it('returns ok=false when the send call itself fails', async () => {
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 401 }));
        const r = await telegramTransport.test();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('401');
        expect((await settingsService.get()).external_notification_last_test_ok).toBe(0);
    });

    it('uses String(err) when fetch throws a non-Error (line 76 false branch, TGSTR-1)', async () => {
        // Covers `err instanceof Error ? err.message : String(err)` false branch at line 76.
        await settingsService.updateExternalNotificationToken('123:abc');
        await settingsService.updateExternalNotificationChatId('-100');
        vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'non-error-fetch-telegram';
        });
        const r = await telegramTransport.test();
        expect(r.ok).toBe(false);
        expect(r.error).toBe('non-error-fetch-telegram');
    });
});
