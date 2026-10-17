import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { goto } from '../helpers/nav.js';
import { API, apiPost } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';
import { createProject, deleteProject, gitFixture, insertRepo, projectAction } from '../helpers/projects.js';
import { setThemeMode } from '../helpers/theme.js';

// Two things projects-tasks.spec does not reach. (1) Every status chip at once:
// a project (prefix CHP) whose Tasks sit in all six statuses and whose runs sit
// in all six run statuses, checked by axe — colour contrast unfiltered — on
// the table, Kanban, the project's Tasks / Overview / History tabs and a Task,
// light and dark, desk and phone. (2) Every Projects / Tasks dialog, opened for
// real and checked by axe, with Escape closing it and focus going back.

const NAME = 'Chip Colours';
const STATUSES = ['draft', 'ready', 'in_progress', 'waiting_for_info', 'in_review', 'done'] as const;
const RUN_STATUSES = ['queued', 'in_progress', 'completed', 'error', 'cancelled', 'setup_failed'] as const;
let projectId = '';
let firstTask = '';
const taskIds: string[] = [];

async function cleanup(request: APIRequestContext) {
    for (const [id] of sql(`SELECT id FROM projects WHERE issue_key_prefix = 'CHP'`)) {
        sql(`DELETE FROM agent_runs WHERE id LIKE 'chp-run-%'`);
        await deleteProject(request, id ?? '');
    }
}

test.beforeAll(async ({ request }) => {
    await cleanup(request);
    projectId = (await createProject(request, NAME, 'CHP', 'Every status chip at once')).id;
    const git = gitFixture('chp');
    insertRepo(projectId, { id: `${projectId}-r`, name: 'chips', git_path: git.clone, git_url: git.origin });
    taskIds.length = 0;
    firstTask = '';
    for (const s of STATUSES) {
        const t = await apiPost<{ id: string }>(request, '/api/tasks', { project_id: projectId, title: `Chip ${s}` });
        // replica: keep updated_at fresh-ish but skip triggers; done stays within the 7-day window.
        sql(`UPDATE items SET status = '${s}' WHERE id = '${t.id}'`);
        if (!firstTask) firstTask = t.id;
        taskIds.push(t.id);
        await apiPost(request, `/api/tasks/${t.id}/sub-tasks`, { title: `Chip sub of ${s}` });
    }
    const agent = one(`SELECT id FROM agents ORDER BY created_at LIMIT 1`);
    RUN_STATUSES.forEach((s, i) =>
        sql(
            `INSERT INTO agent_runs (id, agent_id, item_id, status, total_cost_usd, started_at, completed_at, created_at)
             VALUES ('chp-run-${i}', '${agent}', '${taskIds[i]}', '${s}', 0.01, now() - interval '${i} minutes', now() - interval '${i} minutes', now() - interval '${i} minutes')`,
        ),
    );
});
test.afterAll(async ({ request }) => cleanup(request));

async function axe(page: Page, include?: string): Promise<string[]> {
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
    const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
    if (include) builder.include(include);
    const { violations } = await builder.analyze();
    return violations.map((x) => `${x.id} ×${x.nodes.length}: ${x.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)}`).join(' | ')}`);
}

const VIEWS: Array<{ name: string; path: () => string; ready: (p: Page) => Promise<void> }> = [
    {
        name: 'tasks table',
        path: () => `/tasks?project=${encodeURIComponent(NAME)}`,
        ready: async (p) => {
            for (const s of ['Draft', 'Ready', 'In Progress', 'Waiting for Info', 'In Review', 'Done']) await expect(p.getByText(s, { exact: true }).first()).toBeVisible();
        },
    },
    {
        name: 'tasks kanban',
        path: () => `/tasks?project=${encodeURIComponent(NAME)}`,
        ready: async (p) => {
            const kanban = p.getByRole('button', { name: 'Kanban' });
            if (await kanban.isVisible()) await kanban.click();
            await expect(p.getByText('Chip in_review').first()).toBeVisible();
        },
    },
    { name: 'project tasks tab', path: () => `/projects/${projectId}?tab=tasks`, ready: async (p) => void (await expect(p.getByText('Showing 6 tasks in this project')).toBeVisible()) },
    { name: 'project history', path: () => `/projects/${projectId}?tab=history`, ready: async (p) => void (await expect(p.getByLabel('Setup failed', { exact: true })).toBeVisible()) },
    { name: 'project overview', path: () => `/projects/${projectId}`, ready: async (p) => void (await expect(p.getByRole('link', { name: 'View run' })).toHaveCount(5)) },
    { name: 'task detail', path: () => `/tasks/${firstTask}`, ready: async (p) => void (await expect(p.getByRole('heading', { level: 1, name: 'Chip draft' })).toBeVisible()) },
];

for (const mode of ['light', 'dark'] as const) {
    for (const size of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
        test.describe(`every status chip · ${mode} · ${size.w}px`, () => {
            test.use({ viewport: { width: size.w, height: size.h } });
            for (const v of VIEWS) {
                test(`${v.name}: axe clean, colour contrast unfiltered`, async ({ page }) => {
                    await setThemeMode(page, mode);
                    await goto(page, v.path());
                    await v.ready(page);
                    await expect(page.locator('.MuiSkeleton-root')).toHaveCount(0);
                    const found = await axe(page);
                    expect(found, found.join('\n')).toEqual([]);
                });
            }
        });
    }
}

// ── Dialogs ────────────────────────────────────────────────────────────────

interface Dialog {
    name: string;
    open: (p: Page) => Promise<void>;
    /** The control focus should return to after Escape, when it is not the one clicked. */
    trigger?: (p: Page) => ReturnType<Page['getByRole']>;
}

const P = () => `/projects/${projectId}`;
const repoMenu = async (p: Page, item: RegExp) => {
    await goto(p, `${P()}?tab=repos`);
    await p.getByRole('button', { name: 'Actions for chips' }).click();
    await p.getByRole('menuitem', { name: item }).click();
};

const DIALOGS: Dialog[] = [
    { name: 'New project', open: async (p) => { await goto(p, '/projects'); await p.getByRole('button', { name: 'New Project' }).click(); }, trigger: (p) => p.getByRole('button', { name: 'New Project' }) },
    { name: 'Rename project', open: async (p) => { await goto(p, P()); await projectAction(p, 'Rename project…'); }, trigger: (p) => p.getByRole('button', { name: 'Project actions' }) },
    { name: 'Delete project', open: async (p) => { await goto(p, P()); await projectAction(p, 'Delete project…'); }, trigger: (p) => p.getByRole('button', { name: 'Project actions' }) },
    { name: 'Project Secrets', open: async (p) => { await goto(p, P()); await projectAction(p, 'Manage Secrets'); }, trigger: (p) => p.getByRole('button', { name: 'Project actions' }) },
    { name: 'Add guard-rail', open: async (p) => { await goto(p, `${P()}?tab=guardrails`); await p.getByRole('button', { name: 'Add rule' }).first().click(); } },
    {
        name: 'Add project script',
        open: async (p) => {
            await goto(p, `${P()}?tab=guardrails`);
            await p.getByRole('tab', { name: /^Scripts/ }).click();
            await p.getByRole('button', { name: 'Add script', exact: true }).first().click();
        },
    },
    { name: 'Add repo', open: async (p) => { await goto(p, `${P()}?tab=repos`); await p.getByRole('button', { name: 'Add repo' }).click(); } },
    { name: 'Edit repo', open: (p) => repoMenu(p, /^Edit$/), trigger: (p) => p.getByRole('button', { name: 'Actions for chips' }) },
    { name: 'Auto-fetch schedule', open: (p) => repoMenu(p, /Auto-fetch schedule/), trigger: (p) => p.getByRole('button', { name: 'Actions for chips' }) },
    { name: 'Pull from remote', open: (p) => repoMenu(p, /Pull from remote/), trigger: (p) => p.getByRole('button', { name: 'Actions for chips' }) },
    { name: 'Remove repo', open: (p) => repoMenu(p, /^Remove$/), trigger: (p) => p.getByRole('button', { name: 'Actions for chips' }) },
    { name: 'Setup scripts', open: async (p) => { await goto(p, `${P()}?tab=setup`); await p.getByRole('button', { name: 'Edit setup scripts for chips' }).click(); } },
    {
        name: 'Link an item',
        open: async (p) => {
            await goto(p, `/tasks/${firstTask}`);
            await p.getByRole('button', { name: 'Add related item' }).click();
            await p.getByRole('menuitem', { name: 'Link an item' }).click();
        },
        trigger: (p) => p.getByRole('button', { name: 'Add related item' }),
    },
    { name: 'Add PR link', open: async (p) => { await goto(p, `/tasks/${firstTask}`); await p.getByRole('button', { name: 'Add PR link' }).click(); } },
    { name: 'Delete task', open: async (p) => { await goto(p, `/tasks/${firstTask}`); await p.getByRole('button', { name: 'Task actions' }).click(); await p.getByRole('menuitem', { name: 'Delete this task…' }).click(); }, trigger: (p) => p.getByRole('button', { name: 'Task actions' }) },
];

test.describe('dialogs', () => {
    test.use({ viewport: { width: 1440, height: 900 } });
    for (const d of DIALOGS) {
        for (const mode of ['light', 'dark'] as const) {
            test(`${d.name} (${mode}): axe clean; Escape closes it`, async ({ page }) => {
                await setThemeMode(page, mode);
                await d.open(page);
                const dialog = page.getByRole('dialog').last();
                await expect(dialog).toBeVisible();
                // Settle async content (status tables, credential lists) before measuring.
                await page.waitForLoadState('load');
                await expect(dialog.locator('.MuiCircularProgress-root, .MuiSkeleton-root')).toHaveCount(0, { timeout: 15_000 });
                const found = await axe(page, '[role="dialog"]');
                expect(found, found.join('\n')).toEqual([]);
                await page.keyboard.press('Escape');
                await expect(page.getByRole('dialog')).toHaveCount(0);
                if (d.trigger) await expect(d.trigger(page)).toBeFocused();
            });
        }
    }
});

test('Projects / Tasks API refuses a write for a project that does not exist (404), not 500', async ({ request }) => {
    for (const [method, path, data] of [
        ['post', '/api/tasks', { project_id: 'no-such-project', title: 'x' }],
        ['patch', '/api/projects/no-such-project', { name: 'x' }],
        ['post', '/api/projects/no-such-project/guardrails', { title: 'x', body_md: 'y' }],
        ['get', '/api/projects/no-such-project/repos', undefined],
    ] as const) {
        const res = await request[method](`${API}${path}`, data ? { data } : {});
        expect([400, 404], `${method} ${path} → ${res.status()} ${await res.text()}`).toContain(res.status());
    }
});
