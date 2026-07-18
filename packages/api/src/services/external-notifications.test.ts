import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmpKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-external-notifications-test-'));
process.env['ATLAS_DATA_DIR'] = tmpKeyDir;

vi.mock('../routes/events.js', () => ({ broadcastSSE: vi.fn() }));

// vi.mock() is hoisted to the top of the file by the transformer, so any
// `const` referenced inside the factory must also be hoisted via `vi.hoisted`
// — otherwise the factory closes over uninitialized bindings (TDZ).
const mocks = vi.hoisted(() => ({
    telegramSend: vi.fn(async (_m: string) => {}),
    telegramTest: vi.fn(async () => ({
        ok: true,
        endpoint_label: '@AtlasBot' as string | null,
    })),
    telegramIsConfigured: vi.fn(() => true),
    teamsSend: vi.fn(async (_m: string) => {}),
    teamsTest: vi.fn(async () => ({
        ok: true,
        endpoint_label: 'Microsoft Teams (Power Automate)' as string | null,
    })),
    teamsIsConfigured: vi.fn(() => true),
}));

vi.mock('./transports/telegram.js', () => ({
    telegramTransport: {
        send: mocks.telegramSend,
        test: mocks.telegramTest,
        isConfigured: mocks.telegramIsConfigured,
    },
}));

vi.mock('./transports/teams.js', () => ({
    teamsTransport: {
        send: mocks.teamsSend,
        test: mocks.teamsTest,
        isConfigured: mocks.teamsIsConfigured,
    },
}));

import {
    isInQuietHours,
    shouldSendForEvent,
    sendExternalNotification,
    sendExternalForNotification,
    testExternalNotification,
} from './external-notifications.js';
import { settingsService } from './settings.js';
import { notificationsService } from './notifications.js';
import { truncateAll, closeTestDb } from '../../tests/_pg-db.js';

const baseGating = {
    external_notification_event_toggles: '{}',
    quiet_hours_from: null,
    quiet_hours_to: null,
    quiet_hours_timezone: null,
    quiet_hours_enabled: 0,
};

beforeEach(async () => {
    await truncateAll();
    mocks.telegramSend.mockClear();
    mocks.telegramTest.mockClear();
    mocks.telegramIsConfigured.mockClear().mockReturnValue(true);
    mocks.teamsSend.mockClear();
    mocks.teamsTest.mockClear();
    mocks.teamsIsConfigured.mockClear().mockReturnValue(true);
});

afterAll(async () => {
    await closeTestDb();
});

describe('isInQuietHours', () => {
    it('returns false when quiet_hours_enabled=0', () => {
        expect(
            isInQuietHours({
                quiet_hours_enabled: 0,
                quiet_hours_from: '00:00',
                quiet_hours_to: '23:59',
                quiet_hours_timezone: 'UTC',
            }),
        ).toBe(false);
    });

    it('returns true mid-window when enabled', () => {
        const at = new Date('2026-01-15T13:30:00Z');
        expect(
            isInQuietHours(
                {
                    quiet_hours_enabled: 1,
                    quiet_hours_from: '13:00',
                    quiet_hours_to: '14:00',
                    quiet_hours_timezone: 'UTC',
                },
                at,
            ),
        ).toBe(true);
    });

    it('handles overnight wrap-around (22:00 → 08:00)', () => {
        const at = new Date('2026-01-15T02:30:00Z');
        expect(
            isInQuietHours(
                {
                    quiet_hours_enabled: 1,
                    quiet_hours_from: '22:00',
                    quiet_hours_to: '08:00',
                    quiet_hours_timezone: 'UTC',
                },
                at,
            ),
        ).toBe(true);
    });

    it('returns false when enabled=1 but quiet_hours_from is null (!from branch)', () => {
        // Covers `if (!from || !to) return false` at line 45 when from is null.
        expect(
            isInQuietHours({
                quiet_hours_enabled: 1,
                quiet_hours_from: null,
                quiet_hours_to: '08:00',
                quiet_hours_timezone: 'UTC',
            }),
        ).toBe(false);
    });

    it('uses local getHours/getMinutes when quiet_hours_timezone is null (tz false branch)', () => {
        // Covers `const local = tz ? Intl... : \`\${getHours()}...\`` false branch.
        // With no tz, the code uses Date#getHours/getMinutes to compute local time.
        // We use a mid-day UTC time and a window that should be outside quiet hours.
        const at = new Date('2026-01-15T12:00:00Z'); // noon UTC → 12:00 in local
        expect(
            isInQuietHours(
                {
                    quiet_hours_enabled: 1,
                    quiet_hours_from: '23:00',
                    quiet_hours_to: '05:00',
                    quiet_hours_timezone: null,
                },
                at,
            ),
        ).toBe(false);
    });
});

describe('shouldSendForEvent', () => {
    it('default ON when no toggle set', () => {
        expect(shouldSendForEvent('agent.failed', baseGating)).toBe(true);
    });

    it('OFF when the event toggle is false', () => {
        expect(
            shouldSendForEvent('agent.failed', {
                ...baseGating,
                external_notification_event_toggles: JSON.stringify({ 'agent.failed': false }),
            }),
        ).toBe(false);
    });

    it('quiet hours mute even with toggle ON', () => {
        const at = new Date('2026-01-15T13:30:00Z');
        expect(
            shouldSendForEvent(
                'agent.failed',
                {
                    ...baseGating,
                    quiet_hours_enabled: 1,
                    quiet_hours_from: '13:00',
                    quiet_hours_to: '14:00',
                    quiet_hours_timezone: 'UTC',
                },
                at,
            ),
        ).toBe(false);
    });

    it('corrupt JSON in toggles falls through to per-event defaults (JSON.parse catch branch)', () => {
        // Covers the `catch { }` at line 80 when external_notification_event_toggles is invalid JSON.
        // Corrupt JSON → toggles stays {} → no explicit toggle → fall through to default behavior.
        expect(
            shouldSendForEvent('agent.failed', {
                ...baseGating,
                external_notification_event_toggles: 'not-valid-json{{{',
            }),
        ).toBe(true); // agent.failed defaults to ON
    });

    it('default-OFF event (terminal.waiting_for_input) returns false when not explicitly toggled on', () => {
        // Covers `if (toggles[eventKey] !== true && DEFAULT_OFF_EVENT_KEYS.has(eventKey))` at line 85.
        expect(
            shouldSendForEvent('terminal.waiting_for_input', baseGating),
        ).toBe(false);
    });

    it('default-OFF event returns true when explicitly toggled ON', () => {
        // Covers the `toggles[eventKey] !== true` = false path (does NOT return false on line 85).
        expect(
            shouldSendForEvent('terminal.waiting_for_input', {
                ...baseGating,
                external_notification_event_toggles: JSON.stringify({ 'terminal.waiting_for_input': true }),
            }),
        ).toBe(true);
    });
});

describe('sendExternalNotification — dispatch', () => {
    it('routes to Telegram when provider is telegram (default)', async () => {
        await sendExternalNotification('msg');
        expect(mocks.telegramSend).toHaveBeenCalledWith('msg');
        expect(mocks.teamsSend).not.toHaveBeenCalled();
    });

    it('routes to Teams when provider is teams', async () => {
        await settingsService.updateExternalNotificationProvider('teams');
        await sendExternalNotification('msg');
        expect(mocks.teamsSend).toHaveBeenCalledWith('msg');
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('skips both transports when quiet hours active', async () => {
        await settingsService.updateNotifications({
            quiet_hours_enabled: 1,
            quiet_hours_from: '00:00',
            quiet_hours_to: '23:59',
            quiet_hours_timezone: 'UTC',
        });
        await sendExternalNotification('msg');
        expect(mocks.telegramSend).not.toHaveBeenCalled();
        expect(mocks.teamsSend).not.toHaveBeenCalled();
    });

    it('skips when event toggle is off', async () => {
        await settingsService.updateNotifications({
            external_notification_event_toggles: { 'agent.failed': false },
        });
        await sendExternalNotification('msg', 'agent.failed');
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('skips when active transport is not configured', async () => {
        mocks.telegramIsConfigured.mockReturnValue(false);
        await sendExternalNotification('msg');
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });
});

describe('sendExternalForNotification — status flow', () => {
    it('pending → sent on success', async () => {
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm');
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
    });

    it('pending → failed and rethrows on transport error', async () => {
        mocks.telegramSend.mockRejectedValueOnce(new Error('boom'));
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await expect(sendExternalForNotification(n.id, 'm')).rejects.toThrow(/boom/);
        const got = (await notificationsService.get(n.id))!;
        expect(got.external_status).toBe('failed');
        expect(got.failure_reason).toBe('boom');
    });

    it('failed and rethrows with String(err) when transport throws non-Error (EXTNOTIF-STR-1)', async () => {
        // Covers `err instanceof Error ? err.message : String(err)` false branch at line 132.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        mocks.telegramSend.mockRejectedValueOnce('non-error-transport-fail');
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await expect(sendExternalForNotification(n.id, 'm')).rejects.toBe('non-error-transport-fail');
        const got = (await notificationsService.get(n.id))!;
        expect(got.external_status).toBe('failed');
        expect(got.failure_reason).toBe('non-error-transport-fail');
    });
});

describe('testExternalNotification — provider delegation', () => {
    it('delegates to telegramTransport.test when provider is telegram', async () => {
        const r = await testExternalNotification();
        expect(mocks.telegramTest).toHaveBeenCalledTimes(1);
        expect(mocks.teamsTest).not.toHaveBeenCalled();
        expect(r.endpoint_label).toBe('@AtlasBot');
    });

    it('delegates to teamsTransport.test when provider is teams', async () => {
        await settingsService.updateExternalNotificationProvider('teams');
        const r = await testExternalNotification();
        expect(mocks.teamsTest).toHaveBeenCalledTimes(1);
        expect(mocks.telegramTest).not.toHaveBeenCalled();
        expect(r.endpoint_label).toBe('Microsoft Teams (Power Automate)');
    });
});
