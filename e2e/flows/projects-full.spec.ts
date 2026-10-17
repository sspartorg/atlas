import { test, expect, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProjectsByPrefix, insertRepo, projectAction } from '../helpers/projects.js';

// /projects against the real API: create through the New project modal (the
// list follows without a reload), Cards ↔ Table, the queue chips and their
// counts, paging past 20, the empty and failed-load states, and on Project
// Detail: Rename (persisted), Delete in unregister mode (lands on /projects,
// the project is gone) and the AI-scaffold item's disabled reason with no repo.
// Every project here has a Q.. prefix and is deleted afterwards.

test.afterAll(async ({ request }) => deleteProjectsByPrefix(request, 'Q'));

const card = (page: Page, name: string) => page.locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name, exact: true }) });
const pill = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });

test.describe('/projects list', () => {
    test('New project creates it end to end: key probe, Create, lands on Repos, the list shows it without a reload', async ({ page, request }) => {
        await goto(page, '/projects');
        const before = Number(one('SELECT count(*) FROM projects'));
        await expect(page.locator('main header')).toContainText(`${before} project${before === 1 ? '' : 's'} ·`);

        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('New project', { exact: true })).toBeVisible();
        await dialog.getByLabel(/^Name/).fill('Quokka Web');
        // The key follows the name until it is typed over.
        await expect(dialog.getByLabel(/Issue key prefix/)).toHaveValue('QUO');
        await expect(dialog.getByText('Available. New items will be QUO-1, QUO-2, …')).toBeVisible();
        await dialog.getByLabel(/Description/).fill('Made by projects-full.spec');
        await dialog.getByRole('button', { name: 'Create project' }).click();

        await expect(page).toHaveURL(/\/projects\/[^/?]+\?tab=repos$/);
        await expect(page.getByRole('tab', { name: /Repos/ })).toHaveAttribute('aria-selected', 'true');
        const id = /\/projects\/([^/?]+)/.exec(page.url())?.[1] ?? '';
        expect(one(`SELECT name || '|' || issue_key_prefix || '|' || description FROM projects WHERE id = '${id}'`)).toBe('Quokka Web|QUO|Made by projects-full.spec');

        // Back through the sidenav (client-side), not a reload.
        await page.getByTestId('nav-item-projects').click();
        await expect(card(page, 'Quokka Web')).toBeVisible();
        await expect(card(page, 'Quokka Web')).toContainText('QUO');
        await expect(card(page, 'Quokka Web')).toContainText('No repos');
        await expect(page.locator('main header')).toContainText(`${before + 1} projects ·`);

        // A taken key is refused before Create.
        await page.getByRole('button', { name: 'New Project' }).click();
        await dialog.getByLabel(/^Name/).fill('Quokka Again');
        await expect(dialog.getByText('Already used by "Quokka Web"')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Create project' })).toBeDisabled();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        expect((await apiGet<Array<{ name: string }>>(request, '/api/projects')).filter((p) => p.name === 'Quokka Again')).toHaveLength(0);
    });

    test('Cards ↔ Table shows the same projects; Table rows open the project; the toggle resets on reload', async ({ page, request }) => {
        await createProject(request, 'Quill Docs', 'QDC');
        await goto(page, '/projects');
        await expect(page.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
        const names = sql('SELECT name FROM projects ORDER BY name').map((r) => r[0]);
        for (const n of names) await expect(card(page, n ?? '')).toBeVisible();

        await page.getByRole('button', { name: 'Table' }).click();
        await expect(page.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
        const table = page.getByRole('table');
        for (const h of ['ID', 'Project', 'Repos', 'Tasks', 'Sub-tasks', 'Last Activity', 'Owner']) {
            await expect(table.getByRole('columnheader', { name: h, exact: true })).toBeVisible();
        }
        await expect(table.getByRole('row')).toHaveCount(names.length + 1);
        const row = table.getByRole('row').filter({ hasText: 'Quill Docs' });
        await expect(row).toContainText('QDC');
        // The card says "No repos"; the table cell is a dash.
        await expect(row.locator('td').nth(2)).toHaveText('—');
        // Sorting by Project puts the names in order.
        await table.getByRole('columnheader', { name: 'Project', exact: true }).getByRole('button').click();
        const firstCells = await table.getByRole('row').locator('td:nth-child(2)').allInnerTexts();
        expect(firstCells.map((t) => t.trim())).toEqual([...firstCells.map((t) => t.trim())].sort((a, b) => a.localeCompare(b)));
        await row.click();
        await expect(page).toHaveURL(/\/projects\/[^/?]+$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Quill Docs' })).toBeVisible();

        await goto(page, '/projects');
        await expect(page.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('queue chips count every project and filter to the ones with a Task on an agent of that category', async ({ page, request }) => {
        const p = await createProject(request, 'Quasar Ops', 'QSR');
        insertRepo(p.id, { id: `${p.id}-r`, name: 'ops', git_path: '/tmp/atlas-e2e-quasar' });
        const agent = one(`SELECT id || '|' || category FROM agents ORDER BY created_at LIMIT 1`).split('|');
        const task = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: p.id, title: 'Quasar task on an agent' });
        await request.patch(`${API}/api/tasks/${task.id}/assign`, { data: { assignee_agent_id: agent[0] } });
        const category = agent[1] ?? '';
        const label = ({ 'software-dev': 'Software dev queue', marketing: 'Marketing queue', content: 'Content queue', design: 'Design queue' } as Record<string, string>)[category] ?? '';
        const total = Number(one('SELECT count(*) FROM projects'));
        const inCategory = Number(
            one(`SELECT count(DISTINCT i.project_id) FROM items_live i JOIN agents a ON a.id = i.assignee_agent_id WHERE i.type = 'task' AND a.category = '${category}'`),
        );

        await goto(page, '/projects');
        await expect(pill(page, 'All')).toContainText(String(total));
        await expect(pill(page, 'My queue')).toContainText(String(total));
        await expect(pill(page, label)).toContainText(String(inCategory));
        for (const other of ['Software dev queue', 'Marketing queue', 'Content queue', 'Design queue'].filter((l) => l !== label)) {
            await expect(pill(page, other)).toContainText('0');
        }

        await pill(page, label).click();
        await expect(page.locator('main .MuiPaper-root h2')).toHaveCount(inCategory);
        await expect(card(page, 'Quasar Ops')).toBeVisible();
        await expect(card(page, 'Quasar Ops')).toContainText(/1\s*tasks/);

        // A category nobody works on is empty, and says so.
        const empty = ['Software dev queue', 'Marketing queue', 'Content queue', 'Design queue'].find((l) => l !== label) ?? '';
        await pill(page, empty).click();
        await expect(page.getByText('No projects match this filter.')).toBeVisible();
        // Keyboard: Enter selects a chip.
        await pill(page, 'All').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('main .MuiPaper-root h2')).toHaveCount(total);
    });

    test('paging: past 20 projects the footer says the range, pages, and changes the page size', async ({ page, request }) => {
        const existing = Number(one('SELECT count(*) FROM projects'));
        for (let i = 0; existing + i < 23; i++) await createProject(request, `Queue Filler ${String(i).padStart(2, '0')}`, `QF${String.fromCharCode(65 + i)}`);
        const total = Number(one('SELECT count(*) FROM projects'));
        expect(total).toBeGreaterThan(20);

        const pages: string[] = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/projects/paged')) pages.push(new URL(r.url()).search);
        });
        await goto(page, '/projects');
        await expect(page.getByText(`Showing 1–20 of ${total}`)).toBeVisible();
        await expect(page.locator('main .MuiPaper-root h2')).toHaveCount(20);
        await page.getByRole('button', { name: 'Go to page 2' }).click();
        await expect(page.getByText(`Showing 21–${total} of ${total}`)).toBeVisible();
        await expect(page.locator('main .MuiPaper-root h2')).toHaveCount(total - 20);
        expect(pages).toContain('?page=2&limit=20');

        await page.getByLabel('Rows').click();
        await page.getByRole('option', { name: '50' }).click();
        await expect(page.getByText(/^Showing /)).toHaveCount(0);
        await expect(page.locator('main .MuiPaper-root h2')).toHaveCount(total);
        expect(pages).toContain('?page=1&limit=50');
        // Every project once, newest page first: the union of the pages is the table.
        const shown = await page.locator('main .MuiPaper-root h2').allInnerTexts();
        expect(new Set(shown).size).toBe(total);
        await deleteProjectsByPrefix(request, 'QF');
    });

    test('a failed load says so with Retry instead of "No projects yet."; Retry recovers', async ({ page }) => {
        let fail = true;
        await page.route('**/api/projects/paged**', (r) => (fail ? r.fulfill({ status: 500, json: { error: 'database is down' } }) : r.continue()));
        await goto(page, '/projects', { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Could not load projects — Something went wrong')).toBeVisible();
        await expect(page.getByText(/database is down/)).toBeVisible();
        await expect(page.getByText('No projects yet.')).toHaveCount(0);
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
        await expect(card(page, 'E2E Terminal')).toBeVisible();
    });

    test('no projects at all → the empty hero, whose New Project opens the modal', async ({ page }) => {
        await page.route('**/api/projects/paged**', (r) => r.fulfill({ json: { rows: [], total: 0, page: 1, limit: 20 } }));
        await page.route(/\/api\/projects$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue()));
        await goto(page, '/projects');
        await expect(page.getByText('No projects yet.')).toBeVisible();
        await expect(page.getByText('Add your first project')).toBeVisible();
        await page.getByRole('button', { name: 'New Project' }).click();
        await expect(page.getByRole('dialog').getByText('New project', { exact: true })).toBeVisible();
    });
});

test.describe('/projects/:id header actions', () => {
    test('Rename saves, shows the new name, and survives a reload', async ({ page, request }) => {
        const p = await createProject(request, 'Quarry Old', 'QRN');
        await goto(page, `/projects/${p.id}`);
        await projectAction(page, 'Rename project…');
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Rename project')).toBeVisible();
        const field = dialog.getByLabel('Project name');
        await expect(field).toHaveValue('Quarry Old');
        await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
        await field.fill('Quarry New');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Renamed to Quarry New')).toBeVisible();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 1, name: 'Quarry New' })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: 'Quarry New' })).toBeVisible();
        expect((await apiGet<{ name: string }>(request, `/api/projects/${p.id}`)).name).toBe('Quarry New');

        // Enter saves too; a blank name cannot.
        await projectAction(page, 'Rename project…');
        await field.fill('   ');
        await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
        await field.fill('Quarry Final');
        await field.press('Enter');
        await expect(page.getByRole('heading', { level: 1, name: 'Quarry Final' })).toBeVisible();
    });

    test('Generate AI scaffold is disabled with its reason while the project has no repo', async ({ page, request }) => {
        const p = await createProject(request, 'Quiet Empty', 'QNR');
        await goto(page, `/projects/${p.id}`);
        await page.getByRole('button', { name: 'Project actions' }).click();
        const item = page.getByRole('menuitem', { name: /Generate AI scaffold…/ });
        await expect(item).toHaveAttribute('aria-disabled', 'true');
        await expect(item).toContainText('Needs a cloned repo first');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toHaveCount(0);
    });

    test('Delete in "Remove from Atlas only" mode wipes the project and lands on /projects without it', async ({ page, request }) => {
        const p = await createProject(request, 'Quench Gone', 'QDL');
        insertRepo(p.id, { id: `${p.id}-r`, name: 'gone', git_path: '/tmp/atlas-e2e-quench-gone' });
        await apiPost(request, '/api/tasks', { project_id: p.id, title: 'Task that goes with it' });
        await goto(page, `/projects/${p.id}`);
        await projectAction(page, 'Delete project…');
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Delete project?', { exact: true })).toBeVisible();
        await expect(dialog.getByText('/tmp/atlas-e2e-quench-gone')).toBeVisible();
        await dialog.getByRole('button', { name: 'Remove from Atlas' }).click();
        await expect(dialog.getByText('Project deleted', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(dialog.getByText('Unregistered from Atlas. Workspace folder kept on disk.')).toBeVisible();
        await dialog.getByRole('button', { name: /Back to projects/ }).click();
        await expect(page).toHaveURL(/\/projects$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
        await expect(card(page, 'Quench Gone')).toHaveCount(0);
        expect(one(`SELECT count(*) FROM projects WHERE id = '${p.id}'`)).toBe('0');
        expect(one(`SELECT count(*) FROM items WHERE project_id = '${p.id}'`)).toBe('0');
        expect((await request.get(`${API}/api/projects/${p.id}`)).status()).toBe(404);
    });
});
