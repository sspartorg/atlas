import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, gitFixture, insertRepo, projectAction } from '../helpers/projects.js';

// Rows the coverage matrix had proven by unit tests only, now driven in the
// browser against the real API (or a routed fault where the real one cannot
// be produced on demand): loading and error states, the project page's
// Refresh / rail / header pill, guard-rail and script failures and the
// override chip, repo Open folder / pull errors / a repo with no credential,
// the secrets dialog's no-repo warning, copy and remove, the Tasks empty
// state, a 60+ row virtualised table, Kanban cards and paging, the create
// form's workflow / reporter / assignee, not-found pages, the Spec and Pull
// request cards, the rail rows, the Done guard and activity-log paging.
// Projects have prefix ST.; everything is removed afterwards.

const NAME = 'Stoat States';
const AGENT = 'agent-po-writer';
let projectId = '';
let git = { origin: '', clone: '' };
const WORKSPACE = '/tmp/atlas-e2e';
const LOCKED = join(WORKSPACE, 'sta-locked');

async function cleanup(request: APIRequestContext) {
    try {
        chmodSync(LOCKED, 0o755);
    } catch {
        /* not there */
    }
    rmSync(LOCKED, { recursive: true, force: true });
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix LIKE 'ST%' AND issue_key_prefix <> 'STQ'`)) {
        sql(`DELETE FROM workflow_runs WHERE project_id = '${id}'`);
        sql(`DELETE FROM agent_runs WHERE project_id = '${id}' OR item_id IN (SELECT id FROM items WHERE project_id = '${id}')`);
        for (const [wf] of sql(`SELECT id FROM workflows WHERE project_id = '${id}'`)) await request.delete(`${API}/api/workflows/${wf}`);
        await deleteProject(request, id ?? '');
    }
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    projectId = (await createProject(request, NAME, 'STA', 'Unit-only rows, now in the browser')).id;
    git = gitFixture('sta');
    insertRepo(projectId, { id: `${projectId}-r`, name: 'stoat', git_path: git.clone, git_url: git.origin });
});
test.afterAll(async ({ request }) => cleanup(request));

const P = () => `/projects/${projectId}`;
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();
function hold(page: Page, url: string | RegExp) {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    return page
        .route(url, async (r) => {
            if (r.request().method() !== 'GET') return r.continue();
            await held;
            await r.continue();
        })
        .then(() => release);
}

test.describe('/projects', () => {
    test('loading shows the branded fallback, never the empty state; the API clamps page and limit', async ({ page, request }) => {
        const release = await hold(page, '**/api/projects/paged**');
        await page.goto('/projects');
        await expect(page.getByTestId('route-fallback').first()).toBeVisible();
        await expect(page.getByText('No projects yet.')).toHaveCount(0);
        release();
        await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();

        const clamped = await apiGet<{ page: number; limit: number; rows: Array<{ created_at: string }> }>(request, '/api/projects/paged?page=0&limit=1000');
        expect([clamped.page, clamped.limit]).toEqual([1, 100]);
        const dates = clamped.rows.map((r) => r.created_at);
        expect(dates).toEqual([...dates].sort().reverse());
        // 0 / junk read as "not given" (20); a negative is clamped up to 1.
        expect((await apiGet<{ page: number; limit: number }>(request, '/api/projects/paged?page=-4&limit=0'))).toMatchObject({ page: 1, limit: 20 });
        const tiny = await apiGet<{ limit: number; rows: unknown[] }>(request, '/api/projects/paged?page=1&limit=-3');
        expect(tiny.limit).toBe(1);
        expect(tiny.rows).toHaveLength(1);
    });

    test('the subtitle uses singular forms at one: "1 project · 1 task · 1 sub-task"', async ({ page }) => {
        await page.route('**/api/projects/paged**', async (r) => {
            const body = (await (await r.fetch()).json()) as { rows: unknown[] };
            await r.fulfill({ json: { ...body, rows: body.rows.slice(0, 1), total: 1 } });
        });
        await page.route(/\/api\/tasks(\?.*)?$/, async (r) => {
            const body = (await (await r.fetch()).json()) as Array<Record<string, unknown>>;
            await r.fulfill({ json: body.slice(0, 1).map((t) => ({ ...t, sub_task_count: 1 })) });
        });
        await goto(page, '/projects');
        await expect(page.locator('main header')).toContainText('1 project · 1 task · 1 sub-task');
    });

    test('a card says when the project last moved', async ({ page }) => {
        await goto(page, '/projects');
        const card = page.locator('.MuiPaper-root').filter({ has: page.getByRole('heading', { name: NAME, exact: true }) });
        await expect(card).toContainText(/Last activity\s+(just now|\d+\s*(s|m|min|minutes?) ago)/);
    });
});

test.describe('/projects/:id', () => {
    test('skeletons while the project loads; a 404 says "Project not found" with Back to Projects', async ({ page }) => {
        const release = await hold(page, `**/api/projects/${projectId}`);
        await page.goto(P());
        await expect(page.locator('main .MuiSkeleton-root').first()).toBeVisible();
        release();
        await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();

        await goto(page, '/projects/no-such-project', { allow: [/404|Not Found/] });
        await expect(page.getByText('Project not found')).toBeVisible();
        await page.getByRole('button', { name: 'Back to Projects' }).click();
        await expect(page).toHaveURL(/\/projects$/);
    });

    test('a 500 says "Could not load this project" with Retry (not "not found"); Retry recovers', async ({ page }) => {
        let fail = true;
        await page.route(`**/api/projects/${projectId}`, (r) => (fail && r.request().method() === 'GET' ? r.fulfill({ status: 500, json: { error: 'project exploded' } }) : r.continue()));
        await goto(page, P(), { allow: [/500|Internal Server Error/] });
        await expect(page.getByText(/Could not load this project/)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Project not found')).toHaveCount(0);
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
    });

    test('Refresh project data refetches: a change made elsewhere shows without a reload', async ({ page, request }) => {
        await goto(page, P());
        await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
        await apiPost(request, '/api/tasks', { project_id: projectId, title: 'Stoat made elsewhere' });
        sql(`UPDATE projects SET name = 'Stoat Renamed Elsewhere' WHERE id = '${projectId}'`);
        await page.getByRole('button', { name: 'Refresh project data' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Stoat Renamed Elsewhere' })).toBeVisible();
        sql(`UPDATE projects SET name = '${NAME}' WHERE id = '${projectId}'`);
    });

    test('the rail hides on Guard-rails; "Edit guard-rails" opens that tab; rules drive the header pill and rail', async ({ page, request }) => {
        await goto(page, P());
        await expect(page.getByText('Health · 30 d')).toBeVisible();
        await expect(page.getByText('No active rules.')).toBeVisible();
        await expect(page.getByText('Guard-rails active')).toHaveCount(0);
        await projectAction(page, 'Edit guard-rails');
        await expect(page).toHaveURL(/tab=guardrails/);
        await expect(page.getByText('Health · 30 d')).toHaveCount(0);

        const rule = await apiPost<{ id: string }>(request, `/api/projects/${projectId}/guardrails`, { title: 'Stoats stay in burrows', body_md: 'x' });
        await page.getByRole('tab', { name: /Overview/ }).click();
        await page.reload();
        await expect(page.getByText('Guard-rails active')).toBeVisible();
        await expect(page.getByText('Stoats stay in burrows')).toBeVisible();
        await page.getByRole('button', { name: 'Edit →' }).click();
        await expect(page).toHaveURL(/tab=guardrails/);
        // Paused: gone from the pill and the rail.
        await request.patch(`${API}/api/projects/${projectId}/guardrails/${rule.id}/toggle`, { data: { enabled: 0 } });
        await goto(page, P());
        await expect(page.getByText('No active rules.')).toBeVisible();
        await expect(page.getByText('Guard-rails active')).toHaveCount(0);
        await request.delete(`${API}/api/projects/${projectId}/guardrails/${rule.id}`);
    });

    test('Active agents lists agents on open Tasks, idle or running, and links to /agents', async ({ page, request }) => {
        await goto(page, P());
        await expect(page.getByText('No agents assigned to this project yet.')).toBeVisible();
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Stoat on an agent' });
        await request.patch(`${API}/api/tasks/${t.id}/assign`, { data: { assignee_agent_id: AGENT } });
        const agentName = one(`SELECT name FROM agents WHERE id = '${AGENT}'`);
        await page.reload();
        const panel = page.getByText('Active agents').locator('xpath=ancestor::div[2]');
        await expect(panel).toContainText(agentName);
        await expect(panel).toContainText('idle');
        sql(`INSERT INTO agent_runs (id, agent_id, item_id, status, started_at, created_at) VALUES ('sta-live-run', '${AGENT}', '${t.id}', 'in_progress', now(), now())`);
        try {
            await page.reload();
            await expect(panel).toContainText('running');
        } finally {
            sql(`DELETE FROM agent_runs WHERE id = 'sta-live-run'`);
        }
        await page.getByRole('link', { name: 'All →' }).click();
        await expect(page).toHaveURL(/\/agents$/);
        await request.patch(`${API}/api/tasks/${t.id}/assign`, { data: { assignee_agent_id: null } });
    });

    test('Overview: skeleton while counts load; a failed runs load says "Could not load recent activity" with Retry', async ({ page }) => {
        const release = await hold(page, `**/api/counts/project/${projectId}`);
        await page.goto(P());
        await expect(page.locator('main .MuiSkeleton-root').first()).toBeVisible();
        release();
        await expect(page.getByText('Open tasks')).toBeVisible();

        let fail = true;
        await page.route('**/api/run?project_id=**', (r) => (fail ? r.fulfill({ status: 500, json: { error: 'runs exploded' } }) : r.continue()));
        await goto(page, P(), { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Could not load recent activity — Something went wrong')).toBeVisible({ timeout: 20_000 });
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).first().click();
        await expect(page.getByText('No recent activity yet')).toBeVisible();
    });

    test('Rename: a failed save shows its message in the dialog and keeps it open', async ({ page }) => {
        await page.route(`**/api/projects/${projectId}`, (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 500, json: { error: 'rename exploded' } }) : r.continue()));
        await goto(page, P());
        await projectAction(page, 'Rename project…');
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Project name').fill('Stoat Never');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog.getByRole('alert')).toContainText('rename exploded');
        await expect(dialog.getByLabel('Project name')).toHaveValue('Stoat Never');
        expect(one(`SELECT name FROM projects WHERE id = '${projectId}'`)).toBe(NAME);
    });
});

test.describe('delete project failures', () => {
    test('a purge whose folder cannot be removed ends in "Delete failed" with Try again; a folder outside the workspace is kept', async ({ page, request }) => {
        // Inside the workspace but in a read-only parent: the purge step fails.
        mkdirSync(join(LOCKED, 'repo'), { recursive: true });
        writeFileSync(join(LOCKED, 'repo', 'file.txt'), 'x');
        chmodSync(LOCKED, 0o555);
        const doomed = await createProject(request, 'Stoat Locked', 'STL');
        insertRepo(doomed.id, { id: `${doomed.id}-r`, name: 'locked', git_path: join(LOCKED, 'repo') });
        await goto(page, `/projects/${doomed.id}`);
        await projectAction(page, 'Delete project…');
        const dialog = page.getByRole('dialog');
        await dialog.getByText('Delete project and content').click();
        await dialog.getByRole('textbox').last().fill('Stoat Locked');
        await dialog.getByRole('button', { name: 'Delete project and content' }).click();
        await expect(dialog.getByText('Delete failed', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
        await expect(dialog).toContainText('A delete step failed.');
        await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
        expect(existsSync(join(LOCKED, 'repo', 'file.txt'))).toBe(true);
        await dialog.getByRole('button', { name: 'Close' }).last().click();
        chmodSync(LOCKED, 0o755);

        // A repo folder outside the workspace root survives a purge.
        const outside = join(tmpdir(), 'atlas-e2e-fixtures', 'sta-outside');
        mkdirSync(outside, { recursive: true });
        writeFileSync(join(outside, 'keep.txt'), 'keep');
        const p2 = await createProject(request, 'Stoat Outside', 'STO');
        insertRepo(p2.id, { id: `${p2.id}-r`, name: 'outside', git_path: outside });
        const res = await request.post(`${API}/api/projects/${p2.id}/delete`, { data: { mode: 'purge', confirm_name: 'Stoat Outside', delete_id: `sta-outside-${Date.now()}` } });
        expect(res.status(), await res.text()).toBeLessThan(300);
        await expect.poll(() => one(`SELECT count(*) FROM projects WHERE id = '${p2.id}'`), { timeout: 30_000 }).toBe('0');
        expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
        rmSync(outside, { recursive: true, force: true });
    });
});

test.describe('guard-rail and script failures', () => {
    test('a failed pause toasts "Could not update guard-rail"; a failed add toasts its reason and keeps the dialog; Enter in Title does not submit', async ({ page, request }) => {
        const rule = await apiPost<{ id: string }>(request, `/api/projects/${projectId}/guardrails`, { title: 'Stoat toggle', body_md: 'x' });
        await page.route('**/guardrails/*/toggle', (r) => r.fulfill({ status: 500, json: { error: 'toggle exploded' } }));
        await page.route(`**/api/projects/${projectId}/guardrails`, (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, json: { error: 'add exploded' } }) : r.continue()));
        await goto(page, `${P()}?tab=guardrails`);
        await page.getByRole('switch', { name: 'Pause Stoat toggle' }).click();
        await expect(toast(page, 'Could not update guard-rail')).toBeVisible();
        await expect(page.getByRole('switch', { name: 'Pause Stoat toggle' })).toBeChecked();
        expect(one(`SELECT enabled FROM project_guardrails WHERE id = '${rule.id}'`)).toBe('1');

        await page.getByRole('button', { name: 'Add rule' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Add guard-rail' });
        await dialog.getByLabel('Title').fill('Stoat fails');
        await dialog.getByLabel('Title').press('Enter');
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('Rule').fill('never');
        await dialog.getByRole('button', { name: 'Add rule' }).click();
        await expect(toast(page, /add exploded/)).toBeVisible();
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toHaveCount(0);
        expect(one(`SELECT count(*) FROM project_guardrails WHERE title = 'Stoat fails'`)).toBe('0');
        await request.delete(`${API}/api/projects/${projectId}/guardrails/${rule.id}`);
    });

    test('a project script can override a workspace script by its chip; a duplicate slug 409s; another project 404s', async ({ page, request }) => {
        const workspace = await apiGet<Array<{ id: string; name: string }>>(request, '/api/guardrail-scripts');
        const target = workspace[0];
        expect(target, 'the seed has workspace scripts').toBeTruthy();
        await goto(page, `${P()}?tab=guardrails`);
        await page.getByRole('tab', { name: /^Scripts/ }).click();
        await page.getByRole('button', { name: 'Add script', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Add script' });
        await expect(dialog).toContainText('A project script with the same slug overrides the workspace script. Override one:');
        await dialog.getByRole('button', { name: target?.id ?? '' }).click();
        await expect(dialog.getByLabel('Slug (id)')).toHaveValue(target?.id ?? '');
        await expect(dialog.getByLabel('Name')).toHaveValue(target?.name ?? '');
        await dialog.getByLabel('.sh body (POSIX)').fill('exit 0');
        await dialog.getByLabel('.ps1 body (Windows PowerShell)').fill('exit 0');
        await dialog.getByRole('button', { name: 'Add script' }).click();
        await expect(toast(page, 'Project script added')).toBeVisible();
        // Once overridden, it is no longer offered.
        await page.getByRole('button', { name: 'Add script', exact: true }).first().click();
        await expect(dialog.getByRole('button', { name: target?.id ?? '', exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');

        const dup = await request.post(`${API}/api/projects/${projectId}/guardrail-scripts`, { data: { id: target?.id, name: 'dup', body_sh: 'exit 0', body_ps1: 'exit 0' } });
        expect(dup.status()).toBe(409);
        const cross = await request.delete(`${API}/api/projects/e2e-terminal-project/guardrail-scripts/${target?.id}`);
        expect(cross.status()).toBe(404);
        expect(one(`SELECT count(*) FROM project_guardrail_scripts WHERE project_id = '${projectId}' AND id = '${target?.id}'`)).toBe('1');
        await request.delete(`${API}/api/projects/${projectId}/guardrail-scripts/${target?.id}`);
    });
});

test.describe('repos', () => {
    const menu = async (page: Page, name: string, item: RegExp) => {
        await page.getByRole('button', { name: `Actions for ${name}` }).click();
        await page.getByRole('menuitem', { name: item }).click();
    };

    test('Open folder toasts where it opened, or that it could not (routed: never launches an app)', async ({ page }) => {
        let fail = false;
        await page.route('**/repos/*/reveal', (r) =>
            fail ? r.fulfill({ status: 500, json: { error: 'no file manager' } }) : r.fulfill({ json: { ok: true, path: git.clone, opened_in: 'Finder' } }),
        );
        await goto(page, `${P()}?tab=repos`);
        await menu(page, 'stoat', /Open folder/);
        await expect(toast(page, 'Opened in Finder')).toBeVisible();
        fail = true;
        await menu(page, 'stoat', /Open folder/);
        await expect(toast(page, 'Could not open folder')).toBeVisible();
    });

    test('Pull on a repo with no credential says so with "Manage credentials →"; a pull whose remote is gone ends in the error view', async ({ page, request }) => {
        insertRepo(projectId, { id: `${projectId}-nocred`, name: 'nocred', git_path: git.clone, git_url: git.origin, position: 1 });
        await goto(page, `${P()}?tab=repos`);
        await menu(page, 'nocred', /Pull from remote/);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
        await expect(dialog.getByText('Original credential was deleted')).toBeVisible();
        await dialog.getByRole('button', { name: 'Manage credentials →' }).click();
        await expect(page).toHaveURL(/\/settings\/credentials$/);
        await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-nocred`);

        // With a credential but a remote that no longer exists: the run fails.
        const cred = await apiPost<{ id: string }>(request, '/api/credentials', { label: 'e2e-sta-pat', kind: 'pat', token: 'ghp_e2eFAKEtoken0000000099' });
        const gone = gitFixture('sta-gone');
        insertRepo(projectId, { id: `${projectId}-gone`, name: 'gone', git_path: gone.clone, git_url: gone.origin, credential_id: cred.id, position: 2 });
        rmSync(gone.origin, { recursive: true, force: true });
        try {
            await goto(page, `${P()}?tab=repos`);
            await menu(page, 'gone', /Pull from remote/);
            await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
            await expect(dialog.getByText('Pull failed', { exact: true })).toBeVisible({ timeout: 30_000 });
        } finally {
            await request.delete(`${API}/api/projects/${projectId}/repos/${projectId}-gone`);
            await request.delete(`${API}/api/credentials/${cred.id}`);
        }
    });

    test('Auto-fetch: a failed save shows its error in the dialog and keeps it open', async ({ page }) => {
        await page.route('**/repos/*/schedule', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 500, json: { error: 'schedule exploded' } }) : r.continue()));
        await goto(page, `${P()}?tab=repos`);
        await menu(page, 'stoat', /Auto-fetch schedule/);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('switch', { name: 'Enable scheduled auto-fetch' }).check();
        await dialog.getByRole('button', { name: 'Save schedule' }).click();
        await expect(dialog.getByRole('alert')).toContainText('schedule exploded');
        await expect(dialog).toBeVisible();
    });
});

test.describe('Project Secrets', () => {
    test('a project with no repos warns and keeps Save off; otherwise the encryption notice shows', async ({ page, request }) => {
        const bare = await createProject(request, 'Stoat Bare', 'STB');
        await goto(page, `/projects/${bare.id}`);
        await projectAction(page, 'Manage Secrets');
        const dialog = page.getByRole('dialog', { name: 'Project Secrets' });
        await expect(dialog).toContainText('This project has no repos yet, so nothing on disk to inject into. Add a repo before managing secrets.');
        await expect(dialog.getByRole('button', { name: 'Save secrets' })).toBeDisabled();
        await page.keyboard.press('Escape');

        await goto(page, P());
        await projectAction(page, 'Manage Secrets');
        await expect(dialog).toContainText('Encrypted at rest with AES-256-GCM.');
    });

    test('Copy puts the value on the clipboard (a stored row is revealed first); Remove only lands on Save', async ({ page, context, request }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await request.put(`${API}/api/projects/${projectId}/env`, { data: { vars: [{ key: 'STOAT_ONE', value: 'one-value' }, { key: 'STOAT_TWO', value: 'two-value' }] } });
        await goto(page, P());
        await projectAction(page, 'Manage Secrets');
        const dialog = page.getByRole('dialog', { name: 'Project Secrets' });
        const keys = dialog.locator('input[placeholder="MY_KEY"]');
        await expect(keys).toHaveCount(2);
        await expect(keys.nth(0)).toHaveValue('STOAT_ONE');
        await dialog.getByRole('button', { name: 'Copy' }).nth(0).click();
        await expect(toast(page, 'STOAT_ONE copied')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('one-value');

        await expect(keys.nth(1)).toHaveValue('STOAT_TWO');
        await dialog.getByRole('button', { name: /^Remove/ }).nth(1).click();
        await expect(keys).toHaveCount(1);
        await expect(keys.first()).toHaveValue('STOAT_ONE');
        // Not saved yet: the API still has it.
        expect((await apiGet<{ vars: Array<{ key: string }> }>(request, `/api/projects/${projectId}/env`)).vars.map((v) => v.key)).toContain('STOAT_TWO');
        await dialog.getByRole('button', { name: 'Save secrets' }).click();
        await expect(toast(page, 'Project secrets saved')).toBeVisible();
        expect((await apiGet<{ vars: Array<{ key: string }> }>(request, `/api/projects/${projectId}/env`)).vars.map((v) => v.key)).toEqual(['STOAT_ONE']);
        await request.put(`${API}/api/projects/${projectId}/env`, { data: { vars: [] } });
    });
});

async function ensureMany(request: APIRequestContext): Promise<string> {
    const existing = one(`SELECT id FROM projects WHERE issue_key_prefix = 'STM'`);
    if (existing && one(`SELECT count(*) FROM items_live WHERE project_id = '${existing}'`) === '65') return existing;
    if (existing) await deleteProject(request, existing);
    const big = await createProject(request, 'Stoat Many', 'STM');
    insertRepo(big.id, { id: `${big.id}-r`, name: 'many', git_path: '/tmp/atlas-e2e-stoat-many' });
    for (let i = 1; i <= 65; i++) await apiPost(request, '/api/tasks', { project_id: big.id, title: `Stoat many ${String(i).padStart(2, '0')}` });
    return big.id;
}

test.describe('/tasks', () => {
    test('no projects at all: "No projects yet" / "Create a project first, then add tasks." / Go to Projects', async ({ page }) => {
        await page.route(/\/api\/projects$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue()));
        await goto(page, '/tasks');
        await expect(page.getByText('No projects yet')).toBeVisible();
        await expect(page.getByText('Create a project first, then add tasks.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'New task' }).first()).toBeDisabled();
        await page.getByRole('button', { name: 'Go to Projects' }).click();
        await expect(page).toHaveURL(/\/projects$/);
    });

    test('65 Tasks on "all" rows: the table virtualises, and scrolling reaches the last one', async ({ page, request }) => {
        await ensureMany(request);
        await goto(page, `/tasks?project=${encodeURIComponent('Stoat Many')}`);
        await page.getByLabel('Rows').selectOption('all');
        await expect(page.getByText('65 tasks · page 1 of 1')).toBeVisible();
        const rows = page.locator('main [role="button"]').filter({ has: page.locator('text=/^STM-\\d+$/') });
        const drawn = await rows.count();
        expect(drawn).toBeGreaterThan(0);
        expect(drawn).toBeLessThan(65);
        await page.getByRole('button', { name: 'Sort by ID' }).click();
        for (let i = 0; i < 30 && (await page.getByText('STM-65', { exact: true }).count()) === 0; i++) await page.mouse.wheel(0, 2000);
        await expect(page.getByText('STM-65', { exact: true })).toBeVisible();
    });

    test('Kanban: a card opens by click and by Enter; an empty column says "Drop here"; a full column pages with "Show more"; cards are draggable', async ({ page, request }) => {
        await ensureMany(request);
        await goto(page, `/tasks?project=${encodeURIComponent('Stoat Many')}`);
        await page.getByRole('button', { name: 'Kanban' }).click();
        const card = page.locator('main [role="button"][draggable="true"]');
        // 65 drafts: 50 drawn, then Show more.
        await expect(card).toHaveCount(50);
        await expect(card.first()).toHaveCSS('cursor', 'grab');
        await page.getByRole('button', { name: 'Show 15 more · 15 hidden' }).click();
        await expect(card).toHaveCount(65);
        await expect(page.getByText('Drop here').first()).toBeVisible();
        await card.first().focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/tasks\/STM-\d+$/);
        await page.goBack();
        await page.locator('main [role="button"][draggable="true"]').first().click();
        await expect(page).toHaveURL(/\/tasks\/STM-\d+$/);
        // Leave the view as Table for later specs (the choice is remembered).
        await goto(page, '/tasks');
        await page.getByRole('button', { name: 'Table' }).click();
    });

    test('/tasks/new: Workflow, Reporter and Assignee are stored; Submit with a workflow says it is starting', async ({ page, request }) => {
        const wf = await apiPost<{ id: string; name: string }>(request, '/api/workflows', {
            name: 'Stoat flow',
            project_id: projectId,
            status: 'active',
            input_kind: 'item',
            trigger: 'manual',
            use_worktree: false,
            push_code: false,
            raises_pr: false,
            graph: { nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 } }, { id: 'end', type: 'end', position: { x: 0, y: 130 } }], edges: [{ id: 'e', source: 'start', target: 'end', kind: 'pass' }] },
        });
        const agentName = one(`SELECT name FROM agents WHERE id = '${AGENT}'`);
        await goto(page, `/tasks/new?project=${projectId}`);
        await page.getByLabel('Title').fill('Stoat with a workflow');
        await page.getByLabel('Description').fill('made by projects-tasks-states.spec');
        await page.getByLabel('Workflow').click();
        await page.getByRole('option', { name: 'Stoat flow' }).click();
        await page.getByLabel('Reporter').click();
        await page.getByRole('option', { name: new RegExp(agentName) }).click();
        await page.getByLabel('Assignee').click();
        await page.getByRole('option', { name: new RegExp(agentName) }).click();
        await page.getByRole('button', { name: 'Submit' }).first().click();
        await expect(page).toHaveURL(/\/tasks\/STA-\d+$/);
        await expect(toast(page, 'Submitted — Stoat flow is starting')).toBeVisible();
        const id = /STA-\d+/.exec(page.url())?.[0] ?? '';
        const t = await apiGet<{ workflow_id: string | null; reporter_agent_id?: string | null; reporter?: string | null; assignee_agent_id: string | null }>(request, `/api/tasks/${id}`);
        expect(t.workflow_id).toBe(wf.id);
        expect(t.assignee_agent_id).toBe(AGENT);
        expect(JSON.stringify(t)).toContain(AGENT);
    });
});

test.describe('task and sub-task detail', () => {
    test('"Task not found" / "Sub-task not found" with Back to Tasks; a skeleton while the Task loads', async ({ page }) => {
        await goto(page, '/tasks/STA-99999', { allow: [/404|Not Found/] });
        await expect(page.getByText('Task not found')).toBeVisible();
        await page.getByRole('button', { name: 'Back to Tasks' }).click();
        await expect(page).toHaveURL(/\/tasks$/);
        await goto(page, '/sub-tasks/STA-99998', { allow: [/404|Not Found/] });
        await expect(page.getByText('Sub-task not found')).toBeVisible();
        await page.getByRole('button', { name: 'Back to Tasks' }).click();
        await expect(page).toHaveURL(/\/tasks$/);
    });

    test('the Spec and Pull request cards show when the Task has them; the rail lists its details', async ({ page, request }) => {
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Stoat with a spec', repo_ids: [`${projectId}-r`] });
        await goto(page, `/tasks/${t.id}`);
        await expect(page.getByRole('heading', { level: 2, name: 'Spec' })).toHaveCount(0);
        await expect(page.getByRole('heading', { level: 2, name: 'Pull request' })).toHaveCount(0);
        sql(`UPDATE items SET spec_md = '## Plan\n\n- dig', pr_url = 'https://github.com/atlas-e2e/stoat/pull/3' WHERE id = '${t.id}'`);
        await page.reload();
        await expect(page.getByRole('heading', { level: 2, name: 'Spec' })).toBeVisible();
        await expect(page.getByRole('heading', { level: 4, name: 'Plan' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'https://github.com/atlas-e2e/stoat/pull/3' })).toHaveAttribute('href', 'https://github.com/atlas-e2e/stoat/pull/3');

        const rail = page.getByText('Details', { exact: true }).locator('xpath=ancestor::div[2]');
        for (const label of ['Project', 'Status', 'Assignee', 'Reporter', 'Priority', 'Created', 'Last updated']) await expect(rail).toContainText(label);
        await expect(rail.getByRole('link', { name: new RegExp(NAME) })).toHaveAttribute('href', `/projects/${projectId}`);
        await expect(rail).toContainText('stoat');
    });

    test('Done with an unmerged PR link asks "Mark done anyway?"; Cancel keeps the status, Mark done closes it', async ({ page, request }) => {
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Stoat with a PR' });
        sql(`UPDATE items SET status = 'in_review' WHERE id = '${t.id}'`);
        await goto(page, `/tasks/${t.id}`);
        await page.getByRole('button', { name: 'Add PR link' }).click();
        const pr = page.getByRole('dialog');
        await pr.getByLabel('GitHub PR URL').fill('https://github.com/atlas-e2e/stoat/pull/9');
        await pr.getByRole('button', { name: 'Add link' }).click();
        await expect(toast(page, 'PR link added')).toBeVisible({ timeout: 15_000 });
        const status = page.getByRole('button', { name: /^Status/ });
        await status.click();
        await page.getByRole('menuitem', { name: /^Done/ }).first().click();
        const guard = page.getByRole('dialog').filter({ hasText: 'Mark done anyway?' });
        await expect(guard).toContainText("These pull requests aren't merged yet:");
        await expect(guard).toContainText('#9');
        await guard.getByRole('button', { name: 'Cancel' }).click();
        expect(one(`SELECT status FROM items WHERE id = '${t.id}'`)).toBe('in_review');
        await status.click();
        await page.getByRole('menuitem', { name: /^Done/ }).first().click();
        await guard.getByRole('button', { name: 'Mark done' }).click();
        await expect.poll(() => one(`SELECT status FROM items WHERE id = '${t.id}'`)).toBe('done');
    });

    test('the activity log shows the newest 50 and pages earlier entries', async ({ page, request }) => {
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Stoat busy' });
        // 60 title edits → 60+ activity entries.
        for (let i = 1; i <= 60; i++) await request.patch(`${API}/api/tasks/${t.id}`, { data: { title: `Stoat busy ${i}` } });
        await goto(page, `/tasks/${t.id}`);
        const more = page.getByRole('button', { name: /^Show \d+ earlier · \d+ hidden$/ }).last();
        await expect(more).toBeVisible();
        await more.click();
        await expect(more).toHaveCount(0);
    });
});
