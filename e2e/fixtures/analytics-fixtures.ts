import type { Page } from '@playwright/test';

// Realistic analytics payloads for the tabbed /analytics page. The e2e DB
// holds a handful of rows, which cannot show what the charts look like with
// a month of work in them, so specs and screenshot passes route the three
// summary endpoints to these. Shapes follow `IAnalyticsDelivery` /
// `IAnalyticsWorkflows` (@atlas/shared) and the web's `AnalyticsResponse`.

const H = 3600;

// Small deterministic generator so every run draws the same charts.
function rng(seed: number) {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}

/** A tile trend: this window, the one before, and a per-bucket series. */
function trend(cur: number | null, prev: number | null, series: Array<number | null>) {
    return { cur, prev, series };
}

function days(n: number, end = new Date('2026-10-16T12:00:00Z')): string[] {
    return Array.from({ length: n }, (_, i) => {
        const d = new Date(end.getTime() - (n - 1 - i) * 86_400_000);
        return d.toISOString().slice(0, 10);
    });
}

export function deliveryFixture(projectId = 'e2e-terminal-project') {
    const r = rng(7);
    const buckets = days(16);
    const base = deliveryBase(projectId, r, buckets);
    const tp = base.throughput;
    const wave = (lo: number, hi: number, k: number) => buckets.map((_, i) => lo + ((hi - lo) * ((i * k) % 7)) / 6);
    return {
        ...base,
        buckets,
        trends: {
            tasks_shipped: trend(38, 29, tp.map((b) => b.tasks)),
            lead_p50_s: trend(31.5 * H, 36 * H, wave(20 * H, 48 * H, 3)),
            cycle_p50_s: trend(7.4 * H, 9.8 * H, tp.map((b) => b.cycle_p50_s)),
            wip: trend(7, 9, wave(5, 11, 2).map(Math.round)),
            waiting_s: trend(146 * H, 120 * H, wave(2 * H, 18 * H, 5)),
            reopen_rate: trend(4 / 129, 6 / 101, wave(0, 0.08, 4)),
            prs_merged: trend(35, 27, tp.map((b) => Math.max(0, b.tasks - 1))),
            time_to_pr_s: trend(46 * 60, 58 * 60, wave(30 * 60, 70 * 60, 3)),
            flow_efficiency: trend(0.31, 0.27, wave(0.2, 0.45, 2)),
            owner_response_p50_s: trend(2.8 * H, 3.6 * H, wave(H, 6 * H, 5)),
            weekly_throughput: trend(16.6, 12.7, buckets.map((_, i) => (i < 5 ? 14 : i < 12 ? 19 : 5))),
            rework_rate: trend(2 / 38, 3 / 29, wave(0, 0.2, 3)),
            first_attempt_merge_rate: trend(21 / 33, 0.55, wave(0.4, 0.8, 2)),
        },
        flow: {
            efficiency: 0.31,
            active_s: 9.4 * 38 * H,
            waiting_s: 22.1 * 38 * H,
            owner_response: { answered: 21, unanswered: 3, p50_s: 2.8 * H, p90_s: 11.5 * H },
            weekly_throughput: 16.6,
            weekly: [
                { bucket: '2026-09-28', tasks: 9 },
                { bucket: '2026-10-05', tasks: 19 },
                { bucket: '2026-10-12', tasks: 10 },
            ],
        },
        rework: { shipped: 38, reopened: 2, rate: 2 / 38 },
        first_attempt: { merged_runs: 33, clean: 21, rate: 21 / 33 },
    };
}

function deliveryBase(projectId: string, r: () => number, buckets: string[]) {
    return {
        period: {
            window: 'month', tz: 'UTC', bucket: 'day',
            start: '2026-10-01T00:00:00.000Z', end: '2026-10-16T12:00:00.000Z',
            previous_start: '2026-09-01T00:00:00.000Z', previous_end: '2026-09-16T12:00:00.000Z',
        },
        shipped: { tasks: 38, sub_tasks: 91 },
        throughput: buckets.map((bucket, i) => {
            const weekend = [0, 6].includes(new Date(bucket).getUTCDay());
            const tasks = weekend ? Math.round(r()) : 1 + Math.round(r() * 4);
            return {
                bucket,
                tasks,
                sub_tasks: tasks * 2 + Math.round(r() * 3),
                cycle_p50_s: tasks === 0 ? null : Math.round((5 + r() * 9 - i * 0.2) * H),
            };
        }),
        lead_time: { count: 38, p50_s: 31.5 * H, p90_s: 4.2 * 86_400 },
        cycle_time: { count: 36, p50_s: 7.4 * H, p90_s: 26 * H },
        cycle_histogram: [
            { label: '< 1h', min_s: 0, max_s: H, count: 3 },
            { label: '1–4h', min_s: H, max_s: 4 * H, count: 9 },
            { label: '4–24h', min_s: 4 * H, max_s: 86_400, count: 16 },
            { label: '1–3d', min_s: 86_400, max_s: 3 * 86_400, count: 6 },
            { label: '3–7d', min_s: 3 * 86_400, max_s: 7 * 86_400, count: 2 },
            { label: '1–2w', min_s: 7 * 86_400, max_s: 14 * 86_400, count: 0 },
            { label: '> 2w', min_s: 14 * 86_400, max_s: null, count: 0 },
        ],
        time_in_status: [
            { status: 'draft', avg_s: 9.1 * H, items: 38 },
            { status: 'ready', avg_s: 4.4 * H, items: 31 },
            { status: 'in_progress', avg_s: 5.2 * H, items: 36 },
            { status: 'waiting_for_info', avg_s: 8.6 * H, items: 17 },
            { status: 'in_review', avg_s: 4.2 * H, items: 29 },
        ],
        waiting: { parks: 24, total_s: 146 * H, median_s: 2.8 * H, still_waiting: 3 },
        reopens: { reopened: 4, done: 129, rate: 4 / 129 },
        wip: {
            count: 7,
            aging: 2,
            aging_after_s: 7 * 86_400,
            oldest: [
                { id: 'ETM-1', title: 'Migrate billing webhooks to the queue worker', status: 'in_review', project_id: projectId, age_s: 11.3 * 86_400 },
                { id: 'ETM-2', title: 'Search: rank exact title matches first', status: 'waiting_for_info', project_id: projectId, age_s: 8.1 * 86_400 },
                { id: 'ETM-3', title: 'Add CSV export to the invoices table', status: 'in_progress', project_id: projectId, age_s: 3.4 * 86_400 },
                { id: 'ETM-4', title: 'Fix timezone drift in the weekly digest email', status: 'in_progress', project_id: projectId, age_s: 1.6 * 86_400 },
                { id: 'ETM-5', title: 'Dark-mode contrast on the settings tabs', status: 'in_review', project_id: projectId, age_s: 19 * H },
            ],
        },
        by_priority: [
            { priority: 'urgent', shipped: 4, cycle_p50_s: 3.1 * H },
            { priority: 'high', shipped: 9, cycle_p50_s: 5.8 * H },
            { priority: 'normal', shipped: 19, cycle_p50_s: 8.2 * H },
            { priority: 'low', shipped: 6, cycle_p50_s: 14.5 * H },
        ],
        by_project: [
            { project_id: projectId, project_name: 'Storefront', shipped: 21, cycle_p50_s: 6.9 * H, lead_p50_s: 28 * H },
            { project_id: 'p-billing', project_name: 'Billing service', shipped: 11, cycle_p50_s: 9.4 * H, lead_p50_s: 41 * H },
            { project_id: 'p-docs', project_name: 'Developer docs', shipped: 6, cycle_p50_s: 3.2 * H, lead_p50_s: 12 * H },
        ],
        source_mix: { jira: 14, native: 24 },
        prs: { opened: 41, merged: 35, merge_rate: 35 / 41, median_s_to_pr: 46 * 60 },
        previous: { tasks_shipped: 29, cycle_p50_s: 9.8 * H, prs_merged: 27 },
    };
}

export function workflowsFixture() {
    const agent = (id: string, name: string, color: string, steps: number, applied: number, rejected: number, parked: number, loops: number, gate: number, cost: number, p95: number) => ({
        agent_id: id, name, accent_color: color, steps,
        first_pass: { applied, rejected, parked }, loops, gate_catch: gate,
        cost_usd: cost, per_step_usd: cost / steps, p95_s: p95,
    });
    const d = deliveryFixture();
    const wave = (lo: number, hi: number, k: number) => d.buckets.map((_, i) => lo + ((hi - lo) * ((i * k) % 7)) / 6);
    return {
        period: d.period,
        buckets: d.buckets,
        trends: {
            success_rate: trend(37 / 41, 0.81, wave(0.7, 1, 3)),
            runs: trend(46, 35, wave(1, 5, 2).map(Math.round)),
            gate_pass_rate: trend(112 / 126, 0.86, wave(0.75, 1, 4)),
            retries: trend(6, 9, wave(0, 2, 5).map(Math.round)),
            retries_per_task: trend(6 / 38, 9 / 31, wave(0, 0.5, 3)),
        },
        retries_per_task: { retries: 6, tasks: 38, rate: 6 / 38 },
        gate_failures: [
            { script_id: 'tests', name: 'Unit tests', failures: 9, runs: 7, last_at: '2026-10-15T16:20:00.000Z' },
            { script_id: 'lint', name: 'Lint', failures: 4, runs: 4, last_at: '2026-10-14T09:05:00.000Z' },
            { script_id: 'commit-discipline', name: 'Commit discipline (Co-Authored-By trailer)', failures: 1, runs: 1, last_at: '2026-10-09T11:40:00.000Z' },
        ],
        runs: { total: 46, completed: 37, cancelled: 3, error: 1, waiting_for_owner: 3, running: 2, success_rate: 37 / 41 },
        by_workflow: [
            { workflow_id: 'wf-build', name: 'Build', runs: 0, completed: 0, success_rate: null, median_duration_s: null, avg_loops: 0, avg_gate_rounds: 0, cost_per_run_usd: null },
            { workflow_id: 'wf-delivery', name: 'Delivery', runs: 29, completed: 22, success_rate: 22 / 26, median_duration_s: 52 * 60, avg_loops: 0.8, avg_gate_rounds: 0.4, cost_per_run_usd: 4.12 },
            { workflow_id: 'wf-quick', name: 'Quick change', runs: 17, completed: 15, success_rate: 1, median_duration_s: 9 * 60, avg_loops: 0.2, avg_gate_rounds: 0, cost_per_run_usd: 0.61 },
        ],
        gates: { pass: 112, fail: 14, unavailable: 3, needs_review: 1, pass_rate: 112 / 126 },
        park_reasons: [
            { kind: 'question', reason: 'Agent asked you', count: 13 },
            { kind: 'checklist_failed', reason: 'Required checklist failed', count: 6 },
            { kind: 'loop_limit', reason: 'Loop limit reached', count: 3 },
            { kind: 'check_unavailable', reason: 'A check could not run', count: 2 },
        ],
        retries: { retries: 6, dispatches: 214, rate: 6 / 214 },
        agents: [
            agent('agent-architect', 'Architect', '#5B7CFA', 29, 27, 0, 2, 1, 0, 21.8, 190),
            agent('agent-architect-reviewer', 'Architect Reviewer', '#4263CB', 29, 22, 6, 1, 0, 0, 3.1, 24),
            // In name order, as the API returns them (fleetPerformance sorts by name, ADR 0023).
            agent('agent-code-reviewer', 'Code Reviewer', '#0891B2', 64, 46, 17, 1, 2, 1, 14.2, 95),
            agent('agent-coder', 'Coder', '#7C3AED', 64, 51, 4, 9, 12, 7, 88.4, 640),
            agent('agent-qa', 'QA Engineer', '#059669', 28, 25, 1, 2, 3, 2, 9.7, 210),
        ],
        previous: { runs: 35, success_rate: 0.81 },
    };
}

export function spendFixture() {
    const r = rng(11);
    const ds = days(16);
    const daily = ds.map((date) => {
        const a = 2 + r() * 9;
        const t = r() * 3;
        return {
            date,
            total_cost_usd: Number(a.toFixed(4)),
            input_tokens: Math.round(a * 40_000),
            output_tokens: Math.round(a * 12_000),
            cache_read_tokens: Math.round(a * 410_000),
            run_count: Math.round(a * 1.6),
            terminal_total_cost_usd: Number(t.toFixed(4)),
            terminal_session_count: Math.round(t),
            terminal_input_tokens: Math.round(t * 30_000),
            terminal_output_tokens: Math.round(t * 9_000),
            terminal_cache_read_tokens: Math.round(t * 250_000),
        };
    });
    const sum = (k: keyof (typeof daily)[number]) => daily.reduce((n, d) => n + Number(d[k]), 0);
    const agentic = sum('total_cost_usd');
    const terminal = sum('terminal_total_cost_usd');
    return {
        period: { start: '2026-10-01T00:00:00Z', end: '2026-10-31T23:59:59.999Z', tz: 'UTC', window: 'month', previous_start: '2026-09-01T00:00:00.000Z', previous_end: '2026-09-16T12:00:00.000Z' },
        previous: { total_cost_usd: agentic * 1.18, terminal_total_cost_usd: terminal * 0.7 },
        summary: {
            total_cost_usd: agentic, input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'),
            cache_read_tokens: sum('cache_read_tokens'), cache_creation_tokens: 0, run_count: sum('run_count'),
        },
        daily,
        monthly: ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month, i) => ({
            month, total_cost_usd: 20 + i * 14 + r() * 20, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
            run_count: 30 + i * 9, terminal_total_cost_usd: 5 + r() * 15, terminal_session_count: 4 + i,
        })),
        byAgent: workflowsFixture().agents.map((a) => ({ agent_id: a.agent_id, agent_name: a.name, total_cost_usd: a.cost_usd, input_tokens: 0, output_tokens: 0, run_count: a.steps })),
        byProject: [
            { project_id: 'e2e-terminal-project', project_name: 'Storefront', total_cost_usd: agentic * 0.58, run_count: 120 },
            { project_id: 'p-billing', project_name: 'Billing service', total_cost_usd: agentic * 0.31, run_count: 61 },
            { project_id: 'p-docs', project_name: 'Developer docs', total_cost_usd: agentic * 0.11, run_count: 33 },
        ],
        topRuns: [],
        cacheEfficiency: 0.91,
        terminalSummary: { total_cost_usd: terminal, input_tokens: sum('terminal_input_tokens'), output_tokens: sum('terminal_output_tokens'), cache_read_tokens: sum('terminal_cache_read_tokens'), cache_creation_tokens: 0, session_count: sum('terminal_session_count') },
        terminalByCli: [{ cli: 'claude', total_cost_usd: terminal, session_count: sum('terminal_session_count'), input_tokens: 0, output_tokens: 0 }],
        terminalByProject: [{ project_id: 'e2e-terminal-project', project_name: 'Storefront', total_cost_usd: terminal, session_count: 9 }],
        topTerminalSessions: [],
        byModel: [
            { source: 'agentic', cli: 'claude', model: 'claude-opus-5-5', total_cost_usd: agentic * 0.62, cache_read_tokens: 3_100_000, count: 88 },
            { source: 'agentic', cli: 'claude', model: 'claude-sonnet-5-5', total_cost_usd: agentic * 0.38, cache_read_tokens: 2_400_000, count: 126 },
            { source: 'terminal', cli: 'claude', model: 'claude-opus-5-5', total_cost_usd: terminal, cache_read_tokens: 900_000, count: 9 },
        ],
        cache_savings_usd: 18.42,
        cache_savings_unpriced_tokens: 0,
        shipped_tasks: 38,
        buckets: ds,
        trends: {
            spend: trend(agentic + terminal, (agentic * 1.18) + terminal * 0.7, daily.map((d) => d.total_cost_usd + d.terminal_total_cost_usd)),
            cost_per_task: trend((agentic + terminal) / 38, ((agentic * 1.18) + terminal * 0.7) / 29, daily.map((d, i) => (i % 6 === 5 ? null : (d.total_cost_usd + d.terminal_total_cost_usd) / 2))),
            cache_savings: trend(18.42, 15.1, daily.map((d) => Number((d.cache_read_tokens * 1.8e-6).toFixed(4)))),
            cache_hit_rate: trend(0.91, 0.88, daily.map((d) => d.cache_read_tokens / (d.cache_read_tokens + d.input_tokens))),
        },
        cost_efficiency: {
            by_workflow: [
                { workflow_id: 'wf-build', name: 'Build', runs: 0, cost_usd: 0, prs: 0, shipped_tasks: 0, per_pr_usd: null, per_task_usd: null },
                { workflow_id: 'wf-delivery', name: 'Delivery', runs: 29, cost_usd: 119.48, prs: 31, shipped_tasks: 24, per_pr_usd: 119.48 / 31, per_task_usd: 119.48 / 24 },
                { workflow_id: 'wf-quick', name: 'Quick change', runs: 17, cost_usd: 10.37, prs: 10, shipped_tasks: 14, per_pr_usd: 1.037, per_task_usd: 10.37 / 14 },
            ],
            by_model: [
                { model: 'claude-opus-5-5', cli: 'claude', runs: 29, cost_usd: 74.1, prs: 31, shipped_tasks: 24, per_pr_usd: 74.1 / 31, per_task_usd: 74.1 / 24 },
                { model: 'claude-sonnet-5-5', cli: 'claude', runs: 46, cost_usd: 51.2, prs: 41, shipped_tasks: 38, per_pr_usd: 51.2 / 41, per_task_usd: 51.2 / 38 },
                { model: 'gpt-5.4', cli: 'copilot', runs: 8, cost_usd: 4.55, prs: 7, shipped_tasks: 6, per_pr_usd: 4.55 / 7, per_task_usd: 4.55 / 6 },
            ],
        },
    };
}

export function emptyDelivery() {
    const d = deliveryFixture();
    return {
        ...d,
        shipped: { tasks: 0, sub_tasks: 0 },
        throughput: d.throughput.map((b) => ({ ...b, tasks: 0, sub_tasks: 0, cycle_p50_s: null })),
        lead_time: { count: 0, p50_s: null, p90_s: null },
        cycle_time: { count: 0, p50_s: null, p90_s: null },
        cycle_histogram: d.cycle_histogram.map((h) => ({ ...h, count: 0 })),
        time_in_status: d.time_in_status.map((s) => ({ ...s, avg_s: 0, items: 0 })),
        waiting: { parks: 0, total_s: 0, median_s: null, still_waiting: 0 },
        reopens: { reopened: 0, done: 0, rate: null },
        wip: { count: 0, aging: 0, aging_after_s: 7 * 86_400, oldest: [] },
        by_priority: d.by_priority.map((p) => ({ ...p, shipped: 0, cycle_p50_s: null })),
        by_project: [],
        source_mix: { jira: 0, native: 0 },
        prs: { opened: 0, merged: 0, merge_rate: null, median_s_to_pr: null },
        previous: { tasks_shipped: 0, cycle_p50_s: null, prs_merged: 0 },
        trends: Object.fromEntries(Object.keys(d.trends).map((k) => [k, trend(null, null, d.buckets.map(() => null))])),
        flow: {
            efficiency: null,
            active_s: 0,
            waiting_s: 0,
            owner_response: { answered: 0, unanswered: 0, p50_s: null, p90_s: null },
            weekly_throughput: 0,
            weekly: d.flow.weekly.map((w) => ({ ...w, tasks: 0 })),
        },
        rework: { shipped: 0, reopened: 0, rate: null },
        first_attempt: { merged_runs: 0, clean: 0, rate: null },
    };
}

/** Route the three summary endpoints to the fixtures (drill-down endpoints stay real). */
export async function routeAnalytics(page: Page, opts: { empty?: boolean } = {}): Promise<string[]> {
    const seen: string[] = [];
    await page.route(/\/api\/analytics(\/delivery|\/workflows)?\?/, async (route) => {
        const url = new URL(route.request().url());
        seen.push(`${url.pathname}?window=${url.searchParams.get('window')}`);
        const body = url.pathname.endsWith('/delivery')
            ? opts.empty ? emptyDelivery() : deliveryFixture()
            : url.pathname.endsWith('/workflows')
              ? workflowsFixture()
              : spendFixture();
        await route.fulfill({ json: body });
    });
    return seen;
}
