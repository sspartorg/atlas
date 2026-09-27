import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';

import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { FleetPerformance } from './FleetPerformance.js';
import type { FleetAgentRow, FleetPerformance as FleetPayload } from '../api/types.js';

const BASE = 'http://localhost:3000/api';

function row(over: Partial<FleetAgentRow> = {}): FleetAgentRow {
    return {
        agent_id: 'agent-release-reviewer',
        name: 'Release Reviewer',
        accent_color: '#123456',
        quality: { steps: 20, dispatches: 24, first_pass: { applied: 7, rejected: 13, parked: 0 }, loops: 4, gate_catch: 2 },
        cost: { total_usd: 54.6, per_step_usd: 2.73 },
        latency: { p95_s: 466 },
        trend: [
            { bucket: '2026-09-14', steps: 8, first_pass: { applied: 3, rejected: 5, parked: 0 }, cost_usd: 20, p95_s: 400 },
            { bucket: '2026-09-21', steps: 12, first_pass: { applied: 4, rejected: 8, parked: 0 }, cost_usd: 34.6, p95_s: 466 },
        ],
        ...over,
    };
}

function payload(over: Partial<FleetPayload> = {}): FleetPayload {
    return {
        window: { since: '2026-06-29T00:00:00Z', until: null },
        agents: [row(), row({ agent_id: 'agent-coder', name: 'Coder', trend: [], latency: { p95_s: 30 }, cost: { total_usd: 0, per_step_usd: null } })],
        delivery: {
            runs: 6,
            prs_opened: 5,
            prs_merged: 3,
            merge_rate: 0.6,
            tasks_merged: 3,
            merged_cost_usd: 35.25,
            cost_per_merged_task_usd: 11.75,
            median_s_to_pr: 5400,
            interventions: { parked: 3, tasks: 4, per_task: 0.75, since: '2026-09-27T10:00:00Z' },
        },
        ...over,
    };
}

let lastDays: string | null = null;
function mount(body: FleetPayload = payload(), initial = '/agents/performance') {
    lastDays = null;
    server.use(
        http.get(`${BASE}/agents/performance`, ({ request }) => {
            lastDays = new URL(request.url).searchParams.get('days');
            return HttpResponse.json(body);
        }),
    );
    function Where() {
        const loc = useLocation();
        return <div data-testid="where">{loc.pathname + loc.search}</div>;
    }
    return renderWithProviders(
        <Routes>
            <Route path="/agents/performance" element={<FleetPerformance />} />
            <Route path="*" element={<Where />} />
        </Routes>,
        { initialEntries: [initial] },
    );
}

describe('FleetPerformance', () => {
    it('shows the delivery tiles with honest denominators', async () => {
        mount();
        expect(await screen.findByText('PRs merged')).toBeInTheDocument();
        expect(screen.getByText('of 5 opened')).toBeInTheDocument();
        expect(screen.getByText('$11.75')).toBeInTheDocument();
        expect(screen.getByText('Cost per merged Task')).toBeInTheDocument();
        expect(screen.getByText(/3 delivered/)).toBeInTheDocument();
        expect(screen.getByText('1.5h')).toBeInTheDocument();
        expect(screen.getByText('0.8')).toBeInTheDocument();
        // The intervention series starts at migration 024, and says so.
        expect(screen.getByText(/3 over 4 Tasks since/)).toBeInTheDocument();
    });

    it('compares every agent in the order the API sent, with the tab’s outcome labels', async () => {
        mount();
        const table = await screen.findByRole('table', { name: 'Agents compared' });
        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['Release Reviewer', 'Coder']);
        expect(within(table).getByText('Sent back')).toBeInTheDocument();
        expect(within(rows[0] as HTMLElement).getByText('7 · 13 · 0')).toBeInTheDocument();
        expect(within(rows[0] as HTMLElement).getByText('$2.73')).toBeInTheDocument();
        expect(within(rows[0] as HTMLElement).getByText('8m')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Release Reviewer steps by week: 8, 12' })).toBeInTheDocument();
        expect(within(rows[1] as HTMLElement).getByText('no weeks yet')).toBeInTheDocument();
        expect(within(rows[1] as HTMLElement).getByText('—')).toBeInTheDocument();
    });

    // ADR 0023 — a comparison, never a ranking by success.
    it('never shows a pass rate', async () => {
        const { container } = mount();
        await screen.findByRole('table');
        expect(screen.queryByText(/pass rate/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/pass@1/i)).not.toBeInTheDocument();
        // 7 of 20 would read as 35%.
        expect(container.textContent).not.toMatch(/35\s*%/);
    });

    it('never draws a rejection in the error colour', async () => {
        const { container } = mount();
        await screen.findByRole('table');
        const segments = container.querySelectorAll('[data-outcome="rejected"]');
        expect(segments.length).toBeGreaterThan(0);
        for (const el of segments) {
            expect(getComputedStyle(el).background).toMatch(/brandblue/i);
            expect(getComputedStyle(el).background).not.toMatch(/error/i);
        }
    });

    it('opens an agent’s Performance tab from its row', async () => {
        mount();
        await userEvent.click(await screen.findByText('Coder'));
        expect(screen.getByTestId('where').textContent).toBe('/agents/agent-coder?tab=performance');
    });

    it('switches the window between 90 and 30 days', async () => {
        mount();
        await screen.findByRole('table');
        expect(lastDays).toBe('90');
        await userEvent.click(screen.getByRole('button', { name: '30 days' }));
        await waitFor(() => expect(lastDays).toBe('30'));
        // Pressing the selected window again keeps it rather than clearing it.
        await userEvent.click(screen.getByRole('button', { name: '30 days' }));
        expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(screen.getByRole('button', { name: '90 days' }));
        await waitFor(() => expect(lastDays).toBe('90'));
    });

    it('reads the window from the URL', async () => {
        mount(payload(), '/agents/performance?days=30');
        await screen.findByRole('table');
        expect(lastDays).toBe('30');
    });

    it('says plainly when there is nothing in the window', async () => {
        mount(
            payload({
                agents: [],
                delivery: {
                    runs: 0,
                    prs_opened: 0,
                    prs_merged: 0,
                    merge_rate: null,
                    tasks_merged: 0,
                    merged_cost_usd: 0,
                    cost_per_merged_task_usd: null,
                    median_s_to_pr: null,
                    interventions: { parked: 0, tasks: 0, per_task: null, since: null },
                },
            }),
        );
        expect(await screen.findByText('Nothing to compare yet')).toBeInTheDocument();
        expect(screen.getByText(/No workflow runs in the last 90 days/)).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    // Runs whose steps all fell outside the window, or project runs with no
    // agent step, still delivered — unknown numbers render as dashes.
    it('shows deliveries with no agent rows, and dashes for what was not measured', async () => {
        mount(
            payload({
                agents: [],
                delivery: {
                    runs: 1,
                    prs_opened: 0,
                    prs_merged: 0,
                    merge_rate: null,
                    tasks_merged: 0,
                    merged_cost_usd: 0,
                    cost_per_merged_task_usd: null,
                    median_s_to_pr: null,
                    interventions: { parked: 0, tasks: 0, per_task: null, since: null },
                },
            }),
        );
        expect(await screen.findByText('No agent took a workflow step in this window.')).toBeInTheDocument();
        expect(screen.getAllByText('—').length).toBe(3);
        expect(screen.getByText('not recorded yet')).toBeInTheDocument();
    });

    it('renders short and multi-day times to PR in their own units', async () => {
        const d = payload().delivery;
        mount(payload({ delivery: { ...d, median_s_to_pr: 45 } }));
        expect(await screen.findByText('45s')).toBeInTheDocument();
    });

    it('renders a multi-day time to PR in days', async () => {
        const d = payload().delivery;
        mount(payload({ delivery: { ...d, median_s_to_pr: 3 * 86_400 } }));
        expect(await screen.findByText('3.0d')).toBeInTheDocument();
    });

    it('surfaces a failure to load', async () => {
        server.use(http.get(`${BASE}/agents/performance`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
        renderWithProviders(<FleetPerformance />, { initialEntries: ['/agents/performance'] });
        expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
    });
});

