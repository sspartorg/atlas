import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { WORKFLOW_PARK_KIND_LABELS } from '../../packages/shared/src/constants/index.js';
import type { WorkflowParkKind } from '../../packages/shared/src/types/index.js';
import { goto } from '../helpers/nav.js';
import { API } from '../helpers/api.js';
import { one, sql } from '../helpers/db.js';

// The Analytics pages against the REAL API over a realistic seed
// (`fixtures/analytics-seed.ts`): every number below is hand-computed from
// the seeded rows with plain SQL and must match what the page shows.
//
// Seeded in beforeAll and removed in afterAll, so the rest of the suite keeps
// the small base seed. The browser and the SQL both use UTC.

const ROOT = new URL('../..', import.meta.url).pathname;
const E2E_DB_URL = 'postgres://atlas:atlas@localhost:5500/atlas_e2e';
const WINDOWS = ['7d', '30d', '90d', 'month'] as const;
type Win = (typeof WINDOWS)[number];

function analyticsSeed(clean = false): void {
    execFileSync('pnpm', ['exec', 'tsx', 'e2e/fixtures/analytics-seed.ts', ...(clean ? ['--clean'] : [])], {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: E2E_DB_URL },
        stdio: 'pipe',
    });
}

/** The window's first instant, in UTC, as the page defines it. */
function start(w: Win): string {
    const day = `date_trunc('day', now() AT TIME ZONE 'UTC')`;
    const local = w === 'month' ? `date_trunc('month', now() AT TIME ZONE 'UTC')` : `${day} - interval '${Number.parseInt(w, 10) - 1} days'`;
    return `((${local}) AT TIME ZONE 'UTC')`;
}

// The page's own formatting rules (`formatRate`, `formatSpan`, `formatCostUsd`).
const rate = (n: number, d: number) => (d === 0 ? '—' : `${Math.round((n / d) * 100)}%`);
function span(sec: number | null): string {
    if (sec === null) return '—';
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 172_800) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86_400).toFixed(1)}d`;
}
const usd = (v: number) => (v === 0 ? '$0.00' : `$${v.toFixed(2)}`);

// ── Hand-computed expectations ─────────────────────────────────────────────

/** Tasks whose FIRST Done is in the window, and their median first-In-progress → first-Done. */
function shipped(w: Win): { count: number; cycleP50: number | null } {
    const [row] = sql(`
        WITH f AS (
            SELECT item_id,
                   MIN(created_at) FILTER (WHERE to_value = 'done') AS done_at,
                   MIN(created_at) FILTER (WHERE to_value = 'in_progress') AS ip_at
              FROM issue_events WHERE field = 'status' GROUP BY item_id)
        SELECT COUNT(*),
               percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM done_at - ip_at)) FILTER (WHERE ip_at <= done_at)
          FROM f JOIN items i ON i.id = f.item_id
         WHERE i.type = 'task' AND NOT i.is_test AND f.done_at >= ${start(w)} AND f.done_at < now()`);
    return { count: Number(row?.[0]), cycleP50: row?.[1] ? Number(row[1]) : null };
}

/** Items that left Done ÷ items that entered Done, status moves in the window. */
function reopenRate(w: Win): string {
    const [row] = sql(`
        SELECT COUNT(DISTINCT e.item_id) FILTER (WHERE from_value = 'done'), COUNT(DISTINCT e.item_id) FILTER (WHERE to_value = 'done')
          FROM issue_events e JOIN items i ON i.id = e.item_id
         WHERE e.field = 'status' AND NOT i.is_test AND e.created_at >= ${start(w)}`);
    return rate(Number(row?.[0]), Number(row?.[1]));
}

/** Completed ÷ finished top-level runs started in the window, agent tests out. */
function successRate(w: Win): string {
    const [row] = sql(`
        SELECT COUNT(*) FILTER (WHERE r.status = 'completed'), COUNT(*) FILTER (WHERE r.status IN ('completed', 'cancelled', 'error'))
          FROM workflow_runs r LEFT JOIN items i ON i.id = r.item_id
         WHERE r.parent_workflow_run_id IS NULL AND NOT COALESCE(i.is_test, false) AND r.started_at >= ${start(w)}`);
    return rate(Number(row?.[0]), Number(row?.[1]));
}

/** Completed agent runs (agent tests out) + closed terminal sessions in the window. */
function spendUsd(w: Win): number {
    return Number(
        one(`SELECT COALESCE((SELECT SUM(r.total_cost_usd) FROM agent_runs r LEFT JOIN items i ON i.id = r.item_id
                               WHERE r.status = 'completed' AND NOT COALESCE(i.is_test, false) AND r.completed_at >= ${start(w)}), 0)
                  + COALESCE((SELECT SUM(total_cost_usd) FROM cli_sessions WHERE status = 'closed' AND closed_at >= ${start(w)}), 0)`),
    );
}
const spend = (w: Win): string => usd(spendUsd(w));

/**
 * Parks per kind in the window. A sub-task's park also parks its Task's run
 * (`subtask_waiting`); the Owner answered once, so only the sub-task's counts.
 * A Task run is an agent test when its Task is; a sub-task run, when its Task's is.
 */
function parks(w: Win): Array<[string, string]> {
    return sql(`
        SELECT ev.park_kind, COUNT(*)
          FROM workflow_run_events ev
          JOIN workflow_runs wr ON wr.id = ev.workflow_run_id
          LEFT JOIN items i ON i.id = wr.item_id
          LEFT JOIN items t ON t.id = i.parent_id
         WHERE ev.kind = 'parked' AND ev.park_kind <> 'subtask_waiting'
           AND NOT COALESCE(t.is_test, i.is_test, false) AND ev.created_at >= ${start(w)}
         GROUP BY 1`)
        .map(([kind, n]) => [WORKFLOW_PARK_KIND_LABELS[kind as WorkflowParkKind], String(n)] as [string, string])
        .sort((a, b) => a[0].localeCompare(b[0]));
}

// ── Reading the page ───────────────────────────────────────────────────────

async function tile(page: Page, label: string): Promise<string> {
    const info = page.getByRole('button', { name: `How ${label} is measured`, exact: true });
    await expect(info).toBeVisible();
    // StatTile: [label row, value, caption].
    return (await info.locator('xpath=../..').locator(':scope > *').nth(1).innerText()).trim();
}

async function barList(page: Page, name: string): Promise<Array<[string, string]>> {
    const list = page.getByRole('list', { name, exact: true });
    await expect(list).toBeVisible();
    const rows = await list.evaluate((ul) =>
        [...ul.children].map((li) => {
            const [label, value] = [...(li.firstElementChild?.children ?? [])];
            return [label?.textContent ?? '', value?.textContent ?? ''] as [string, string];
        }),
    );
    return rows.sort((a, b) => a[0].localeCompare(b[0]));
}

test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'serial' });

test.describe('/analytics over the realistic seed, against the real API', () => {
    test.beforeAll(() => analyticsSeed());
    test.afterAll(() => analyticsSeed(true));

    for (const w of WINDOWS) {
        test(`Overview tiles match the seed (${w})`, async ({ page }) => {
            await goto(page, w === 'month' ? '/analytics' : `/analytics?window=${w}`);
            const s = shipped(w);
            expect.soft(await tile(page, 'Tasks shipped')).toBe(String(s.count));
            expect.soft(await tile(page, 'Median cycle time')).toBe(span(s.cycleP50));
            expect.soft(await tile(page, 'Workflow success rate')).toBe(successRate(w));
            expect.soft(await tile(page, 'Spend')).toBe(spend(w));
        });

        test(`Delivery reopen rate and Workflows park kinds match the seed (${w})`, async ({ page }) => {
            await goto(page, `/analytics?tab=delivery${w === 'month' ? '' : `&window=${w}`}`);
            expect.soft(await tile(page, 'Reopen rate')).toBe(reopenRate(w));
            expect.soft(await tile(page, 'Tasks shipped')).toBe(String(shipped(w).count));

            await page.getByRole('tab', { name: /Workflows & agents/ }).click();
            expect.soft(await tile(page, 'Success rate')).toBe(successRate(w));
            const expected = parks(w);
            if (expected.length === 0) await expect(page.getByText('No parks in this window')).toBeVisible();
            else expect(await barList(page, 'Park reasons')).toEqual(expected);
        });
    }

    test('agent-test runs are not spend, and the Dashboard month spend equals Analytics month spend', async ({ page }) => {
        // The seed's agent-test Tasks did spend: that is what the exclusion is for.
        const testSpend = Number(one(`SELECT COALESCE(SUM(r.total_cost_usd), 0) FROM agent_runs r JOIN items i ON i.id = r.item_id WHERE i.is_test AND r.status = 'completed' AND r.completed_at >= ${start('90d')}`));
        expect(testSpend).toBeGreaterThan(0);
        await goto(page, '/analytics?tab=spend');
        const month = await tile(page, 'Spend');
        expect(month).toBe(spend('month'));
        await goto(page, '/');
        await expect(page.getByText(month, { exact: true }).first()).toBeVisible();
    });

    test('the seed parks with every kind the engine writes, over 90 days', () => {
        const kinds = parks('90d').map(([label]) => label);
        const engineKinds = (Object.keys(WORKFLOW_PARK_KIND_LABELS) as WorkflowParkKind[]).filter((k) => k !== 'subtask_waiting' && k !== 'other');
        expect(kinds.sort()).toEqual(engineKinds.map((k) => WORKFLOW_PARK_KIND_LABELS[k]).sort());
        expect(Number(one(`SELECT COUNT(*) FROM workflow_run_events WHERE park_kind = 'subtask_waiting'`))).toBeGreaterThan(0);
    });

    test('agent rows leave agent tests out; the Fleet performance page keeps them', async ({ page, request }) => {
        // The Doc Writer only ever ran on the two agent-test Tasks (last 25 days).
        await goto(page, '/analytics?tab=workflows&window=30d');
        const agents = page.getByRole('table', { name: 'Agents compared' });
        await expect(agents.getByRole('link', { name: 'Coder', exact: true })).toBeVisible();
        await expect(agents.getByText('Doc Writer')).toHaveCount(0);
        const fleet = (await (await request.get(`${API}/api/agents/performance?days=30`)).json()) as { agents: Array<{ name: string }> };
        expect(fleet.agents.map((a) => a.name)).toEqual(expect.arrayContaining(['Coder', 'Doc Writer']));
    });
});

test.describe('/analytics drill-downs over the realistic seed', () => {
    test.beforeAll(() => analyticsSeed());
    test.afterAll(() => analyticsSeed(true));

    test('project: top Tasks, View all, rows per page, paging and row links', async ({ page }) => {
        const total = Number(one(`SELECT COUNT(*) FROM items WHERE project_id = 'an-store' AND type = 'task'`));
        await goto(page, '/analytics/project/an-store');
        await expect(page.getByText('Storefront').first()).toBeVisible();
        await expect(page.getByText(/^Showing top 25 of \d+ tasks/)).toBeVisible();

        await page.getByText(/^View all \d+ tasks$/).click();
        const caption = page.getByText(/total — showing page \d+ of \d+\./);
        const pages = (n: number, size: number) => Math.max(1, Math.ceil(n / size));
        const listed = Number((await caption.innerText()).match(/(\d+) total/)?.[1]);
        expect(listed).toBeGreaterThan(25);
        expect(listed).toBeLessThanOrEqual(total);
        await expect(caption).toContainText(`showing page 1 of ${pages(listed, 25)}.`);
        const rows = page.locator('a[href^="/analytics/task/"]');
        // 25 top-Task bars + one page of 25 rows.
        await expect(rows).toHaveCount(25 + 25);

        await page.getByRole('navigation').getByRole('button', { name: 'Go to page 2' }).click();
        await expect(caption).toContainText(`showing page 2 of ${pages(listed, 25)}.`);
        await expect(rows).toHaveCount(25 + (listed - 25));

        await page.getByRole('combobox', { name: 'Rows per page' }).click();
        await page.getByRole('option', { name: '50' }).click();
        await expect(caption).toContainText('showing page 1 of 1.');
        await expect(rows).toHaveCount(25 + listed);

        const last = rows.last();
        const href = (await last.getAttribute('href')) ?? '';
        await last.click();
        await expect(page).toHaveURL(new RegExp(`${href}$`));
        await expect(page.getByRole('link', { name: 'Storefront', exact: true })).toBeVisible();
    });

    test('task: kind filter, chip, rows per page, paging and the project link', async ({ page }) => {
        const big = one(`SELECT parent_id FROM items WHERE project_id = 'an-store' AND type = 'sub_task' GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`);
        await goto(page, `/analytics/task/${big}`);
        await expect(page.getByText('Showing all kinds')).toBeVisible();
        const totalText = page.getByText(/^\d+ total$/);
        await expect(totalText).toBeVisible();
        const all = Number((await totalText.innerText()).split(' ')[0]);
        expect(all).toBeGreaterThan(25);
        const nav = page.getByRole('navigation');
        await expect(nav.getByRole('button', { name: 'page 2' })).toBeVisible();
        await nav.getByRole('button', { name: 'Go to page 2' }).click();
        await expect(nav.getByRole('button', { name: 'page 2' })).toHaveAttribute('aria-current', 'page');

        // A kind card filters and goes back to page 1.
        await page.getByRole('button', { name: /Sub-task/ }).first().click();
        await expect(page.getByText('Showing only: Sub-task')).toBeVisible();
        await expect(nav.getByRole('button', { name: 'page 1' })).toHaveAttribute('aria-current', 'page');
        const subs = Number(one(`SELECT COUNT(*) FROM items WHERE parent_id = '${big}'`));
        await expect(totalText).toHaveText(`${subs} total`);

        await page.getByRole('combobox', { name: 'Rows per page' }).click();
        await page.getByRole('option', { name: '50' }).click();
        await expect(nav.getByRole('button', { name: 'Go to page 2' })).toHaveCount(0);

        await page.getByText('Showing only: Sub-task').locator('..').locator('svg').click();
        await expect(page.getByText('Showing all kinds')).toBeVisible();
        await expect(totalText).toHaveText(`${all} total`);

        await page.getByRole('link', { name: 'Storefront', exact: true }).first().click();
        await expect(page).toHaveURL(/\/analytics\/project\/an-store$/);
    });
});
