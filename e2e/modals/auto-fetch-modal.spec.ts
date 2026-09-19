import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ADR 0018 — auto-fetch is per repo, so the modal opens from Project Detail's
// Repos tab → the repo's row menu → "Auto-fetch schedule…". The e2e seed
// inserts "E2E Terminal" (id: e2e-terminal-project) with one repo, `project`.

const PROJECT_ID = 'e2e-terminal-project';

async function openAutoFetch(page: import('@playwright/test').Page) {
    await goto(page, `/projects/${PROJECT_ID}?tab=repos`);
    await page.getByRole('button', { name: /Actions for project/i }).first().click();
    await page.getByRole('menuitem', { name: /Auto-fetch schedule/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    return dialog;
}

test.describe('AutoFetchScheduleModal', () => {
    test('open from the Repos tab — repo actions → Auto-fetch schedule…', async ({ page }) => {
        const dialog = await openAutoFetch(page);
        // Header text: "Auto-fetch schedule" (disabled state) or "Auto-fetch enabled".
        // Multiple matches occur (header + body copy + tooltip) — first is enough.
        await expect(dialog.getByText(/Auto-fetch/i).first()).toBeVisible();
    });

    test('form fields — enable switch, schedule presets, and conflict cards visible', async ({ page }) => {
        const dialog = await openAutoFetch(page);
        // Enable switch row.
        await expect(dialog.getByText('Enable scheduled auto-fetch')).toBeVisible();
        // Schedule preset cards — at minimum "Every hour" should be present.
        await expect(dialog.getByText('Every hour')).toBeVisible();
        // Conflict policy cards.
        await expect(dialog.getByText('Skip & notify')).toBeVisible();
    });

    test('Esc closes the modal without saving', async ({ page }) => {
        const dialog = await openAutoFetch(page);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
