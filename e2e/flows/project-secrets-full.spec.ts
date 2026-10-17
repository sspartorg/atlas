import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';
import { sql } from '../helpers/db.js';
import { createProject, deleteProject, insertRepo, projectAction } from '../helpers/projects.js';

// Project → Manage Secrets against the real API, on a project of its own
// (prefix ZSC): add + save + reload, reveal one / all, export, import, the
// untouched-row rule (Save sends `keep`, never reveals), key validation, and
// the load states (Save / Add / Import wait for the stored set; a failed load
// says so).

let projectId = '';
const NAME = 'Zephyr Secrets';

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'ZSC'`)) await deleteProject(request, id ?? '');
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    projectId = (await createProject(request, NAME, 'ZSC')).id;
    insertRepo(projectId, { id: `${projectId}-r`, name: 'zephyr', git_path: '/tmp/atlas-e2e-zephyr' });
});
test.afterAll(async ({ request }) => cleanup(request));

const reveal = (request: APIRequestContext, key: string) => apiGet<{ value: string }>(request, `/api/projects/${projectId}/env/${key}/value`).then((r) => r.value);
const stored = (request: APIRequestContext) => apiGet<{ vars: Array<{ key: string }> }>(request, `/api/projects/${projectId}/env`).then((r) => r.vars.map((v) => v.key));
const setVars = (request: APIRequestContext, vars: Array<{ key: string; value: string }>) =>
    request.put(`${API}/api/projects/${projectId}/env`, { data: { vars } });

async function openSecrets(page: Page) {
    await projectAction(page, 'Manage Secrets');
    const dialog = page.getByRole('dialog', { name: 'Project Secrets' });
    await expect(dialog).toBeVisible();
    return dialog;
}

const keyInputs = (dialog: ReturnType<Page['getByRole']>) => dialog.locator('input[placeholder="MY_KEY"]');
const valueInputs = (dialog: ReturnType<Page['getByRole']>) => dialog.locator('input:not([placeholder="MY_KEY"]):not([type="file"]):not([placeholder^="Search"])');

test('add two secrets, save, reload; reveal one, then all, then hide all', async ({ page, request }) => {
    await setVars(request, []);
    await goto(page, `/projects/${projectId}`);
    const dialog = await openSecrets(page);
    await expect(dialog.getByText('No secrets yet — click "Add variable" to create one.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Export' })).toBeDisabled();

    for (const [k, v] of [['alpha_key', 'alpha-secret'], ['BETA_KEY', 'beta-secret']] as const) {
        await dialog.getByRole('button', { name: 'Add variable' }).click();
        await keyInputs(dialog).last().fill(k);
        await valueInputs(dialog).last().fill(v);
    }
    // Typed keys are upper-cased.
    await expect(keyInputs(dialog).first()).toHaveValue('ALPHA_KEY');
    await expect(dialog.getByText('2 unsaved changes')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save secrets' }).click();
    await expect(page.getByText('Project secrets saved')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(await stored(request)).toEqual(['ALPHA_KEY', 'BETA_KEY']);

    await page.reload();
    await openSecrets(page);
    await expect(keyInputs(dialog)).toHaveCount(2);
    await expect(dialog.getByText('no unsaved changes')).toBeVisible();
    // Stored values are never on the page until asked for.
    for (const i of [0, 1]) {
        await expect(valueInputs(dialog).nth(i)).toHaveValue('');
        await expect(valueInputs(dialog).nth(i)).toHaveAttribute('type', 'password');
    }
    await expect(dialog.getByRole('button', { name: 'Save secrets' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Reveal' }).first().click();
    await expect(valueInputs(dialog).first()).toHaveValue('alpha-secret');
    await expect(valueInputs(dialog).first()).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide' }).first().click();
    await expect(valueInputs(dialog).first()).toHaveValue('');

    await dialog.getByRole('button', { name: 'Reveal all' }).click();
    await expect(valueInputs(dialog).nth(0)).toHaveValue('alpha-secret');
    await expect(valueInputs(dialog).nth(1)).toHaveValue('beta-secret');
    await dialog.getByRole('button', { name: 'Hide all' }).click();
    for (const i of [0, 1]) await expect(valueInputs(dialog).nth(i)).toHaveAttribute('type', 'password');
    // Revealing is not an edit.
    await expect(dialog.getByText('no unsaved changes')).toBeVisible();
});

test('Export downloads every stored value as <project>.secrets.json', async ({ page, request }) => {
    await setVars(request, [
        { key: 'ALPHA_KEY', value: 'alpha-secret' },
        { key: 'BETA_KEY', value: 'beta-secret' },
    ]);
    await goto(page, `/projects/${projectId}`);
    const dialog = await openSecrets(page);
    await expect(keyInputs(dialog)).toHaveCount(2);
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Export' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${NAME}.secrets.json`);
    expect(JSON.parse(readFileSync((await file.path()) ?? '', 'utf8'))).toEqual({ ALPHA_KEY: 'alpha-secret', BETA_KEY: 'beta-secret' });
});

test('Import merges a file; Save keeps the untouched row without revealing it', async ({ page, request }) => {
    await setVars(request, [
        { key: 'ALPHA_KEY', value: 'alpha-secret' },
        { key: 'BETA_KEY', value: 'beta-secret' },
    ]);
    await goto(page, `/projects/${projectId}`);
    const dialog = await openSecrets(page);
    await expect(keyInputs(dialog)).toHaveCount(2);
    await dialog.locator('input[type="file"]').setInputFiles({
        name: 'import.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ ALPHA_KEY: 'alpha-2', GAMMA_KEY: 'gamma', 'bad-key': 'x' })),
    });
    await expect(page.getByText('Imported 2 secrets (skipped 1: 1 bad key)')).toBeVisible();
    await expect(keyInputs(dialog)).toHaveCount(3);
    await expect(dialog.getByText('NEW', { exact: true })).toHaveCount(1);
    await expect(dialog.getByText('2 unsaved changes')).toBeVisible();

    const reveals: string[] = [];
    let body: unknown = null;
    page.on('request', (r) => {
        if (/\/env\/[^/]+\/value$/.test(new URL(r.url()).pathname)) reveals.push(r.url());
        if (r.method() === 'PUT' && r.url().endsWith(`/api/projects/${projectId}/env`)) body = r.postDataJSON();
    });
    await dialog.getByRole('button', { name: 'Save secrets' }).click();
    await expect(page.getByText('Project secrets saved')).toBeVisible();
    expect(reveals).toEqual([]);
    expect(body).toEqual({
        vars: expect.arrayContaining([
            { key: 'ALPHA_KEY', value: 'alpha-2' },
            { key: 'BETA_KEY', keep: 'BETA_KEY' },
            { key: 'GAMMA_KEY', value: 'gamma' },
        ]),
    });
    expect(await reveal(request, 'BETA_KEY')).toBe('beta-secret');
    expect(await reveal(request, 'ALPHA_KEY')).toBe('alpha-2');
    expect(await reveal(request, 'GAMMA_KEY')).toBe('gamma');
});

test('a bad, blank or duplicate key blocks Save; the API refuses a lowercase key', async ({ page, request }) => {
    await setVars(request, [{ key: 'ALPHA_KEY', value: 'alpha-secret' }]);
    await goto(page, `/projects/${projectId}`);
    const dialog = await openSecrets(page);
    const save = dialog.getByRole('button', { name: 'Save secrets' });
    await dialog.getByRole('button', { name: 'Add variable' }).click();
    await expect(dialog.getByText('Key required')).toBeVisible();
    await expect(save).toBeDisabled();
    await keyInputs(dialog).last().fill('1BAD-KEY');
    await expect(dialog.getByText('UPPER_SNAKE_CASE only')).toBeVisible();
    await expect(save).toBeDisabled();
    await keyInputs(dialog).last().fill('ALPHA_KEY');
    await expect(dialog.getByText('Duplicate key')).toBeVisible();
    await expect(save).toBeDisabled();
    await keyInputs(dialog).last().fill('DELTA_KEY');
    await valueInputs(dialog).last().fill('d');
    await expect(save).toBeEnabled();

    const res = await setVars(request, [{ key: 'lower_key', value: 'x' }]);
    expect(res.status()).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'Invalid key "lower_key" — must be UPPER_SNAKE_CASE' });
    expect(await stored(request)).toEqual(['ALPHA_KEY']);
});

test('Save, Add variable and Import wait for the stored set; a failed load says so and Save stays off', async ({ page, request }) => {
    await setVars(request, [{ key: 'ALPHA_KEY', value: 'alpha-secret' }]);
    await goto(page, `/projects/${projectId}`);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    await page.route(`**/api/projects/${projectId}/env`, async (r) => {
        if (r.request().method() !== 'GET') return r.continue();
        await held;
        await r.continue();
    });
    const dialog = await openSecrets(page);
    for (const name of ['Save secrets', 'Add variable', 'Import']) await expect(dialog.getByRole('button', { name })).toBeDisabled();
    release();
    await expect(keyInputs(dialog)).toHaveCount(1);
    for (const name of ['Add variable', 'Import']) await expect(dialog.getByRole('button', { name })).toBeEnabled();
    await page.keyboard.press('Escape');

    await page.unroute(`**/api/projects/${projectId}/env`);
    await page.route(`**/api/projects/${projectId}/env`, (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 500, json: { error: 'vault sealed' } }) : r.continue()));
    await page.reload();
    const failed = await openSecrets(page);
    await expect(failed.getByRole('alert').filter({ hasText: "Could not load this project's secrets. Close and try again." })).toBeVisible();
    await expect(failed.getByRole('button', { name: 'Save secrets' })).toBeDisabled();
    await expect(failed.getByRole('button', { name: 'Add variable' })).toBeDisabled();
    expect(await reveal(request, 'ALPHA_KEY')).toBe('alpha-secret');
});
