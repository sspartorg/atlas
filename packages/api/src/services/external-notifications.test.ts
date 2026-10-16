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
    sendOwnerExternalMessage,
    sendExternalForNotification,
    STUCK_SEND_MS,
    deliverExternalNow,
    flushDeferredExternal,
    testExternalNotification,
} from './external-notifications.js';
import { EXTERNAL_NOTIFICATION_EVENT_KEYS } from '@atlas/shared';
import { settingsService } from './settings.js';
import { notificationsService, SKIPPED_WHILE_HELD, INTERRUPTED_TWICE, CANCELLED_BY_OWNER, SKIPPED_NO_CHANNEL } from './notifications.js';
import { truncateAll, closeTestDb, testDb } from '../../tests/_pg-db.js';

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

describe('sendOwnerExternalMessage (MCP send-external) — dispatch', () => {
    // `transport.send` takes (message, settings). The settings arg is not
    // incidental: it hands the ALREADY-DECRYPTED row down so the transport
    // doesn't re-fetch, which is what closes the race between this lookup and
    // the transport's own. Assert it arrives, or a regression that drops it
    // would pass here and only surface as a double-fetch in production.
    it('routes to Telegram when provider is telegram (default)', async () => {
        await sendOwnerExternalMessage('msg');
        expect(mocks.telegramSend).toHaveBeenCalledWith(
            'msg',
            expect.objectContaining({ external_notification_provider: 'telegram' }),
        );
        expect(mocks.teamsSend).not.toHaveBeenCalled();
    });

    it('routes to Teams when provider is teams', async () => {
        await settingsService.updateExternalNotificationProvider('teams');
        await sendOwnerExternalMessage('msg');
        expect(mocks.teamsSend).toHaveBeenCalledWith(
            'msg',
            expect.objectContaining({ external_notification_provider: 'teams' }),
        );
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('logs a tracked, log-only row: in the Notification Log, never in the feed or the unread count', async () => {
        const r = await sendOwnerExternalMessage('digest');
        expect(r).toMatchObject({ external_status: 'sent', held: false });
        const row = (await notificationsService.get(r.notification_id))!;
        expect(row).toMatchObject({
            event_type: 'mcp_external',
            kind: 'system',
            in_app: false,
            external_status: 'sent',
            link_url: '/notifications?tab=external',
        });
        await expect(notificationsService.countUnread()).resolves.toBe(0);
        await expect(notificationsService.list({ in_app: true })).resolves.toEqual([]);
    });

    it('quiet hours HOLD it (no longer dropped) and the flush sends it', async () => {
        await settingsService.updateNotifications({
            quiet_hours_enabled: 1,
            quiet_hours_from: '22:00',
            quiet_hours_to: '08:00',
            quiet_hours_timezone: 'UTC',
        });
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-16T23:30:00Z'));
        try {
            const r = await sendOwnerExternalMessage('night digest', 'agent.daily-digest');
            expect(r).toMatchObject({ external_status: 'pending', held: true });
            expect(mocks.telegramSend).not.toHaveBeenCalled();
            await flushDeferredExternal(new Date('2026-10-17T08:00:00Z'));
            expect(mocks.telegramSend.mock.calls[0]![0]).toMatch(/^Held during quiet hours · \d\d:\d\d\nnight digest$/);
            expect((await notificationsService.get(r.notification_id))!.external_status).toBe('sent');
        } finally {
            vi.useRealTimers();
        }
    });

    it('skips when its event toggle is off (a free-form MCP key)', async () => {
        await settingsService.updateNotifications({
            external_notification_event_toggles: { 'agent.daily-digest': false },
        });
        await expect(sendOwnerExternalMessage('msg', 'agent.daily-digest')).resolves.toMatchObject({
            external_status: 'none',
            held: false,
        });
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('skips when active transport is not configured', async () => {
        mocks.telegramIsConfigured.mockReturnValue(false);
        await expect(sendOwnerExternalMessage('msg')).resolves.toMatchObject({ external_status: 'none' });
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('a transport failure is reported on the row, not thrown', async () => {
        mocks.telegramSend.mockRejectedValueOnce(new Error('429'));
        const r = await sendOwnerExternalMessage('msg');
        expect(r.external_status).toBe('failed');
        expect((await notificationsService.get(r.notification_id))!.failure_reason).toBe('429');
    });
});

describe('sendExternalForNotification — status flow', () => {
    it('pending → sent on success', async () => {
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm');
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
    });

    it('stays none (not sent) when the transport is not configured', async () => {
        mocks.telegramIsConfigured.mockReturnValue(false);
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm');
        expect((await notificationsService.get(n.id))!.external_status).toBe('none');
    });

    it('stays none (not sent) when the event toggle is off', async () => {
        await settingsService.updateNotifications({
            external_notification_event_toggles: { 'agent.failed': false },
        });
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', 'agent.failed');
        expect((await notificationsService.get(n.id))!.external_status).toBe('none');
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

// Quiet hours 22:00 → 08:00 UTC: the overnight, cross-midnight case.
async function overnightQuietHours(): Promise<void> {
    await settingsService.updateNotifications({
        quiet_hours_enabled: 1,
        quiet_hours_from: '22:00',
        quiet_hours_to: '08:00',
        quiet_hours_timezone: 'UTC',
    });
}
const at = (iso: string) => new Date(iso);

describe('quiet hours defer outward sends (held → flushed)', () => {
    it('holds the send inside the window: pending + external_deferred_at, nothing sent', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        const got = (await notificationsService.get(n.id))!;
        expect(got.external_status).toBe('pending');
        expect(new Date(got.external_deferred_at!).toISOString()).toBe('2026-10-16T23:30:00.000Z');
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('flush does nothing while the window is still open (07:59 the next morning)', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        await expect(flushDeferredExternal(at('2026-10-17T07:59:00Z'))).resolves.toBe(0);
        expect((await notificationsService.get(n.id))!.external_status).toBe('pending');
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('flush after the window sends every held row oldest first, prefixed with the original time', async () => {
        await overnightQuietHours();
        const a = await notificationsService.create({ event_type: 'e', message: 'first' });
        const b = await notificationsService.create({ event_type: 'e', message: 'second' });
        // Hold b before a; created_at decides the order, not hold order.
        await sendExternalForNotification(b.id, 'second', undefined, at('2026-10-16T23:40:00Z'));
        await sendExternalForNotification(a.id, 'first', undefined, at('2026-10-16T23:41:00Z'));
        await expect(flushDeferredExternal(at('2026-10-17T08:00:00Z'))).resolves.toBe(2);
        const sent = mocks.telegramSend.mock.calls.map((c) => c[0]);
        expect(sent).toHaveLength(2);
        expect(sent[0]).toMatch(/^Held during quiet hours · \d\d:\d\d\nfirst$/);
        expect(sent[1]).toMatch(/\nsecond$/);
        for (const id of [a.id, b.id]) {
            const got = (await notificationsService.get(id))!;
            expect(got.external_status).toBe('sent');
            expect(got.external_deferred_at).toBeNull();
        }
        // The claim is a CAS: a second flush finds nothing to send.
        await expect(flushDeferredExternal(at('2026-10-17T08:01:00Z'))).resolves.toBe(0);
        expect(mocks.telegramSend).toHaveBeenCalledTimes(2);
    });

    it('Cancel while held means it is never sent', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        await expect(notificationsService.cancel(n.id)).resolves.toBe(true);
        const got = (await notificationsService.get(n.id))!;
        expect(got.external_status).toBe('none');
        expect(got.failure_reason).toBe(CANCELLED_BY_OWNER);
        expect(got.external_deferred_at).toBeNull();
        await expect(flushDeferredExternal(at('2026-10-17T09:00:00Z'))).resolves.toBe(0);
        expect(mocks.telegramSend).not.toHaveBeenCalled();
    });

    it('a held row whose channel was removed meanwhile is Skipped with a reason, not dropped', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        mocks.telegramIsConfigured.mockReturnValue(false);
        await expect(flushDeferredExternal(at('2026-10-17T08:01:00Z'))).resolves.toBe(1);
        expect(await notificationsService.get(n.id)).toMatchObject({ external_status: 'none', failure_reason: SKIPPED_NO_CHANNEL });
    });

    it('turning quiet hours off releases held rows on the next flush', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        await settingsService.updateNotifications({ quiet_hours_enabled: 0 });
        await expect(flushDeferredExternal(at('2026-10-16T23:31:00Z'))).resolves.toBe(1);
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
    });

    it('one failing held send is marked failed and the rest still go out', async () => {
        await overnightQuietHours();
        const a = await notificationsService.create({ event_type: 'e', message: 'a' });
        const b = await notificationsService.create({ event_type: 'e', message: 'b' });
        await sendExternalForNotification(a.id, 'a', undefined, at('2026-10-16T23:30:00Z'));
        await sendExternalForNotification(b.id, 'b', undefined, at('2026-10-16T23:30:00Z'));
        mocks.telegramSend.mockRejectedValueOnce(new Error('rate limited'));
        await flushDeferredExternal(at('2026-10-17T08:00:00Z'));
        expect((await notificationsService.get(a.id))!.external_status).toBe('failed');
        expect((await notificationsService.get(b.id))!.external_status).toBe('sent');
    });

    it('an event toggled off is not held (stays none)', async () => {
        await overnightQuietHours();
        await settingsService.updateNotifications({
            external_notification_event_toggles: { 'workflow.failed': false },
        });
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', 'workflow.failed', at('2026-10-16T23:30:00Z'));
        const got = (await notificationsService.get(n.id))!;
        expect(got.external_status).toBe('none');
        expect(got.external_deferred_at).toBeNull();
    });

    it('nothing is held when no channel is configured', async () => {
        await overnightQuietHours();
        mocks.telegramIsConfigured.mockReturnValue(false);
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        expect((await notificationsService.get(n.id))!.external_status).toBe('none');
    });

    it('Resend (deliverExternalNow) ignores quiet hours — the Owner pressed it', async () => {
        await settingsService.updateNotifications({
            quiet_hours_enabled: 1,
            quiet_hours_from: '00:00',
            quiet_hours_to: '23:59',
            quiet_hours_timezone: 'UTC',
        });
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await deliverExternalNow(n.id, 'm');
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
    });
});

describe('the flush re-checks the event toggle (turned off while held)', () => {
    it('a row whose toggle went off while held becomes none + "Skipped", never sent', async () => {
        await overnightQuietHours();
        const off = await notificationsService.create({ event_type: 'workflow_run', message: 'run failed' });
        const on = await notificationsService.create({ event_type: 'jira_sync', message: 'jira failed' });
        await sendExternalForNotification(off.id, 'run failed', 'workflow.failed', at('2026-10-16T23:30:00Z'));
        await sendExternalForNotification(on.id, 'jira failed', 'jira.sync_failed', at('2026-10-16T23:30:00Z'));
        const [rawOff] = await testDb.selectFrom('notifications').select('external_event_key').where('id', '=', off.id).execute();
        expect(rawOff!.external_event_key).toBe('workflow.failed');

        await settingsService.updateNotifications({
            external_notification_event_toggles: { 'workflow.failed': false },
        });
        await flushDeferredExternal(at('2026-10-17T08:00:00Z'));

        expect(mocks.telegramSend).toHaveBeenCalledTimes(1);
        expect(mocks.telegramSend.mock.calls[0]![0]).toMatch(/\njira failed$/);
        expect(await notificationsService.get(off.id)).toMatchObject({
            external_status: 'none',
            failure_reason: SKIPPED_WHILE_HELD,
            external_deferred_at: null,
        });
        expect((await notificationsService.get(on.id))!.external_status).toBe('sent');
    });

    it('a reminder (no event key) is never skipped by toggles', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'reminder', message: 'stand up' });
        await sendExternalForNotification(n.id, 'stand up', undefined, at('2026-10-16T23:30:00Z'));
        await settingsService.updateNotifications({
            external_notification_event_toggles: Object.fromEntries(EXTERNAL_NOTIFICATION_EVENT_KEYS.map((k) => [k, false])),
        });
        await flushDeferredExternal(at('2026-10-17T08:00:00Z'));
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
    });
});

describe('stuck in-flight sends are recovered', () => {
    const claimAt = async (id: number, iso: string, reclaimed = false) =>
        testDb
            .updateTable('notifications')
            .set({ external_status: 'pending', external_deferred_at: null, external_claimed_at: iso, external_reclaimed: reclaimed })
            .where('id', '=', id)
            .execute();
    const raw = (id: number) =>
        testDb
            .selectFrom('notifications')
            .select(['external_claimed_at', 'external_reclaimed'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow();

    it('every in-flight send stamps a claim; settling clears it', async () => {
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await notificationsService.updateExternalStatus(n.id, 'pending');
        expect((await raw(n.id)).external_claimed_at).not.toBeNull();
        await notificationsService.updateExternalStatus(n.id, 'sent');
        expect(await raw(n.id)).toEqual({ external_claimed_at: null, external_reclaimed: false });
    });

    it('the flush claim stamps it too, so a row the process never reached is not orphaned', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T23:30:00Z'));
        expect((await raw(n.id)).external_claimed_at).toBeNull();
        await notificationsService.claimDeferred(at('2026-10-17T08:00:00Z'));
        expect(new Date((await raw(n.id)).external_claimed_at!).toISOString()).toBe('2026-10-17T08:00:00.000Z');
    });

    it('a claim older than 10 minutes is retried once, then marked failed', async () => {
        const n = await notificationsService.create({ event_type: 'e', message: 'lost' });
        await claimAt(n.id, '2026-10-17T08:00:00Z');
        // 9 minutes: still in flight, left alone.
        await expect(flushDeferredExternal(at('2026-10-17T08:09:00Z'))).resolves.toBe(0);
        expect(mocks.telegramSend).not.toHaveBeenCalled();

        // The retry dies too (the send hangs past the next window): it stays
        // pending with a fresh claim and the re-claimed mark.
        mocks.telegramSend.mockImplementationOnce(() => new Promise(() => {}));
        void flushDeferredExternal(at('2026-10-17T08:10:01Z'));
        await vi.waitFor(() => expect(mocks.telegramSend).toHaveBeenCalledWith('lost', expect.anything()));
        expect(await raw(n.id)).toMatchObject({ external_reclaimed: true });
        expect((await notificationsService.get(n.id))!.external_status).toBe('pending');

        const later = new Date(Date.now() + STUCK_SEND_MS + 60_000);
        await expect(flushDeferredExternal(later)).resolves.toBe(0);
        expect(await notificationsService.get(n.id)).toMatchObject({
            external_status: 'failed',
            failure_reason: INTERRUPTED_TWICE,
        });
        expect(await raw(n.id)).toEqual({ external_claimed_at: null, external_reclaimed: false });
        expect(mocks.telegramSend).toHaveBeenCalledTimes(1);
    });

    it('a successful retry is sent and settles', async () => {
        const n = await notificationsService.create({ event_type: 'e', message: 'lost' });
        await claimAt(n.id, '2026-10-17T08:00:00Z');
        await expect(flushDeferredExternal(at('2026-10-17T08:11:00Z'))).resolves.toBe(1);
        expect(mocks.telegramSend).toHaveBeenCalledWith('lost', expect.anything());
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
        expect(await raw(n.id)).toEqual({ external_claimed_at: null, external_reclaimed: false });
    });

    it('a held row is not "stuck" however long it waits', async () => {
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await notificationsService.holdExternal(n.id, at('2026-10-16T23:00:00Z'));
        await expect(notificationsService.reclaimStuck(at('2026-10-20T00:00:00Z'))).resolves.toEqual([]);
    });

    it('stuck recovery waits for quiet hours to end', async () => {
        await overnightQuietHours();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        await claimAt(n.id, '2026-10-16T22:00:00Z');
        await expect(flushDeferredExternal(at('2026-10-16T23:30:00Z'))).resolves.toBe(0);
        expect((await notificationsService.get(n.id))!.external_status).toBe('pending');
    });
});

describe('quiet hours edge cases', () => {
    const on = { ...baseGating, quiet_hours_enabled: 1, quiet_hours_timezone: 'UTC' };

    it('cross-midnight window: in at 22:00 and 07:59, out at 08:00 and 21:59', () => {
        const w = { ...on, quiet_hours_from: '22:00', quiet_hours_to: '08:00' };
        expect(isInQuietHours(w, at('2026-10-16T22:00:00Z'))).toBe(true);
        expect(isInQuietHours(w, at('2026-10-17T07:59:00Z'))).toBe(true);
        expect(isInQuietHours(w, at('2026-10-17T08:00:00Z'))).toBe(false);
        expect(isInQuietHours(w, at('2026-10-17T21:59:00Z'))).toBe(false);
    });

    it('from == to means off, at any time', () => {
        const w = { ...on, quiet_hours_from: '09:00', quiet_hours_to: '09:00' };
        for (const t of ['2026-10-16T09:00:00Z', '2026-10-16T12:00:00Z', '2026-10-16T03:00:00Z']) {
            expect(isInQuietHours(w, at(t))).toBe(false);
        }
    });

    it('an invalid stored time zone falls back instead of throwing', () => {
        const w = { ...on, quiet_hours_from: '22:00', quiet_hours_to: '08:00', quiet_hours_timezone: 'Mars/Olympus' };
        expect(() => isInQuietHours(w, at('2026-10-16T12:00:00Z'))).not.toThrow();
    });

    it('an invalid stored time zone never breaks a send', async () => {
        // The schema now rejects it, so write it the way a hand-edited row would.
        const { db } = await import('../db/kysely-client.js');
        await db
            .updateTable('settings')
            .set({ quiet_hours_enabled: 1, quiet_hours_from: '22:00', quiet_hours_to: '08:00', quiet_hours_timezone: 'Mars/Olympus' })
            .where('id', '=', 1)
            .execute();
        const n = await notificationsService.create({ event_type: 'e', message: 'm' });
        // Noon server-local (UTC in tests) is outside the window: sent now.
        await sendExternalForNotification(n.id, 'm', undefined, at('2026-10-16T12:00:00Z'));
        expect((await notificationsService.get(n.id))!.external_status).toBe('sent');
    });
});

describe('every event key honours its own toggle', () => {
    it.each(EXTERNAL_NOTIFICATION_EVENT_KEYS)('%s: off → none, on → sent', async (key) => {
        await settingsService.updateNotifications({ external_notification_event_toggles: { [key]: false } });
        const off = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(off.id, 'm', key);
        expect((await notificationsService.get(off.id))!.external_status).toBe('none');

        await settingsService.updateNotifications({ external_notification_event_toggles: { [key]: true } });
        const on = await notificationsService.create({ event_type: 'e', message: 'm' });
        await sendExternalForNotification(on.id, 'm', key);
        expect((await notificationsService.get(on.id))!.external_status).toBe('sent');
    });

    it('the new failure keys default ON', () => {
        expect(shouldSendForEvent('jira.sync_failed', baseGating)).toBe(true);
        expect(shouldSendForEvent('workflow.failed', baseGating)).toBe(true);
    });
});
