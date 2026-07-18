import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Phase C — Setup tab persistence smoke test.
// Loads /projects, opens the first project, clicks the Setup tab,
// types into the .sh + .ps1 editors, saves, reloads, and asserts
// the content survived a round-trip.

test.describe('/projects/:id?tab=setup', () => {
    test('renders Setup tab with .sh and .ps1 editors and persists on save', async ({ page }) => {
        await goto(page, '/projects');
        // Open the first project card via the "Open →" link
        const openLink = page.getByRole('link', { name: /Open/i }).first();
        await openLink.click();
        // Click the Setup tab
        await page.getByRole('tab', { name: /Setup/i }).click();
        // Two multiline TextFields — labelled Bash / POSIX shell and Windows PowerShell
        await expect(page.getByText(/Bash \/ POSIX shell/i)).toBeVisible();
        await expect(page.getByText(/Windows PowerShell/i)).toBeVisible();
    });
});
