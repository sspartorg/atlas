import type { ISettings } from '@atlas/shared';

// Contract every external-notification transport implements. Gating
// (quiet hours, per-event toggles) lives in the orchestrator — transports
// stay pure: configure, send, test.
export interface ExternalNotificationTransport {
    /** True iff settings carry enough config for `send()` to attempt delivery. */
    isConfigured(settings: ISettings): boolean;
    /**
     * Deliver the message via this transport. Throws on transport-level failure.
     *
     * The `settings` argument carries the already-decrypted plaintext token /
     * webhook URL. The orchestrator (`sendExternalNotification`) fetches
     * via `settingsService.getWithSecrets()` once and threads the result
     * down so the transport doesn't hit the DB a second time. Passing the
     * same object also closes a narrow race window where the Owner could
     * rotate the token between the orchestrator's isConfigured() check
     * and the transport's own fetch, causing the transport to silently
     * drop the send under the rotated (partially-propagated) value.
     */
    send(message: string, settings: ISettings): Promise<void>;
    /**
     * Explicit Owner-driven connectivity check. Bypasses quiet hours / per-event
     * toggles by convention (the button is an explicit action; silence would be
     * indistinguishable from misconfiguration). Persists `last_test_ok` +
     * `endpoint_label` via `settingsService.recordExternalNotificationTest`.
     * Fetches its own settings — the Send Test button is not routed through
     * `sendExternalNotification`.
     */
    test(): Promise<{ ok: boolean; error?: string; endpoint_label?: string | null }>;
}
