import { readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, gitFixture, insertRepo } from '../helpers/projects.js';

// Gaps the earlier Projects / Tasks specs left, against the real API on a
// project of its own (prefix MOR): /tasks loading and failed loads with Retry;
// the shell title per item kind; markdown headings as real headings on both
// detail pages; History, Recent activity and an item's runs refreshing live on
// run events; the Setup tab's failed / loading workflow list; the "Applies to"
// field staying gone; and setup scripts running for real (a terminal session
// starts in a worktree, `${variable.KEY}` resolves from project secrets, a
// failing script refuses the session and masks the secret).

const NAME = 'Marten More';
const AGENT = 'agent-po-writer';
let projectId = '';
let taskId = '';
let subId = '';
let git = { origin: '', clone: '' };
const OUT = join(tmpdir(), 'atlas-e2e-fixtures', 'mor-setup-out.txt');

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'MOR'`)) {
        sql(`DELETE FROM cli_sessions WHERE project_id = '${id}'`);
        sql(`DELETE FROM agent_runs WHERE project_id = '${id}' OR item_id IN (SELECT id FROM items WHERE project_id = '${id}')`);
        sql(`DELETE FROM workflow_runs WHERE project_id = '${id}'`);
        for (const [wf] of sql(`SELECT id FROM workflows WHERE project_id = '${id}'`)) await request.delete(`${API}/api/workflows/${wf}`);
        await deleteProject(request, id ?? '');
    }
    rmSync(OUT, { force: true });
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    projectId = (await createProject(request, NAME, 'MOR', 'Gap-closing fixture')).id;
    git = gitFixture('mor');
    insertRepo(projectId, { id: `${projectId}-r`, name: 'marten', git_path: git.clone, git_url: git.origin });
    taskId = (await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Marten task' })).id;
    subId = (await apiPost<{ id: string }>(request, `/api/tasks/${taskId}/sub-tasks`, { title: 'Marten sub-task' })).id;
});
test.afterAll(async ({ request }) => cleanup(request));

const rows = (page: Page) => page.locator('main [role="button"]').filter({ has: page.locator('text=/^MOR-\\d+$/') });

test.describe('/tasks loading and failures', () => {
    test('skeleton rows show while the Tasks request is in flight, never the empty state', async ({ page }) => {
        let release: () => void = () => {};
        const held = new Promise<void>((r) => (release = r));
        await page.route('**/api/tasks?**', async (r) => {
            await held;
            await r.continue();
        });
        await page.goto(`/tasks?project=${encodeURIComponent(NAME)}`);
        await expect(page.locator('main .MuiSkeleton-root')).toHaveCount(5);
        await expect(page.getByText('No tasks match this view.')).toHaveCount(0);
        release();
        await expect(page.locator('main .MuiSkeleton-root')).toHaveCount(0);
        await expect(rows(page)).toHaveCount(1);
    });

    test('a failed Tasks load says "Could not load tasks" with Retry, not an empty list; Retry recovers', async ({ page }) => {
        let fail = true;
        await page.route('**/api/tasks?**', (r) => (fail ? r.fulfill({ status: 500, json: { error: 'tasks exploded' } }) : r.continue()));
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`, { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Could not load tasks — Something went wrong')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('tasks exploded')).toBeVisible();
        await expect(page.getByText('No tasks match this view.')).toHaveCount(0);
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(rows(page)).toHaveCount(1);
        await expect(page.getByText('Could not load tasks')).toHaveCount(0);
    });

    test('a failed projects load says "Could not load projects" with Retry, not "No projects yet"; Retry recovers', async ({ page }) => {
        let fail = true;
        await page.route(/\/api\/projects$/, (r) => (fail && r.request().method() === 'GET' ? r.fulfill({ status: 500, json: { error: 'projects exploded' } }) : r.continue()));
        await goto(page, '/tasks', { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Could not load projects — Something went wrong')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('No projects yet')).toHaveCount(0);
        fail = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(page.getByRole('button', { name: /Marten task/ })).toBeVisible();
    });
});

test.describe('detail pages', () => {
    test('the shell names the page by its id and kind ("Task" / "Sub-task"); the browser tab stays "Atlas"', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await goto(page, `/tasks/${taskId}`);
        const bar = page.getByRole('banner').first();
        await expect(bar).toContainText(taskId);
        await expect(bar).toContainText('Task');
        await expect(page).toHaveTitle('Atlas');
        await goto(page, `/sub-tasks/${subId}`);
        await expect(bar).toContainText(subId);
        await expect(bar).toContainText('Sub-task');
        await goto(page, '/tasks');
        await expect(bar).toContainText('Tasks');
        await expect(bar).not.toContainText(subId);
    });

    for (const kind of ['task', 'sub-task'] as const) {
        test(`${kind} detail: card titles are h2 and markdown headings are h3–h6 under them`, async ({ page, request }) => {
            const api = kind === 'task' ? `/api/tasks/${taskId}` : `/api/sub-tasks/${subId}`;
            await request.patch(`${API}${api}`, { data: { description: '# Burrow\n\n## Tunnels\n\n### Exits\n\n#### Vents\n\n##### Deep\n\nplain text' } });
            await goto(page, kind === 'task' ? `/tasks/${taskId}` : `/sub-tasks/${subId}`);
            for (const t of ['Description', 'Acceptance criteria', 'Conversation', 'Activity log']) {
                await expect(page.getByRole('heading', { level: 2, name: t, exact: true })).toBeVisible();
            }
            if (kind === 'task') {
                await page.getByRole('button', { name: 'Add sub-task', exact: true }).first().click();
                await expect(page.getByRole('heading', { level: 2, name: 'New sub-task', exact: true })).toBeVisible();
            }
            await expect(page.getByRole('heading', { level: 3, name: 'Burrow' })).toBeVisible();
            await expect(page.getByRole('heading', { level: 4, name: 'Tunnels' })).toBeVisible();
            await expect(page.getByRole('heading', { level: 5, name: 'Exits' })).toBeVisible();
            await expect(page.getByRole('heading', { level: 6, name: 'Vents' })).toBeVisible();
            await expect(page.getByRole('heading', { level: 6, name: 'Deep' })).toBeVisible();
            // One h1: the item's title.
            await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
            await expect(page.getByText('plain text')).not.toHaveRole('heading');
        });
    }
});

test.describe('live run refresh', () => {
    test('History and Recent activity show a new run and its finish without a reload', async ({ page, request }) => {
        sql(`DELETE FROM agent_runs WHERE project_id = '${projectId}'`);
        await goto(page, `/projects/${projectId}?tab=history`);
        await expect(page.getByText('No agent activity yet for this project.')).toBeVisible();
        const { runId } = await apiPost<{ runId: string }>(request, '/api/run', { agent_id: AGENT, project_id: projectId });
        await expect(page.getByRole('link', { name: 'View run' })).toHaveCount(1);
        await expect(page.getByRole('link', { name: 'View run' })).toHaveAttribute('href', new RegExp(`/runs/${runId}$`));
        await expect(page.getByLabel('Completed', { exact: true })).toBeVisible({ timeout: 20_000 });

        await page.getByRole('tab', { name: /Overview/ }).click();
        await expect(page.getByRole('link', { name: 'View run' })).toHaveCount(1);
        const second = await apiPost<{ runId: string }>(request, '/api/run', { agent_id: AGENT, project_id: projectId });
        await expect(page.getByRole('link', { name: 'View run' })).toHaveCount(2);
        await expect(page.getByRole('link', { name: 'View run' }).first()).toHaveAttribute('href', new RegExp(`/runs/${second.runId}$`));
        await expect(page.getByLabel('Completed', { exact: true })).toHaveCount(2, { timeout: 20_000 });
    });

    test('a Task page refetches its runs when a workflow run works it', async ({ page, request }) => {
        const wf = await apiPost<{ id: string }>(request, '/api/workflows', {
            name: 'Marten live',
            project_id: projectId,
            status: 'active',
            input_kind: 'item',
            trigger: 'manual',
            use_worktree: true,
            push_code: false,
            raises_pr: false,
            graph: {
                nodes: [
                    { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                    { id: 'a', type: 'agent', agent_id: AGENT, position: { x: 0, y: 130 } },
                    { id: 'end', type: 'end', position: { x: 0, y: 260 } },
                ],
                edges: [
                    { id: 'e1', source: 'start', target: 'a', kind: 'pass' },
                    { id: 'e2', source: 'a', target: 'end', kind: 'pass' },
                ],
            },
        });
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Marten live task' });
        const fetches: string[] = [];
        page.on('response', (r) => {
            if (r.url().includes(`/api/run?`) && r.url().includes(`issue_id=${t.id}`)) fetches.push(r.url());
        });
        await goto(page, `/tasks/${t.id}`);
        await expect.poll(() => fetches.length).toBeGreaterThan(0);
        const before = fetches.length;
        const put = await request.put(`${API}/api/items/${t.id}/workflow`, { data: { workflow_id: wf.id } });
        expect(put.status(), await put.text()).toBeLessThan(300);
        const { run_id } = await apiPost<{ run_id: string }>(request, `/api/workflows/${wf.id}/runs`, { item_id: t.id });
        await expect.poll(() => one(`SELECT status FROM workflow_runs WHERE id = '${run_id}'`), { timeout: 60_000, intervals: [1_000] }).toBe('completed');
        await expect.poll(() => fetches.length, { timeout: 10_000 }).toBeGreaterThan(before);
        expect(Number(one(`SELECT count(*) FROM agent_runs WHERE item_id = '${t.id}'`))).toBe(1);
    });
});

test.describe('Setup tab and guard-rails', () => {
    test('a failed workflows load shows Retry instead of a "None" default; the picker waits while loading', async ({ page }) => {
        let mode: 'fail' | 'hold' | 'pass' = 'fail';
        let release: () => void = () => {};
        const held = new Promise<void>((r) => (release = r));
        await page.route(/\/api\/workflows(\?.*)?$/, async (r) => {
            if (r.request().method() !== 'GET') return r.continue();
            if (mode === 'fail') return r.fulfill({ status: 500, json: { error: 'workflows exploded' } });
            if (mode === 'hold') await held;
            return r.continue();
        });
        await goto(page, `/projects/${projectId}?tab=setup`, { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Could not load workflows — Something went wrong')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('None — Tasks wait until you pick one')).toHaveCount(0);
        mode = 'hold';
        await page.getByRole('button', { name: 'Retry' }).click();
        const picker = page.getByRole('combobox', { name: 'Default workflow' });
        await expect(picker).toBeVisible();
        await expect(picker).toHaveAttribute('aria-disabled', 'true');
        release();
        mode = 'pass';
        await expect(picker).not.toHaveAttribute('aria-disabled', 'true');
        await expect(picker).toContainText('None — Tasks wait until you pick one');
    });

    test('Add guard-rail has Title and Rule only — the old "Applies to" field stays gone', async ({ page }) => {
        await goto(page, `/projects/${projectId}?tab=guardrails`);
        await page.getByRole('button', { name: 'Add rule' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Add guard-rail' });
        await expect(dialog.getByLabel('Title')).toBeVisible();
        await expect(dialog.getByLabel('Rule')).toBeVisible();
        await expect(dialog.getByText(/Applies to/i)).toHaveCount(0);
        await expect(dialog.getByRole('textbox')).toHaveCount(2);
        await page.keyboard.press('Escape');
    });
});

test.describe('setup scripts run for real', () => {
    const repoUrl = () => `${API}/api/projects/${projectId}/repos/${projectId}-r`;
    const startSession = (request: APIRequestContext) => request.post(`${API}/api/cli/sessions`, { data: { project_id: projectId, title: 'MOR setup' } });
    async function endSession(request: APIRequestContext, body: { id: string; worktree_path?: string | null }) {
        await request.delete(`${API}/api/cli/sessions/${body.id}`);
        if (body.worktree_path) {
            try {
                execFileSync('git', ['-C', git.clone, 'worktree', 'remove', '--force', body.worktree_path], { stdio: 'pipe' });
            } catch {
                rmSync(body.worktree_path, { recursive: true, force: true });
            }
        }
        execFileSync('git', ['-C', git.clone, 'worktree', 'prune'], { stdio: 'pipe' });
    }
    test.afterEach(async ({ request }) => {
        await request.patch(repoUrl(), { data: { setup_sh_body: '', setup_ps1_body: '' } });
        await request.put(`${API}/api/projects/${projectId}/env`, { data: { vars: [] } });
        rmSync(OUT, { force: true });
    });

    test('the .sh saved on the Setup tab runs in the session\'s worktree with ${variable.KEY} from the project\'s secrets', async ({ page, request }) => {
        const put = await request.put(`${API}/api/projects/${projectId}/env`, { data: { vars: [{ key: 'MARTEN_TOKEN', value: 'burrow-secret-42' }] } });
        expect(put.status(), await put.text()).toBeLessThan(300);
        await goto(page, `/projects/${projectId}?tab=setup`);
        await page.getByRole('button', { name: 'Edit setup scripts for marten' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Bash setup script').fill(`printf '%s\\n' "\${variable.MARTEN_TOKEN}" > "${OUT}"\npwd >> "${OUT}"`);
        await dialog.getByRole('button', { name: 'Save scripts' }).click();
        await expect(page.getByText('Setup scripts saved for marten')).toBeVisible();

        const res = await startSession(request);
        expect(res.status(), await res.text()).toBe(201);
        const body = (await res.json()) as { id: string; worktree_path: string | null };
        try {
            expect(existsSync(OUT)).toBe(true);
            const [value, cwd] = readFileSync(OUT, 'utf8').trim().split('\n');
            expect(value).toBe('burrow-secret-42');
            // It ran inside the session's worktree, not the repo folder.
            expect(cwd).not.toBe(git.clone);
            expect(body.worktree_path && cwd?.endsWith(body.worktree_path.split('/').slice(-1)[0] ?? '')).toBeTruthy();
        } finally {
            await endSession(request, body);
        }
    });

    test('a failing script refuses the session (400 project_setup_failed) with its output, secrets masked, and leaves no session', async ({ request }) => {
        await request.put(`${API}/api/projects/${projectId}/env`, { data: { vars: [{ key: 'MARTEN_TOKEN', value: 'burrow-secret-42' }] } });
        await request.patch(repoUrl(), { data: { setup_sh_body: 'echo "using ${variable.MARTEN_TOKEN}"\necho "npm install failed" >&2\nexit 3' } });
        const before = one(`SELECT count(*) FROM cli_sessions WHERE project_id = '${projectId}'`);
        const worktrees = () => execFileSync('git', ['-C', git.clone, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).match(/^worktree /gm)?.length;
        const worktreesBefore = worktrees();
        const res = await startSession(request);
        expect(res.status()).toBe(400);
        const body = (await res.json()) as { error: string; kind: string };
        expect(body.kind).toBe('project_setup_failed');
        expect(body.error).toMatch(/^project setup script failed: /);
        expect(body.error).toContain('npm install failed');
        expect(body.error).not.toContain('burrow-secret-42');
        expect(body.error).toContain('***');
        expect(one(`SELECT count(*) FROM cli_sessions WHERE project_id = '${projectId}'`)).toBe(before);
        // The worktree it made for the session is gone again.
        // (A workflow run elsewhere in this file may keep its own worktree; count against before.)
        expect(worktrees()).toBe(worktreesBefore);
    });

    test('an unknown ${variable.KEY} is refused before anything runs', async ({ request }) => {
        await request.patch(repoUrl(), { data: { setup_sh_body: `echo "\${variable.NOT_A_SECRET}" > "${OUT}"` } });
        const res = await startSession(request);
        expect(res.status()).toBe(400);
        const body = (await res.json()) as { error: string; kind: string };
        expect(body).toMatchObject({ kind: 'project_setup_failed' });
        expect(body.error).toContain('Unknown secret: ${variable.NOT_A_SECRET}');
        expect(existsSync(OUT)).toBe(false);
    });

    test('the API keeps project secrets out of list reads', async ({ request }) => {
        await request.put(`${API}/api/projects/${projectId}/env`, { data: { vars: [{ key: 'MARTEN_TOKEN', value: 'burrow-secret-42' }] } });
        const list = await request.get(`${API}/api/projects/${projectId}/env`);
        expect(await list.text()).not.toContain('burrow-secret-42');
        const repos = await apiGet<unknown>(request, `/api/projects/${projectId}/repos`);
        expect(JSON.stringify(repos)).not.toContain('burrow-secret-42');
    });
});
