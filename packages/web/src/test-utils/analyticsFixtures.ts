import type { IAnalyticsDelivery, IAnalyticsWorkflows } from '@atlas/shared';
import type { AnalyticsResponse } from '../api/types.js';

// Small, hand-readable analytics payloads for the /analytics page tests.

const H = 3600;
const period = {
    window: 'month' as const,
    tz: 'UTC',
    bucket: 'day' as const,
    start: '2026-10-01T00:00:00.000Z',
    end: '2026-10-03T12:00:00.000Z',
    previous_start: '2026-09-01T00:00:00.000Z',
    previous_end: '2026-09-03T12:00:00.000Z',
};

export function deliveryFixture(over: Partial<IAnalyticsDelivery> = {}): IAnalyticsDelivery {
    return {
        period,
        shipped: { tasks: 6, sub_tasks: 9 },
        throughput: [
            { bucket: '2026-10-01', tasks: 2, sub_tasks: 3, cycle_p50_s: 5 * H },
            { bucket: '2026-10-02', tasks: 0, sub_tasks: 0, cycle_p50_s: null },
            { bucket: '2026-10-03', tasks: 4, sub_tasks: 6, cycle_p50_s: 8 * H },
        ],
        lead_time: { count: 6, p50_s: 30 * H, p90_s: 70 * H },
        cycle_time: { count: 5, p50_s: 7 * H, p90_s: 20 * H },
        cycle_histogram: [
            { label: '< 1h', min_s: 0, max_s: H, count: 1 },
            { label: '4–24h', min_s: 4 * H, max_s: 86_400, count: 4 },
        ],
        time_in_status: [
            { status: 'draft', avg_s: 10 * H, items: 6 },
            { status: 'ready', avg_s: 2 * H, items: 4 },
            { status: 'in_progress', avg_s: 6 * H, items: 5 },
            { status: 'waiting_for_info', avg_s: 3 * H, items: 2 },
            { status: 'in_review', avg_s: 4 * H, items: 5 },
        ],
        waiting: { parks: 3, total_s: 9 * H, median_s: 2 * H, still_waiting: 1 },
        reopens: { reopened: 1, done: 15, rate: 1 / 15 },
        wip: {
            count: 2,
            aging: 1,
            aging_after_s: 7 * 86_400,
            oldest: [
                { id: 'ATL-9', title: 'Old migration', status: 'in_progress', project_id: 'p1', age_s: 9 * 86_400 },
                { id: 'ATL-12', title: 'Fresh fix', status: 'in_review', project_id: 'p1', age_s: 5 * H },
            ],
        },
        by_priority: [
            { priority: 'urgent', shipped: 1, cycle_p50_s: 2 * H },
            { priority: 'high', shipped: 0, cycle_p50_s: null },
            { priority: 'normal', shipped: 5, cycle_p50_s: 8 * H },
            { priority: 'low', shipped: 0, cycle_p50_s: null },
        ],
        by_project: [{ project_id: 'p1', project_name: 'Storefront', shipped: 6, cycle_p50_s: 7 * H, lead_p50_s: 30 * H }],
        source_mix: { jira: 2, native: 4 },
        prs: { opened: 5, merged: 4, merge_rate: 0.8, median_s_to_pr: 40 * 60 },
        previous: { tasks_shipped: 4, cycle_p50_s: 12 * H, prs_merged: 3 },
        ...over,
    };
}

export function emptyDeliveryFixture(): IAnalyticsDelivery {
    return deliveryFixture({
        shipped: { tasks: 0, sub_tasks: 0 },
        throughput: [{ bucket: '2026-10-01', tasks: 0, sub_tasks: 0, cycle_p50_s: null }],
        lead_time: { count: 0, p50_s: null, p90_s: null },
        cycle_time: { count: 0, p50_s: null, p90_s: null },
        cycle_histogram: [],
        time_in_status: [{ status: 'draft', avg_s: 0, items: 0 }],
        waiting: { parks: 0, total_s: 0, median_s: null, still_waiting: 0 },
        reopens: { reopened: 0, done: 0, rate: null },
        wip: { count: 0, aging: 0, aging_after_s: 7 * 86_400, oldest: [] },
        by_priority: [],
        by_project: [],
        source_mix: { jira: 0, native: 0 },
        prs: { opened: 0, merged: 0, merge_rate: null, median_s_to_pr: null },
        previous: { tasks_shipped: 0, cycle_p50_s: null, prs_merged: 0 },
    });
}

export function workflowsFixture(over: Partial<IAnalyticsWorkflows> = {}): IAnalyticsWorkflows {
    return {
        period,
        runs: { total: 10, completed: 7, cancelled: 1, error: 1, waiting_for_owner: 1, running: 0, success_rate: 7 / 9 },
        by_workflow: [
            { workflow_id: 'wf-d', name: 'Delivery', runs: 6, completed: 4, success_rate: 4 / 5, median_duration_s: 50 * 60, avg_loops: 0.5, avg_gate_rounds: 0.2, cost_per_run_usd: 3.5 },
            { workflow_id: 'wf-q', name: 'Quick change', runs: 4, completed: 3, success_rate: 1, median_duration_s: 8 * 60, avg_loops: 0, avg_gate_rounds: 0, cost_per_run_usd: null },
        ],
        gates: { pass: 20, fail: 2, unavailable: 1, needs_review: 0, pass_rate: 20 / 22 },
        park_reasons: [{ kind: 'question', reason: 'Agent asked you', count: 3 }],
        retries: { retries: 2, dispatches: 40, rate: 0.05 },
        agents: [
            { agent_id: 'a-anna', name: 'Anna Reviewer', accent_color: '#123456', steps: 4, first_pass: { applied: 2, rejected: 2, parked: 0 }, loops: 0, gate_catch: 0, cost_usd: 1, per_step_usd: 0.25, p95_s: 30 },
            { agent_id: 'a-coder', name: 'Coder', accent_color: null, steps: 9, first_pass: { applied: 8, rejected: 0, parked: 1 }, loops: 2, gate_catch: 1, cost_usd: 9, per_step_usd: 1, p95_s: 600 },
        ],
        previous: { runs: 8, success_rate: 0.6 },
        ...over,
    };
}

export function spendFixture(over: Partial<AnalyticsResponse> = {}): AnalyticsResponse {
    return {
        period: { start: '2026-10-01T00:00:00Z', end: '2026-10-31T23:59:59.999Z', tz: 'UTC', window: 'month' },
        previous: { total_cost_usd: 30, terminal_total_cost_usd: 2 },
        summary: { total_cost_usd: 20, input_tokens: 1000, output_tokens: 500, cache_read_tokens: 9000, cache_creation_tokens: 0, run_count: 12 },
        daily: [
            { date: '2026-10-01', total_cost_usd: 8, input_tokens: 400, output_tokens: 200, cache_read_tokens: 4000, run_count: 5, terminal_total_cost_usd: 1, terminal_session_count: 1, terminal_input_tokens: 10, terminal_output_tokens: 5, terminal_cache_read_tokens: 50 },
            { date: '2026-10-03', total_cost_usd: 12, input_tokens: 600, output_tokens: 300, cache_read_tokens: 5000, run_count: 7, terminal_total_cost_usd: 3, terminal_session_count: 2, terminal_input_tokens: 10, terminal_output_tokens: 5, terminal_cache_read_tokens: 50 },
        ],
        monthly: [{ month: '2026-10', total_cost_usd: 20, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, run_count: 12, terminal_total_cost_usd: 4, terminal_session_count: 3 }],
        byAgent: [{ agent_id: 'a-coder', agent_name: 'Coder', total_cost_usd: 20, input_tokens: 0, output_tokens: 0, run_count: 12 }],
        byProject: [{ project_id: 'p1', project_name: 'Storefront', total_cost_usd: 20, run_count: 12 }],
        topRuns: [],
        cacheEfficiency: 0.9,
        terminalSummary: { total_cost_usd: 4, input_tokens: 20, output_tokens: 10, cache_read_tokens: 100, cache_creation_tokens: 0, session_count: 3 },
        terminalByCli: [],
        terminalByProject: [],
        topTerminalSessions: [],
        byModel: [
            { source: 'agentic', cli: 'claude', model: 'claude-opus-5-5', total_cost_usd: 15, cache_read_tokens: 6000, count: 8 },
            { source: 'terminal', cli: 'claude', model: null, total_cost_usd: 4, cache_read_tokens: 100, count: 3 },
        ],
        cache_savings_usd: 1.25,
        cache_savings_unpriced_tokens: 100,
        shipped_tasks: 6,
        ...over,
    };
}
