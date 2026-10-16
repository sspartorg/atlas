import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { API, apiPost, chainGraph, createTask, createWorkflow } from '../helpers/api.js';
import { sql } from '../helpers/db.js';

// Browser push through Google's real push service (FCM) into installed Google
// Chrome: Enable web push in Settings, Send test, then a real workflow park —
// each must reach the service worker and be shown. Needs Google Chrome and the
// internet, and opens a Chrome window, so it is `pnpm e2e:live` only.
//
// The profile stores "Allow notifications" for the app the way clicking Allow
// does: an automation permission override is not enough for Chrome's push
// service ("Registration failed - permission denied").

test.skip(process.env['E2E_LIVE'] !== '1', 'live spec: run with `pnpm e2e:live`');
test.describe.configure({ timeout: 240_000 });

const ORIGIN = 'http://127.0.0.1:6010';

test('real Chrome + FCM: Send test and a workflow park both pop up', async ({ request }) => {
    sql('DELETE FROM push_subscriptions');
    const dir = mkdtempSync(join(tmpdir(), 'atlas-chrome-push-'));
    mkdirSync(join(dir, 'Default'), { recursive: true });
    writeFileSync(
        join(dir, 'Default', 'Preferences'),
        JSON.stringify({ profile: { content_settings: { exceptions: { notifications: { [`${ORIGIN},*`]: { setting: 1 } } } } } }),
    );
    const ctx = await chromium.launchPersistentContext(dir, {
        channel: 'chrome',
        headless: false,
        args: ['--no-first-run', '--no-default-browser-check'],
        // Chrome's push service needs its background connection to Google.
        ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--use-mock-keychain', '--password-store=basic'],
    });
    try {
        const page = ctx.pages()[0] ?? (await ctx.newPage());
        await page.goto(`${ORIGIN}/settings?tab=notifications`, { waitUntil: 'load' });
        await page.getByRole('button', { name: 'Enable web push' }).click();
        await expect(page.getByText(/^Enabled on this device/)).toBeVisible({ timeout: 30_000 });
        expect(sql('SELECT endpoint FROM push_subscriptions')[0]?.[0] ?? '').toMatch(/^https:\/\/fcm\.googleapis\.com\//);

        const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
        await sw.evaluate(() => {
            const g = self as unknown as { __shown: Array<{ title: string; body: string | undefined }> };
            g.__shown = [];
            const proto = ServiceWorkerRegistration.prototype;
            const show = proto.showNotification;
            proto.showNotification = function (title: string, options?: NotificationOptions) {
                g.__shown.push({ title, body: options?.body });
                return show.call(this, title, options);
            };
        });
        const shown = () => sw.evaluate(() => (self as unknown as { __shown: Array<{ title: string; body: string | undefined }> }).__shown);

        await page.getByRole('button', { name: 'Send test', exact: true }).click();
        await expect(page.getByText(/Test push sent \(1\/1 device\)/)).toBeVisible({ timeout: 30_000 });
        await expect.poll(shown, { timeout: 60_000, intervals: [1_000] }).toContainEqual(expect.objectContaining({ title: 'Atlas — test push' }));

        const name = `Live FCM ${Date.now()}`;
        const wf = await createWorkflow(request, name, chainGraph({ type: 'owner' }));
        const task = await createTask(request, `${name} task`);
        await request.put(`${API}/api/items/${task.id}/workflow`, { data: { workflow_id: wf.id } });
        await apiPost(request, `/api/workflows/${wf.id}/runs`, { item_id: task.id });
        await expect
            .poll(shown, { timeout: 60_000, intervals: [1_000] })
            .toContainEqual(expect.objectContaining({ body: expect.stringContaining(`needs you on ${task.id}`) }));
        // eslint-disable-next-line no-console
        console.log('[live] shown by the service worker:', JSON.stringify(await shown()));
    } finally {
        await ctx.close();
        rmSync(dir, { recursive: true, force: true });
        sql('DELETE FROM push_subscriptions');
    }
});
