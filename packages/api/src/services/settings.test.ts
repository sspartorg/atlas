import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Use a temp dir for crypto.ts's workspace.key so we don't trample
// the developer's real key on disk.
const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settings-test-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

import { sql } from 'kysely';
import { settingsService } from './settings.js';
import { testDb, truncateAll, closeTestDb } from '../../tests/_pg-db.js';

beforeEach(async () => {
    // truncateAll already resets settings to defaults.
    await truncateAll();
});

afterAll(async () => {
    await closeTestDb();
});

describe('settingsService', () => {
    it('get returns the singleton row with external_notification_token redacted', async () => {
        const s = await settingsService.get();
        expect(s.owner_name).toBe('Owner');
        // Batch-9 read model: the HTTP-facing `.get()` never surfaces
        // plaintext for the notification secrets. This is null both
        // before any storage AND after — the redaction is unconditional.
        expect(s.external_notification_token).toBeNull();
        expect(s.accent_color).toBe('#2E2E2E');
    });

    it('onboard sets owner + workspace and flips onboarding_complete', async () => {
        const s = await settingsService.onboard('Alice', 'C:/work');
        expect(s.owner_name).toBe('Alice');
        expect(s.workspace_path).toBe('C:/work');
        expect(s.onboarding_complete).toBe(1);
    });

    it('updateConstitution stores the markdown body', async () => {
        const s = await settingsService.updateConstitution('# rules');
        expect(s.constitution_md).toBe('# rules');
    });

    describe('external notification fields', () => {
        it('updateExternalNotificationToken encrypts on write, getWithSecrets decrypts on read', async () => {
            await settingsService.updateExternalNotificationToken('123:abc');
            const raw = (await sql<{ external_notification_token: string }>`SELECT external_notification_token FROM settings WHERE id = 1`.execute(
                testDb,
            )).rows[0]!;
            expect(raw.external_notification_token).not.toBe('123:abc');
            // Redacted read model — HTTP-facing shape.
            expect((await settingsService.get()).external_notification_token).toBeNull();
            // Internal-only accessor decrypts for transport delivery.
            const internal = await settingsService.getWithSecrets();
            expect(internal.external_notification_token).toBe('123:abc');
        });

        it('updateExternalNotificationToken accepts null/empty string and stores NULL', async () => {
            await settingsService.updateExternalNotificationToken('x');
            await settingsService.updateExternalNotificationToken(null);
            expect((await settingsService.get()).external_notification_token).toBeNull();
            await settingsService.updateExternalNotificationToken('y');
            await settingsService.updateExternalNotificationToken('');
            expect((await settingsService.get()).external_notification_token).toBeNull();
        });

        it('maybeDecryptToken falls back to plaintext for pre-encryption values (via getWithSecrets)', async () => {
            await sql`UPDATE settings SET external_notification_token = 'plain-text-bot:token' WHERE id = 1`.execute(testDb);
            // Legacy plaintext (pre-v1 encryption) round-trips through
            // maybeDecryptToken unchanged when read via the internal
            // accessor. `.get()` still redacts.
            expect((await settingsService.get()).external_notification_token).toBeNull();
            const internal = await settingsService.getWithSecrets();
            expect(internal.external_notification_token).toBe('plain-text-bot:token');
        });

        it('updateExternalNotificationToken clears the prior test result + endpoint label', async () => {
            await sql`UPDATE settings SET external_notification_last_test_ok = 1, external_notification_endpoint_label = 'AtlasBot' WHERE id = 1`.execute(
                testDb,
            );
            await settingsService.updateExternalNotificationToken('new-token');
            const s = await settingsService.get();
            expect(s.external_notification_last_test_ok).toBeNull();
            expect(s.external_notification_endpoint_label).toBeNull();
        });

        it('updateExternalNotificationChatId stores chat id and clears prior test result', async () => {
            await sql`UPDATE settings SET external_notification_last_test_ok = 1, external_notification_endpoint_label = 'b' WHERE id = 1`.execute(
                testDb,
            );
            await settingsService.updateExternalNotificationChatId('-100123');
            const s = await settingsService.get();
            expect(s.external_notification_chat_id).toBe('-100123');
            expect(s.external_notification_last_test_ok).toBeNull();
            expect(s.external_notification_endpoint_label).toBeNull();
        });

        it('recordExternalNotificationTest writes ok=1 + endpoint label when ok', async () => {
            await settingsService.recordExternalNotificationTest(true, 'AtlasBot');
            const s = await settingsService.get();
            expect(s.external_notification_last_test_ok).toBe(1);
            expect(s.external_notification_endpoint_label).toBe('AtlasBot');
        });

        it('recordExternalNotificationTest writes ok=0 + null label on failure', async () => {
            await settingsService.recordExternalNotificationTest(false, 'AtlasBot');
            const s = await settingsService.get();
            expect(s.external_notification_last_test_ok).toBe(0);
            expect(s.external_notification_endpoint_label).toBeNull();
        });

        it('updateExternalNotificationProvider switches provider and clears prior test result', async () => {
            await sql`UPDATE settings SET external_notification_last_test_ok = 1, external_notification_endpoint_label = 'old' WHERE id = 1`.execute(
                testDb,
            );
            const s = await settingsService.updateExternalNotificationProvider('teams');
            expect(s.external_notification_provider).toBe('teams');
            expect(s.external_notification_last_test_ok).toBeNull();
            expect(s.external_notification_endpoint_label).toBeNull();
        });

        it('updateExternalNotificationWebhookUrl encrypts on write, getWithSecrets decrypts on read', async () => {
            await settingsService.updateExternalNotificationWebhookUrl('https://example.com/webhook?sig=abc');
            const raw = (await sql<{ external_notification_webhook_url: string }>`SELECT external_notification_webhook_url FROM settings WHERE id = 1`.execute(
                testDb,
            )).rows[0]!;
            expect(raw.external_notification_webhook_url).not.toBe('https://example.com/webhook?sig=abc');
            // Redacted read model — HTTP-facing shape.
            expect((await settingsService.get()).external_notification_webhook_url).toBeNull();
            // Internal-only accessor decrypts for transport delivery.
            const internal = await settingsService.getWithSecrets();
            expect(internal.external_notification_webhook_url).toBe('https://example.com/webhook?sig=abc');
        });

        it('updateExternalNotificationWebhookUrl accepts null/empty string and stores NULL', async () => {
            await settingsService.updateExternalNotificationWebhookUrl('https://example.com/hook');
            await settingsService.updateExternalNotificationWebhookUrl(null);
            expect((await settingsService.get()).external_notification_webhook_url).toBeNull();
            await settingsService.updateExternalNotificationWebhookUrl('https://example.com/hook2');
            await settingsService.updateExternalNotificationWebhookUrl('');
            expect((await settingsService.get()).external_notification_webhook_url).toBeNull();
        });
    });

    describe('updateProfile', () => {
        it('patches single field at a time', async () => {
            await settingsService.updateProfile({ owner_name: 'Bob' });
            expect((await settingsService.get()).owner_name).toBe('Bob');
            await settingsService.updateProfile({ accent_color: '#FFAA00' });
            expect((await settingsService.get()).accent_color).toBe('#FFAA00');
            await settingsService.updateProfile({ workspace_path: 'D:/work' });
            expect((await settingsService.get()).workspace_path).toBe('D:/work');
        });

        it('returns get() when nothing defined', async () => {
            const before = await settingsService.get();
            const after = await settingsService.updateProfile({});
            expect(after.owner_name).toBe(before.owner_name);
        });

        it('skips explicit undefined keys mixed with a defined key (v !== undefined false branch)', async () => {
            const before = await settingsService.get();
            const after = await settingsService.updateProfile({
                owner_name: 'Carol',
                accent_color: undefined,
            });
            expect(after.owner_name).toBe('Carol');
            expect(after.accent_color).toBe(before.accent_color);
        });
    });

    describe('updateNotifications', () => {
        it('round-trips external_notification_event_toggles as JSON', async () => {
            await settingsService.updateNotifications({
                external_notification_event_toggles: { epic_created: true, story_done: false },
            });
            const raw = (await sql<{ external_notification_event_toggles: string }>`SELECT external_notification_event_toggles FROM settings WHERE id = 1`.execute(
                testDb,
            )).rows[0]!;
            expect(JSON.parse(raw.external_notification_event_toggles)).toEqual({
                epic_created: true,
                story_done: false,
            });
        });

        it('patches quiet hours fields independently', async () => {
            await settingsService.updateNotifications({
                quiet_hours_from: '22:00',
                quiet_hours_to: '07:00',
                quiet_hours_timezone: 'America/New_York',
            });
            const s = await settingsService.get();
            expect(s.quiet_hours_from).toBe('22:00');
            expect(s.quiet_hours_to).toBe('07:00');
            expect(s.quiet_hours_timezone).toBe('America/New_York');
        });

        it('accepts null values to clear quiet hours', async () => {
            await settingsService.updateNotifications({ quiet_hours_from: '22:00' });
            await settingsService.updateNotifications({ quiet_hours_from: null });
            expect((await settingsService.get()).quiet_hours_from).toBeNull();
        });

        it('round-trips quiet_hours_enabled', async () => {
            // Default is 0 — defined by the migration's column default.
            expect((await settingsService.get()).quiet_hours_enabled).toBe(0);
            await settingsService.updateNotifications({ quiet_hours_enabled: 1 });
            expect((await settingsService.get()).quiet_hours_enabled).toBe(1);
            await settingsService.updateNotifications({ quiet_hours_enabled: 0 });
            expect((await settingsService.get()).quiet_hours_enabled).toBe(0);
        });

        it('returns get() when no defined keys', async () => {
            const before = await settingsService.get();
            const after = await settingsService.updateNotifications({});
            expect(after.id).toBe(before.id);
        });

        it('round-trips terminal_idle_notify_seconds', async () => {
            await settingsService.updateNotifications({ terminal_idle_notify_seconds: 45 });
            expect((await settingsService.get()).terminal_idle_notify_seconds).toBe(45);
        });
    });
});
