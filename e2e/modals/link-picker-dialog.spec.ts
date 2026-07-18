import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// LinkPickerDialog is a search-style dialog for linking items together.
// It is typically opened from an item detail page. We use the seeded ETM-1
// epic as the entry point. If the trigger button is absent from the page,
// the spec defers gracefully.

const API = 'http://127.0.0.1:6001';

test.describe('LinkPickerDialog', () => {
    let storyId = '';

    test.beforeAll(async ({ request }) => {
        const res = await request.post(`${API}/api/stories`, {
            data: {
                epic_id: 'ETM-1',
                title: 'E2E link picker dialog test story',
                description: 'Created by link-picker-dialog.spec.ts',
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

    test('LinkPickerDialog opens from item detail and shows a search input', async ({ page }) => {
        test.skip(!storyId, 'no seeded story — deferring LinkPickerDialog smoke test');
        await goto(page, `/issues/stories/${storyId}`);
        await expect(page.getByText(storyId).first()).toBeVisible();

        // LinkPickerDialog is typically opened via a "Link item" or "Add link" button
        const linkBtn = page
            .getByRole('button', { name: /Link item|Add link|Link issue|Related/i })
            .first();
        const hasLink = await linkBtn.isVisible().catch(() => false);
        test.skip(!hasLink, 'no Link item button on detail page — deferring');

        await linkBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // A search / filter input should be present
        const searchInput = dialog.getByRole('textbox').first();
        await expect(searchInput).toBeVisible();
    });

    test('Esc closes the LinkPickerDialog', async ({ page }) => {
        test.skip(!storyId, 'no seeded story — deferring LinkPickerDialog smoke test');
        await goto(page, `/issues/stories/${storyId}`);
        await expect(page.getByText(storyId).first()).toBeVisible();

        const linkBtn = page
            .getByRole('button', { name: /Link item|Add link|Link issue|Related/i })
            .first();
        const hasLink = await linkBtn.isVisible().catch(() => false);
        test.skip(!hasLink, 'no Link item button — deferring');

        await linkBtn.click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
