import { db } from '../db/kysely-client.js';
import { settingsService } from './settings.js';
import { notificationsService } from './notifications.js';
import { telegramTransport } from './transports/telegram.js';
import { teamsTransport } from './transports/teams.js';
import type {
    ISettings,
    ExternalNotificationEventKey,
    ExternalNotificationProvider,
} from '@atlas/shared';
import type { ExternalNotificationTransport } from './transports/types.js';

// Orchestrator for the channel-agnostic external-notification surface.
// Owns the gating (quiet hours + per-event toggles) and dispatches to the
// active transport (Telegram or Teams) selected by
// `settings.external_notification_provider`.

const transports: Record<ExternalNotificationProvider, ExternalNotificationTransport> = {
    telegram: telegramTransport,
    teams: teamsTransport,
};

type GatingSettings = Pick<
    ISettings,
    | 'external_notification_event_toggles'
    | 'quiet_hours_from'
    | 'quiet_hours_to'
    | 'quiet_hours_timezone'
    | 'quiet_hours_enabled'
>;

// True iff `now` falls within the configured quiet-hours window AND the
// feature is currently enabled. With the toggle off, the window is ignored
// even if from/to are still populated — that's the whole point of
// separating the boolean from the time fields.
export function isInQuietHours(
    settings: Pick<
        GatingSettings,
        'quiet_hours_enabled' | 'quiet_hours_from' | 'quiet_hours_to' | 'quiet_hours_timezone'
    >,
    now: Date = new Date(),
): boolean {
    if (settings.quiet_hours_enabled !== 1) return false;
    const { quiet_hours_from: from, quiet_hours_to: to, quiet_hours_timezone: tz } = settings;
    if (!from || !to) return false;

    const local = tz
        ? new Intl.DateTimeFormat('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
              timeZone: tz,
          }).format(now)
        : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Wrap-around windows (22:00 → 08:00) are the common overnight case.
    if (from <= to) return local >= from && local < to;
    return local >= from || local < to;
}

// Events that default to OFF (must be explicitly toggled on by the Owner
// in Settings → Notifications). Most events default to ON; opt-out events
// like the high-volume Terminal idle pings stay quiet until requested.
const DEFAULT_OFF_EVENT_KEYS = new Set<ExternalNotificationEventKey>([
    'terminal.waiting_for_input',
]);

export function shouldSendForEvent(
    eventKey: ExternalNotificationEventKey,
    settings: GatingSettings,
    now: Date = new Date(),
): boolean {
    // Quiet hours are the global mute — checked first so neither toggle
    // override nor missing toggle can punch through it.
    if (isInQuietHours(settings, now)) return false;

    let toggles: Record<string, boolean> = {};
    try {
        toggles = JSON.parse(settings.external_notification_event_toggles || '{}');
    } catch {
        // Corrupt JSON: treat as "no opinion, fall back to per-event defaults".
    }
    if (toggles[eventKey] === false) return false;
    // Default-off events require an explicit `true` toggle.
    if (toggles[eventKey] !== true && DEFAULT_OFF_EVENT_KEYS.has(eventKey)) return false;
    return true;
}

async function loadGatingSettings(): Promise<GatingSettings> {
    return (await db
        .selectFrom('settings')
        .select([
            'external_notification_event_toggles',
            'quiet_hours_from',
            'quiet_hours_to',
            'quiet_hours_timezone',
            'quiet_hours_enabled',
        ])
        .where('id', '=', 1)
        .executeTakeFirstOrThrow()) as unknown as GatingSettings;
}

export async function sendExternalNotification(
    message: string,
    eventKey?: ExternalNotificationEventKey,
): Promise<void> {
    // getWithSecrets: `transport.isConfigured(settings)` reads
    // external_notification_webhook_url (teams) and
    // external_notification_token / _chat_id (telegram). The redacted
    // `.get()` returns null for those, so isConfigured() would always
    // return false and every notification would be silently dropped.
    const settings = await settingsService.getWithSecrets();
    const gating = await loadGatingSettings();
    // Quiet hours apply to EVERY send, with or without an event key — same
    // invariant as the pre-multi-provider Telegram path.
    if (isInQuietHours(gating)) return;
    if (eventKey && !shouldSendForEvent(eventKey, gating)) return;

    const transport = transports[settings.external_notification_provider];
    if (!transport.isConfigured(settings)) return;
    // Pass the already-decrypted settings down so the transport doesn't
    // hit the DB a second time (previously each dispatch cost 2× settings
    // queries — orchestrator + transport). Also closes the narrow race
    // where the Owner rotates the token between the isConfigured check
    // above and the transport's own re-fetch; both now use the same
    // snapshot. See ExternalNotificationTransport.send docstring.
    await transport.send(message, settings);
}

export async function sendExternalForNotification(
    notificationId: number,
    message: string,
    eventKey?: ExternalNotificationEventKey,
): Promise<void> {
    await notificationsService.updateExternalStatus(notificationId, 'pending');
    try {
        await sendExternalNotification(message, eventKey);
        await notificationsService.updateExternalStatus(notificationId, 'sent');
    } catch (err) {
        await notificationsService.updateExternalStatus(
            notificationId,
            'failed',
            err instanceof Error ? err.message : String(err),
        );
        throw err;
    }
}

export async function testExternalNotification(): Promise<{
    ok: boolean;
    error?: string;
    endpoint_label?: string | null;
}> {
    // Use `getWithSecrets` for consistency with `sendExternalNotification`
    // above — this helper currently only reads `external_notification_provider`
    // (which is present on both accessors), so the switch is defensive.
    // The 2026-07-03 audit flagged the redacted-accessor call as a
    // landmine: a later change reading token/webhook via `settings` here
    // would silently see null and report every configured provider as
    // 'unconfigured', breaking the Send Test button.
    const settings = await settingsService.getWithSecrets();
    return transports[settings.external_notification_provider].test();
}
