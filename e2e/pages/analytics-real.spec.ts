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

/** Shipped Tasks (first Done in the window), as a CTE other checks build on. */
const SHIPPED_CTE = (w: Win) => `
    f AS (SELECT item_id, MIN(created_at) FILTER (WHERE to_value = 'done') AS done_at
            FROM issue_events WHERE field = 'status' GROUP BY item_id),
    s AS (SELECT f.item_id, f.done_at FROM f JOIN items i ON i.id = f.item_id
           WHERE i.type = 'task' AND NOT i.is_test AND f.done_at >= ${start(w)} AND f.done_at < now())`;

/** Shipped Tasks' time In progress or In review ÷ all their status time before first Done. */
function flowEfficiency(w: Win): string {
    const [row] = sql(`
        WITH ${SHIPPED_CTE(w)},
        ev AS (SELECT e.item_id, e.from_value, e.to_value, e.created_at,
                      LEAD(e.created_at) OVER x AS next_at, ROW_NUMBER() OVER x AS rn
                 FROM issue_events e JOIN s ON s.item_id = e.item_id
                WHERE e.field = 'status' AND e.created_at <= s.done_at
               WINDOW x AS (PARTITION BY e.item_id ORDER BY e.created_at, e.id)),
        iv AS (SELECT to_value AS st, created_at AS a, next_at AS b FROM ev WHERE to_value <> 'done'
               UNION ALL
               SELECT ev.from_value, i.created_at, ev.created_at FROM ev JOIN items i ON i.id = ev.item_id
                WHERE ev.rn = 1 AND ev.from_value IS NOT NULL)
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM b - a)) FILTER (WHERE st IN ('in_progress', 'in_review')), 0),
               COALESCE(SUM(EXTRACT(EPOCH FROM b - a)), 0)
          FROM iv WHERE b IS NOT NULL AND b > a`);
    return rate(Number(row?.[0]), Number(row?.[1]));
}

/** Shipped Tasks that left Done again (after their first Done) ÷ shipped Tasks. */
function rework(w: Win): string {
    const [row] = sql(`
        WITH ${SHIPPED_CTE(w)}
        SELECT COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM issue_events r WHERE r.item_id = s.item_id AND r.field = 'status'
                                                AND r.from_value = 'done' AND r.created_at > s.done_at)), COUNT(*)
          FROM s`);
    return rate(Number(row?.[0]), Number(row?.[1]));
}

/** Tasks shipped ÷ the window's length in weeks, to one decimal. */
function weeklyThroughput(w: Win): string {
    const days = Number(one(`SELECT EXTRACT(EPOCH FROM now() - ${start(w)}) / 86400`));
    return ((shipped(w).count * 7) / days).toFixed(1);
}

/** Median park → that run's next resume, parks started in the window, sub-task copies and agent tests out. */
function ownerResponse(w: Win): string {
    const v = one(`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM (
            SELECT EXTRACT(EPOCH FROM (SELECT MIN(r.created_at) FROM workflow_run_events r
                                        WHERE r.workflow_run_id = ev.workflow_run_id AND r.kind = 'resumed'
                                          AND r.created_at >= ev.created_at AND r.created_at < now()) - ev.created_at) AS s
              FROM workflow_run_events ev
              JOIN workflow_runs wr ON wr.id = ev.workflow_run_id
              LEFT JOIN items i ON i.id = wr.item_id
              LEFT JOIN items t ON t.id = i.parent_id
             WHERE ev.kind = 'parked' AND ev.park_kind <> 'subtask_waiting'
               AND NOT COALESCE(t.is_test, i.is_test, false) AND ev.created_at >= ${start(w)}) x
         WHERE s IS NOT NULL`);
    return span(v ? Number(v) : null);
}

/** Runs started in the window whose every PR merged; clean = no retried step and no park in the run tree. */
function firstAttempt(w: Win): string {
    const [row] = sql(`
        WITH r AS (SELECT r.id, r.pr_urls, r.pr_url FROM workflow_runs r LEFT JOIN items i ON i.id = r.item_id
                    WHERE r.parent_workflow_run_id IS NULL AND NOT COALESCE(i.is_test, false)
                      AND r.started_at >= ${start(w)} AND r.started_at <= now()),
        u AS (SELECT r.id, x.url FROM r, LATERAL jsonb_array_elements_text(
                  CASE WHEN jsonb_array_length(r.pr_urls) > 0 THEN r.pr_urls ELSE jsonb_build_array(r.pr_url) END) x(url)
               WHERE x.url IS NOT NULL),
        m AS (SELECT u.id FROM u LEFT JOIN item_external_links l ON l.url = u.url AND l.link_kind = 'pull_request'
               GROUP BY u.id HAVING bool_and(COALESCE(l.pr_state = 'merged', false)))
        SELECT COUNT(*) FILTER (WHERE NOT EXISTS (
                   SELECT 1 FROM workflow_runs t JOIN agent_runs a ON a.workflow_run_id = t.id
                    WHERE (t.id = m.id OR t.parent_workflow_run_id = m.id) AND a.parent_run_id IS NOT NULL)
                 AND NOT EXISTS (
                   SELECT 1 FROM workflow_runs t JOIN workflow_run_events ev ON ev.workflow_run_id = t.id
                    WHERE (t.id = m.id OR t.parent_workflow_run_id = m.id) AND ev.kind = 'parked')),
               COUNT(*)
          FROM m`);
    return rate(Number(row?.[0]), Number(row?.[1]));
}

/** Agent-run retries ÷ distinct Tasks those runs worked for (a sub-task's for its Task), agent tests out. */
function retriesPerTask(w: Win): string {
    const [row] = sql(`
        SELECT COUNT(*) FILTER (WHERE a.parent_run_id IS NOT NULL),
               COUNT(DISTINCT CASE WHEN i.type = 'sub_task' THEN i.parent_id ELSE i.id END)
          FROM agent_runs a LEFT JOIN items i ON i.id = a.item_id
         WHERE NOT COALESCE(i.is_test, false) AND a.created_at >= ${start(w)}`);
    const tasks = Number(row?.[1]);
    return tasks === 0 ? '—' : (Number(row?.[0]) / tasks).toFixed(2);
}

/** Red checks by script in the window: [name, failures] most first (ties by name). */
function redChecks(w: Win): Array<[string, string]> {
    return sql(`
        SELECT COALESCE(s.name, g.script_id), COUNT(*)
          FROM run_gate_results g JOIN workflow_runs r ON r.id = g.workflow_run_id
          LEFT JOIN items i ON i.id = r.item_id LEFT JOIN guardrail_scripts s ON s.id = g.script_id
         WHERE g.verdict = 'fail' AND NOT COALESCE(i.is_test, false) AND g.created_at >= ${start(w)}
         GROUP BY g.script_id, s.name ORDER BY COUNT(*) DESC, 1 LIMIT 10`).map(([n, c]) => [String(n), String(c)]);
}

/** Per workflow: run-tree cost of runs started in the window ÷ the PRs they opened. */
function costPerPr(w: Win): Array<[string, string]> {
    return sql(`
        WITH runs AS (SELECT r.id, r.workflow_id,
                             CASE WHEN jsonb_array_length(r.pr_urls) > 0 THEN jsonb_array_length(r.pr_urls)
                                  WHEN r.pr_url IS NOT NULL THEN 1 ELSE 0 END AS prs
                        FROM workflow_runs r LEFT JOIN items i ON i.id = r.item_id
                       WHERE r.parent_workflow_run_id IS NULL AND NOT COALESCE(i.is_test, false) AND r.started_at >= ${start(w)}),
        cost AS (SELECT runs.id, COALESCE(SUM(a.total_cost_usd::numeric), 0) AS usd FROM runs
                   LEFT JOIN workflow_runs t ON t.id = runs.id OR t.parent_workflow_run_id = runs.id
                   LEFT JOIN agent_runs a ON a.workflow_run_id = t.id GROUP BY runs.id)
        SELECT w.name, SUM(cost.usd), SUM(runs.prs) FROM runs JOIN cost ON cost.id = runs.id
          JOIN workflows w ON w.id = runs.workflow_id GROUP BY w.name ORDER BY w.name`).map(([name, usdSum, prs]) => [
        String(name),
        Number(prs) === 0 ? '—' : usd(Number(usdSum) / Number(prs)),
    ]);
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

        test(`Flow, quality and cost efficiency match the seed (${w})`, async ({ page }) => {
            const qs = w === 'month' ? '' : `&window=${w}`;
            await goto(page, `/analytics?tab=delivery${qs}`);
            expect.soft(await tile(page, 'Flow efficiency')).toBe(flowEfficiency(w));
            expect.soft(await tile(page, 'Rework after Done')).toBe(rework(w));
            expect.soft(await tile(page, 'Weekly throughput')).toBe(weeklyThroughput(w));
            expect.soft(await tile(page, 'Your response to parks')).toBe(ownerResponse(w));
            expect.soft(await tile(page, 'First-attempt merges')).toBe(firstAttempt(w));

            await goto(page, `/analytics?tab=workflows${qs}`);
            expect.soft(await tile(page, 'Retries per Task')).toBe(retriesPerTask(w));
            const red = redChecks(w);
            if (red.length === 0) await expect(page.getByText('No failed checks in this window')).toBeVisible();
            else {
                const rows = page.getByRole('table', { name: 'Red checks by script' }).locator('tbody tr');
                const seen = await rows.evaluateAll((trs) => trs.map((tr) => [tr.children[0]?.textContent ?? '', tr.children[1]?.textContent ?? '']));
                expect.soft(seen).toEqual(red);
            }

            await goto(page, `/analytics?tab=spend${qs}`);
            const perPr = costPerPr(w);
            if (perPr.length === 0) await expect(page.getByText('No workflow runs in this window')).toBeVisible();
            else {
                const rows = page.getByRole('table', { name: 'Cost per PR and Task by workflow' }).locator('tbody tr');
                const seen = await rows.evaluateAll((trs) => trs.map((tr) => [tr.children[0]?.textContent ?? '', tr.children[4]?.textContent ?? '']));
                expect.soft(seen).toEqual(perPr);
            }
        });

        test(`every tile's trend compares with the previous window (${w})`, async ({ page }) => {
            await goto(page, `/analytics?tab=delivery${w === 'month' ? '' : `&window=${w}`}`);
            const vs = w === 'month' ? 'vs the same days last month' : `vs the ${Number.parseInt(w, 10)} days before`;
            await expect(page.getByText(vs)).toHaveCount(13);
            // Tasks shipped: the delta is this window against the one before, in plain SQL.
            const prevStart = w === 'month'
                ? `((date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month') AT TIME ZONE 'UTC')`
                : `(${start(w)} - interval '${Number.parseInt(w, 10)} days')`;
            const prevEnd = w === 'month' ? `(now() - interval '1 month')` : start(w);
            const prev = Number(one(`
                WITH f AS (SELECT item_id, MIN(created_at) FILTER (WHERE to_value = 'done') AS done_at
                             FROM issue_events WHERE field = 'status' GROUP BY item_id)
                SELECT COUNT(*) FROM f JOIN items i ON i.id = f.item_id
                 WHERE i.type = 'task' AND NOT i.is_test AND f.done_at >= ${prevStart} AND f.done_at < ${prevEnd}`));
            const cur = shipped(w).count;
            const info = page.getByRole('button', { name: 'How Tasks shipped is measured', exact: true });
            const trendRow = info.locator('xpath=../..').locator(':scope > *').last();
            const text = (await trendRow.innerText()).replace(/\s+/g, ' ');
            if (prev === 0) expect.soft(text).toContain(cur === 0 ? 'same as before' : 'none before');
            else {
                const pct = (cur - prev) / prev;
                if (Math.abs(pct) < 0.005) expect.soft(text).toContain('same as before');
                else expect.soft(text).toContain(`${pct > 0 ? 'up' : 'down'} ${Math.abs(pct * 100).toFixed(0)}%`);
            }
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
