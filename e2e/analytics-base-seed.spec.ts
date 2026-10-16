import { test, expect, type Page } from '@playwright/test';
import { goto } from './helpers/nav.js';
import { one } from './helpers/db.js';

// Every Analytics empty state, for every tab × window, against the REAL API
// over the small base seed (fixtures/run-seed.ts: one project, ETM-1 in
// progress, ETM-2 a draft sub-task, no runs, no sessions). It sits at the top
// of e2e/ so it runs before the flows/ specs add runs; it refuses to run
// against a stack that already has any, rather than pass on luck.

const WINDOWS = ['7d', '30d', '90d', 'month'] as const;
const WIN_QS = (w: (typeof WINDOWS)[number]) => (w === 'month' ? '' : `window=${w}`);

const EMPTY: Record<string, Array<[string, number]>> = {
    overview: [['Nothing shipped, ran or spent in this window yet.', 1]],
    delivery: [
        ['Nothing shipped in this window', 3],
        ['No cycle times yet', 3],
        ['No project shipped a Task in this window.', 1],
    ],
    workflows: [
        ['No workflow runs in this window', 1],
        ['No checks ran in this window', 1],
        ['No parks in this window', 1],
        ['No run cost in this window', 1],
        ['No workflow ran in this window.', 1],
        ['No agent took a workflow step in this window.', 1],
    ],
    spend: [
        ['No spend in this window', 3],
        ['No tokens in this window', 1],
        ['No agent spend in this window', 1],
        ['No project spend in this window', 1],
        ['No completed runs in this window', 1],
        ['No spend in the trailing 12 months', 1],
    ],
};

async function tile(page: Page, label: string): Promise<string> {
    const info = page.getByRole('button', { name: `How ${label} is measured`, exact: true });
    await expect(info).toBeVisible();
    return (await info.locator('xpath=../..').locator(':scope > *').nth(1).innerText()).trim();
}

test.beforeAll(() => {
    const busy = Number(
        one(`SELECT (SELECT COUNT(*) FROM agent_runs) + (SELECT COUNT(*) FROM workflow_runs) + (SELECT COUNT(*) FROM cli_sessions WHERE status = 'closed')
                  + (SELECT COUNT(*) FROM issue_events WHERE field = 'status' AND to_value = 'done')`),
    );
    expect(busy, 'analytics-base-seed.spec.ts needs the fresh base seed (run the whole suite, or this file on its own stack)').toBe(0);
});

for (const tab of Object.keys(EMPTY)) {
    for (const w of WINDOWS) {
        test(`${tab} · ${w}: every card says it is empty, honestly`, async ({ page }) => {
            const qs = [tab === 'overview' ? '' : `tab=${tab}`, WIN_QS(w)].filter(Boolean).join('&');
            await goto(page, `/analytics${qs ? `?${qs}` : ''}`);
            for (const [text, n] of EMPTY[tab]!) {
                await expect(page.getByText(text, { exact: true })).toHaveCount(n);
            }
            await expect(page.getByRole('alert')).toHaveCount(0);
            if (tab === 'overview') {
                expect(await tile(page, 'Tasks shipped')).toBe('0');
                expect(await tile(page, 'Median cycle time')).toBe('—');
                expect(await tile(page, 'Workflow success rate')).toBe('—');
                expect(await tile(page, 'Spend')).toBe('$0.00');
                expect(await tile(page, 'Cost per shipped Task')).toBe('—');
            }
            if (tab === 'delivery') {
                // The seed's one Task in progress is the only work in progress.
                const wip = page.getByRole('list', { name: 'Oldest work in progress' });
                await expect(wip.getByRole('listitem')).toHaveCount(1);
                await expect(wip.getByRole('link', { name: 'ETM-1', exact: true })).toBeVisible();
            }
        });
    }
}

test('the drill-downs read empty for a project and Task with no runs', async ({ page }) => {
    await goto(page, '/analytics/project/e2e-terminal-project');
    await expect(page.getByText('No tasks with cost data yet.')).toBeVisible();
    await goto(page, '/analytics/task/ETM-1');
    await expect(page.getByText('E2E linked task').first()).toBeVisible();
    await expect(page.getByText('No completed runs on this Task or its sub-tasks yet.')).toBeVisible();
});

test('the Dashboard reads no spend this month, like Analytics', async ({ page }) => {
    await goto(page, '/');
    await expect(page.getByText('No spend yet this month')).toBeVisible();
});
