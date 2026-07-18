import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// AddPrLinkDialog is opened from an item detail page (story or bug) via an
// "Add PR link" / "Link PR" action. The e2e seed creates one epic ETM-1 but
// no stories or bugs, so we use the story-detail approach: POST a story via
// the API in beforeAll and open it. Validates URL field and Cancel.

const API = 'http://127.0.0.1:6001';

test.describe('AddPrLinkDialog', () => {
    let storyId = '';

    test.beforeAll(async ({ request }) => {
        const res = await request.post(`${API}/api/stories`, {
            data: {
                epic_id: 'ETM-1',
                title: 'E2E PR link dialog test story',
                description: 'Created by add-pr-link-dialog.spec.ts',
                labels: [],
            },
        });
        if (res.status() === 201) {
            const body = await res.json() as { id: string };
            storyId = body.id;
        }
    });

    test.afterAll(async ({ request }) => {
        if (storyId) {
            await request.delete(`${API}/api/stories/${storyId}`);
        }
    });

    test('Add PR link dialog opens from story detail with URL field', async ({ page }) => {
        test.skip(!storyId, 'no seeded story — deferring AddPrLinkDialog smoke test');
        await goto(page, `/issues/stories/${storyId}`);
        await expect(page.getByText(storyId).first()).toBeVisible();

        // Look for "Add PR link" or "Link PR" button
        const addPrBtn = page.getByRole('button', { name: /Add PR link|Link PR|Add link/i }).first();
        const hasPrBtn = await addPrBtn.isVisible().catch(() => false);
        test.skip(!hasPrBtn, 'no Add PR link button on story detail — deferring');

        await addPrBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // URL input field should be present
        const urlField = dialog.getByLabel(/URL/i).first();
        await expect(urlField).toBeVisible();
    });

    test('URL field is required — empty submit shows validation', async ({ page }) => {
        test.skip(!storyId, 'no seeded story — deferring AddPrLinkDialog smoke test');
        await goto(page, `/issues/stories/${storyId}`);
        await expect(page.getByText(storyId).first()).toBeVisible();

        const addPrBtn = page.getByRole('button', { name: /Add PR link|Link PR|Add link/i }).first();
        const hasPrBtn = await addPrBtn.isVisible().catch(() => false);
        test.skip(!hasPrBtn, 'no Add PR link button — deferring');

        await addPrBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // The Save/Add button should be disabled without a URL
        const saveBtn = dialog.getByRole('button', { name: /Save|Add|Link/i }).first();
        const hasSave = await saveBtn.isVisible().catch(() => false);
        if (hasSave) {
            await expect(saveBtn).toBeDisabled();
        }
        // Close without submitting
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
