import { test, expect } from '@playwright/test';
import { API, apiGet } from '../helpers/api.js';
import { goto } from '../helpers/nav.js';
import { noHorizontalOverflow } from '../helpers/layout.js';

// Setup tab: the project's repos as a list, each opening its .sh + .ps1 in a
// dialog. Edits survive a reload; an unsaved edit is never dropped silently.

const PROJECT = 'e2e-terminal-project';
interface Repo {
    id: string;
    name: string;
    setup_sh_body: string;
    setup_ps1_body: string;
}

test.describe('/projects/:id?tab=setup', () => {
    let repo: Repo;
    test.beforeEach(async ({ request }) => {
        const repos = await apiGet<Repo[]>(request, `/api/projects/${PROJECT}/repos`);
        expect(repos.length).toBeGreaterThan(0);
        repo = repos[0]!;
    });
    // Leave the seed as found for later specs.
    test.afterEach(async ({ request }) => {
        await request.patch(`${API}/api/projects/${PROJECT}/repos/${repo.id}`, {
            data: { setup_sh_body: repo.setup_sh_body, setup_ps1_body: repo.setup_ps1_body },
        });
    });

    test('lists repos, edits one in the dialog, and the scripts persist across a reload', async ({ page }) => {
        await goto(page, `/projects/${PROJECT}?tab=setup`);
        const row = page.getByRole('button', { name: `Edit setup scripts for ${repo.name}` });
        await expect(row).toBeVisible();
        await expect(page.getByLabel('Bash setup script')).toHaveCount(0);

        await row.click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Bash setup script').fill('echo one\necho two');
        await dialog.getByLabel('PowerShell setup script').fill('Write-Host one');
        await dialog.getByRole('button', { name: 'Save scripts' }).click();
        await expect(page.getByText(`Setup scripts saved for ${repo.name}`)).toBeVisible();
        await expect(dialog).toBeHidden();
        await expect(row).toContainText('.sh · 2 lines');
        await expect(row).toContainText('.ps1 · 1 line');

        await page.reload();
        await row.click();
        await expect(dialog.getByLabel('Bash setup script')).toHaveValue('echo one\necho two');
        await expect(dialog.getByLabel('PowerShell setup script')).toHaveValue('Write-Host one');
    });

    test('closing with unsaved edits asks; Discard leaves the stored scripts untouched', async ({ page, request }) => {
        await goto(page, `/projects/${PROJECT}?tab=setup`);
        await page.getByRole('button', { name: `Edit setup scripts for ${repo.name}` }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Bash setup script').fill('not saved');
        await page.keyboard.press('Escape');
        await expect(dialog.getByText('Discard your unsaved changes?')).toBeVisible();
        await dialog.getByRole('button', { name: 'Keep editing' }).click();
        await expect(dialog.getByLabel('Bash setup script')).toHaveValue('not saved');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await dialog.getByRole('button', { name: 'Discard' }).click();
        await expect(dialog).toBeHidden();
        const [after] = await apiGet<Repo[]>(request, `/api/projects/${PROJECT}/repos`);
        expect(after!.setup_sh_body).toBe(repo.setup_sh_body);
    });
});

test.describe('/projects/:id?tab=setup @mobile', () => {
    test('the list and a full-screen dialog fit a phone', async ({ page }) => {
        await goto(page, `/projects/${PROJECT}?tab=setup`);
        await noHorizontalOverflow(page);
        await page.getByRole('button', { name: /Edit setup scripts for/ }).first().click();
        await expect(page.getByLabel('Bash setup script')).toBeVisible();
        await noHorizontalOverflow(page);
    });
});
