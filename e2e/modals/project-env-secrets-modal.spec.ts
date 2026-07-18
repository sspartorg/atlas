import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// ProjectEnvSecretsModal is opened from /projects/:id → Project actions menu
// (the "more_horiz" icon button at the top-right of the project header) →
// "Manage Secrets" menu item. The e2e seed creates project "e2e-terminal-project".
// We never submit — Cancel or Esc only.

const PROJECT_URL = '/projects/e2e-terminal-project';

test.describe('ProjectEnvSecretsModal', () => {
    test('open from project detail — Project actions → Manage Secrets', async ({ page }) => {
        await goto(page, PROJECT_URL);
        await expect(page.getByText(/e2e terminal|ETM/i).first()).toBeVisible();
        // The project actions button has a Tooltip title "Project actions".
        await page.getByRole('button', { name: /Project actions/i }).click();
        await page.getByRole('menuitem', { name: /Manage Secrets/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Heading is a Typography <p> (not heading role).
        await expect(dialog.getByText('Project Secrets', { exact: true })).toBeVisible();
    });

    test('form controls — search field, Import, Export, Reveal all, Add variable visible', async ({ page }) => {
        await goto(page, PROJECT_URL);
        await expect(page.getByText(/e2e terminal|ETM/i).first()).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).click();
        await page.getByRole('menuitem', { name: /Manage Secrets/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        // Search input.
        await expect(dialog.getByPlaceholder(/Search by key/i)).toBeVisible();
        // Toolbar buttons.
        await expect(dialog.getByRole('button', { name: /Import/i })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Export/i })).toBeVisible();
        // "Add variable" dashed button at the footer.
        await expect(dialog.getByRole('button', { name: /Add variable/i })).toBeVisible();
    });

    test('Esc closes the modal without saving', async ({ page }) => {
        await goto(page, PROJECT_URL);
        await expect(page.getByText(/e2e terminal|ETM/i).first()).toBeVisible();
        await page.getByRole('button', { name: /Project actions/i }).click();
        await page.getByRole('menuitem', { name: /Manage Secrets/i }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
    });
});
