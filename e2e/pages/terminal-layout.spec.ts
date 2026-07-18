import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

test.describe('/terminal/layout', () => {
    test('page renders with empty-pane text and attached status', async ({ page }) => {
        await goto(page, '/terminal/layout');
        // No DOM <h1> — page title lives in document.title only.
        // The visible landmark is the empty-pane prompt and status label.
        await expect(
            page.getByText('Empty pane — connect a session').first(),
        ).toBeVisible();
        // Status label: "0 / 1 attached" (Typography, not a heading).
        await expect(page.getByText(/\d\s*\/\s*\d\s+attached/).first()).toBeVisible();
    });

    test('layout switcher opens and switching to v2 adds a second pane', async ({ page }) => {
        await goto(page, '/terminal/layout');
        // LayoutPickerMenu renders as an IconButton with tooltip "Choose layout".
        const picker = page.getByRole('button', { name: 'Choose layout' });
        await expect(picker).toBeVisible();
        await picker.click();
        // Menu item text comes from LAYOUT_LABELS.
        const v2Item = page.getByRole('menuitem', { name: 'Two — side by side' });
        await expect(v2Item).toBeVisible();
        await v2Item.click();
        // v2 = 2 panes; both should be empty, so two "Empty pane" tiles appear.
        await expect(
            page.getByText('Empty pane — connect a session'),
        ).toHaveCount(2);
        // Status label reflects 2 total panes.
        await expect(page.getByText(/0\s*\/\s*2\s+attached/).first()).toBeVisible();
    });

    test('?k=h2 URL param loads two-pane layout on first render', async ({ page }) => {
        await goto(page, '/terminal/layout?k=h2');
        // h2 = two vertically stacked panes, both empty.
        await expect(
            page.getByText('Empty pane — connect a session'),
        ).toHaveCount(2);
        // URL should retain ?k=h2 (state→URL sync keeps it).
        await expect(page).toHaveURL(/[?&]k=h2/);
    });
});
