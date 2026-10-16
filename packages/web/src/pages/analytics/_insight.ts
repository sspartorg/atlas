import type { IAnalyticsDelivery, IAnalyticsWorkflows } from '@atlas/shared';
import type { AnalyticsResponse } from '../../api/types.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { formatSpan } from '../../utils/time.js';

export interface Insight {
    label: string;
    sentence: string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const change = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Total spend in a summary response: agent runs plus terminal sessions. */
export function totalSpend(s: AnalyticsResponse): number {
    return s.summary.total_cost_usd + (s.terminalSummary?.total_cost_usd ?? 0);
}

/**
 * One sentence that says the most useful thing about the window, picked in
 * priority order: where shipped work waited, a cycle-time swing, a throughput
 * swing, aging WIP, a spend swing, cache leverage, then plain activity.
 * Every branch quotes the numbers it is based on.
 */
export function pickInsight(
    spend: AnalyticsResponse,
    delivery: IAnalyticsDelivery,
    workflows: IAnalyticsWorkflows,
): Insight {
    const shipped = delivery.shipped.tasks;
    const waitShare = (() => {
        const total = delivery.time_in_status.reduce((n, s) => n + s.avg_s, 0);
        const waiting = delivery.time_in_status.find((s) => s.status === 'waiting_for_info')?.avg_s ?? 0;
        return total > 0 ? waiting / total : 0;
    })();
    if (shipped >= 3 && waitShare >= 0.3) {
        return {
            label: 'Waiting on you',
            sentence: `Shipped Tasks spent ${pct(waitShare)} of their time waiting for your reply. ${delivery.waiting.parks.toLocaleString()} park${delivery.waiting.parks === 1 ? '' : 's'} this window, median wait ${formatSpan(delivery.waiting.median_s)}.`,
        };
    }

    const cyc = delivery.cycle_time.p50_s;
    const prevCyc = delivery.previous.cycle_p50_s;
    const cycChange = cyc !== null && prevCyc !== null ? change(cyc, prevCyc) : null;
    if (cycChange !== null && Math.abs(cycChange) >= 0.25 && delivery.cycle_time.count >= 3) {
        return {
            label: 'Cycle time',
            sentence: `Median cycle time is ${cycChange < 0 ? 'down' : 'up'} ${pct(Math.abs(cycChange))}: ${formatSpan(cyc)} from first In progress to Done, against ${formatSpan(prevCyc)} the window before.`,
        };
    }

    const tpChange = change(shipped, delivery.previous.tasks_shipped);
    if (tpChange !== null && Math.abs(tpChange) >= 0.25 && shipped + delivery.previous.tasks_shipped >= 4) {
        return {
            label: 'Throughput',
            sentence: `${plural(shipped, 'Task')} shipped, ${tpChange < 0 ? 'down' : 'up'} ${pct(Math.abs(tpChange))} from ${delivery.previous.tasks_shipped.toLocaleString()} the window before.`,
        };
    }

    const oldest = delivery.wip.oldest[0];
    if (delivery.wip.aging > 0 && oldest) {
        return {
            label: 'Aging work',
            sentence: `${plural(delivery.wip.aging, 'Task has', 'Tasks have')} been open for more than ${formatSpan(delivery.wip.aging_after_s)}. The oldest, ${oldest.id}, has been in flight ${formatSpan(oldest.age_s)}.`,
        };
    }

    const cur = totalSpend(spend);
    const prev = (spend.previous?.total_cost_usd ?? 0) + (spend.previous?.terminal_total_cost_usd ?? 0);
    const spendChange = change(cur, prev);
    if (spendChange !== null && Math.abs(spendChange) >= 0.25) {
        return {
            label: 'Spend',
            sentence: `Spend is ${spendChange < 0 ? 'down' : 'up'} ${pct(Math.abs(spendChange))}: ${formatCostUsd(cur)} this window against ${formatCostUsd(prev)} the window before.`,
        };
    }

    if (spend.cacheEfficiency >= 0.5 && (spend.cache_savings_usd ?? 0) > 0) {
        return {
            label: 'Cache leverage',
            sentence: `${pct(spend.cacheEfficiency)} of agent input came from cache, which saved about ${formatCostUsd(spend.cache_savings_usd ?? 0)} against fresh-input prices.`,
        };
    }

    const runs = workflows.runs.total;
    return {
        label: 'This window',
        sentence:
            shipped + runs === 0 && cur === 0
                ? 'Nothing shipped, ran or spent in this window yet.'
                : `${plural(shipped, 'Task')} shipped, ${plural(runs, 'workflow run')} and ${formatCostUsd(cur)} spent.`,
    };
}
