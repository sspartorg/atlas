import { db } from '../db/kysely-client.js';
import { settingsService } from './settings.js';
import { notificationsService, SKIPPED_NO_CHANNEL, SKIPPED_WHILE_HELD } from './notifications.js';
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

// The Owner's wall-clock HH:MM. A zone the formatter rejects (a hand-edited
// row, an engine without that zone) falls back to server-local time: a bad
// zone must never make every send throw.
function localHHMM(now: Date, tz: string | null): string {
    if (tz) {
        try {
            return new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: tz,
            }).format(now);
        } catch {
            /* fall through to server-local */
        }
    }
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// True iff `now` falls within the configured quiet-hours window AND the
// feature is currently enabled. With the toggle off, the window is ignored
// even if from/to are still populated — that's the whole point of
// separating the boolean from the time fields. `from == to` is an empty
// window (off), not "all day".
export function isInQuietHours(
    settings: Pick<
        GatingSettings,
        'quiet_hours_enabled' | 'quiet_hours_from' | 'quiet_hours_to' | 'quiet_hours_timezone'
    >,
    now: Date = new Date(),
): boolean {
    if (settings.quiet_hours_enabled !== 1) return false;
    const { quiet_hours_from: from, quiet_hours_to: to, quiet_hours_timezone: tz } = settings;
    if (!from || !to || from === to) return false;

    const local = localHHMM(now, tz);
    // Wrap-around windows (22:00 → 08:00) are the common overnight case.
    if (from < to) return local >= from && local < to;
    return local >= from || local < to;
}

// Events that default to OFF (must be explicitly toggled on by the Owner
// in Settings → Notifications). Most events default to ON; opt-out events
// like the high-volume Terminal idle pings stay quiet until requested.
const DEFAULT_OFF_EVENT_KEYS = new Set<ExternalNotificationEventKey>([
    'terminal.waiting_for_input',
]);

function isEventEnabled(eventKey: string, settings: GatingSettings): boolean {
    let toggles: Record<string, boolean> = {};
    try {
        toggles = JSON.parse(settings.external_notification_event_toggles || '{}');
    } catch {
        // Corrupt JSON: treat as "no opinion, fall back to per-event defaults".
    }
    if (toggles[eventKey] === false) return false;
    // Default-off events require an explicit `true` toggle.
    if (toggles[eventKey] !== true && DEFAULT_OFF_EVENT_KEYS.has(eventKey as ExternalNotificationEventKey)) return false;
    return true;
}

export function shouldSendForEvent(
    eventKey: ExternalNotificationEventKey,
    settings: GatingSettings,
    now: Date = new Date(),
): boolean {
    // Quiet hours are the global mute — checked first so neither toggle
    // override nor missing toggle can punch through it.
    if (isInQuietHours(settings, now)) return false;
    return isEventEnabled(eventKey, settings);
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

// The transport hop alone, no gating. False = no channel configured.
async function transportSend(message: string): Promise<boolean> {
    // getWithSecrets: `transport.isConfigured(settings)` reads
    // external_notification_webhook_url (teams) and
    // external_notification_token / _chat_id (telegram). The redacted
    // `.get()` returns null for those, so isConfigured() would always
    // return false and every notification would be silently dropped.
    const settings = await settingsService.getWithSecrets();
    const transport = transports[settings.external_notification_provider];
    if (!transport.isConfigured(settings)) return false;
    // Pass the already-decrypted settings down so the transport doesn't
    // hit the DB a second time, and so the isConfigured check above and the
    // send use the same snapshot. See ExternalNotificationTransport.send.
    await transport.send(message, settings);
    return true;
}

export async function channelConfigured(): Promise<boolean> {
    const settings = await settingsService.getWithSecrets();
    return transports[settings.external_notification_provider].isConfigured(settings);
}

/**
 * Deliver a notification row now, ignoring quiet hours — Resend/Retry (the
 * Owner pressed it) and the deferred flush. pending → sent | none | failed.
 */
export async function deliverExternalNow(
    notificationId: number,
    message: string,
    // Why the row ends at `none` when no channel is connected. A held row
    // keeps a reason so the log shows it Skipped (with Send now) instead of
    // the hold silently vanishing.
    noChannelReason: string | null = null,
): Promise<void> {
    await notificationsService.updateExternalStatus(notificationId, 'pending');
    try {
        // An unconfigured skip is not a delivery — revert to 'none' (the
        // schema's "no external delivery" value) so the Notification Log
        // never claims "Sent" with no channel connected.
        const delivered = await transportSend(message);
        await notificationsService.updateExternalStatus(
            notificationId,
            delivered ? 'sent' : 'none',
            delivered ? null : noChannelReason,
        );
    } catch (err) {
        await notificationsService.updateExternalStatus(
            notificationId,
            'failed',
            err instanceof Error ? err.message : String(err),
        );
        throw err;
    }
}

/**
 * The outward send for a notification row. An event toggled off leaves the
 * row at `none`. Inside quiet hours the row is HELD (`pending` +
 * `external_deferred_at`) and `flushDeferredExternal` sends it once the window
 * ends — nothing is dropped. Otherwise it is delivered now.
 */
export async function sendExternalForNotification(
    notificationId: number,
    message: string,
    // A free-form key from an MCP caller (e.g. 'agent.daily-digest') gates on
    // its own toggle the same way.
    eventKey?: ExternalNotificationEventKey | string,
    now: Date = new Date(),
): Promise<void> {
    const gating = await loadGatingSettings();
    if (eventKey && !isEventEnabled(eventKey, gating)) return;
    if (isInQuietHours(gating, now)) {
        // Holding for a channel that isn't there would show "Held" for a send
        // that can never happen.
        if (await channelConfigured()) {
            await notificationsService.holdExternal(notificationId, now, eventKey ?? null);
        }
        return;
    }
    await deliverExternalNow(notificationId, message);
}

/** A claim older than this is a send whose process died mid-flight. */
export const STUCK_SEND_MS = 10 * 60_000;

/**
 * Minute tick, once quiet hours are over:
 * - every held row goes out oldest first, prefixed with when it was raised —
 *   unless its event was toggled off while it was held (→ `none`, "Skipped");
 * - a send stuck in flight for 10 minutes (the process died mid-send) is
 *   retried once more; stuck again, it is marked failed.
 * Returns how many rows were claimed. A failed send marks its row `failed`
 * (Retry is on the log) and the sweep carries on.
 */
export async function flushDeferredExternal(now: Date = new Date()): Promise<number> {
    const gating = await loadGatingSettings();
    if (isInQuietHours(gating, now)) return 0;
    const held = await notificationsService.claimDeferred(now);
    const stuck = await notificationsService.reclaimStuck(new Date(now.getTime() - STUCK_SEND_MS), now);
    const jobs = [
        ...held.map((row) => ({
            row,
            text: `Held during quiet hours · ${localHHMM(new Date(row.created_at), gating.quiet_hours_timezone)}\n${row.message}`,
        })),
        ...stuck.map((row) => ({ row, text: row.message })),
    ];
    for (const { row, text } of jobs) {
        if (row.external_event_key && !isEventEnabled(row.external_event_key, gating)) {
            await notificationsService.updateExternalStatus(row.id, 'none', SKIPPED_WHILE_HELD);
            continue;
        }
        try {
            await deliverExternalNow(row.id, text, SKIPPED_NO_CHANNEL);
        } catch {
            /* row is marked failed; keep flushing the rest */
        }
    }
    return jobs.length;
}

/**
 * An outward message Claude sends on the Owner's behalf (MCP
 * `sendExternalNotification`). It gets a log-only row (`in_app: false`) so it
 * is held through quiet hours, gated by its event toggle and tracked in the
 * Notification Log like every other send — but never lands in the feed.
 */
export async function sendOwnerExternalMessage(
    message: string,
    eventKey?: string,
): Promise<{ notification_id: number; external_status: string; held: boolean }> {
    const n = await notificationsService.create({
        event_type: 'mcp_external',
        message,
        kind: 'system',
        agent_id: null,
        link_url: '/notifications?tab=external',
        in_app: false,
    });
    try {
        await sendExternalForNotification(n.id, message, eventKey);
    } catch {
        /* the row is marked failed with the reason; the caller reads it below */
    }
    const row = await notificationsService.get(n.id);
    /* v8 ignore next */
    const status = row?.external_status ?? 'none';
    return { notification_id: n.id, external_status: status, held: status === 'pending' && row?.external_deferred_at != null };
}

export async function testExternalNotification(): Promise<{
    ok: boolean;
    error?: string;
    endpoint_label?: string | null;
}> {
    // Use `getWithSecrets` for consistency with `transportSend`
    // above — this helper currently only reads `external_notification_provider`
    // (which is present on both accessors), so the switch is defensive.
    // The 2026-07-03 audit flagged the redacted-accessor call as a
    // landmine: a later change reading token/webhook via `settings` here
    // would silently see null and report every configured provider as
    // 'unconfigured', breaking the Send Test button.
    const settings = await settingsService.getWithSecrets();
    return transports[settings.external_notification_provider].test();
}
