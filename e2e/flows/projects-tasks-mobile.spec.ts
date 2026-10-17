import { test, expect, type Locator, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';

// Every Projects and Tasks route at phone widths (390px — the mobile-chrome
// project — and 360px) and on the iPad project (834px): the page never scrolls
// sideways, and the actions a phone user needs are on screen and clickable
// (a trial click checks visible, enabled, stable and not covered by the
// bottom nav or a FAB). Read-only: the seed project, ETM-1 and ETM-2.

const P = '/projects/e2e-terminal-project';

interface Route {
    name: string;
    path: string;
    ready: (page: Page) => Locator;
    actions: (page: Page) => Locator[];
}

const ROUTES: Route[] = [
    {
        name: 'projects list',
        path: '/projects',
        ready: (p) => p.getByRole('heading', { name: 'E2E Terminal' }),
        actions: (p) => [p.getByRole('button', { name: 'New Project' }), p.getByRole('link', { name: 'Open →' }).first(), p.getByRole('button', { name: 'Project actions' }).first()],
    },
    { name: 'project overview', path: P, ready: (p) => p.getByText('Open tasks'), actions: (p) => [p.getByRole('button', { name: 'Project actions' }), p.getByText('Full history →')] },
    { name: 'project tasks', path: `${P}?tab=tasks`, ready: (p) => p.getByText(/Showing \d+ tasks? in this project/), actions: (p) => [p.getByRole('link', { name: 'Open in Tasks' }), p.getByRole('button', { name: /ETM-1\b/ })] },
    { name: 'project guard-rails', path: `${P}?tab=guardrails`, ready: (p) => p.getByText('Guard-rails are active'), actions: (p) => [p.getByRole('button', { name: 'Add rule' }).first(), p.getByRole('tab', { name: /Scripts/ })] },
    { name: 'project repos', path: `${P}?tab=repos`, ready: (p) => p.getByTestId('repo-row-project'), actions: (p) => [p.getByRole('button', { name: 'Add repo' }), p.getByRole('button', { name: 'Actions for project' })] },
    { name: 'project jira', path: `${P}?tab=jira`, ready: (p) => p.getByText('Jira sources'), actions: (p) => [p.getByRole('button', { name: 'Add source' }), p.getByLabel('Jira statuses for Ready')] },
    { name: 'project setup', path: `${P}?tab=setup`, ready: (p) => p.getByText('Setup scripts'), actions: (p) => [p.getByRole('button', { name: 'Edit setup scripts for project' }), p.getByRole('combobox', { name: /Default workflow/ })] },
    { name: 'project history', path: `${P}?tab=history`, ready: (p) => p.getByText('Agent activity'), actions: (p) => [p.getByRole('tab', { name: /Overview/ })] },
    { name: 'tasks list', path: '/tasks', ready: (p) => p.getByText('E2E linked task'), actions: (p) => [p.getByRole('button', { name: 'New task' }), p.getByLabel('Search tasks'), p.getByRole('button', { name: /E2E linked task/ })] },
    { name: 'new task', path: '/tasks/new', ready: (p) => p.getByLabel('Title'), actions: (p) => [p.getByLabel('Title'), p.getByRole('button', { name: 'Submit' }).last(), p.getByRole('button', { name: /^(Save as draft|Draft)$/ }).last()] },
    {
        name: 'task detail',
        path: '/tasks/ETM-1',
        ready: (p) => p.getByRole('heading', { level: 1, name: 'E2E linked task' }),
        actions: (p) => [p.getByRole('button', { name: 'Task actions' }), p.getByRole('button', { name: /^Status/ }), p.getByPlaceholder('Comment on this item…'), p.getByRole('button', { name: 'Add sub-task' })],
    },
    {
        name: 'sub-task detail',
        path: '/sub-tasks/ETM-2',
        ready: (p) => p.getByRole('heading', { level: 1, name: 'E2E seeded sub-task' }),
        actions: (p) => [p.getByRole('button', { name: 'Sub-task actions' }), p.getByRole('button', { name: /^Status/ }), p.getByPlaceholder('Comment on this item…')],
    },
];

async function sideways(page: Page) {
    return page.evaluate(() => {
        // A region that scrolls on purpose (tab strips, pill rows, wide tables) is fine; the page itself never.
        const scrolls = (e: Element) => {
            for (let n: Element | null = e.parentElement; n; n = n.parentElement) {
                const o = getComputedStyle(n).overflowX;
                if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
            }
            return false;
        };
        const offenders = [...document.body.querySelectorAll('*')]
            .filter((e) => !scrolls(e) && getComputedStyle(e).opacity !== '0' && e.getClientRects().length > 0 && e.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 3)
            .map((e) => `${e.tagName}.${String(e.className).slice(0, 60)}`);
        return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, offenders };
    });
}

async function check(page: Page, r: Route) {
    await goto(page, r.path);
    await expect(r.ready(page).first()).toBeVisible();
    expect(await sideways(page), `${r.name} at ${page.viewportSize()?.width}px`).toEqual({ scroll: 0, offenders: [] });
    const width = page.viewportSize()?.width ?? 0;
    for (const a of r.actions(page)) {
        await a.scrollIntoViewIfNeeded();
        const box = await a.boundingBox();
        expect(box, `${r.name}: ${a}`).toBeTruthy();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width, `${r.name}: ${a} past the right edge`).toBeLessThanOrEqual(width + 1);
        await a.click({ trial: true });
    }
}

test.describe('Projects and Tasks @mobile', () => {
    for (const r of ROUTES) {
        test(`${r.name}: fits 390px and 360px, key actions on screen @mobile`, async ({ page }) => {
            await check(page, r);
            await page.setViewportSize({ width: 360, height: 780 });
            await check(page, r);
        });
    }

    test('the project tab strip scrolls to every tab at 360px @mobile', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await goto(page, P);
        for (const name of [/Overview/, /Tasks/, /Guard-rails/, /Repos/, /Jira/, /Setup/, /History/]) {
            const tab = page.getByRole('tab', { name });
            await tab.scrollIntoViewIfNeeded();
            await tab.click();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
        expect(await sideways(page)).toEqual({ scroll: 0, offenders: [] });
    });

    test('New Project and New task open from their FABs and fit the phone @mobile', async ({ page }) => {
        await goto(page, '/projects');
        await page.getByRole('button', { name: 'New Project' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('New project', { exact: true })).toBeVisible();
        // MUI puts role=dialog on the paper itself.
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        await page.keyboard.press('Escape');
        await goto(page, '/tasks');
        await page.getByRole('button', { name: 'New task' }).click();
        await expect(page).toHaveURL(/\/tasks\/new$/);
    });
});

test.describe('Projects and Tasks @ipad', () => {
    for (const r of ROUTES) {
        test(`${r.name}: fits 834px, key actions on screen @ipad`, async ({ page }) => {
            await check(page, r);
        });
    }
});
