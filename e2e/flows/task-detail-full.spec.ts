import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, insertRepo } from '../helpers/projects.js';
import { ISSUE_STATUSES, STATUS_LABELS, getValidNextStatuses, type IssueStatus } from '../../packages/shared/src/index.js';

// /tasks/:id and /sub-tasks/:id against the real API, on a project of its own
// (prefix VTD): title / description / acceptance criteria / priority / labels /
// assignee persist on both kinds; the status menu offers exactly the status
// machine's moves; a Task with an open sub-task cannot close (the 422 says
// why); comments post / edit / delete and render GFM; a refused mutation
// toasts; links and PR links; reorder; clone; delete without a 404 refetch;
// and the assign lock follows a live workflow run.

const NAME = 'Vole Detail';
let projectId = '';
let taskId = '';
let subIds: string[] = [];
let agent = { id: '', name: '' };

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'VTD'`)) {
        sql(`DELETE FROM workflow_runs WHERE project_id = '${id}'`);
        await deleteProject(request, id ?? '');
    }
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    projectId = (await createProject(request, NAME, 'VTD')).id;
    insertRepo(projectId, { id: `${projectId}-r`, name: 'vole', git_path: '/tmp/atlas-e2e-vole' });
    taskId = (await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: 'Vole task', description: 'Original description' })).id;
    subIds = [];
    for (const t of ['Vole sub one', 'Vole sub two', 'Vole sub three']) {
        subIds.push((await apiPost<{ id: string }>(request, `/api/tasks/${taskId}/sub-tasks`, { title: t })).id);
    }
    const [id, name] = one(`SELECT id || '|' || name FROM agents WHERE status = 'active' ORDER BY created_at LIMIT 1`).split('|');
    agent = { id: id ?? '', name: name ?? '' };
});
test.afterAll(async ({ request }) => cleanup(request));

type Kind = 'task' | 'sub_task';
const KINDS: Array<{ kind: Kind; path: () => string; api: () => string; id: () => string }> = [
    { kind: 'task', path: () => `/tasks/${taskId}`, api: () => `/api/tasks/${taskId}`, id: () => taskId },
    { kind: 'sub_task', path: () => `/sub-tasks/${subIds[0]}`, api: () => `/api/sub-tasks/${subIds[0]}`, id: () => subIds[0] ?? '' },
];

// The card title's Typography → header row → card.
const card = (page: Page, title: string) => page.getByText(title, { exact: true }).locator('xpath=ancestor::div[2]');
const railRow = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(`^${label}\\b`) });

for (const k of KINDS) {
    test.describe(`${k.kind === 'task' ? 'Task' : 'Sub-task'} detail`, () => {
        test('title, description and acceptance criteria save, render and survive a reload', async ({ page, request }) => {
            await goto(page, k.path());
            await page.getByRole('heading', { level: 1 }).click();
            const field = page.getByRole('textbox').first();
            await field.fill(`Edited ${k.kind} title`);
            await field.press('Enter');
            await expect(page.getByRole('heading', { level: 1, name: `Edited ${k.kind} title` })).toBeVisible();

            await card(page, 'Description').getByRole('button', { name: 'Edit', exact: true }).click();
            await card(page, 'Description').getByRole('textbox').fill('## Why\n\nBecause **voles** dig.');
            await card(page, 'Description').getByRole('button', { name: 'Save' }).click();
            // Markdown headings render as styled text, not heading elements.
            await expect(card(page, 'Description').getByText('Why', { exact: true })).toBeVisible();
            await expect(card(page, 'Description')).not.toContainText('##');
            await expect(page.locator('strong', { hasText: 'voles' })).toBeVisible();

            await card(page, 'Acceptance criteria').getByRole('button', { name: 'Edit', exact: true }).click();
            await card(page, 'Acceptance criteria').getByRole('textbox').fill('- burrow exists\n- burrow is dry');
            await card(page, 'Acceptance criteria').getByRole('button', { name: 'Save' }).click();
            await expect(page.getByRole('listitem').filter({ hasText: 'burrow is dry' })).toBeVisible();

            await page.reload();
            await expect(page.getByRole('heading', { level: 1, name: `Edited ${k.kind} title` })).toBeVisible();
            expect(await apiGet<Record<string, string>>(request, k.api())).toMatchObject({
                title: `Edited ${k.kind} title`,
                description: '## Why\n\nBecause **voles** dig.',
                acceptance_criteria: '- burrow exists\n- burrow is dry',
            });
        });

        test('priority, labels and assignee persist', async ({ page, request }) => {
            await goto(page, k.path());
            await railRow(page, 'Priority').click();
            await page.getByRole('menuitem', { name: 'Urgent' }).click();
            await expect(railRow(page, 'Priority')).toContainText('Urgent');

            await page.getByRole('button', { name: 'Add labels' }).click();
            const labelInput = page.getByPlaceholder('Type a label…');
            await labelInput.fill('backend');
            await labelInput.press('Enter');
            await labelInput.fill('needs-review');
            await labelInput.press('Enter');
            // Labels stage while the editor is open and save once on blur.
            await labelInput.blur();
            await expect.poll(async () => (await apiGet<{ labels: string[] }>(request, k.api())).labels).toEqual(['backend', 'needs-review']);

            await railRow(page, 'Assignee').click();
            await page.getByRole('menuitem', { name: new RegExp(agent.name) }).click();
            await expect.poll(async () => (await apiGet<{ assignee_agent_id: string | null }>(request, k.api())).assignee_agent_id).toBe(agent.id);
            await page.reload();
            await expect(railRow(page, 'Assignee')).toContainText(agent.name);
            await expect(railRow(page, 'Priority')).toContainText('Urgent');
            expect((await apiGet<{ priority: string }>(request, k.api())).priority).toBe('urgent');
            // Back to the Owner for the tests after this one.
            await request.patch(`${API}${k.api()}/assign`, { data: { assignee_agent_id: null } });
        });

        test('the status menu offers exactly the status machine\'s moves, then the rest under Override', async ({ page }) => {
            for (const from of ['draft', 'in_progress', 'in_review', 'done'] as IssueStatus[]) {
                sql(`UPDATE items SET status = '${from}' WHERE id = '${k.id()}'`);
                await goto(page, k.path());
                await railRow(page, 'Status').click();
                const valid = getValidNextStatuses('task', from);
                const rest = ISSUE_STATUSES.filter((s) => s !== from && !valid.includes(s));
                await expect(page.getByRole('menuitem')).toHaveText([from, ...valid, ...rest].map((s) => new RegExp(`^${STATUS_LABELS[s]}`)));
                await expect(page.getByRole('menu')).toContainText('Move to');
                if (rest.length) await expect(page.getByRole('menu')).toContainText('Override');
                await page.keyboard.press('Escape');
            }
            sql(`UPDATE items SET status = 'draft' WHERE id = '${k.id()}'`);
            await goto(page, k.path());
            await railRow(page, 'Status').click();
            await page.getByRole('menuitem', { name: 'Ready' }).click();
            await expect(railRow(page, 'Status')).toContainText('Ready');
            expect(one(`SELECT status FROM items WHERE id = '${k.id()}'`)).toBe('ready');
        });

        test('comments post, edit and delete; a GFM table and a fenced block render, the block scrolls inside the page at 390px', async ({ page, request }) => {
            await goto(page, k.path());
            const composer = page.getByPlaceholder('Comment on this item…');
            await composer.fill('First vole note');
            await page.getByRole('button', { name: 'Post' }).click();
            await expect(page.getByText('First vole note')).toBeVisible();
            await expect(composer).toHaveValue('');

            const row = page.locator('div').filter({ has: page.getByText('First vole note') }).filter({ has: page.getByRole('button', { name: 'Edit comment' }) }).last();
            await row.hover();
            await row.getByRole('button', { name: 'Edit comment' }).click();
            // Editing swaps the text for a focused textarea, so the row locator no longer matches.
            const editor = page.locator('textarea:focus');
            await expect(editor).toHaveValue('First vole note');
            await editor.fill('First vole note, edited');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect(page.getByText('First vole note, edited')).toBeVisible();
            await expect(page.getByText('edited', { exact: true })).toBeVisible();

            const long = 'x'.repeat(400);
            await composer.fill(`| Burrow | Depth |\n| --- | --- |\n| north | 2m |\n\n\`\`\`sh\necho ${long}\n\`\`\``);
            await page.getByRole('button', { name: 'Post' }).click();
            const table = page.locator('table').filter({ hasText: 'north' });
            await expect(table).toBeVisible();
            await expect(table.getByRole('columnheader', { name: 'Depth' })).toBeVisible();
            const pre = page.locator('pre').filter({ hasText: long });
            await expect(pre).toBeVisible();
            await page.setViewportSize({ width: 390, height: 844 });
            await expect(pre).toBeVisible();
            const box = await pre.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
            expect(box.sw).toBeGreaterThan(box.cw);
            expect(['auto', 'scroll']).toContain(box.ox);
            expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
            await page.setViewportSize({ width: 1920, height: 1080 });

            const edited = page.locator('div').filter({ has: page.getByText('First vole note, edited') }).filter({ has: page.getByRole('button', { name: 'Delete comment' }) }).last();
            await edited.hover();
            await edited.getByRole('button', { name: 'Delete comment' }).click();
            const confirm = page.getByRole('dialog', { name: 'Delete this comment?' });
            await confirm.getByRole('button', { name: 'Delete' }).click();
            await expect(confirm).toHaveCount(0);
            await expect(page.getByText('First vole note, edited')).toHaveCount(0);
            const left = await apiGet<Array<{ body: string }>>(request, `/api/comments?issue_type=${k.kind}&issue_id=${k.id()}`);
            expect(left.map((c) => c.body).some((b) => b.startsWith('First vole note'))).toBe(false);
        });

        test('a refused save and a refused status move each toast the reason; the editor stays open', async ({ page }) => {
            await goto(page, k.path());
            await page.route(`**${k.api()}`, (r) => (r.request().method() === 'PATCH' ? r.fulfill({ status: 500, json: { error: 'disk full' } }) : r.continue()));
            await page.getByRole('heading', { level: 1 }).click();
            const field = page.getByRole('textbox').first();
            await field.fill('Will not save');
            await field.press('Enter');
            await expect(page.getByText(`Couldn't save ${k.id()}`)).toBeVisible();
            await expect(page.getByText('disk full')).toBeVisible();
            await expect(field).toBeVisible();
            await page.getByRole('button', { name: 'Cancel title edit' }).click();

            await page.route(`**${k.api()}/status**`, (r) =>
                r.fulfill({ status: 409, json: { error: 'A workflow run is working on this item and owns its status and assignee.', kind: 'conflict' } }),
            );
            await railRow(page, 'Status').click();
            await page.getByRole('menuitem').nth(1).click();
            await expect(page.getByText(`Couldn't move ${k.id()}`)).toHaveCount(1);
            await expect(page.getByText('A workflow run is working on this item and owns its status and assignee.')).toBeVisible();
        });

        test('Link an item and Add PR link attach and list', async ({ page }) => {
            const other = k.kind === 'task' ? subIds[2] ?? '' : subIds[1] ?? '';
            await goto(page, k.path());
            await page.getByRole('button', { name: 'Add related item' }).click();
            await page.getByRole('menuitem', { name: 'Link an item' }).click();
            const picker = page.getByRole('dialog');
            await picker.getByLabel('Id or title').fill(other);
            await picker.getByRole('button', { name: new RegExp(other) }).click();
            await expect(page.getByText(`Linked to ${other}`)).toBeVisible();
            await expect(page.getByText(/Relates to/i).first()).toBeVisible();
            await expect(page.getByRole('button', { name: new RegExp(`${other}(?!\\d)`) }).first()).toBeVisible();

            await page.getByRole('button', { name: 'Add PR link' }).click();
            const pr = page.getByRole('dialog');
            await pr.getByLabel('GitHub PR URL').fill('not a url');
            await pr.getByRole('button', { name: 'Add link' }).click();
            await expect(pr.getByText(/Enter a GitHub PR URL/)).toBeVisible();
            await pr.getByLabel('GitHub PR URL').fill(`https://github.com/atlas-e2e/does-not-exist/pull/${k.kind === 'task' ? 7 : 8}`);
            await pr.getByRole('button', { name: 'Add link' }).click();
            await expect(page.getByText('PR link added')).toBeVisible({ timeout: 15_000 });
            await expect(page.getByText(`#${k.kind === 'task' ? 7 : 8}`).first()).toBeVisible();
            expect(Number(one(`SELECT count(*) FROM item_external_links WHERE item_id = '${k.id()}' AND link_kind = 'pull_request'`))).toBe(1);
        });
    });
}

test.describe('Task-only and sub-task-only', () => {
    test('a Task with an open sub-task cannot close: the 422 reason is shown and the status stays', async ({ page }) => {
        sql(`UPDATE items SET status = 'in_review' WHERE id = '${taskId}'`);
        sql(`DELETE FROM item_external_links WHERE item_id = '${taskId}'`);
        await goto(page, `/tasks/${taskId}`);
        const res = page.waitForResponse((r) => r.url().includes(`/api/tasks/${taskId}/status`));
        await railRow(page, 'Status').click();
        await page.getByRole('menuitem', { name: 'Done' }).first().click();
        expect((await res).status()).toBe(422);
        await expect(page.getByText('Cannot close — open children')).toBeVisible();
        await expect(page.getByText(/ are not done yet\.$/)).toBeVisible();
        await expect(railRow(page, 'Status')).toContainText('In Review');
        expect(one(`SELECT status FROM items WHERE id = '${taskId}'`)).toBe('in_review');
    });

    test('Reorder moves a sub-task and the order persists', async ({ page, request }) => {
        await goto(page, `/tasks/${taskId}`);
        await page.getByRole('button', { name: 'Reorder' }).click();
        const dialog = page.getByRole('dialog', { name: 'Reorder sub-tasks' });
        await expect(dialog.getByRole('list', { name: 'Sub-task order' }).getByRole('listitem')).toHaveCount(3);
        await expect(dialog.getByRole('button', { name: `Move ${subIds[0]} up` })).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Save order' })).toBeDisabled();
        await dialog.getByRole('button', { name: `Move ${subIds[2]} up` }).click();
        await dialog.getByRole('button', { name: 'Save order' }).click();
        await expect(dialog).toHaveCount(0);
        const order = [subIds[0], subIds[2], subIds[1]];
        const full = await apiGet<{ sub_tasks: Array<{ id: string }> }>(request, `/api/tasks/${taskId}/full`);
        expect(full.sub_tasks.map((s) => s.id)).toEqual(order);
        await page.reload();
        // The Sub-tasks table is the first list of these ids on the page (Related items comes later).
        await expect(page.getByRole('button', { name: new RegExp(`${subIds[1]}(?!\\d)`) }).first()).toBeVisible();
        const names = await page.getByRole('button', { name: /VTD-\d+/ }).allInnerTexts();
        const firstSeen = [...new Set(names.map((t) => /VTD-\d+/.exec(t)?.[0]).filter((x) => order.includes(x)))];
        expect(firstSeen).toEqual(order);
    });

    test('Clone item makes "Copy of …" under the same Task, related to the original', async ({ page, request }) => {
        const src = subIds[1] ?? '';
        await goto(page, `/sub-tasks/${src}`);
        await page.getByRole('button', { name: 'Sub-task actions' }).click();
        await page.getByRole('menuitem', { name: 'Clone item…' }).click();
        await expect(page).not.toHaveURL(new RegExp(`/sub-tasks/${src}$`));
        await expect(page).toHaveURL(/\/sub-tasks\/VTD-\d+$/);
        const clone = /VTD-\d+/.exec(page.url())?.[0] ?? '';
        const title = one(`SELECT title FROM items WHERE id = '${src}'`);
        await expect(page.getByRole('heading', { level: 1, name: `Copy of ${title}` })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(taskId);
        const full = await apiGet<{ sub_task: { task_id: string }; related_links: Array<{ to_id?: string; from_id?: string; relation_type: string }> }>(request, `/api/sub-tasks/${clone}/full`);
        expect(full.sub_task.task_id).toBe(taskId);
        expect(JSON.stringify(full.related_links)).toContain(src);
        await expect(page.getByRole('button', { name: new RegExp(`${src}(?!\\d)`) }).first()).toBeVisible();
    });

    test('the assign lock follows a live workflow run, and the API refuses the move meanwhile', async ({ page, request }) => {
        const wf = await apiPost<{ id: string }>(request, '/api/workflows', {
            name: 'Vole lock',
            project_id: projectId,
            status: 'active',
            input_kind: 'item',
            trigger: 'manual',
            use_worktree: false,
            push_code: false,
            raises_pr: false,
            graph: { nodes: [{ id: 'start', type: 'start', position: { x: 0, y: 0 } }, { id: 'end', type: 'end', position: { x: 0, y: 130 } }], edges: [{ id: 'e', source: 'start', target: 'end', kind: 'pass' }] },
        });
        sql(`INSERT INTO workflow_runs (id, workflow_id, item_id, project_id, status, graph_snapshot) VALUES ('vtd-lock-run', '${wf.id}', '${taskId}', '${projectId}', 'running', '{}'::jsonb)`);
        try {
            await goto(page, `/tasks/${taskId}`);
            await expect(page.getByRole('img', { name: 'Locked while a workflow run works this item' })).toHaveCount(2);
            await expect(railRow(page, 'Status')).toHaveCount(0);
            await expect(railRow(page, 'Assignee')).toHaveCount(0);
            const res = await request.patch(`${API}/api/tasks/${taskId}/status`, { data: { status: 'in_progress' } });
            expect(res.status()).toBe(409);
        } finally {
            sql(`DELETE FROM workflow_runs WHERE id = 'vtd-lock-run'`);
        }
        await page.reload();
        await expect(railRow(page, 'Status')).toBeVisible();
    });

    for (const kind of ['sub_task', 'task'] as const) {
        test(`deleting a ${kind === 'task' ? 'Task' : 'sub-task'} navigates away with no 404 refetch`, async ({ page }) => {
            const id = kind === 'task' ? taskId : subIds[2] ?? '';
            const label = kind === 'task' ? 'task' : 'sub-task';
            const notFound: string[] = [];
            page.on('response', (r) => {
                if (r.status() === 404 && r.url().includes(`/${id}`)) notFound.push(r.url());
            });
            await goto(page, kind === 'task' ? `/tasks/${id}` : `/sub-tasks/${id}`);
            await page.getByRole('button', { name: kind === 'task' ? 'Task actions' : 'Sub-task actions' }).click();
            await page.getByRole('menuitem', { name: `Delete this ${label}…` }).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog.getByText(`Delete this ${label}?`)).toBeVisible();
            await dialog.getByRole('button', { name: `Delete ${label}` }).click();
            await expect(page).toHaveURL(kind === 'task' ? /\/tasks$/ : new RegExp(`/tasks/${taskId}$`));
            // Let any late refetch land before checking.
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
            await page.waitForLoadState('load');
            expect(notFound).toEqual([]);
            expect(one(`SELECT count(*) FROM items_live WHERE id = '${id}'`)).toBe('0');
        });
    }
});
