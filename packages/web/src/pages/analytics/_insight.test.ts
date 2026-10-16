import { describe, expect, it } from 'vitest';
import { deliveryFixture, spendFixture, workflowsFixture } from '../../test-utils/analyticsFixtures.js';
import { pickInsight, totalSpend } from './_insight.js';

const H = 3600;
// A delivery with no swings, so each test can turn on exactly one branch.
const calm = () =>
    deliveryFixture({
        cycle_time: { count: 5, p50_s: 7 * H, p90_s: 9 * H },
        previous: { tasks_shipped: 6, cycle_p50_s: 7 * H, prs_merged: 3 },
        wip: { count: 0, aging: 0, aging_after_s: 7 * 86_400, oldest: [] },
    });
const steadySpend = () => spendFixture({ previous: { total_cost_usd: 20, terminal_total_cost_usd: 4 }, cacheEfficiency: 0.2 });

describe('pickInsight', () => {
    it('leads with time waiting on the Owner when it dominates shipped work', () => {
        const d = deliveryFixture({
            time_in_status: [
                { status: 'in_progress', avg_s: 4 * H, items: 6 },
                { status: 'waiting_for_info', avg_s: 6 * H, items: 3 },
            ],
        });
        const i = pickInsight(spendFixture(), d, workflowsFixture());
        expect(i.label).toBe('Waiting on you');
        expect(i.sentence).toBe('Shipped Tasks spent 60% of their time waiting for your reply. 3 parks this window, median wait 2.0h.');
    });

    it('reports a cycle-time swing', () => {
        const d = calm();
        d.previous.cycle_p50_s = 14 * H;
        expect(pickInsight(steadySpend(), d, workflowsFixture()).sentence).toMatch(/^Median cycle time is down 50%: 7\.0h/);
    });

    it('reports a throughput swing', () => {
        const d = calm();
        d.previous.tasks_shipped = 3;
        expect(pickInsight(steadySpend(), d, workflowsFixture()).sentence).toBe('6 Tasks shipped, up 100% from 3 the window before.');
    });

    it('names the oldest aging Task', () => {
        const d = calm();
        d.wip = deliveryFixture().wip;
        expect(pickInsight(steadySpend(), d, workflowsFixture()).sentence).toBe(
            '1 Task has been open for more than 7.0d. The oldest, ATL-9, has been in flight 9.0d.',
        );
    });

    it('falls back to spend, then cache, then plain activity', () => {
        expect(pickInsight(spendFixture(), calm(), workflowsFixture()).label).toBe('Spend');
        const cached = spendFixture({ previous: { total_cost_usd: 20, terminal_total_cost_usd: 4 } });
        expect(pickInsight(cached, calm(), workflowsFixture()).label).toBe('Cache leverage');
        expect(pickInsight(steadySpend(), calm(), workflowsFixture()).sentence).toBe('6 Tasks shipped, 10 workflow runs and $24.00 spent.');
    });

    it('says when nothing happened at all', () => {
        const d = calm();
        d.shipped = { tasks: 0, sub_tasks: 0 };
        d.previous.tasks_shipped = 0;
        const s = spendFixture({
            summary: { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, run_count: 0 },
            terminalSummary: { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, session_count: 0 },
            previous: { total_cost_usd: 0, terminal_total_cost_usd: 0 },
            cacheEfficiency: 0,
        });
        const w = workflowsFixture({ runs: { total: 0, completed: 0, cancelled: 0, error: 0, waiting_for_owner: 0, running: 0, success_rate: null } });
        expect(pickInsight(s, d, w).sentence).toBe('Nothing shipped, ran or spent in this window yet.');
        expect(totalSpend(s)).toBe(0);
    });

    it('uses singular words for one of a thing', () => {
        const d = calm();
        d.shipped = { tasks: 1, sub_tasks: 0 };
        d.previous.tasks_shipped = 1;
        const w = workflowsFixture({ runs: { total: 1, completed: 1, cancelled: 0, error: 0, waiting_for_owner: 0, running: 0, success_rate: 1 } });
        expect(pickInsight(steadySpend(), d, w).sentence).toBe('1 Task shipped, 1 workflow run and $24.00 spent.');
        const waiting = deliveryFixture({
            waiting: { parks: 1, total_s: H, median_s: H, still_waiting: 0 },
            time_in_status: [{ status: 'waiting_for_info', avg_s: H, items: 1 }],
        });
        expect(pickInsight(steadySpend(), waiting, w).sentence).toContain('1 park this window');
        const two = calm();
        two.wip = { ...deliveryFixture().wip, aging: 2 };
        expect(pickInsight(steadySpend(), two, w).sentence).toMatch(/^2 Tasks have been open/);
    });
});
