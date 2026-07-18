import { db } from '../db/kysely-client.js';
import { encrypt, decrypt } from './crypto.js';
import type { ExternalNotificationProvider, ISettings } from '@atlas/shared';

// Encrypted-value marker. New encryptions in this module carry the `v1:`
// prefix; the presence of the prefix lets `maybeDecryptToken` distinguish
// "this is a versioned encrypted blob" from "this is a legacy plaintext
// value written before at-rest encryption landed". Without the marker, a
// decrypt-failure had to be silently swallowed (the fallback returned the
// raw value), which masked key-rotation issues — if the workspace.key was
// regenerated, every existing token turned into a garbled ciphertext blob
// that got round-tripped to the client and to the transport (Telegram /
// webhook), and the caller saw "connectivity test failed" with no clue why.
const V1_PREFIX = 'v1:';

function encryptTokenAtRest(plain: string): string {
    return V1_PREFIX + encrypt(plain);
}

function maybeDecryptToken(value: string | null): string | null {
    if (value === null) return null;
    if (value.startsWith(V1_PREFIX)) {
        // Versioned blob — decrypt errors here are real (wrong key,
        // corruption). Log the specific `crypto:` prefix so the operator
        // can distinguish this from a bad env var.
        try {
            return decrypt(value.slice(V1_PREFIX.length));
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(
                `settings: v1 encrypted value failed to decrypt (${detail}). ` +
                    'Likely cause: workspace.key was regenerated after the value was written. ' +
                    'Reset the affected secret via the Settings UI.',
            );
        }
    }
    // Legacy path — plaintext value written before at-rest encryption
    // landed. Return as-is; the next write-through (any update from the
    // Settings UI) will re-store as a `v1:` blob.
    return value;
}

interface ProfilePatch {
    owner_name?: string | undefined;
    accent_color?: string | undefined;
    workspace_path?: string | undefined;
}

interface NotificationsPatch {
    external_notification_event_toggles?: Record<string, boolean> | undefined;
    quiet_hours_from?: string | null | undefined;
    quiet_hours_to?: string | null | undefined;
    quiet_hours_timezone?: string | null | undefined;
    quiet_hours_enabled?: number | undefined;
    terminal_idle_notify_seconds?: number | undefined;
}

async function fetchSettings(): Promise<ISettings> {
    const row = await db
        .selectFrom('settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
    // Batch-9 audit (enterprise secrets read model): NEVER return the
    // plaintext external-notification token / webhook URL on this
    // endpoint. The UI reads the `_set` booleans below to decide
    // whether to render "Reveal" or "Set new" per row; a Reveal click
    // hits the dedicated `POST /api/settings/external-notification/
    // reveal-*` endpoints one-shot. Matches Vault / AWS Secrets Manager
    // / Doppler / 1Password read-model semantics: never batch the
    // plaintext across the wire.
    const tokenStored = row.external_notification_token ?? null;
    const webhookStored = row.external_notification_webhook_url ?? null;
    return {
        ...(row as unknown as ISettings),
        external_notification_token: null,
        external_notification_webhook_url: null,
        // Boolean signal so the UI knows whether a value is configured.
        // Declared on ISettings as optional (shared schema updated in
        // this same PR) so both TS and downstream consumers stay happy.
        external_notification_token_set:
            tokenStored !== null && tokenStored.length > 0,
        external_notification_webhook_url_set:
            webhookStored !== null && webhookStored.length > 0,
        // `ai_enabled` is derived at request time from ATLAS_AI_ENABLED
        // so flipping the env + restarting takes effect without a DB
        // write. Enriching here (rather than only in the GET route)
        // means PATCH/POST handlers also return the field, so a
        // settings mutation can't accidentally evict it from the React
        // Query cache and flash the Topbar Simulated badge.
        ai_enabled: process.env['ATLAS_AI_ENABLED'] === 'true',
    } as ISettings;
}

// Internal-only accessor: returns the full settings row with the external
// notification credentials DECRYPTED. Must NEVER be surfaced on an HTTP
// route — the redacted `fetchSettings()` shape is what the wire sees.
// Callers are limited to server-side code that needs the plaintext value
// to actually deliver a notification (the Teams/Telegram transports and
// the `sendExternalNotification` orchestrator). Any new caller should be
// audited during code review — a leak here re-opens the exact hole the
// Batch-9 read-model change closed.
async function fetchSettingsWithSecrets(): Promise<ISettings> {
    const row = await db
        .selectFrom('settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
    // 2026-07-03 audit round 2: keep the shape identical to fetchSettings
    // (both accessors declare `Promise<ISettings>`). The `_set` booleans
    // must be present here too so any internal caller that inspects them
    // gets the same truthiness (Boolean(undefined)===false was misreporting
    // 'token is stored' as 'no token' if a future callsite added such a
    // check on the with-secrets path).
    const tokenStored = row.external_notification_token ?? null;
    const webhookStored = row.external_notification_webhook_url ?? null;
    return {
        ...(row as unknown as ISettings),
        external_notification_token: maybeDecryptToken(tokenStored),
        external_notification_webhook_url: maybeDecryptToken(webhookStored),
        external_notification_token_set:
            tokenStored !== null && tokenStored.length > 0,
        external_notification_webhook_url_set:
            webhookStored !== null && webhookStored.length > 0,
        ai_enabled: process.env['ATLAS_AI_ENABLED'] === 'true',
    } as ISettings;
}

// On-demand reveal helpers. Called by the reveal endpoints only, one
// key per HTTP request. Return `null` when no value is stored.
async function revealExternalNotificationToken(): Promise<string | null> {
    const row = await db
        .selectFrom('settings')
        .select('external_notification_token')
        .where('id', '=', 1)
        .executeTakeFirst();
    return maybeDecryptToken(row?.external_notification_token ?? null);
}

async function revealExternalNotificationWebhookUrl(): Promise<string | null> {
    const row = await db
        .selectFrom('settings')
        .select('external_notification_webhook_url')
        .where('id', '=', 1)
        .executeTakeFirst();
    return maybeDecryptToken(row?.external_notification_webhook_url ?? null);
}

export const settingsService = {
    async get(): Promise<ISettings> {
        return fetchSettings();
    },

    // See `fetchSettingsWithSecrets` docstring. Only callable from
    // internal service code (transports, external-notifications
    // orchestrator). Do NOT invoke from an HTTP handler.
    async getWithSecrets(): Promise<ISettings> {
        return fetchSettingsWithSecrets();
    },

    async onboard(ownerName: string, workspacePath: string): Promise<ISettings> {
        await db
            .updateTable('settings')
            .set({
                owner_name: ownerName,
                workspace_path: workspacePath,
                onboarding_complete: 1,
            })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async updateConstitution(constitutionMd: string): Promise<ISettings> {
        await db
            .updateTable('settings')
            .set({ constitution_md: constitutionMd })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async updateExternalNotificationProvider(
        provider: ExternalNotificationProvider,
    ): Promise<ISettings> {
        await db
            .updateTable('settings')
            .set({
                external_notification_provider: provider,
                // Switching provider invalidates the prior connectivity test — the
                // Owner clicks Send Test against the newly active provider.
                external_notification_last_test_ok: null,
                external_notification_endpoint_label: null,
            })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async updateExternalNotificationToken(token: string | null): Promise<ISettings> {
        const stored = token === null || token === '' ? null : encryptTokenAtRest(token);
        await db
            .updateTable('settings')
            .set({
                external_notification_token: stored,
                external_notification_last_test_ok: null,
                external_notification_endpoint_label: null,
            })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async updateExternalNotificationChatId(chatId: string | null): Promise<ISettings> {
        await db
            .updateTable('settings')
            .set({
                external_notification_chat_id: chatId,
                external_notification_last_test_ok: null,
                external_notification_endpoint_label: null,
            })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async updateExternalNotificationWebhookUrl(url: string | null): Promise<ISettings> {
        // Webhook URLs carry a SAS-style `sig=…` token — anyone with the URL
        // can post to the channel. Encrypt at rest like the Telegram bot
        // token; fetchSettings() decrypts.
        const stored = url === null || url === '' ? null : encryptTokenAtRest(url);
        await db
            .updateTable('settings')
            .set({
                external_notification_webhook_url: stored,
                external_notification_last_test_ok: null,
                external_notification_endpoint_label: null,
            })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    /**
     * Apply every provided field in one UPDATE. Prevents the "partial
     * apply" hazard where a mid-sequence failure between provider/token/
     * chat_id/webhook writes leaves the row in a mismatched provider →
     * secret shape (e.g. provider='teams' + token still holds the old
     * Telegram bot token, which a subsequent test-send would leak to
     * Teams infrastructure). The test-pill is cleared once, atomically.
     */
    async updateExternalNotificationBatch(fields: {
        external_notification_provider?: ExternalNotificationProvider | undefined;
        external_notification_token?: string | null | undefined;
        external_notification_chat_id?: string | null | undefined;
        external_notification_webhook_url?: string | null | undefined;
    }): Promise<ISettings> {
        const set: Record<string, unknown> = {
            // Any batched write resets the connectivity signal — the Owner
            // clicks Send Test against the resulting active-provider shape.
            external_notification_last_test_ok: null,
            external_notification_endpoint_label: null,
        };
        if (fields.external_notification_provider !== undefined) {
            set['external_notification_provider'] = fields.external_notification_provider;
        }
        if (fields.external_notification_token !== undefined) {
            const raw = fields.external_notification_token;
            set['external_notification_token'] = raw === null || raw === '' ? null : encryptTokenAtRest(raw);
        }
        if (fields.external_notification_chat_id !== undefined) {
            set['external_notification_chat_id'] = fields.external_notification_chat_id;
        }
        if (fields.external_notification_webhook_url !== undefined) {
            const raw = fields.external_notification_webhook_url;
            set['external_notification_webhook_url'] = raw === null || raw === '' ? null : encryptTokenAtRest(raw);
        }
        await db
            .updateTable('settings')
            .set(set as never)
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async recordExternalNotificationTest(ok: boolean, endpointLabel: string | null): Promise<ISettings> {
        await db
            .updateTable('settings')
            .set({
                external_notification_last_test_ok: ok ? 1 : 0,
                external_notification_endpoint_label: ok ? endpointLabel : null,
            })
            .where('id', '=', 1)
            .execute();
        return fetchSettings();
    },

    async updateProfile(patch: ProfilePatch): Promise<ISettings> {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) clean[k] = v;
        }
        if (Object.keys(clean).length === 0) return fetchSettings();
        await db.updateTable('settings').set(clean as never).where('id', '=', 1).execute();
        return fetchSettings();
    },

    async updateNotifications(patch: NotificationsPatch): Promise<ISettings> {
        const clean: Record<string, unknown> = {};
        if (patch.external_notification_event_toggles !== undefined) {
            clean['external_notification_event_toggles'] = JSON.stringify(
                patch.external_notification_event_toggles,
            );
        }
        if (patch.quiet_hours_from !== undefined) clean['quiet_hours_from'] = patch.quiet_hours_from;
        if (patch.quiet_hours_to !== undefined) clean['quiet_hours_to'] = patch.quiet_hours_to;
        if (patch.quiet_hours_timezone !== undefined)
            clean['quiet_hours_timezone'] = patch.quiet_hours_timezone;
        if (patch.quiet_hours_enabled !== undefined)
            clean['quiet_hours_enabled'] = patch.quiet_hours_enabled;
        if (patch.terminal_idle_notify_seconds !== undefined)
            clean['terminal_idle_notify_seconds'] = patch.terminal_idle_notify_seconds;
        if (Object.keys(clean).length === 0) return fetchSettings();
        await db.updateTable('settings').set(clean as never).where('id', '=', 1).execute();
        return fetchSettings();
    },

    // Batch-9 audit: on-demand reveal endpoints. Return the plaintext
    // for a single value; do not include in the settings GET body.
    revealExternalNotificationToken,
    revealExternalNotificationWebhookUrl,
};
