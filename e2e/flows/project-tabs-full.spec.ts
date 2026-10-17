import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, gitFixture, insertRepo, pushUpstream } from '../helpers/projects.js';

// Every Project Detail tab against the real API, on a project of its own
// (prefix XTB) with a real git clone whose origin is a local bare repo:
// Overview tiles = SQL, Tasks lists the project's Tasks, Guard-rails rules and
// scripts round-trip (and a rule id 404s under another project), Repos edit /
// auto-fetch / Pull from remote (clean, behind, dirty, and a failing pull that
// leaves a `reclone_failed` notification), History pages its runs, and a
// failed load on each data tab says so with Retry.

let projectId = '';
let credId = '';
let git = { origin: '', clone: '' };
const NAME = 'Xenon Tabs';
const REPO = 'xenon';
const RUNS = 55;

const STATUSES = ['draft', 'ready', 'ready', 'in_progress', 'in_review', 'waiting_for_info', 'done'] as const;

test.beforeAll(async ({ request }) => {
    // A failed test restarts the worker and re-runs this: start from nothing.
    await cleanup(request);
    const cred = await apiPost<{ id: string }>(request, '/api/credentials', { label: 'e2e-pat-tabs', kind: 'pat', token: 'ghp_e2eFAKEtoken0000000077' });
    credId = cred.id;
    const p = await createProject(request, NAME, 'XTB', 'Project Detail tabs fixture');
    projectId = p.id;
    git = gitFixture('tabs');
    insertRepo(projectId, { id: `${projectId}-x`, name: REPO, git_path: git.clone, git_url: git.origin, credential_id: credId });
    for (const [i, s] of STATUSES.entries()) {
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: `Xenon task ${i + 1} (${s})` });
        sql(`UPDATE items SET status = '${s}' WHERE id = '${t.id}'`);
    }
    const agent = one('SELECT id FROM agents ORDER BY created_at LIMIT 1');
    const first = one(`SELECT id FROM items WHERE project_id = '${projectId}' ORDER BY id LIMIT 1`);
    sql(
        `INSERT INTO agent_runs (id, agent_id, item_id, status, total_cost_usd, input_tokens, output_tokens, started_at, completed_at, created_at)
         SELECT 'xtb-run-' || g, '${agent}', '${first}', 'completed', 0.10, 100, 50, now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval
         FROM generate_series(1, ${RUNS}) g`,
    );
});

async function cleanup(request: APIRequestContext) {
    sql(`DELETE FROM agent_runs WHERE id LIKE 'xtb-run-%'`);
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'XTB'`)) {
        sql(`DELETE FROM notifications WHERE project_id = '${id}'`);
        await deleteProject(request, id ?? '');
    }
    for (const [id] of sql(`SELECT id FROM credentials WHERE label = 'e2e-pat-tabs'`)) await request.delete(`${API}/api/credentials/${id}`);
}

test.afterAll(async ({ request }) => cleanup(request));

const tile = (page: Page, label: string | RegExp) => page.locator('.MuiPaper-root').filter({ has: page.getByTitle(label) });
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();

async function openTab(page: Page, key: string) {
    await goto(page, `/projects/${projectId}?tab=${key}`);
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
}

test.describe('Overview + Tasks', () => {
    test('the three tiles equal the database; Recent activity lists the newest 5 runs and links to History', async ({ page }) => {
        const n = (where: string) => one(`SELECT count(*) FROM items_live WHERE project_id = '${projectId}' AND type = 'task' AND ${where}`);
        const open = n(`status <> 'done'`);
        const ready = n(`status = 'ready'`);
        const inFlight = n(`status IN ('in_progress', 'in_review')`);
        const waiting = n(`status = 'waiting_for_info'`);
        const cost = Number(one(`SELECT sum(total_cost_usd) FROM agent_runs r JOIN items i ON i.id = r.item_id WHERE i.project_id = '${projectId}' AND r.status = 'completed'`));

        await openTab(page, 'overview');
        await expect(tab(page, /Overview/)).toHaveAttribute('aria-selected', 'true');
        await expect(tile(page, 'Open tasks')).toContainText(open);
        await expect(tile(page, 'Open tasks')).toContainText(`${ready} awaiting pickup`);
        await expect(tile(page, 'Tasks in flight')).toContainText(inFlight);
        await expect(tile(page, 'Tasks in flight')).toContainText(`${waiting} waiting info`);
        const month = new Date().toLocaleString('default', { month: 'long' });
        const cost$ = tile(page, `AI Cost (${month})`);
        await expect(cost$).toContainText(`$${cost.toFixed(2)}`);
        await expect(cost$.getByTitle(new RegExp(`this month: ${RUNS} runs · 0 sessions · `))).toBeVisible();

        // Recent activity is the only list on Overview: the newest five runs.
        await expect(page.getByText('Recent activity', { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'View run' })).toHaveCount(5);
        await expect(page.getByRole('link', { name: 'View run' }).first()).toHaveAttribute('href', /\/agents\/[^/]+\/runs\/xtb-run-1$/);
        await page.getByText('Full history →').click();
        await expect(page).toHaveURL(/tab=history/);
    });

    test('the Tasks tab lists exactly this project\'s Tasks and opens /tasks scoped to it', async ({ page }) => {
        const ids = sql(`SELECT id, title FROM items_live WHERE project_id = '${projectId}' AND type = 'task' ORDER BY id`);
        await openTab(page, 'tasks');
        await expect(tab(page, new RegExp(`Tasks\\s+${ids.length}`))).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText(`Showing ${ids.length} tasks in this project`)).toBeVisible();
        for (const [id, title] of ids) {
            const row = page.getByRole('button', { name: new RegExp(id ?? '') });
            await expect(row).toContainText(title ?? '');
        }
        await expect(page.getByText('E2E linked task')).toHaveCount(0);
        await page.getByRole('link', { name: 'Open in Tasks' }).click();
        await expect(page).toHaveURL(`/tasks?project=${encodeURIComponent(NAME)}`);
        await expect(page.locator('main header')).toContainText(`${ids.length} tasks · ${NAME}`);
    });

    test('a failed overview, tasks or history load says so with Retry, and Retry recovers', async ({ page }) => {
        const cases = [
            { tab: 'overview', url: `**/api/counts/project/${projectId}`, text: 'Could not load the overview', then: () => expect(tile(page, 'Open tasks')).toBeVisible() },
            { tab: 'tasks', url: '**/api/issues/tree**', text: 'Could not load tasks', then: () => expect(page.getByText(/Showing \d+ tasks in this project/)).toBeVisible() },
            { tab: 'history', url: '**/api/run?project_id=**', text: 'Could not load agent activity', then: () => expect(page.getByText('Agent activity')).toBeVisible() },
        ];
        for (const c of cases) {
            let fail = true;
            await page.route(c.url, (r) => (fail ? r.fulfill({ status: 500, json: { error: `${c.tab} exploded` } }) : r.continue()));
            await goto(page, `/projects/${projectId}?tab=${c.tab}`, { allow: [/500|Internal Server Error/] });
            await expect(page.getByText(`${c.text} — Something went wrong`)).toBeVisible();
            fail = false;
            await page.getByRole('button', { name: 'Retry' }).first().click();
            await c.then();
            await page.unroute(c.url);
        }
    });
});

test.describe('Guard-rails tab', () => {
    const rules = (request: APIRequestContext) => apiGet<Array<{ id: string; title: string; body_md: string; enabled: number }>>(request, `/api/projects/${projectId}/guardrails`);

    test('a rule is added, edited, paused (persisted) and deleted after a confirm; another project cannot touch it', async ({ page, request }) => {
        await openTab(page, 'guardrails');
        await expect(page.getByText('No guard-rails yet for this project')).toBeVisible();
        await page.getByRole('button', { name: 'Add rule' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Add guard-rail' });
        await dialog.getByLabel('Title').fill('No force pushes');
        await expect(dialog.getByRole('button', { name: 'Add rule' })).toBeDisabled();
        await dialog.getByLabel('Rule').fill('Never run git push --force on shared branches.');
        await dialog.getByRole('button', { name: 'Add rule' }).click();
        await expect(toast(page, 'Added guard-rail — No force pushes')).toBeVisible();
        await expect(page.getByRole('tab', { name: /Rules\s+1/ })).toBeVisible();
        await expect(page.getByText('Never run git push --force on shared branches.')).toBeVisible();
        const [rule] = await rules(request);
        expect(rule).toMatchObject({ title: 'No force pushes', enabled: 1 });

        // Another project's URL never reaches this rule.
        for (const [method, path] of [
            ['patch', `/api/projects/e2e-terminal-project/guardrails/${rule?.id}/toggle`],
            ['patch', `/api/projects/e2e-terminal-project/guardrails/${rule?.id}`],
            ['delete', `/api/projects/e2e-terminal-project/guardrails/${rule?.id}`],
        ] as const) {
            const res = await request[method](`${API}${path}`, { data: method === 'patch' ? { enabled: 0, title: 'hijack' } : undefined });
            expect(res.status(), `${method} ${path}`).toBe(404);
        }
        expect((await rules(request))[0]).toMatchObject({ title: 'No force pushes', enabled: 1 });

        await page.getByRole('button', { name: 'Edit No force pushes' }).click();
        const edit = page.getByRole('dialog', { name: 'Edit guard-rail' });
        await expect(edit.getByLabel('Title')).toHaveValue('No force pushes');
        await edit.getByLabel('Title').fill('No force pushes, ever');
        await edit.getByRole('button', { name: 'Save changes' }).click();
        await expect(toast(page, 'Updated guard-rail — No force pushes, ever')).toBeVisible();

        await page.getByRole('switch', { name: 'Pause No force pushes, ever' }).click();
        await expect(page.getByText('Paused', { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('switch', { name: 'Resume No force pushes, ever' })).not.toBeChecked();
        expect((await rules(request))[0]).toMatchObject({ title: 'No force pushes, ever', enabled: 0 });
        await expect(page.getByText(/· 0\s*active/)).toBeVisible();

        await page.getByRole('button', { name: 'Delete No force pushes, ever' }).click();
        const confirm = page.getByRole('dialog', { name: 'Delete this rule?' });
        await expect(confirm).toContainText('Removes "No force pushes, ever" from this project.');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        expect(await rules(request)).toHaveLength(1);
        await page.getByRole('button', { name: 'Delete No force pushes, ever' }).click();
        await confirm.getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Deleted guard-rail — No force pushes, ever')).toBeVisible();
        await expect(page.getByText('No guard-rails yet for this project')).toBeVisible();
        expect(await rules(request)).toHaveLength(0);
    });

    test('a project script is added, edited and deleted after a confirm', async ({ page, request }) => {
        const scripts = () => apiGet<Array<{ id: string; name: string }>>(request, `/api/projects/${projectId}/guardrail-scripts`);
        await openTab(page, 'guardrails');
        await page.getByRole('tab', { name: /Scripts\s+0/ }).click();
        await expect(page.getByText('No project scripts yet')).toBeVisible();
        await page.getByRole('button', { name: 'Add script', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Add script' });
        await dialog.getByLabel('Slug (id)').fill('xenon-lint');
        await dialog.getByLabel('Name').fill('Xenon lint');
        await dialog.getByLabel('Description (optional)').fill('Lints the xenon repo');
        await dialog.getByLabel('.sh body (POSIX)').fill('#!/usr/bin/env bash\nexit 0\n');
        await dialog.getByLabel('.ps1 body (Windows PowerShell)').fill('exit 0\n');
        await dialog.getByRole('button', { name: 'Add script' }).click();
        await expect(toast(page, 'Project script added')).toBeVisible();
        await expect(page.getByRole('tab', { name: /Scripts\s+1/ })).toBeVisible();
        await expect(page.getByText('check-xenon-lint.sh')).toBeVisible();
        expect(await scripts()).toEqual([expect.objectContaining({ id: 'xenon-lint', name: 'Xenon lint' })]);

        await page.getByRole('button', { name: /Xenon lint/ }).click();
        const edit = page.getByRole('dialog', { name: 'Edit script' });
        await expect(edit.getByLabel('Slug (id)')).toBeDisabled();
        await edit.getByLabel('Name').fill('Xenon lint v2');
        await edit.getByRole('button', { name: 'Save changes' }).click();
        await expect(toast(page, 'Project script updated')).toBeVisible();
        expect((await scripts())[0]?.name).toBe('Xenon lint v2');

        await page.getByRole('button', { name: /Xenon lint v2/ }).click();
        await edit.getByRole('button', { name: 'Delete' }).click();
        const confirm = page.getByRole('dialog', { name: 'Delete this script?' });
        await expect(confirm).toContainText('Removes "Xenon lint v2".');
        await confirm.getByRole('button', { name: 'Delete' }).click();
        await expect(toast(page, 'Project script deleted')).toBeVisible();
        await expect(page.getByText('No project scripts yet')).toBeVisible();
        expect(await scripts()).toEqual([]);
    });

    test('a failed rules load says so with Retry', async ({ page }) => {
        let fail = true;
        await page.route(`**/api/projects/${projectId}/guardrails`, (r) => (fail ? r.fulfill({ status: 500, json: { error: 'rules exploded' } }) : r.continue()));
        await goto(page, `/projects/${projectId}?tab=guardrails`, { allow: [/500|Internal Server Error/] });
        await expect(page.getByText("Could not load this project's rules — Something went wrong")).toBeVisible();
        await expect(page.getByText('No guard-rails yet for this project')).toHaveCount(0);
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByText('No guard-rails yet for this project')).toBeVisible();
    });
});

test.describe('Repos tab', () => {
    const repoUrl = () => `/api/projects/${projectId}/repos/${projectId}-x`;
    const menu = async (page: Page, name: string, item: RegExp) => {
        await page.getByRole('button', { name: `Actions for ${name}` }).click();
        await page.getByRole('menuitem', { name: item }).click();
    };

    test('Edit saves the default branch; it survives a reload and the API reads it back', async ({ page, request }) => {
        await openTab(page, 'repos');
        const row = page.getByTestId(`repo-row-${REPO}`);
        await expect(row).toContainText('main');
        await menu(page, REPO, /^Edit$/);
        const dialog = page.getByRole('dialog', { name: `Edit ${REPO}` });
        await dialog.getByLabel('Default branch').fill('develop');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(toast(page, `Saved ${REPO}`)).toBeVisible();
        await page.reload();
        await expect(row).toContainText('develop');
        const repos = await apiGet<Array<{ id: string; default_branch: string }>>(request, `/api/projects/${projectId}/repos`);
        expect(repos.find((r) => r.id === `${projectId}-x`)?.default_branch).toBe('develop');
        // Back to main for the pull tests.
        await request.patch(`${API}${repoUrl()}`, { data: { default_branch: 'main' } });
    });

    test('auto-fetch: weekly saves its weekday; switching off and saving stores enabled=false', async ({ page, request }) => {
        const schedule = () => apiGet<{ enabled: boolean | number; preset: string; weekday: number | null }>(request, `${repoUrl()}/schedule`);
        await openTab(page, 'repos');
        await menu(page, REPO, /Auto-fetch schedule/);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Auto-fetch schedule', { exact: true })).toBeVisible();
        await dialog.getByRole('switch').or(dialog.getByRole('checkbox')).first().check();
        await expect(dialog.getByText('Auto-fetch enabled', { exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: /^Weekly/ }).click();
        await expect(dialog.getByRole('button', { name: /^Weekly/ })).toHaveAttribute('aria-pressed', 'true');
        await dialog.getByLabel('Weekday').click();
        await page.getByRole('option', { name: 'Fri' }).click();
        await dialog.getByRole('button', { name: 'Save schedule' }).click();
        await expect(dialog).toHaveCount(0);
        expect(await schedule()).toMatchObject({ preset: 'weekly', weekday: 5 });
        expect(Boolean((await schedule()).enabled)).toBe(true);
        await expect(page.getByTestId(`repo-row-${REPO}`)).toContainText('Auto-fetch · weekly');

        // Reopened: the switch off + Done saves it off.
        await menu(page, REPO, /Auto-fetch schedule/);
        await expect(dialog.getByLabel('Weekday')).toContainText('Fri');
        await dialog.getByRole('switch').or(dialog.getByRole('checkbox')).first().uncheck();
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toHaveCount(0);
        expect(Boolean((await schedule()).enabled)).toBe(false);
        await expect(page.getByTestId(`repo-row-${REPO}`)).not.toContainText('Auto-fetch ·');
    });

    test('Pull from remote: behind by one and clean → "Pull" fast-forwards the real clone', async ({ page }) => {
        pushUpstream(git.origin, 'upstream-1.txt');
        await openTab(page, 'repos');
        await menu(page, REPO, /Pull from remote/);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Pull from remote?', { exact: true })).toBeVisible();
        await expect(dialog.getByText('1 commits')).toBeVisible();
        await expect(dialog.getByText('clean', { exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
        await expect(dialog.getByText('Pulled from remote', { exact: true })).toBeVisible({ timeout: 30_000 });
        expect(existsSync(join(git.clone, 'upstream-1.txt'))).toBe(true);
        await page.keyboard.press('Escape');
    });

    test('Pull from remote: a dirty tree is named and stashed first', async ({ page }) => {
        pushUpstream(git.origin, 'upstream-2.txt');
        writeFileSync(join(git.clone, 'README.md'), '# fixture, edited locally\n');
        await openTab(page, 'repos');
        await menu(page, REPO, /Pull from remote/);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('1 modified files')).toBeVisible();
        await expect(dialog).toContainText('1 uncommitted files will be stashed to .git/atlas-stash/ before pulling. Restore them afterwards with git stash pop.');
        await dialog.getByRole('button', { name: 'Stash & pull' }).click();
        await expect(dialog.getByText('Pulled from remote', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(dialog.getByText(/Your stashed files are kept in .*\.git\/atlas-stash\//)).toBeVisible();
        expect(existsSync(join(git.clone, 'upstream-2.txt'))).toBe(true);
    });

    test('Pull from remote on a folder that is gone: the modal says so, and a pull leaves a reclone_failed notification', async ({ page, request }) => {
        insertRepo(projectId, { id: `${projectId}-ghost`, name: 'ghost', git_path: join(git.clone, '..', 'not-there'), git_url: git.origin, credential_id: credId, position: 1 });
        await openTab(page, 'repos');
        await menu(page, 'ghost', /Pull from remote/);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Could not read git status. Is the workspace folder still on disk?')).toBeVisible();
        await expect(dialog.getByRole('button', { name: /^(Stash & )?[Pp]ull$/ })).toBeDisabled();
        await page.keyboard.press('Escape');

        const res = await request.post(`${API}/api/projects/${projectId}/repos/${projectId}-ghost/reclone`, { data: {} });
        expect(res.status()).toBe(202);
        await expect.poll(() => one(`SELECT message FROM notifications WHERE project_id = '${projectId}' AND event_type = 'reclone_failed'`), { timeout: 15_000 }).toMatch(/^Pull failed on "ghost": /);
        await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-ghost`);
    });
});

test.describe('History tab', () => {
    test('lists every run with its total, 50 at a time, each linking to its run page', async ({ page }) => {
        const total = Number(one(`SELECT sum(total_cost_usd) FROM agent_runs WHERE id LIKE 'xtb-run-%'`));
        await openTab(page, 'history');
        await expect(page.getByText(`· ${RUNS}`, { exact: true })).toBeVisible();
        await expect(page.getByText(`· $${total.toFixed(2)} total`)).toBeVisible();
        const links = page.getByRole('link', { name: 'View run' });
        await expect(links).toHaveCount(50);
        await expect(links.first()).toHaveAttribute('href', /\/runs\/xtb-run-1$/);
        await page.getByRole('button', { name: `Show ${RUNS - 50} more of ${RUNS - 50}` }).click();
        await expect(links).toHaveCount(RUNS);
        await expect(links.last()).toHaveAttribute('href', new RegExp(`/runs/xtb-run-${RUNS}$`));
    });
});
