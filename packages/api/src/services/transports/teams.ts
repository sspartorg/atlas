import { settingsService } from '../settings.js';
import type { ExternalNotificationTransport } from './types.js';

// Transport adapter for Microsoft Teams via a Power Automate "When an HTTP
// request is received" workflow webhook. The recommended flow uses the
// `PostCardToConversation` (Teams flow bot → "Post card in a chat or channel")
// action, which deserializes its `messageBody` parameter as an Adaptive Card.
// We POST the whole Adaptive Card as the HTTP body so the flow can stringify
// it back into messageBody via `string(triggerBody())`.

const TEAMS_ENDPOINT_LABEL = 'Microsoft Teams (Power Automate)';

// Adaptive Cards v1.4 is the widest-supported version in Teams as of 2026.
// `wrap: true` is required — otherwise multi-line messages from callers like
// auto-fetch-runner get truncated to one line in the Teams chat.
export function buildAdaptiveCard(message: string): object {
    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [{ type: 'TextBlock', text: message, wrap: true }],
    };
}

async function postTeamsMessage(url: string, message: string): Promise<void> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAdaptiveCard(message)),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Teams webhook error ${res.status}: ${body}`);
    }
}

export const teamsTransport: ExternalNotificationTransport = {
    isConfigured: (s) => !!s.external_notification_webhook_url,

    async send(message: string, s): Promise<void> {
        // Settings arrive pre-decrypted from `sendExternalNotification`
        // — no local DB roundtrip. See ExternalNotificationTransport.send
        // for the rationale (single-fetch invariant + race-window fix).
        if (!s.external_notification_webhook_url) return;
        await postTeamsMessage(s.external_notification_webhook_url, message);
    },

    async test() {
        const s = await settingsService.getWithSecrets();
        if (!s.external_notification_webhook_url) {
            await settingsService.recordExternalNotificationTest(false, null);
            return { ok: false, error: 'No webhook URL configured' };
        }
        try {
            await postTeamsMessage(
                s.external_notification_webhook_url,
                'Atlas test notification — external channel is connected.',
            );
            await settingsService.recordExternalNotificationTest(true, TEAMS_ENDPOINT_LABEL);
            return { ok: true, endpoint_label: TEAMS_ENDPOINT_LABEL };
        } catch (err) {
            await settingsService.recordExternalNotificationTest(false, null);
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    },
};
