import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';

// Reset Workspace for real, on the e2e database. Named zz- so it runs after
// every other spec (one worker, files in name order), and it re-seeds after
// itself so a re-run or a later spec still finds the fixtures.

test.afterAll(() => {
    execFileSync('pnpm', ['exec', 'tsx', 'e2e/fixtures/run-seed.ts'], {
        cwd: resolve(new URL('.', import.meta.url).pathname, '../..'),
        env: { ...process.env, DATABASE_URL: 'postgres://atlas:atlas@localhost:5500/atlas_e2e' },
        stdio: 'ignore',
    });
});

test('Reset Workspace needs RESET typed exactly, then wipes data, secrets and push devices', async ({ page, request }) => {
    await request.put(`${API}/api/environment-secrets`, { data: { vars: [{ key: 'E2E_RESET', value: 'x' }] } });
    await request.patch(`${API}/api/settings/notifications`, { data: { quiet_hours_enabled: 1, quiet_hours_from: '22:00', quiet_hours_to: '08:00', terminal_idle_notify_seconds: 900 } });

    await goto(page, '/settings');
    await page.getByRole('button', { name: /Reset Workspace/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('shared secrets');
    const confirm = dialog.getByRole('button', { name: /Reset Everything/ });
    const input = dialog.getByRole('textbox');
    for (const wrong of ['reset', 'RESE', 'RESET ', ' RESET']) {
        await input.fill(wrong);
        if (wrong.trim() !== 'RESET') await expect(confirm).toBeDisabled();
    }
    await dialog.getByRole('button', { name: /Cancel/ }).click();
    await expect(dialog).toHaveCount(0);
    expect((await apiGet<unknown[]>(request, '/api/projects')).length).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Reset Workspace/ }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('RESET');
    await page.getByRole('dialog').getByRole('button', { name: /Reset Everything/ }).click();
    await expect(page).toHaveURL(/\/onboarding/);

    expect(await apiGet<unknown[]>(request, '/api/projects')).toHaveLength(0);
    expect(await apiGet<unknown[]>(request, '/api/credentials')).toHaveLength(0);
    expect((await apiGet<{ vars: unknown[] }>(request, '/api/environment-secrets')).vars).toHaveLength(0);
    const s = await apiGet<Record<string, unknown>>(request, '/api/settings');
    expect(s).toMatchObject({ onboarding_complete: 0, quiet_hours_enabled: 0, terminal_idle_notify_seconds: 300, external_notification_token_set: false });
});
