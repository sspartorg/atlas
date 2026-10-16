import { test, expect, type Page } from '@playwright/test';
import { goto } from '../helpers/nav.js';
import { deliveryFixture, spendFixture, workflowsFixture } from '../fixtures/analytics-fixtures.js';

// /analytics: every tab × window deep link and the fetch it makes, every
// metric's definition tooltip, every row link and drill-down control, and an
// honest error for every endpoint. The summary endpoints are routed to the
// realistic fixtures (e2e/fixtures/analytics-fixtures.ts) so every card has
// data; numbers against the real API are in analytics-real.spec.ts, empty
// states against the base seed in e2e/analytics-base-seed.spec.ts.

const TABS = [
    { key: 'overview', name: /Overview/, marker: /^Shipped and spent, per/, fetches: ['/api/analytics', '/api/analytics/delivery', '/api/analytics/workflows'] },
    { key: 'delivery', name: /Delivery/, marker: /^Throughput per/, fetches: ['/api/analytics/delivery'] },
    { key: 'workflows', name: /Workflows & agents/, marker: /^How runs ended$/, fetches: ['/api/analytics/workflows'] },
    { key: 'spend', name: /Spend/, marker: /^Cost by model$/, fetches: ['/api/analytics'] },
] as const;
const WINDOWS = [
    { key: '7d', label: '7 days', span: 'the last 7 days' },
    { key: '30d', label: '30 days', span: 'the last 30 days' },
    { key: '90d', label: '90 days', span: 'the last 90 days' },
    { key: 'month', label: 'This month', span: new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }) },
] as const;

const RUN = { run_id: 'run-top-1', agent_id: 'agent-coder', agent_name: 'Coder', issue_type: 'task', issue_id: 'ETM-1', total_cost_usd: 3.21, input_tokens: 1200, output_tokens: 300, cache_read_tokens: 9000, created_at: '2026-10-15T10:00:00Z' };
const SESSION = { session_id: 'sess-top-1', project_id: 'e2e-terminal-project', project_name: 'Storefront', title: 'Fix the flaky webhook test', cli: 'claude', total_cost_usd: 1.5, input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, closed_at: '2026-10-15T11:00:00Z', subagents: [] };

/** Routes the three summary endpoints; `fail` makes the named ones 500. Returns every summary request seen. */
async function serve(page: Page, fail: string[] = []): Promise<string[]> {
    const seen: string[] = [];
    await page.route(/\/api\/analytics(\/delivery|\/workflows)?\?/, async (route) => {
        const url = new URL(route.request().url());
        seen.push(`${url.pathname}?window=${url.searchParams.get('window')}`);
        if (fail.includes(url.pathname)) return route.fulfill({ status: 500, json: { error: `${url.pathname} exploded`, kind: 'internal_error' } });
        const body = url.pathname.endsWith('/delivery')
            ? deliveryFixture()
            : url.pathname.endsWith('/workflows')
              ? workflowsFixture()
              : { ...spendFixture(), topRuns: [RUN], topTerminalSessions: [SESSION] };
        await route.fulfill({ json: body });
    });
    return seen;
}

test.describe('/analytics — every tab × window deep link', () => {
    for (const t of TABS) {
        for (const w of WINDOWS) {
            test(`?tab=${t.key}&window=${w.key}`, async ({ page }) => {
                const seen = await serve(page);
                const qs = [t.key === 'overview' ? null : `tab=${t.key}`, w.key === 'month' ? null : `window=${w.key}`].filter(Boolean).join('&');
                await goto(page, `/analytics${qs ? `?${qs}` : ''}`);
                await expect(page.getByRole('heading', { name: t.marker })).toBeVisible();
                await expect(page.getByRole('tab', { name: t.name })).toHaveAttribute('aria-selected', 'true');
                await expect(page.getByRole('button', { name: w.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
                await expect(page.getByText(`for ${w.span}.`)).toBeVisible();
                // Only this tab's endpoints, only this window.
                expect([...new Set(seen)].sort()).toEqual(t.fetches.map((f) => `${f}?window=${w.key}`).sort());
            });
        }
    }

    test('an unknown tab or window falls back to Overview, this month', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=bogus&window=1y');
        await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });

    test('changing the window refetches the open tab and rewrites the URL', async ({ page }) => {
        const seen = await serve(page);
        await goto(page, '/analytics?tab=spend');
        await expect(page.getByRole('heading', { name: /^Cost by model$/ })).toBeVisible();
        for (const w of ['7d', '30d', '90d'] as const) {
            await page.getByRole('button', { name: WINDOWS.find((x) => x.key === w)!.label, exact: true }).click();
            await expect(page).toHaveURL(new RegExp(`tab=spend&window=${w}$`));
            await expect.poll(() => seen).toContain(`/api/analytics?window=${w}`);
        }
        await page.getByRole('button', { name: 'This month', exact: true }).click();
        await expect(page).toHaveURL(/\/analytics\?tab=spend$/);
        // Pressing the selected window again keeps it (the group never goes empty).
        await page.getByRole('button', { name: 'This month', exact: true }).click();
        await expect(page.getByRole('button', { name: 'This month', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('/analytics — every metric states its definition', () => {
    for (const t of TABS) {
        test(`${t.key}: each tile's info button shows its own definition, by hover and by keyboard`, async ({ page }) => {
            await serve(page);
            await goto(page, `/analytics?tab=${t.key}`);
            await expect(page.getByRole('heading', { name: t.marker })).toBeVisible();
            const infos = page.getByRole('button', { name: /^How .+ is measured$/ });
            const n = await infos.count();
            expect(n).toBeGreaterThanOrEqual(4);
            const seen = new Set<string>();
            for (let i = 0; i < n; i++) {
                const info = infos.nth(i);
                await info.hover();
                const tip = page.getByRole('tooltip');
                await expect(tip).toBeVisible();
                const text = (await tip.innerText()).trim();
                expect(text.length, `${await info.getAttribute('aria-label')}`).toBeGreaterThan(30);
                expect(seen.has(text), `duplicate definition: ${text}`).toBe(false);
                seen.add(text);
                await page.mouse.move(0, 0);
                await expect(tip).toHaveCount(0);
            }
            // The keyboard gets the same tooltip.
            await infos.first().focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            await expect(infos.first()).toBeFocused();
            // The one just left may still be fading out.
            await expect(page.getByRole('tooltip').last()).toBeVisible();
        });
    }

    test('the definitions read as written', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics');
        const expectTip = async (label: string, text: string | RegExp) => {
            await page.getByRole('button', { name: `How ${label} is measured`, exact: true }).hover();
            await expect(page.getByRole('tooltip')).toContainText(text);
            await page.mouse.move(0, 0);
            await expect(page.getByRole('tooltip')).toHaveCount(0);
        };
        await expectTip('Tasks shipped', 'first move into Done falls in this window');
        await expectTip('Median cycle time', 'first move into In progress → its first move into Done');
        await expectTip('Workflow success rate', 'Completed ÷ finished workflow runs');
        await expectTip('Spend', 'Completed agent runs plus closed terminal sessions in this window.');
        await expectTip('Cost per shipped Task', 'All spend in the window ÷ Tasks shipped');
        await page.getByRole('tab', { name: /Delivery/ }).click();
        await expectTip('Cycle time, median', 'first move into In progress');
        await expectTip('Reopen rate', /Done/);
        await expectTip('Flow efficiency', 'In progress or In review (worked) ÷ all their time from creation to first Done');
        await expectTip('Your response to parks', 'From a workflow run parking for you to that run resuming on your answer');
        await expectTip('Weekly throughput', "÷ the window's length in weeks");
        await expectTip('Rework after Done', 'moved out of Done again before the window ended');
        await expectTip('First-attempt merges', 'no retried agent step and no park');
        await page.getByRole('tab', { name: /Workflows & agents/ }).click();
        await expectTip('Retries per Task', "a sub-task's run counts for its Task");
    });
});

test.describe('/analytics — trends, flow, quality and cost efficiency', () => {
    for (const [tab, tiles] of [
        ['overview', 6],
        ['delivery', 13],
        ['workflows', 5],
        ['spend', 4],
    ] as const) {
        test(`${tab}: every tile compares with the previous window and draws its sparkline`, async ({ page }) => {
            await serve(page);
            await goto(page, `/analytics${tab === 'overview' ? '' : `?tab=${tab}`}`);
            const infos = page.getByRole('button', { name: /^How .+ is measured$/ });
            await expect(infos).toHaveCount(tiles);
            await expect(page.getByText(/vs the same days last month/)).toHaveCount(tiles);
            // A sparkline names its range in words for a screen reader.
            const sparks = page.getByRole('img', { name: / per day: lowest .+, highest .+, latest / });
            await expect(sparks).toHaveCount(tiles);
            // ▲/▼ with a colour that says good or bad news; never colour alone.
            await expect(page.getByText(/^[▲▼]\s*$/).first()).toBeAttached();
        });
    }

    test('Delivery: the flow and quality group reads the fixture', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=delivery');
        const group = page.getByRole('region', { name: 'Flow and quality' });
        await expect(group).toContainText('31%');
        await expect(group).toContainText('p90 11.5h · 21 answered · 3 open');
        await expect(group).toContainText('16.6');
        await expect(group).toContainText('2 of 38 shipped');
        await expect(group).toContainText('21 of 33 merged runs');
    });

    test('Workflows: red checks by script and agents cost vs success', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=workflows');
        const checks = page.getByRole('table', { name: 'Red checks by script' });
        await expect(checks.getByRole('row')).toHaveCount(4);
        await expect(checks.getByRole('row').nth(1)).toContainText('Unit tests');
        await expect(page.getByRole('heading', { name: 'Agents: cost vs first-attempt success' })).toBeVisible();
        // One dot per agent with steps.
        await expect(page.locator('.recharts-scatter-symbol')).toHaveCount(5);
    });

    test('Spend: cost per PR and per shipped Task, and the cache-savings trend', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=spend');
        const wf = page.getByRole('table', { name: 'Cost per PR and Task by workflow' });
        await expect(wf.getByRole('row').filter({ hasText: 'Delivery' })).toContainText('$3.85');
        await expect(wf.getByRole('row').filter({ hasText: 'Build' })).toContainText('—');
        const models = page.getByRole('table', { name: 'Cost per PR and Task by model' });
        await expect(models.getByRole('row')).toHaveCount(4);
        await expect(page.getByRole('heading', { name: 'Cache savings per day' })).toBeVisible();
    });

    test('nothing scrolls sideways at 390px', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await serve(page);
        for (const tab of ['overview', 'delivery', 'workflows', 'spend']) {
            await goto(page, `/analytics${tab === 'overview' ? '' : `?tab=${tab}`}`);
            await expect(page.getByRole('button', { name: /^How .+ is measured$/ }).first()).toBeVisible();
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow, tab).toBeLessThanOrEqual(0);
        }
    });
});

test.describe('/analytics — every row link and drill-down control', () => {
    test('Delivery: WIP ids open the Task; project rows (link or row) open the project drill-down', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=delivery');
        const wip = page.getByRole('list', { name: 'Oldest work in progress' });
        await expect(wip.getByRole('listitem')).toHaveCount(5);
        await expect(wip).toContainText('aging');
        await wip.getByRole('link', { name: 'ETM-3', exact: true }).click();
        await expect(page).toHaveURL(/\/tasks\/ETM-3$/);

        await goto(page, '/analytics?tab=delivery');
        const table = page.getByRole('table', { name: 'Delivery by project' });
        await expect(table.getByRole('row')).toHaveCount(4);
        await table.getByRole('link', { name: 'Storefront' }).click();
        await expect(page).toHaveURL(/\/analytics\/project\/e2e-terminal-project$/);
        await page.goBack();
        await table.getByRole('row').filter({ hasText: 'Billing service' }).getByRole('cell').nth(1).click();
        await expect(page).toHaveURL(/\/analytics\/project\/p-billing$/);
    });

    test('Workflows & agents: workflow rows, agent rows and the Fleet performance button', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=workflows');
        const wf = page.getByRole('table', { name: 'Workflows compared' });
        await wf.getByRole('link', { name: 'Delivery' }).click();
        await expect(page).toHaveURL(/\/workflows\/wf-delivery$/);
        await page.goBack();
        await wf.getByRole('row').filter({ hasText: 'Quick change' }).getByRole('cell').nth(1).click();
        await expect(page).toHaveURL(/\/workflows\/wf-quick$/);
        await page.goBack();
        const agents = page.getByRole('table', { name: 'Agents compared' });
        // In name order, no ranking.
        const names = await agents.getByRole('link').allInnerTexts();
        expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
        await agents.getByRole('link', { name: 'Coder', exact: true }).click();
        await expect(page).toHaveURL(/\/agents\/agent-coder\?tab=performance$/);
        await page.goBack();
        await expect(page.getByRole('list', { name: 'First attempt legend' })).toContainText('Sent back');
        await page.getByRole('link', { name: 'Fleet performance' }).click();
        await expect(page).toHaveURL(/\/agents\/performance$/);
    });

    test('Spend: project bars, top runs and top terminal sessions link through', async ({ page }) => {
        await serve(page);
        await goto(page, '/analytics?tab=spend');
        await page.getByRole('link', { name: /Billing service/ }).first().click();
        await expect(page).toHaveURL(/\/analytics\/project\/p-billing$/);
        await page.goBack();
        await page.locator(`a[href="/agents/${RUN.agent_id}/runs/${RUN.run_id}"]`).click();
        await expect(page).toHaveURL(new RegExp(`/agents/${RUN.agent_id}/runs/${RUN.run_id}$`));
        await page.goBack();
        await page.getByRole('link', { name: /Fix the flaky webhook test/ }).click();
        await expect(page).toHaveURL(/\/terminal\/sess-top-1\/history$/);
    });
});

test.describe('/analytics — honest errors', () => {
    for (const [tab, failing, text] of [
        ['overview', '/api/analytics/workflows', 'Could not load analytics: '],
        ['delivery', '/api/analytics/delivery', 'Could not load delivery analytics: '],
        ['workflows', '/api/analytics/workflows', 'Could not load workflow analytics: '],
        ['spend', '/api/analytics', 'Could not load spend: '],
    ] as const) {
        test(`${tab}: a 500 from ${failing} reads as an error with the reason, not a blank page`, async ({ page }) => {
            await serve(page, [failing]);
            await goto(page, `/analytics?tab=${tab}`, { allow: [/500|Internal Server Error/] });
            await expect(page.getByRole('alert')).toHaveText(`${text}${failing} exploded`);
            await expect(page.getByRole('heading', { name: TABS.find((t) => t.key === tab)!.marker })).toHaveCount(0);
            // The other tabs still work.
            const other = TABS.find((t) => !(t.fetches as readonly string[]).includes(failing));
            if (other) {
                await page.getByRole('tab', { name: other.name }).click();
                await expect(page.getByRole('heading', { name: other.marker })).toBeVisible();
            }
        });
    }

    test('drill-downs: a 500 or a missing project / task says so', async ({ page }) => {
        await page.route(/\/api\/analytics\/project\/boom$/, (r) => r.fulfill({ status: 500, json: { error: 'project query failed', kind: 'internal_error' } }));
        await goto(page, '/analytics/project/boom', { allow: [/500|Internal Server Error/] });
        await expect(page.getByText('Failed to load project analytics: project query failed')).toBeVisible();
        await goto(page, '/analytics/project/no-such-project', { allow: [/404|Not Found/] });
        await expect(page.getByText(/Failed to load project analytics: Project not found/)).toBeVisible();
        await goto(page, '/analytics/task/ETM-2', { allow: [/404|Not Found/] });
        await expect(page.getByText(/Failed to load task analytics: Item is not a task/)).toBeVisible();
        await goto(page, '/analytics/task/NOPE-1', { allow: [/404|Not Found/] });
        await expect(page.getByText(/Failed to load task analytics:/)).toBeVisible();
    });
});
