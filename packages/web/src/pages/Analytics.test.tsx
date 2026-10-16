import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import {
    deliveryFixture,
    emptyDeliveryFixture,
    spendFixture,
    workflowsFixture,
} from '../test-utils/analyticsFixtures.js';
import { Analytics } from './Analytics.js';

const BASE = 'http://localhost:3000/api';

function Location() {
    const l = useLocation();
    return <div data-testid="loc">{l.search}</div>;
}

/** Route the three endpoints and record every request as `path?window`. */
function mockAll(opts: { delivery?: unknown; failDelivery?: boolean } = {}) {
    const calls: string[] = [];
    const rec = (req: Request) => {
        const u = new URL(req.url);
        calls.push(`${u.pathname.replace('/api', '')}?${u.searchParams.get('window')}`);
    };
    server.use(
        http.get(`${BASE}/analytics`, ({ request }) => {
            rec(request);
            return HttpResponse.json(spendFixture());
        }),
        http.get(`${BASE}/analytics/delivery`, ({ request }) => {
            rec(request);
            if (opts.failDelivery) return HttpResponse.json({ error: 'boom' }, { status: 500 });
            return HttpResponse.json(opts.delivery ?? deliveryFixture());
        }),
        http.get(`${BASE}/analytics/workflows`, ({ request }) => {
            rec(request);
            return HttpResponse.json(workflowsFixture());
        }),
    );
    return calls;
}

function renderAt(path: string) {
    return renderWithProviders(
        <>
            <Analytics />
            <Location />
        </>,
        { initialEntries: [path] },
    );
}

describe('Analytics — tabs and window', () => {
    it('opens on Overview for this month and fetches all three summaries', async () => {
        const calls = mockAll();
        renderAt('/analytics');
        expect(await screen.findByText('Median cycle time')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
        // The insight quotes its numbers: cycle p50 7h vs 12h before = down 42%.
        expect(screen.getByText(/Median cycle time is down 42%: 7.0h from first In progress to Done, against 12.0h/)).toBeInTheDocument();
        // Spend $24 ÷ 6 shipped Tasks.
        expect(screen.getByText('$4.00')).toBeInTheDocument();
        expect([...calls].sort()).toEqual(['/analytics/delivery?month', '/analytics/workflows?month', '/analytics?month']);
    });

    it('deep-links a tab and window, and fetches only what that tab shows', async () => {
        const calls = mockAll();
        renderAt('/analytics?tab=delivery&window=7d');
        expect(await screen.findByText('Throughput per day')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Delivery/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
        expect(calls).toEqual(['/analytics/delivery?7d']);
    });

    it('writes the tab and window to the URL, and drops the defaults', async () => {
        const calls = mockAll();
        renderAt('/analytics');
        await screen.findByText('Median cycle time');
        fireEvent.click(screen.getByRole('tab', { name: /Workflows & agents/ }));
        await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('?tab=workflows'));
        fireEvent.click(screen.getByRole('button', { name: '90 days' }));
        await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('?tab=workflows&window=90d'));
        await waitFor(() => expect(calls).toContain('/analytics/workflows?90d'));
        fireEvent.click(screen.getByRole('button', { name: 'This month' }));
        fireEvent.click(screen.getByRole('tab', { name: /Overview/ }));
        await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent(/^$/));
    });

    it('ignores an unknown tab or window', async () => {
        mockAll();
        renderAt('/analytics?tab=nope&window=1y');
        expect(await screen.findByText('Median cycle time')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('shows the API error instead of a blank tab', async () => {
        mockAll({ failDelivery: true });
        renderAt('/analytics?tab=delivery');
        expect(await screen.findByText(/Could not load delivery analytics/)).toBeInTheDocument();
    });
});

describe('Analytics — Delivery tab', () => {
    it('renders every section with its definition and links work and projects', async () => {
        mockAll();
        renderAt('/analytics?tab=delivery');
        await screen.findByText('Throughput per day');
        for (const title of ['Cycle time trend', 'Cycle time distribution', 'Where shipped work waited', 'Cycle time by priority', 'Where shipped Tasks came from', 'Oldest work in progress', 'By project']) {
            expect(screen.getByText(title)).toBeInTheDocument();
        }
        expect(screen.getByRole('button', { name: 'How Cycle time, median is measured' })).toBeInTheDocument();
        expect(screen.getAllByText('7.0h').length).toBeGreaterThan(0);
        expect(screen.getByRole('link', { name: 'ATL-9' })).toHaveAttribute('href', '/tasks/ATL-9');
        expect(screen.getByText(/9\.0d · aging/)).toBeInTheDocument();
        const table = screen.getByRole('table', { name: 'Delivery by project' });
        expect(within(table).getByRole('link', { name: 'Storefront' })).toHaveAttribute('href', '/analytics/project/p1');
    });

    it('says plainly when nothing shipped', async () => {
        mockAll({ delivery: emptyDeliveryFixture() });
        renderAt('/analytics?tab=delivery');
        expect(await screen.findAllByText('Nothing shipped in this window')).not.toHaveLength(0);
        expect(screen.getByText('No Tasks are in progress, waiting or in review right now.')).toBeInTheDocument();
        expect(screen.getByText('No project shipped a Task in this window.')).toBeInTheDocument();
    });
});

describe('Analytics — Workflows & agents tab', () => {
    it('lists workflows and agents in name order, never ranked', async () => {
        const calls = mockAll();
        renderAt('/analytics?tab=workflows');
        const agents = await screen.findByRole('table', { name: 'Agents compared' });
        const names = within(agents).getAllByRole('link').map((a) => a.textContent);
        expect(names).toEqual(['Anna Reviewer', 'Coder']);
        expect(within(agents).getByRole('link', { name: 'Anna Reviewer' })).toHaveAttribute('href', '/agents/a-anna?tab=performance');
        expect(screen.getByRole('link', { name: 'Fleet performance' })).toHaveAttribute('href', '/agents/performance');
        expect(screen.getByText('78%')).toBeInTheDocument();
        expect(screen.getByText('Agent asked you')).toBeInTheDocument();
        expect(calls).toEqual(['/analytics/workflows?month']);
    });
});

describe('Analytics — row navigation', () => {
    function Path() {
        return <div data-testid="path">{useLocation().pathname}</div>;
    }
    it('rows open the project drill-down, the workflow and the agent', async () => {
        mockAll();
        renderWithProviders(<><Analytics /><Path /></>, { initialEntries: ['/analytics?tab=delivery'] });
        const projects = await screen.findByRole('table', { name: 'Delivery by project' });
        fireEvent.click(within(projects).getByText('6'));
        await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/analytics/project/p1'));
    });

    it('workflow and agent rows navigate, and their links do not double-fire', async () => {
        mockAll();
        renderWithProviders(<><Analytics /><Path /></>, { initialEntries: ['/analytics?tab=workflows'] });
        const wf = await screen.findByRole('table', { name: 'Workflows compared' });
        fireEvent.click(within(wf).getByText('Delivery').closest('tr') as HTMLElement);
        await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/workflows/wf-d'));
    });

    it('an agent row opens its performance tab', async () => {
        mockAll();
        renderWithProviders(<><Analytics /><Path /></>, { initialEntries: ['/analytics?tab=workflows'] });
        const agents = await screen.findByRole('table', { name: 'Agents compared' });
        fireEvent.click(within(agents).getByText('Coder').closest('tr') as HTMLElement);
        await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/agents/a-coder'));
    });
});

describe('Analytics — empty and weekly windows', () => {
    it('Workflows says plainly when nothing ran', async () => {
        mockAll();
        server.use(
            http.get(`${BASE}/analytics/workflows`, () =>
                HttpResponse.json(
                    workflowsFixture({
                        runs: { total: 0, completed: 0, cancelled: 0, error: 0, waiting_for_owner: 0, running: 0, success_rate: null },
                        by_workflow: [],
                        gates: { pass: 0, fail: 0, unavailable: 0, needs_review: 0, pass_rate: null },
                        park_reasons: [],
                        retries: { retries: 0, dispatches: 0, rate: null },
                        agents: [],
                        previous: { runs: 0, success_rate: null },
                    }),
                ),
            ),
        );
        renderAt('/analytics?tab=workflows');
        expect(await screen.findByText('No workflow runs in this window')).toBeInTheDocument();
        for (const t of ['No parks in this window', 'No checks ran in this window', 'No run cost in this window', 'No workflow ran in this window.', 'No agent took a workflow step in this window.']) {
            expect(screen.getByText(t)).toBeInTheDocument();
        }
    });

    it('Overview on 90 days rolls spend into weeks and handles no ships', async () => {
        mockAll({
            delivery: {
                ...emptyDeliveryFixture(),
                period: { ...deliveryFixture().period, window: '90d', bucket: 'week' },
                throughput: [{ bucket: '2026-09-28', tasks: 0, sub_tasks: 0, cycle_p50_s: null }],
            },
        });
        renderAt('/analytics?window=90d');
        expect(await screen.findByText('Shipped and spent, per week')).toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('Overview shows the first failing summary', async () => {
        mockAll({ failDelivery: true });
        renderAt('/analytics');
        expect(await screen.findByText(/Could not load analytics/)).toBeInTheDocument();
    });
});

describe('Analytics — Spend tab', () => {
    it('shows the new spend measures over the window', async () => {
        const calls = mockAll();
        renderAt('/analytics?tab=spend&window=30d');
        expect(await screen.findByText('Cost by model')).toBeInTheDocument();
        expect(screen.getByText('$1.25')).toBeInTheDocument();
        expect(screen.getByText('100 cached tokens unpriced')).toBeInTheDocument();
        expect(screen.getByText('Unknown model')).toBeInTheDocument();
        expect(screen.getByText('Agent runs vs terminal sessions')).toBeInTheDocument();
        expect(calls).toEqual(['/analytics?30d']);
    });

    it('draws terminal sessions with their subagents', async () => {
        const sub = (key: string, cost: number | null, est = false) => ({
            subagent_key: key, source: (cost === null ? 'copilot_list' : 'claude_jsonl') as 'copilot_list' | 'claude_jsonl', agent_type: 'Explore', description: `Look into ${key}`,
            spawn_depth: 1, input_tokens: 100, output_tokens: 20, cache_read_tokens: 300, cache_creation_tokens: 0, cost_usd: cost, is_estimate: est,
        });
        server.use(
            http.get(`${BASE}/analytics`, () =>
                HttpResponse.json(
                    spendFixture({
                        terminalByCli: [
                            { cli: 'claude', total_cost_usd: 3, session_count: 2, input_tokens: 10, output_tokens: 5 },
                            { cli: 'copilot', total_cost_usd: 1, session_count: 1, input_tokens: 10, output_tokens: 5 },
                        ],
                        terminalByProject: [{ project_id: 'p1', project_name: 'Storefront', total_cost_usd: 4, session_count: 3 }],
                        topTerminalSessions: [
                            { session_id: 's1', project_id: 'p1', project_name: 'Storefront', title: 'Fix the cart', cli: 'claude', total_cost_usd: 3, input_tokens: 10, output_tokens: 5, cache_read_tokens: 50, closed_at: '2026-10-02T10:00:00Z', subagents: [sub('a', 0.5), sub('b', null), sub('c', 0.2, true)] },
                            { session_id: 's2', project_id: null, project_name: null, title: '', cli: 'copilot', total_cost_usd: 1, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, closed_at: '2026-10-03T10:00:00Z', subagents: [] },
                        ],
                    }),
                ),
            ),
        );
        renderAt('/analytics?tab=spend');
        const [expand] = await screen.findAllByRole('button', { name: 'Expand subagents' }, { timeout: 10_000 });
        fireEvent.click(expand as HTMLElement);
        expect(await screen.findByRole('button', { name: 'Collapse subagents' })).toBeInTheDocument();
        expect(screen.getByText('Fix the cart')).toBeInTheDocument();
    });

    it('reads an older or empty response as empty, not broken', async () => {
        server.use(
            http.get(`${BASE}/analytics`, () =>
                HttpResponse.json({
                    ...spendFixture({
                        summary: { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, run_count: 0 },
                        daily: [],
                        monthly: [],
                        byAgent: [],
                        byProject: [],
                        cacheEfficiency: 0,
                    }),
                    previous: undefined,
                    byModel: undefined,
                    cache_savings_usd: undefined,
                    cache_savings_unpriced_tokens: undefined,
                    shipped_tasks: undefined,
                    terminalSummary: undefined,
                    terminalByCli: undefined,
                    terminalByProject: undefined,
                    topTerminalSessions: undefined,
                }),
            ),
        );
        renderAt('/analytics?tab=spend&window=90d');
        expect(await screen.findAllByText('No spend in this window')).toHaveLength(3);
        expect(screen.getByText('No tokens in this window')).toBeInTheDocument();
        expect(screen.getByText('Spend per week')).toBeInTheDocument();
        expect(screen.getByText('0 Tasks shipped')).toBeInTheDocument();
    });
});
