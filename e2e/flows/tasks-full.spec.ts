import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { API, apiGet, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, insertRepo } from '../helpers/projects.js';

// /tasks (table + Kanban) and /tasks/new against the real API, on a project
// of its own (prefix WTK, 23 Tasks): every filter and the subtitle that counts
// what is on screen, search by id, sort, paging, the archived switch, a legal
// Kanban drag (persisted), a refused one (exactly one toast), and the create
// form (Submit → Ready, Save as draft → Draft, priority Low, repos).

const NAME = 'Wombat Tasks';
let projectId = '';
let agentId = '';
const COUNT = 23;

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'WTK'`)) await deleteProject(request, id ?? '');
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    projectId = (await createProject(request, NAME, 'WTK')).id;
    insertRepo(projectId, { id: `${projectId}-api`, name: 'wombat-api', git_path: '/tmp/atlas-e2e-wombat-api' });
    insertRepo(projectId, { id: `${projectId}-web`, name: 'wombat-web', git_path: '/tmp/atlas-e2e-wombat-web', position: 1 });
    agentId = one('SELECT id FROM agents ORDER BY created_at LIMIT 1');
    for (let i = 1; i <= COUNT; i++) {
        await apiPost(request, '/api/tasks', { project_id: projectId, title: `Wombat ${String.fromCharCode(64 + i)} task`, repo_ids: [`${projectId}-api`], description: i === 7 ? 'mentions the burrow' : '' });
    }
    // A spread of statuses, every third Task on an agent, updated in id order.
    // `replica` skips items_set_updated_at, which would stamp every row now().
    sql(`SET session_replication_role = replica; UPDATE items SET status = (ARRAY['draft','ready','in_progress','in_review','waiting_for_info','ready'])[1 + (split_part(id, '-', 2)::int % 6)],
            assignee_agent_id = CASE WHEN split_part(id, '-', 2)::int % 3 = 0 THEN '${agentId}' ELSE NULL END,
            updated_at = now() - (split_part(id, '-', 2)::int || ' minutes')::interval
         WHERE project_id = '${projectId}'`);
    // One Task closed 10 days ago: archived.
    sql(`SET session_replication_role = replica; UPDATE items SET status = 'done', updated_at = now() - interval '10 days' WHERE id = 'WTK-${COUNT}'`);
});
test.afterAll(async ({ request }) => cleanup(request));

const rows = (page: Page) => page.locator('main [role="button"]').filter({ has: page.locator('text=/^WTK-\\d+$/') });
const subtitle = (page: Page) => page.locator('main header');
const visible = (where = 'true') =>
    sql(`SELECT id, status FROM items_live WHERE project_id = '${projectId}' AND type = 'task' AND (status <> 'done' OR updated_at >= now() - interval '7 days') AND ${where} ORDER BY id`);
const ready = (r: string[][]) => r.filter(([, s]) => s === 'ready').length;
const sub = (r: string[][]) => `${r.length} tasks · ${NAME}${ready(r) ? ` · ${ready(r)} ready` : ''}`;

test.describe('/tasks table', () => {
    test('By project shows the pick; the subtitle counts the rows on screen and their ready ones', async ({ page }) => {
        await goto(page, '/tasks');
        const chip = page.getByRole('button', { name: /^By project:/ });
        await expect(chip).toHaveText(/By project:\s*Any/);
        await chip.click();
        await page.getByRole('menuitem', { name: NAME }).click();
        await expect(page).toHaveURL(/project=Wombat(\+|%20)Tasks/);
        await expect(chip).toHaveText(new RegExp(`By project:\\s*${NAME}`));
        const all = visible();
        expect(all).toHaveLength(COUNT - 1);
        await expect(subtitle(page)).toContainText(sub(all));
        await page.getByLabel('Rows').selectOption('50');
        await expect(rows(page)).toHaveCount(all.length);
        // The pick shows a check in the menu, and Any clears it.
        await chip.click();
        await expect(page.getByRole('menuitem', { name: NAME })).toContainText('check');
        await page.getByRole('menuitem', { name: 'Any' }).click();
        await expect(page).not.toHaveURL(/project=/);
    });

    test('Status, Assigned to me / to AI and search (title, description and id) filter, count and stay in the URL', async ({ page }) => {
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`);
        const pills = (label: string) => page.getByRole('button', { name: new RegExp(`^${label} \\d+$`) });
        await expect(pills('All')).toContainText(String(visible().length));
        await expect(pills('Assigned to me')).toContainText(String(visible('assignee_agent_id IS NULL').length));
        await expect(pills('Assigned to AI')).toContainText(String(visible('assignee_agent_id IS NOT NULL').length));

        await pills('Assigned to AI').click();
        await expect(page).toHaveURL(/filter=ai/);
        const ai = visible('assignee_agent_id IS NOT NULL');
        await expect(rows(page)).toHaveCount(ai.length);
        await expect(subtitle(page)).toContainText(sub(ai));
        await pills('All').click();
        await expect(page).not.toHaveURL(/filter=/);

        await page.getByRole('button', { name: /^Status:/ }).click();
        await page.getByRole('menuitem', { name: 'Ready', exact: true }).click();
        await expect(page).toHaveURL(/status=ready/);
        const readyRows = visible(`status = 'ready'`);
        await expect(rows(page)).toHaveCount(readyRows.length);
        await expect(subtitle(page)).toContainText(sub(readyRows));
        await page.reload();
        await expect(page.getByRole('button', { name: /^Status:/ })).toHaveText(/Status:\s*Ready/);
        await expect(rows(page)).toHaveCount(readyRows.length);
        await page.getByRole('button', { name: /^Status:/ }).click();
        await page.getByRole('menuitem', { name: 'Any' }).click();

        const search = page.getByLabel('Search tasks');
        await search.fill('WTK-5');
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Wombat E task');
        await expect(subtitle(page)).toContainText(`1 task · ${NAME}`);
        await search.fill('burrow');
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Wombat G task');
        await search.fill('no such wombat');
        await expect(page.getByText('No tasks match this view.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'New task' }).last()).toBeVisible();
        // `/` focuses search from anywhere else.
        await search.fill('');
        await page.locator('main h1').click();
        await page.keyboard.press('/');
        await expect(search).toBeFocused();
    });

    test('sort by Task / ID / Updated, and 20-row pages with the footer', async ({ page }) => {
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`);
        const n = visible().length;
        await expect(page.getByText(`${n} tasks · page 1 of 2`)).toBeVisible();
        await expect(rows(page)).toHaveCount(20);
        // Default: newest update first, which here is id order.
        await expect(rows(page).first()).toContainText('WTK-1');
        await expect(page.getByRole('button', { name: 'Updated, sorted descending' })).toBeVisible();

        await page.getByRole('button', { name: 'Sort by Task' }).click();
        await expect(page.getByRole('button', { name: 'Task, sorted ascending' })).toBeVisible();
        await expect(rows(page).first()).toContainText('Wombat A task');
        await page.getByRole('button', { name: 'Task, sorted ascending' }).click();
        await expect(rows(page).first()).toContainText('Wombat V task');

        await page.getByRole('button', { name: 'Sort by ID' }).click();
        // Numeric-aware: WTK-2 before WTK-10.
        const ids = (await rows(page).allInnerTexts()).map((t) => /WTK-\d+/.exec(t)?.[0]);
        expect(ids.slice(0, 3)).toEqual(['WTK-1', 'WTK-2', 'WTK-3']);

        await page.getByRole('button', { name: 'Next page' }).click();
        await expect(page.getByText(`${n} tasks · page 2 of 2`)).toBeVisible();
        await expect(rows(page)).toHaveCount(n - 20);
        await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
        await page.getByRole('button', { name: 'First page' }).click();
        await expect(page.getByText(`${n} tasks · page 1 of 2`)).toBeVisible();
        await page.getByLabel('Rows').selectOption('all');
        await expect(page.getByText(`${n} tasks · page 1 of 1`)).toBeVisible();
        await expect(rows(page)).toHaveCount(n);
    });

    test('Show archived adds the Task closed 10 days ago, and the subtitle follows', async ({ page }) => {
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`);
        await page.getByLabel('Search tasks').fill(`WTK-${COUNT}`);
        await expect(page.getByText('No tasks match this view.')).toBeVisible();
        // The switch follows the URL, which React Router updates a tick later: click, then wait.
        await page.getByLabel('Show archived').click();
        await expect(page.getByLabel('Show archived')).toBeChecked();
        await expect(page).toHaveURL(/include_archived=true/);
        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page)).toContainText('Done');
        await expect(subtitle(page)).toContainText(`1 task · ${NAME}`);
        await page.getByLabel('Show archived').click();
        await expect(page.getByLabel('Show archived')).not.toBeChecked();
        await expect(page).not.toHaveURL(/include_archived/);
        await expect(rows(page)).toHaveCount(0);
    });
});

test.describe('/tasks Kanban', () => {
    const column = (page: Page, label: string) => page.locator('main p', { hasText: new RegExp(`^${label}$`) }).locator('xpath=../..');
    const card = (page: Page, id: string) => page.locator('main [role="button"][draggable="true"]').filter({ hasText: new RegExp(`${id}(?!\\d)`) });
    const status = (request: APIRequestContext, id: string) => apiGet<{ status: string }>(request, `/api/tasks/${id}`).then((t) => t.status);

    test('a legal drag moves the Task and persists; columns count their cards', async ({ page, request }) => {
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`);
        await page.getByRole('button', { name: 'Kanban' }).click();
        const readyIds = visible(`status = 'ready'`);
        await expect(column(page, 'Ready')).toContainText(String(readyIds.length));
        const id = readyIds[0]?.[0] ?? '';
        await card(page, id).dragTo(column(page, 'In Progress'));
        await expect(card(page, id)).toBeVisible();
        await expect.poll(() => status(request, id)).toBe('in_progress');
        await expect(column(page, 'In Progress').locator('[role="button"]').filter({ hasText: new RegExp(`${id}(?!\\d)`) })).toHaveCount(1);
        await page.reload();
        await expect(column(page, 'In Progress').locator('[role="button"]').filter({ hasText: new RegExp(`${id}(?!\\d)`) })).toHaveCount(1);
        // Kanban is remembered.
        await expect(page.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('an illegal drop is refused with one toast naming the legal moves', async ({ page, request }) => {
        const id = visible(`status = 'draft'`)[0]?.[0] ?? '';
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`);
        await page.getByRole('button', { name: 'Kanban' }).click();
        await card(page, id).dragTo(column(page, 'Done'));
        await expect(page.getByText(`Can't move ${id} to Done`)).toHaveCount(1);
        await expect(page.getByText('From Draft you can go to: Ready, Waiting for Info. To force any other status, use the status picker on the item\'s page.')).toBeVisible();
        expect(await status(request, id)).toBe('draft');
    });

    test('closing a Task with an open sub-task is refused by the API with exactly one toast', async ({ page, request }) => {
        const id = visible(`status = 'in_review'`)[0]?.[0] ?? '';
        const sub = await apiPost<{ id: string }>(request, `/api/tasks/${id}/sub-tasks`, { title: 'Still open' });
        await goto(page, `/tasks?project=${encodeURIComponent(NAME)}`);
        await page.getByRole('button', { name: 'Kanban' }).click();
        const res = page.waitForResponse((r) => r.url().includes(`/api/tasks/${id}/status`));
        await card(page, id).dragTo(column(page, 'Done'));
        expect((await res).status()).toBe(422);
        await expect(page.getByText('Cannot close — open children')).toBeVisible();
        await expect(page.getByText(`${sub.id} is not done yet.`)).toBeVisible();
        await expect(page.getByText(/^(Cannot close — open children|Couldn't move .*)$/)).toHaveCount(1);
        expect(await status(request, id)).toBe('in_review');
        await expect(column(page, 'In Review').locator('[role="button"]').filter({ hasText: new RegExp(`${id}(?!\\d)`) })).toHaveCount(1);
        await request.delete(`${API}/api/sub-tasks/${sub.id}`);
    });
});

test.describe('/tasks/new', () => {
    // An MUI Select's aria-label sits on its hidden native input; the value shows beside it.
    const field = (page: Page, label: string) => page.getByLabel(label).locator('xpath=..');
    async function fill(page: Page, title: string) {
        await goto(page, `/tasks/new?project=${projectId}`);
        await page.getByLabel('Title').fill(title);
        await page.getByLabel('Description').fill(`${title} — made by tasks-full.spec`);
        await expect(field(page, 'Project')).toContainText(NAME);
    }

    test('Submit with no workflow lands Ready at priority Low, on the repos picked', async ({ page, request }) => {
        await fill(page, 'Wombat submitted');
        await expect(field(page, 'Priority')).toContainText('Low');
        // First repo preselected; add the second.
        await expect(field(page, 'Repos')).toContainText('wombat-api');
        await page.getByLabel('Repos').click();
        await page.getByRole('option', { name: /wombat-web/ }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Submit' }).first().click();
        await expect(page).toHaveURL(/\/tasks\/WTK-\d+$/);
        await expect(page.getByText('Submitted — Wombat submitted')).toBeVisible();
        const id = /WTK-\d+/.exec(page.url())?.[0] ?? '';
        const t = await apiGet<{ status: string; priority: string; repo_ids: string[] }>(request, `/api/tasks/${id}`);
        expect(t).toMatchObject({ status: 'ready', priority: 'low', repo_ids: [`${projectId}-api`, `${projectId}-web`] });
        await expect(page.getByRole('button', { name: /^Status/ })).toContainText('Ready');
        // It is on the project's Tasks tab and the list.
        await goto(page, `/projects/${projectId}?tab=tasks`);
        await expect(page.getByRole('button', { name: new RegExp(id) })).toContainText('Wombat submitted');
    });

    test('Save as draft lands Draft, with the priority picked', async ({ page, request }) => {
        await fill(page, 'Wombat drafted');
        await page.getByLabel('Priority').click();
        await page.getByRole('option', { name: 'High' }).click();
        await page.getByRole('button', { name: 'Save as draft' }).click();
        await expect(page).toHaveURL(/\/tasks\/WTK-\d+$/);
        await expect(page.getByText('Saved as draft — Wombat drafted')).toBeVisible();
        const id = /WTK-\d+/.exec(page.url())?.[0] ?? '';
        expect(await apiGet<{ status: string; priority: string }>(request, `/api/tasks/${id}`)).toMatchObject({ status: 'draft', priority: 'high' });
    });
});
