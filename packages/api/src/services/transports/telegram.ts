import { settingsService } from '../settings.js';
import { TRANSPORT_TIMEOUT_MS, type ExternalNotificationTransport } from './types.js';

const TELEGRAM_MAX_CHARS = 4096;

// Test hook: the e2e suite points this at a local fake so Send Test runs offline.
function telegramApiBase(): string {
    return (process.env['ATLAS_TELEGRAM_API_BASE'] ?? 'https://api.telegram.org').replace(/\/$/, '');
}

// Transport adapter for the Telegram bot API. The orchestrator
// (`services/external-notifications.ts`) handles quiet hours + per-event
// toggles; this file does NOT gate — `send()` always attempts delivery
// when `isConfigured()` is true.

function getTransportCredentials(
    s: { external_notification_token: string | null; external_notification_chat_id: string | null },
): { token: string; chatId: string } | null {
    if (!s.external_notification_token || !s.external_notification_chat_id) return null;
    return {
        token: s.external_notification_token,
        chatId: s.external_notification_chat_id,
    };
}

async function postMessage(
    config: { token: string; chatId: string },
    message: string,
): Promise<void> {
    const url = `${telegramApiBase()}/bot${config.token}/sendMessage`;
    // Plain text, no parse_mode: messages carry paths, error text and URLs
    // with `_` / `*` / `[`, and Telegram's Markdown parser rejected those
    // sends outright (400 "can't parse entities").
    const text = message.length > TELEGRAM_MAX_CHARS ? `${message.slice(0, TELEGRAM_MAX_CHARS - 1)}…` : message;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.chatId, text }),
        signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API error ${res.status}: ${body}`);
    }
}

async function fetchBotUsername(token: string): Promise<string | null> {
    try {
        const res = await fetch(`${telegramApiBase()}/bot${token}/getMe`, { signal: AbortSignal.timeout(TRANSPORT_TIMEOUT_MS) });
        if (!res.ok) return null;
        const data = (await res.json()) as { ok?: boolean; result?: { username?: string } };
        const u = data?.result?.username;
        return u ? `@${u}` : null;
    } catch {
        return null;
    }
}

export const telegramTransport: ExternalNotificationTransport = {
    isConfigured: (s) =>
        !!s.external_notification_token && !!s.external_notification_chat_id,

    async send(message: string, s): Promise<void> {
        // Settings arrive pre-decrypted from `transportSend`
        // — no local DB roundtrip. See ExternalNotificationTransport.send
        // for the rationale (single-fetch invariant + race-window fix).
        const config = getTransportCredentials(s);
        if (!config) return;
        await postMessage(config, message);
    },

    async test() {
        const s = await settingsService.getWithSecrets();
        const config = getTransportCredentials(s);
        if (!config) {
            await settingsService.recordExternalNotificationTest(false, null);
            return { ok: false, error: 'No Telegram token or chat ID configured' };
        }

        try {
            await postMessage(
                config,
                'Atlas test notification — external channel is connected.',
            );
            const botUsername = await fetchBotUsername(config.token);
            await settingsService.recordExternalNotificationTest(true, botUsername);
            return { ok: true, endpoint_label: botUsername };
        } catch (err) {
            await settingsService.recordExternalNotificationTest(false, null);
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },
};
