import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Guard-rails page has two tabs: "Rules <N>" (default) and "Scripts <N>".
// Tab state is local useState — no ?tab= deep-link support.
// Labels include a dynamic count, so use a regex for matching.

test.describe('/guardrails tabs', () => {
    test('default load selects Rules tab', async ({ page }) => {
        await goto(page, '/guardrails');
        await expect(
            page.getByRole('heading', { name: /Guard-?rails/i }).first(),
        ).toBeVisible();
        await expect(
            page.getByRole('tab').filter({ hasText: /Rules/ }).first(),
        ).toHaveAttribute('aria-selected', 'true');
    });

    test('clicking Scripts tab selects it', async ({ page }) => {
        await goto(page, '/guardrails');
        const scriptsTab = page.getByRole('tab').filter({ hasText: /Scripts/ }).first();
        await expect(scriptsTab).toBeVisible();
        await scriptsTab.click();
        await expect(scriptsTab).toHaveAttribute('aria-selected', 'true');
        // Rules tab must no longer be selected.
        await expect(
            page.getByRole('tab').filter({ hasText: /Rules/ }).first(),
        ).toHaveAttribute('aria-selected', 'false');
    });
});
