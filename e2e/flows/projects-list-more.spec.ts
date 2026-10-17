import { test, expect, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProjectsByPrefix } from '../helpers/projects.js';

// /projects beyond projects-full.spec: page and rows in the URL (reload, Back,
// a shared link, junk values, a page past the end, a delete that empties the
// last page), the New project modal's keyboard and reset rules, duplicate and
// unusual names, the prefix probe failing, and the server refusing a create.
// Every project here has a K.. prefix and is deleted afterwards.

test.afterAll(async ({ request }) => deleteProjectsByPrefix(request, 'K'));

const card = (page: Page, name: string) => page.locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name, exact: true }) });
const cards = (page: Page) => page.locator('main .MuiPaper-root h2');
const total = () => Number(one('SELECT count(*) FROM projects'));

/** Enough K.. projects that the list has exactly `n` rows. */
async function fillTo(request: Parameters<typeof createProject>[0], n: number) {
    await deleteProjectsByPrefix(request, 'K');
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; total() < n; i++) await createProject(request, `Kiwi Filler ${String(i).padStart(2, '0')}`, `KF${letters[i]}`);
    expect(total()).toBe(n);
}

test.describe('/projects paging lives in the URL', () => {
    test.beforeAll(async ({ request }) => {
        await deleteProjectsByPrefix(request, 'K');
    });

    test('page 2 is in the URL; a reload and a shared link keep it; Rows changes the URL; Back skips the paging steps', async ({ page, context, request }) => {
        await fillTo(request, 24);
        await goto(page, '/tasks');
        await page.getByTestId('nav-item-projects').click();
        await expect(page).toHaveURL(/\/projects$/);
        await expect(page.getByText('Showing 1–20 of 24')).toBeVisible();

        await page.getByRole('button', { name: 'Go to page 2' }).click();
        await expect(page).toHaveURL(/\/projects\?page=2$/);
        await expect(page.getByText('Showing 21–24 of 24')).toBeVisible();
        await expect(cards(page)).toHaveCount(4);

        await page.reload();
        await expect(page.getByText('Showing 21–24 of 24')).toBeVisible();
        await expect(page.getByRole('button', { name: 'page 2' })).toHaveAttribute('aria-current', 'page');

        // Paging replaces the history entry: Back leaves /projects, Forward returns to page 2.
        await page.goBack();
        await expect(page).toHaveURL(/\/tasks$/);
        await page.goForward();
        await expect(page).toHaveURL(/\/projects\?page=2$/);
        await expect(page.getByText('Showing 21–24 of 24')).toBeVisible();

        // Rows: back to page 1, and the URL carries the size (20 is the default and is left out).
        await page.getByLabel('Rows').click();
        await page.getByRole('option', { name: '10', exact: true }).click();
        await expect(page).toHaveURL(/\/projects\?limit=10$/);
        await expect(page.getByText('Showing 1–10 of 24')).toBeVisible();
        await page.getByRole('button', { name: 'Go to page 3' }).click();
        await expect(page).toHaveURL(/\/projects\?limit=10&page=3$|\/projects\?page=3&limit=10$/);
        await expect(page.getByText('Showing 21–24 of 24')).toBeVisible();
        await page.getByLabel('Rows').click();
        await page.getByRole('option', { name: '20', exact: true }).click();
        await expect(page).toHaveURL(/\/projects$/);

        // A link someone shared opens on the same slice in a fresh tab.
        const other = await context.newPage();
        await goto(other, '/projects?page=2&limit=10');
        await expect(other.getByText('Showing 11–20 of 24')).toBeVisible();
        await expect(other.getByLabel('Rows')).toContainText('10');
        await expect(other.locator('main .MuiPaper-root h2')).toHaveCount(10);
        await other.close();
    });

    test('junk page / limit fall back to 1 / 20; a page past the end moves to the last page', async ({ page, request }) => {
        await fillTo(request, 24);
        await goto(page, '/projects?page=abc&limit=7');
        await expect(page.getByText('Showing 1–20 of 24')).toBeVisible();
        await goto(page, '/projects?page=-3');
        await expect(page.getByText('Showing 1–20 of 24')).toBeVisible();
        await goto(page, '/projects?page=1.9');
        await expect(page.getByText('Showing 1–20 of 24')).toBeVisible();

        await goto(page, '/projects?page=99');
        await expect(page).toHaveURL(/\/projects\?page=2$/);
        await expect(page.getByText('Showing 21–24 of 24')).toBeVisible();
        await goto(page, '/projects?page=99&limit=100');
        // One page holds everything: no footer, every project, and the page drops out of the URL.
        await expect(page).toHaveURL(/\/projects\?limit=100$/);
        await expect(cards(page)).toHaveCount(24);
        await expect(page.getByText(/^Showing /)).toHaveCount(0);
    });

    test('deleting the only project on the last page moves the list to the page before', async ({ page, request }) => {
        await fillTo(request, 22);
        const last = await createProject(request, 'Kestrel Last', 'KLS');
        // Oldest of all, so it sits alone on page 2 (newest first) — the seed project stays on page 1.
        sql(`UPDATE projects SET created_at = '2000-01-01' WHERE id = '${last.id}'`);
        await deleteProjectsByPrefix(request, 'KFA');
        await deleteProjectsByPrefix(request, 'KFB');
        expect(total()).toBe(21);

        await goto(page, '/projects?page=2');
        await expect(page.getByText('Showing 21–21 of 21')).toBeVisible();
        await expect(cards(page)).toHaveText(['Kestrel Last']);
        await card(page, 'Kestrel Last').getByRole('button', { name: 'Project actions' }).click();
        await page.getByRole('menuitem', { name: 'Delete project…' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Remove from Atlas' }).click();
        await expect(dialog.getByText('Project deleted', { exact: true })).toBeVisible({ timeout: 20_000 });
        // The footer's Close (the × is also named Close).
        await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

        await expect(page).toHaveURL(/\/projects$/);
        await expect(cards(page)).toHaveCount(20);
        await expect(page.getByText(/^Showing /)).toHaveCount(0);
        await expect(card(page, 'Kestrel Last')).toHaveCount(0);
        expect((await request.get(`${API}/api/projects/${last.id}`)).status()).toBe(404);
    });
});

test.describe('New project modal', () => {
    test.beforeAll(async ({ request }) => {
        await deleteProjectsByPrefix(request, 'K');
    });

    test('Enter in a field does not submit; Cancel and reopen start blank with the key following the name again', async ({ page }) => {
        const posts: string[] = [];
        page.on('request', (r) => {
            if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/projects') posts.push(r.url());
        });
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/^Name/).fill('Kookaburra');
        await expect(dialog.getByText('Available. New items will be KOO-1, KOO-2, …')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Create project' })).toBeEnabled();
        await dialog.getByLabel(/^Name/).press('Enter');
        await dialog.getByLabel(/Issue key prefix/).press('Enter');
        await expect(dialog).toBeVisible();
        expect(posts).toEqual([]);

        // Typed over, the key no longer follows the name.
        await dialog.getByLabel(/Issue key prefix/).fill('kzz9');
        await expect(dialog.getByLabel(/Issue key prefix/)).toHaveValue('KZZ');
        await dialog.getByLabel(/^Name/).fill('Kookaburra Two');
        await expect(dialog.getByLabel(/Issue key prefix/)).toHaveValue('KZZ');
        await dialog.getByLabel(/Description/).fill('should be gone after Cancel');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);

        await page.getByRole('button', { name: 'New Project' }).click();
        await expect(dialog.getByLabel(/^Name/)).toHaveValue('');
        await expect(dialog.getByLabel(/Issue key prefix/)).toHaveValue('');
        await expect(dialog.getByLabel(/Description/)).toHaveValue('');
        await expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled();
        await dialog.getByLabel(/^Name/).fill('Kea');
        await expect(dialog.getByLabel(/Issue key prefix/)).toHaveValue('KEA');
        // Close (×) resets too.
        await dialog.getByRole('button', { name: 'Close' }).click();
        await page.getByRole('button', { name: 'New Project' }).click();
        await expect(dialog.getByLabel(/^Name/)).toHaveValue('');
        await page.keyboard.press('Escape');
        expect(posts).toEqual([]);
        expect(one(`SELECT count(*) FROM projects WHERE name LIKE 'K%a%' AND issue_key_prefix IN ('KOO','KZZ','KEA')`)).toBe('0');
    });

    test('a short or non-letter key is refused locally; a failed probe still lets Create through, and a taken key 409s in the dialog', async ({ page, request }) => {
        await createProject(request, 'Kakapo Taken', 'KKT');
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/^Name/).fill('K1');
        await expect(dialog.getByLabel(/Issue key prefix/)).toHaveValue('K');
        await expect(dialog.getByText('Exactly 3 uppercase letters.')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled();

        // The availability probe is down: say so, and leave Create to the server.
        await page.route('**/api/projects/prefix-available**', (r) => r.fulfill({ status: 500, json: { error: 'probe down' } }));
        await page.route('**/api/projects/key-available**', (r) => r.fulfill({ status: 500, json: { error: 'probe down' } }));
        await dialog.getByLabel(/Issue key prefix/).fill('KKT');
        await expect(dialog.getByText("Couldn't check availability. Create still refuses a prefix that's taken.")).toBeVisible();
        await dialog.getByLabel(/^Name/).fill('Kakapo Again');
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await expect(dialog.getByRole('alert')).toContainText(/KKT|already|in use|taken/i);
        await expect(dialog).toBeVisible();
        expect(one(`SELECT count(*) FROM projects WHERE name = 'Kakapo Again'`)).toBe('0');
    });

    test('a server error on Create stays in the dialog with its message; the next Create works', async ({ page }) => {
        let fail = true;
        await page.route(/\/api\/projects$/, (r) =>
            r.request().method() === 'POST' && fail ? r.fulfill({ status: 500, json: { error: 'disk is full' } }) : r.continue(),
        );
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/^Name/).fill('Kingfisher');
        await expect(dialog.getByText('Available. New items will be KIN-1, KIN-2, …')).toBeVisible();
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await expect(dialog.getByRole('alert')).toContainText('disk is full');
        await expect(dialog.getByLabel(/^Name/)).toHaveValue('Kingfisher');
        fail = false;
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await expect(page).toHaveURL(/\/projects\/[^/?]+\?tab=repos$/);
        expect(one(`SELECT count(*) FROM projects WHERE name = 'Kingfisher'`)).toBe('1');
    });
});

test.describe('names', () => {
    test('two projects may share a name; each keeps its own key and page', async ({ page, request }) => {
        const a = await createProject(request, 'Koala Twin', 'KTA');
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(/^Name/).fill('Koala Twin');
        await dialog.getByLabel(/Issue key prefix/).fill('KTB');
        await expect(dialog.getByText('Available. New items will be KTB-1, KTB-2, …')).toBeVisible();
        await dialog.getByRole('button', { name: 'Create project' }).click();
        await expect(page).toHaveURL(/\/projects\/[^/?]+\?tab=repos$/);
        const b = /\/projects\/([^/?]+)/.exec(page.url())?.[1] ?? '';
        expect(b).not.toBe(a.id);
        expect(sql(`SELECT issue_key_prefix FROM projects WHERE name = 'Koala Twin' ORDER BY issue_key_prefix`).flat()).toEqual(['KTA', 'KTB']);

        await page.getByTestId('nav-item-projects').click();
        await expect(card(page, 'Koala Twin')).toHaveCount(2);
        // Renaming one to the other's name is allowed too.
        const c = await createProject(request, 'Koala Third', 'KTC');
        const res = await request.patch(`${API}/api/projects/${c.id}`, { data: { name: 'Koala Twin' } });
        expect(res.status(), await res.text()).toBeLessThan(300);
        expect((await apiGet<{ name: string }>(request, `/api/projects/${c.id}`)).name).toBe('Koala Twin');
    });

    test('special characters and a very long name round-trip and stay inside their card at 390px', async ({ page, request }) => {
        const special = `Kiwi <b>&amp;</b> "quotes" 'n' émoji 🐦 / \\ % _`;
        const long = `Kiwi ${'longname'.repeat(20)}`;
        const s = await createProject(request, special, 'KSP');
        const l = await createProject(request, long, 'KLN');
        expect((await apiGet<{ name: string }>(request, `/api/projects/${s.id}`)).name).toBe(special);

        await goto(page, `/projects/${s.id}`);
        // Rendered as text, never as markup.
        await expect(page.getByRole('heading', { level: 1, name: special })).toBeVisible();
        await expect(page.locator('main b')).toHaveCount(0);

        await page.setViewportSize({ width: 390, height: 844 });
        await goto(page, `/projects/${l.id}`);
        await expect(page.getByRole('heading', { level: 1 })).toContainText('longnamelongname');
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(sideways).toBe(0);
        await goto(page, '/projects');
        await expect(card(page, long)).toBeVisible();
        const box = await card(page, long).boundingBox();
        expect(box && box.x + box.width).toBeLessThanOrEqual(390);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });

    test('the API refuses a malformed key with 400 and stores nothing', async ({ request }) => {
        const bad = await request.post(`${API}/api/projects`, { data: { name: 'Kiwi bad key', issue_key_prefix: 'k1' } });
        expect(bad.status()).toBe(400);
        expect(one(`SELECT count(*) FROM projects WHERE name = 'Kiwi bad key'`)).toBe('0');
    });
});
