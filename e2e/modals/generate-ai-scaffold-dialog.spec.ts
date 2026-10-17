import { test, expect } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { projectAction } from '../helpers/projects.js';

// GenerateAiScaffoldDialog opens from Project actions → "Generate AI scaffold…"
// (it used to be looked for on the Setup tab, where it no longer lives, and
// the old spec skipped itself). The seed project's one repo is ready, so the
// item is enabled. We never submit here — e2e/flows/project-repos-github.spec.ts
// runs a real Generate against the fake GitHub.

test.describe('GenerateAiScaffoldDialog', () => {
    test('opens from Project actions, names the repo and path it will analyse, and Cancel / Escape close it', async ({ page }) => {
        await goto(page, '/projects/e2e-terminal-project');
        await projectAction(page, /Generate AI scaffold…/);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Generate AI scaffold', { exact: true })).toBeVisible();
        await expect(dialog).toContainText(/Atlas will analyze project at .*atlas-e2e-fixtures\/project, detect its stack/);
        await expect(dialog).toContainText('Files that already exist on main will be skipped.');
        await expect(dialog.getByRole('button', { name: 'Generate' })).toBeEnabled();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);

        await projectAction(page, /Generate AI scaffold…/);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });

    test('Generate on a repo with no credential toasts the refusal and starts nothing', async ({ page }) => {
        await goto(page, '/projects/e2e-terminal-project');
        await projectAction(page, /Generate AI scaffold…/);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Generate' }).click();
        await expect(page.getByText('Generate AI scaffold failed')).toBeVisible();
        await expect(page.getByText(/Repo has no credential attached/)).toBeVisible();
        await expect(page).toHaveURL(/\/projects\/e2e-terminal-project$/);
    });
});
