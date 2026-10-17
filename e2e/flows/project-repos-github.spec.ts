import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { API, apiGet } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, insertRepo } from '../helpers/projects.js';
import {
    fakeGhCalls,
    fakeGithubBranches,
    fakeGithubClone,
    fakeGithubCredential,
    fakeGithubPush,
    fakeGithubRepo,
    removeFakeGithubRepo,
} from '../helpers/fake-github.js';

// The Repos tab against a fake github.com (helpers/fake-github.ts): Add repo
// in both modes — a real clone that lands in the workspace and closes the
// dialog on its SSE, a clone that fails, a duplicate name, connect with a
// matching folder, a mismatched origin, an unreachable remote and a missing
// folder — then Pull from remote, auto-fetch (run now: success, a failure that
// notifies, no credential), the Edit dialog's Cancel / Escape / manage link /
// unchecked branch, the auto-fetch cards by keyboard, and a failed repo load.
// Project prefix RGH; every repo folder, credential and fake repo is removed.

const NAME = 'Robin Repos';
const CRED = 'e2e-fake-github';
const WORKSPACE = '/tmp/atlas-e2e';
const CONNECT_DIR = join(tmpdir(), 'atlas-e2e-fixtures', 'rgh-connect');
const FAKE = ['rgh-base', 'rgh-alpha', 'rgh-beta', 'rgh-other', 'rgh-fetch', 'rgh-gone'];
let projectId = '';
let credId = '';
let credLabel = '';

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'RGH'`)) {
        for (const [path] of sql(`SELECT git_path FROM project_repos WHERE project_id = '${id}'`)) {
            if (path?.startsWith(WORKSPACE)) rmSync(path, { recursive: true, force: true });
        }
        sql(`DELETE FROM notifications WHERE project_id = '${id}'`);
        sql(`DELETE FROM project_schedules WHERE project_id = '${id}'`);
        await deleteProject(request, id ?? '');
    }
    for (const [id] of sql(`SELECT id FROM credentials WHERE label = '${CRED}'`)) await request.delete(`${API}/api/credentials/${id}`);
    for (const n of FAKE) removeFakeGithubRepo(n);
    rmSync(CONNECT_DIR, { recursive: true, force: true });
    for (const n of ['base', 'alpha', 'beta', 'missing']) rmSync(join(WORKSPACE, `robin-repos-${n}`), { recursive: true, force: true });
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    credId = await fakeGithubCredential(request, CRED);
    credLabel = `GitHub · ${CRED}`;
    projectId = (await createProject(request, NAME, 'RGH', 'Repos against a fake GitHub')).id;
    expect(one(`SELECT workspace_path FROM settings WHERE id = 1`)).toBe(WORKSPACE);
    // "base": a real clone through the API, for the tests that need a cloned repo.
    const res = await request.post(`${API}/api/projects/${projectId}/repos`, {
        data: { mode: 'clone', name: 'base', repo_url: fakeGithubRepo('rgh-base'), credential_id: credId, default_branch: 'main' },
    });
    expect(res.status(), await res.text()).toBe(202);
    await expect.poll(() => one(`SELECT clone_status FROM project_repos WHERE project_id = '${projectId}' AND name = 'base'`), { timeout: 30_000 }).toBe('ready');
});
test.afterAll(async ({ request }) => cleanup(request));

const repos = (request: APIRequestContext) => apiGet<Array<{ id: string; name: string; git_path: string; git_url: string; default_branch: string; clone_status: string; credential_id: string | null }>>(request, `/api/projects/${projectId}/repos`);
const row = (page: Page, name: string) => page.getByTestId(`repo-row-${name}`);
const menu = async (page: Page, name: string, item: RegExp) => {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
};

async function openAddRepo(page: Page) {
    await goto(page, `/projects/${projectId}?tab=repos`);
    await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
    await page.getByRole('button', { name: 'Add repo' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Add repo', { exact: true })).toBeVisible();
    return dialog;
}

async function pickCredential(page: Page, dialog: ReturnType<Page['getByRole']>) {
    await dialog.getByRole('combobox', { name: 'Git credential' }).click();
    await page.getByRole('option', { name: new RegExp(credLabel) }).click();
    await expect(dialog.getByRole('combobox', { name: 'Git credential' })).toContainText(CRED);
}

test.describe('Add repo, clone', () => {
    test('a clone runs for real: the folder lands in the workspace, the dialog closes on its SSE with "Repo added — alpha"', async ({ page, request }) => {
        // A retry starts from no alpha.
        for (const r of (await repos(request)).filter((x) => x.name === 'alpha')) await request.delete(`${API}/api/projects/${projectId}/repos/${r.id}`);
        rmSync(join(WORKSPACE, 'robin-repos-alpha'), { recursive: true, force: true });
        const url = fakeGithubRepo('rgh-alpha');
        const dialog = await openAddRepo(page);
        await expect(dialog.getByRole('button', { name: 'Clone fresh' })).toHaveAttribute('aria-pressed', 'true');
        await dialog.getByLabel('Repository URL').fill(url);
        await dialog.getByLabel('Name').fill('alpha');
        await expect(dialog.getByLabel('Default branch')).toHaveValue('main');
        await pickCredential(page, dialog);
        const post = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${projectId}/repos`) && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Clone repo' }).click();
        const res = await post;
        expect(res.status()).toBe(202);
        const body = (await res.json()) as { clone_id: string; destination: string };
        // The client picked the job id and subscribed before posting it.
        expect(JSON.parse(res.request().postData() ?? '{}')).toMatchObject({ mode: 'clone', name: 'alpha', repo_url: url, credential_id: credId, clone_id: body.clone_id });
        expect(body.destination).toBe(join(WORKSPACE, 'robin-repos-alpha'));

        await expect(page.getByText('Repo added — alpha')).toBeVisible({ timeout: 30_000 });
        await expect(dialog).toHaveCount(0);
        await expect(row(page, 'alpha')).toBeVisible();
        await expect(row(page, 'alpha')).toContainText('Ready');
        await expect(row(page, 'alpha')).toContainText('main');
        expect(readFileSync(join(body.destination, 'README.md'), 'utf8')).toBe('# rgh-alpha\n');
        const [r] = (await repos(request)).filter((x) => x.name === 'alpha');
        expect(r).toMatchObject({ git_path: body.destination, git_url: url, clone_status: 'ready', credential_id: credId, default_branch: 'main' });
        // The token never reaches the folder's git config.
        expect(readFileSync(join(body.destination, '.git', 'config'), 'utf8')).not.toContain('ghpE2E');
        // The header pill counts it.
        await expect(page.getByRole('button', { name: '2 repos' })).toBeVisible();
    });

    test('a second repo with the same name is refused in the dialog (409)', async ({ page }) => {
        const dialog = await openAddRepo(page);
        await dialog.getByLabel('Repository URL').fill(fakeGithubRepo('rgh-beta'));
        await dialog.getByLabel('Name').fill('base');
        await pickCredential(page, dialog);
        await dialog.getByRole('button', { name: 'Clone repo' }).click();
        await expect(dialog.getByRole('alert')).toContainText('This project already has a repo named "base"');
        // Still the form: fix the name and nothing was cloned meanwhile.
        await expect(dialog.getByLabel('Name')).toHaveValue('base');
        await expect(dialog.getByRole('button', { name: 'Clone repo' })).toBeEnabled();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        expect(existsSync(join(WORKSPACE, 'robin-repos-beta'))).toBe(false);
    });

    test('a clone that fails shows git\'s error; Edit details returns to the form with the values kept', async ({ page, request }) => {
        const dialog = await openAddRepo(page);
        const url = 'https://github.com/atlas-e2e/rgh-missing.git';
        await dialog.getByLabel('Repository URL').fill(url);
        await dialog.getByLabel('Name').fill('missing');
        await dialog.getByLabel('Default branch').fill('main');
        await pickCredential(page, dialog);
        await dialog.getByRole('button', { name: 'Clone repo' }).click();
        await expect(dialog.getByRole('alert')).toContainText(/does not exist|not found|not appear to be a git repository|exited with code/i, { timeout: 30_000 });
        await expect(dialog).not.toContainText('ghpE2E');
        await dialog.getByRole('button', { name: 'Edit details' }).click();
        await expect(dialog.getByLabel('Repository URL')).toHaveValue(url);
        await expect(dialog.getByLabel('Name')).toHaveValue('missing');
        await expect(dialog.getByRole('button', { name: 'Clone repo' })).toBeEnabled();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        expect((await repos(request)).map((r) => r.name)).not.toContain('missing');
        expect(existsSync(join(WORKSPACE, 'robin-repos-missing'))).toBe(false);
    });

    test('the form refuses a non-GitHub URL and a bad name before posting', async ({ page }) => {
        const dialog = await openAddRepo(page);
        await dialog.getByLabel('Repository URL').fill('https://gitlab.com/acme/web.git');
        await dialog.getByLabel('Name').fill('Bad Name');
        await expect(dialog.getByText('Lowercase letters, digits and dashes (max 40).')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Clone repo' })).toBeDisabled();
        await dialog.getByLabel('Name').fill('web');
        await expect(dialog.getByRole('button', { name: 'Clone repo' })).toBeDisabled();
        const res = await page.request.post(`${API}/api/projects/${projectId}/repos`, {
            data: { mode: 'clone', name: 'web', repo_url: 'https://gitlab.com/acme/web.git', credential_id: credId },
        });
        expect(res.status()).toBe(400);
        expect(await res.text()).toContain('Only https://github.com URLs are supported');
        await page.keyboard.press('Escape');
    });

    test('the Add repo dialog is axe-clean and its controls work by keyboard', async ({ page }) => {
        const dialog = await openAddRepo(page);
        await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
        await expect(dialog.getByRole('combobox', { name: 'Git credential' })).toContainText(/GitHub · /);
        const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 100)).join(' | ')}`)).toEqual([]);
        // "manage in Settings" is a real control: Tab reaches it, Enter follows it.
        const manage = dialog.getByRole('button', { name: 'manage in Settings' });
        await manage.focus();
        await expect(manage).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/settings\/credentials$/);
        await expect(dialog).toHaveCount(0);
    });

    test('Pull from remote fast-forwards the cloned repo after a push to GitHub', async ({ page }) => {
        fakeGithubPush('rgh-base', 'upstream.txt');
        await goto(page, `/projects/${projectId}?tab=repos`);
        await menu(page, 'base', /Pull from remote/);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('1 commits')).toBeVisible();
        await expect(dialog.getByText('clean', { exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
        await expect(dialog.getByText('Pulled from remote', { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(dialog).toContainText('Fast-forwarded 1 commit');
        expect(existsSync(join(WORKSPACE, 'robin-repos-base', 'upstream.txt'))).toBe(true);
    });
});

test.describe('Add repo, connect an existing folder', () => {
    test.afterEach(async ({ request }) => {
        for (const r of await repos(request)) if (r.name === 'beta') await request.delete(`${API}/api/projects/${projectId}/repos/${r.id}`);
    });

    async function connect(page: Page, folder: string, url?: string) {
        const dialog = await openAddRepo(page);
        await dialog.getByRole('button', { name: 'Use existing folder' }).click();
        await expect(dialog.getByLabel('Default branch')).toHaveCount(0);
        // Picking a folder fills the URL from its origin; type the URL after that lands.
        const origin = page.waitForResponse((r) => r.url().includes('/api/projects/folder-origin'));
        await dialog.getByRole('textbox', { name: 'Existing folder' }).fill(folder);
        await origin;
        if (url) await dialog.getByLabel('Repository URL').fill(url);
        await dialog.getByLabel('Name').fill('beta');
        await pickCredential(page, dialog);
        await dialog.getByRole('button', { name: 'Verify & add' }).click();
        return dialog;
    }

    test('a folder whose origin is the URL is registered as is, with the URL filled from the folder', async ({ page, request }) => {
        const url = fakeGithubClone('rgh-beta', CONNECT_DIR);
        const dialog = await openAddRepo(page);
        await dialog.getByRole('button', { name: 'Use existing folder' }).click();
        await dialog.getByRole('textbox', { name: 'Existing folder' }).fill(CONNECT_DIR);
        // The folder's origin fills the URL.
        await expect(dialog.getByLabel('Repository URL')).toHaveValue(url);
        await dialog.getByLabel('Name').fill('beta');
        await pickCredential(page, dialog);
        await dialog.getByRole('button', { name: 'Verify & add' }).click();
        await expect(page.getByText('Repo added — beta')).toBeVisible();
        await expect(dialog).toHaveCount(0);
        await expect(row(page, 'beta')).toBeVisible();
        const beta = (await repos(request)).find((r) => r.name === 'beta');
        expect(beta).toMatchObject({ git_path: CONNECT_DIR, git_url: url, clone_status: 'ready', credential_id: credId, default_branch: 'main' });
        // The folder is used where it is: nothing copied into the workspace.
        expect(existsSync(join(WORKSPACE, 'robin-repos-beta'))).toBe(false);
    });

    test('an origin that is not the URL: "Remote URL mismatch" with both URLs; Edit details keeps the form', async ({ page, request }) => {
        fakeGithubClone('rgh-beta', CONNECT_DIR);
        const other = fakeGithubRepo('rgh-other');
        const dialog = await connect(page, CONNECT_DIR, other);
        await expect(dialog.getByText('Remote URL mismatch')).toBeVisible();
        await expect(dialog).toContainText("The folder you picked is a valid git repository, but its origin points somewhere else.");
        await expect(dialog).toContainText(other);
        await expect(dialog).toContainText('https://github.com/atlas-e2e/rgh-beta.git');
        await expect(dialog).toContainText('Update the entered URL to match the folder\'s origin');
        await dialog.getByRole('button', { name: 'Edit details' }).click();
        await expect(dialog.getByLabel('Repository URL')).toHaveValue(other);
        await expect(dialog.getByRole('textbox', { name: 'Existing folder' })).toHaveValue(CONNECT_DIR);
        expect((await repos(request)).map((r) => r.name)).not.toContain('beta');
    });

    test('a remote the credential cannot reach: "Credential cannot reach remote"', async ({ page }) => {
        fakeGithubClone('rgh-beta', CONNECT_DIR);
        // GitHub no longer has the repo: ls-remote fails.
        removeFakeGithubRepo('rgh-beta');
        const dialog = await connect(page, CONNECT_DIR);
        await expect(dialog.getByText('Credential cannot reach remote')).toBeVisible({ timeout: 20_000 });
        await expect(dialog).toContainText('ls-remote failed');
        await expect(dialog).toContainText('Update the PAT scope in Settings → Credentials');
    });

    test('a folder that is not there: "Folder does not exist"; a plain folder: "Folder is not a git repository"', async ({ page }) => {
        const missing = join(CONNECT_DIR, 'nope');
        rmSync(CONNECT_DIR, { recursive: true, force: true });
        let dialog = await connect(page, missing, 'https://github.com/atlas-e2e/rgh-beta.git');
        await expect(dialog.getByText('Folder does not exist')).toBeVisible();
        await expect(dialog).toContainText('Verify the path still exists on disk');

        const { mkdirSync } = await import('node:fs');
        mkdirSync(CONNECT_DIR, { recursive: true });
        dialog = await connect(page, CONNECT_DIR, 'https://github.com/atlas-e2e/rgh-beta.git');
        await expect(dialog.getByText('Folder is not a git repository')).toBeVisible();
        await expect(dialog).toContainText('Or use Clone fresh instead');
    });

    test('a folder another project already registered is refused, naming it', async ({ page }) => {
        const dialog = await connect(page, join(tmpdir(), 'atlas-e2e-fixtures', 'project'), 'https://github.com/atlas-e2e/rgh-beta.git');
        await expect(dialog.getByText('Folder already registered')).toBeVisible();
        await expect(dialog).toContainText(/This folder is already registered as "[^"]+"\./);
        await expect(dialog).toContainText('Open the existing project from the list');
    });
});

test.describe('Repo row', () => {
    test('Edit: Cancel and Escape discard; the branch is saved unchecked; manage in Settings leaves for Credentials', async ({ page, request }) => {
        const patches: string[] = [];
        page.on('request', (r) => {
            if (r.method() === 'PATCH' && r.url().includes(`/api/projects/${projectId}/repos/`)) patches.push(r.postData() ?? '');
        });
        await goto(page, `/projects/${projectId}?tab=repos`);
        await menu(page, 'base', /^Edit$/);
        let dialog = page.getByRole('dialog', { name: 'Edit base' });
        await expect(dialog.getByLabel('Default branch')).toHaveValue('main');
        await expect(dialog.getByRole('combobox', { name: 'Git credential' })).toContainText(CRED);
        await expect(dialog).toContainText("This repo's setup scripts live on the Setup tab.");
        await dialog.getByLabel('Default branch').fill('develop');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);
        await menu(page, 'base', /^Edit$/);
        await expect(dialog.getByLabel('Default branch')).toHaveValue('main');
        await dialog.getByLabel('Default branch').fill('develop');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(row(page, 'base')).toContainText('main');
        expect(patches).toEqual([]);

        // Blank is refused; a branch the remote does not have is saved as typed (no check).
        await menu(page, 'base', /^Edit$/);
        await dialog.getByLabel('Default branch').fill('  ');
        await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
        await dialog.getByLabel('Default branch').fill('no-such-branch');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Saved base')).toBeVisible();
        await expect(row(page, 'base')).toContainText('no-such-branch');
        expect((await repos(request)).find((r) => r.name === 'base')?.default_branch).toBe('no-such-branch');
        expect(JSON.parse(patches[0] ?? '{}')).toEqual({ default_branch: 'no-such-branch' });
        await request.patch(`${API}/api/projects/${projectId}/repos/${(await repos(request)).find((r) => r.name === 'base')?.id}`, { data: { default_branch: 'main' } });

        await page.reload();
        await menu(page, 'base', /^Edit$/);
        dialog = page.getByRole('dialog', { name: 'Edit base' });
        await dialog.getByRole('button', { name: 'manage in Settings' }).click();
        await expect(page).toHaveURL(/\/settings\/credentials$/);
        await expect(dialog).toHaveCount(0);
    });

    test('the auto-fetch preset and conflict cards work by keyboard and save what was picked', async ({ page, request }) => {
        const repoId = (await repos(request)).find((r) => r.name === 'base')?.id ?? '';
        await goto(page, `/projects/${projectId}?tab=repos`);
        await menu(page, 'base', /Auto-fetch schedule/);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('switch').or(dialog.getByRole('checkbox')).first().check();
        const hourly = dialog.getByRole('button', { name: /^Every hour/ });
        // Reach it by Tab from the control before it, so it is keyboard focus.
        await dialog.getByRole('switch').or(dialog.getByRole('checkbox')).first().focus();
        for (let i = 0; i < 10 && !(await hourly.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press('Tab');
        await expect(hourly).toBeFocused();
        await expect(hourly).toHaveCSS('outline-style', 'solid');
        await page.keyboard.press('Enter');
        await expect(hourly).toHaveAttribute('aria-pressed', 'true');
        // Tab reaches the next card; Space presses it.
        await page.keyboard.press('Tab');
        const every4 = dialog.getByRole('button', { name: /^Every 4 hours/ });
        await expect(every4).toBeFocused();
        await page.keyboard.press(' ');
        await expect(every4).toHaveAttribute('aria-pressed', 'true');
        await expect(hourly).toHaveAttribute('aria-pressed', 'false');
        const stash = dialog.getByRole('button', { name: /^Stash & merge/ });
        await stash.focus();
        await page.keyboard.press('Enter');
        await expect(stash).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.getByRole('button', { name: /^Skip & notify/ })).toHaveAttribute('aria-pressed', 'false');
        await dialog.getByRole('button', { name: 'Save schedule' }).click();
        await expect(dialog).toHaveCount(0);
        const s = await apiGet<{ enabled: boolean | number; preset: string; conflict_policy: string }>(request, `/api/projects/${projectId}/repos/${repoId}/schedule`);
        expect(s).toMatchObject({ preset: 'every_4h', conflict_policy: 'stash' });
        expect(Boolean(s.enabled)).toBe(true);
        await expect(row(page, 'base')).toContainText('Auto-fetch · every 4h');
        await request.put(`${API}/api/projects/${projectId}/repos/${repoId}/schedule`, { data: { ...s, enabled: false, skip_if_dirty: true, pause_while_agents_active: false } });
    });

    test('a failed repo load says so with Retry; Retry recovers', async ({ page }) => {
        let fail = true;
        await page.route(`**/api/projects/${projectId}/repos`, (r) => (fail && r.request().method() === 'GET' ? r.fulfill({ status: 500, json: { error: 'repos exploded' } }) : r.continue()));
        await goto(page, `/projects/${projectId}?tab=repos`, { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Could not load the repos — Something went wrong')).toBeVisible();
        await expect(page.getByText('repos exploded')).toBeVisible();
        await expect(page.getByText('No repos yet')).toHaveCount(0);
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(row(page, 'base')).toBeVisible();
        await expect(page.getByText('Could not load the repos')).toHaveCount(0);
    });
});

test.describe('auto-fetch, run now', () => {
    const fire = (request: APIRequestContext, repoId: string) => request.post(`${API}/api/projects/${projectId}/repos/${repoId}/schedule/fire`, { data: {} });
    async function enable(request: APIRequestContext, repoId: string) {
        const current = await apiGet<Record<string, unknown>>(request, `/api/projects/${projectId}/repos/${repoId}/schedule`);
        const res = await request.put(`${API}/api/projects/${projectId}/repos/${repoId}/schedule`, {
            data: { enabled: true, preset: 'daily', time_of_day: '06:00', weekday: null, cron_expression: current['cron_expression'] || '0 6 * * *', skip_if_dirty: true, pause_while_agents_active: false, conflict_policy: 'skip' },
        });
        expect(res.status(), await res.text()).toBeLessThan(300);
    }
    const notes = (repo: string) => sql(`SELECT event_type, message FROM notifications WHERE project_id = '${projectId}' AND message LIKE '%${NAME}/${repo}%' ORDER BY id`);

    test('a fetch after a push to GitHub fast-forwards the folder and leaves an autofetch_success note', async ({ request }) => {
        const dest = join(tmpdir(), 'atlas-e2e-fixtures', 'rgh-fetch');
        const url = fakeGithubClone('rgh-fetch', dest);
        insertRepo(projectId, { id: `${projectId}-fetch`, name: 'fetch', git_path: dest, git_url: url, credential_id: credId, position: 2 });
        await enable(request, `${projectId}-fetch`);
        fakeGithubPush('rgh-fetch', 'fetched.txt');
        expect((await fire(request, `${projectId}-fetch`)).status()).toBe(202);
        await expect.poll(() => notes('fetch').map((n) => n[0]), { timeout: 20_000 }).toEqual(['autofetch_success']);
        expect(existsSync(join(dest, 'fetched.txt'))).toBe(true);
        await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-fetch`);
        rmSync(dest, { recursive: true, force: true });
    });

    test('a fetch that fails leaves an autofetch_failed notification the Owner sees', async ({ page, request }) => {
        const dest = join(tmpdir(), 'atlas-e2e-fixtures', 'rgh-gone');
        const url = fakeGithubClone('rgh-gone', dest);
        insertRepo(projectId, { id: `${projectId}-gone`, name: 'gone', git_path: dest, git_url: url, credential_id: credId, position: 3 });
        await enable(request, `${projectId}-gone`);
        removeFakeGithubRepo('rgh-gone');
        expect((await fire(request, `${projectId}-gone`)).status()).toBe(202);
        await expect.poll(() => notes('gone').map((n) => n[0]), { timeout: 20_000 }).toEqual(['autofetch_failed']);
        const [[, message]] = notes('gone') as [[string, string]];
        expect(message).toMatch(new RegExp(`^Auto-fetch on "${NAME}/gone": `));
        expect(message).not.toContain('ghpE2E');
        const s = await apiGet<{ last_run_status: string }>(request, `/api/projects/${projectId}/repos/${projectId}-gone/schedule`);
        expect(s.last_run_status).toBe('failure');
        await goto(page, '/notifications');
        await page.getByRole('tab', { name: /In-App Feed/ }).click();
        await expect(page.getByText(`Auto-fetch on "${NAME}/gone": fetch failed`).first()).toBeVisible();
        await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-gone`);
        rmSync(dest, { recursive: true, force: true });
    });

    test('a repo with no credential is skipped with a note saying so; a disabled schedule does nothing', async ({ request }) => {
        insertRepo(projectId, { id: `${projectId}-nocred`, name: 'nocred', git_path: '/tmp/atlas-e2e-rgh-nocred', position: 4 });
        expect((await fire(request, `${projectId}-nocred`)).status()).toBe(202);
        // Off by default: firing an off schedule is a no-op.
        await expect.poll(() => notes('nocred').length, { timeout: 3_000 }).toBe(0);
        await enable(request, `${projectId}-nocred`);
        await fire(request, `${projectId}-nocred`);
        await expect.poll(() => notes('nocred'), { timeout: 10_000 }).toEqual([['autofetch_failed', `Auto-fetch skipped on "${NAME}/nocred": no credential attached.`]]);
        await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-nocred`);
    });
});

test.describe('Generate AI scaffold', () => {
    test('Generate starts the AI Readiness run on the picked repo; it pushes its atlas/wf/… branch to GitHub and opens a PR', async ({ page, request }) => {
        const repoId = (await repos(request)).find((r) => r.name === 'base')?.id ?? '';
        const agentBefore = one(`SELECT count(*) FROM agents WHERE id = 'agent-ai-readiness'`);
        const prsBefore = fakeGhCalls().length;
        try {
            await goto(page, `/projects/${projectId}`);
            await page.getByRole('button', { name: 'Project actions' }).click();
            await page.getByRole('menuitem', { name: /Generate AI scaffold…/ }).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog.getByText('Generate AI scaffold', { exact: true })).toBeVisible();
            // Two ready repos (base and, when the clone test ran, alpha): pick base.
            const picker = dialog.getByRole('combobox', { name: 'Repo' });
            if (await picker.count()) {
                await picker.click();
                await page.getByRole('option', { name: /base/ }).click();
            }
            await expect(dialog).toContainText("on a new atlas/wf/… branch (the run's own), push it, and open a PR for your review.");
            const post = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${projectId}/generate-ai-scaffold`));
            await dialog.getByRole('button', { name: 'Generate' }).click();
            const res = await post;
            expect(res.status()).toBe(202);
            expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ repo_id: repoId });
            const { run_id, workflow_id } = (await res.json()) as { run_id: string; workflow_id: string };
            await expect(page).toHaveURL(new RegExp(`/workflows/${workflow_id}/runs/${run_id}$`));
            expect(JSON.parse(one(`SELECT repo_ids::text FROM workflow_runs WHERE id = '${run_id}'`))).toEqual([repoId]);

            await expect
                .poll(() => one(`SELECT status || ':' || coalesce(park_reason, '') FROM workflow_runs WHERE id = '${run_id}'`), { timeout: 60_000, intervals: [1_000] })
                .toBe('completed:');
            const branch = one(`SELECT branch FROM workflow_runs WHERE id = '${run_id}'`);
            expect(branch).toBe(`atlas/wf/${run_id.slice(0, 8)}`);
            expect(fakeGithubBranches('rgh-base')).toContain(branch);
            const pr = fakeGhCalls().slice(prsBefore);
            expect(pr).toEqual([expect.objectContaining({ repo: 'atlas-e2e/rgh-base', head: branch, base: 'main' })]);
            // A second Generate reuses the project's AI Readiness workflow.
            const again = await request.post(`${API}/api/projects/${projectId}/generate-ai-scaffold`, { data: { repo_id: repoId } });
            expect(again.status()).toBe(202);
            expect(((await again.json()) as { workflow_id: string }).workflow_id).toBe(workflow_id);
            const second = ((await again.json()) as { run_id: string }).run_id;
            await expect.poll(() => one(`SELECT status FROM workflow_runs WHERE id = '${second}'`), { timeout: 60_000, intervals: [1_000] }).toMatch(/completed|waiting_for_owner|error/);
        } finally {
            for (const [wf] of sql(`SELECT id FROM workflows WHERE project_id = '${projectId}'`)) {
                sql(`DELETE FROM workflow_runs WHERE workflow_id = '${wf}'`);
                await request.delete(`${API}/api/workflows/${wf}`);
            }
            if (agentBefore === '0') await request.delete(`${API}/api/agents/agent-ai-readiness`);
        }
    });

    test('a repo without a credential or not cloned is refused with the reason', async ({ request }) => {
        insertRepo(projectId, { id: `${projectId}-bare`, name: 'nocredential', git_path: '/tmp/atlas-e2e-rgh-nocred2', position: 5 });
        const res = await request.post(`${API}/api/projects/${projectId}/generate-ai-scaffold`, { data: { repo_id: `${projectId}-bare` } });
        expect(res.status()).toBe(409);
        expect(await res.json()).toMatchObject({ error: 'Repo has no credential attached' });
        sql(`UPDATE project_repos SET clone_status = 'cloning' WHERE id = '${projectId}-bare'`);
        const cloning = await request.post(`${API}/api/projects/${projectId}/generate-ai-scaffold`, { data: { repo_id: `${projectId}-bare` } });
        expect(await cloning.json()).toMatchObject({ error: 'Repo is not cloned yet' });
        await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-bare`);
    });
});
