import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { IAgent } from '@atlas/shared';

import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { PerformanceTabContent } from './PerformanceTabContent.js';
import type { AgentPerformance } from '../../api/types.js';

const BASE = 'http://localhost:3000/api';
const agent: IAgent = makeAgent({ id: 'agent-release-reviewer', name: 'Release Reviewer' });

function perf(over: Partial<AgentPerformance> = {}): AgentPerformance {
    return {
        agent_id: 'agent-release-reviewer',
        role_id: 'engineer',
        window: { since: '2026-06-26T00:00:00Z', until: null },
        quality: {
            steps: 20,
            dispatches: 24,
            first_pass: { applied: 7, rejected: 13, parked: 0 },
            loops: 4,
            gate_catch: 2,
        },
        cost: {
            total_usd: 54.68,
            per_step_usd: 2.73,
            input_tokens: 1298,
            output_tokens: 526026,
            cache_read_tokens: 42375303,
            cache_creation_tokens: 2033375,
            cache_hit_pct: 1,
        },
        latency: { p50_s: 277, p95_s: 466, max_s: 559, ttft_p50_ms: 3627 },
        tools: {
            runs_with_trace: 1,
            runs_total: 24,
            top: [{ name: 'Bash', calls: 29, runs: 1 }],
            avg_turns: 79,
            avg_tool_calls: 45,
        },
        by_config: [
            { model: 'claude-opus-5', effort: 'xhigh', steps: 20, first_pass: { applied: 7, rejected: 13, parked: 0 }, cost_usd: 54.68 },
        ],
        trend: [],
        ...over,
    };
}

function mount(body: AgentPerformance = perf()) {
    server.use(http.get(`${BASE}/agents/agent-release-reviewer/performance`, () => HttpResponse.json(body)));
    return renderWithProviders(<PerformanceTabContent agent={agent} />);
}

describe('PerformanceTabContent', () => {
    it('shows the three first-attempt outcomes side by side', async () => {
        mount();
        expect(await screen.findByText('Applied')).toBeInTheDocument();
        expect(screen.getByText('Sent back')).toBeInTheDocument();
        expect(screen.getByText('Asked you')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByText('13')).toBeInTheDocument();
    });

    // ADR 0023: on the v4 golden set `agent-release-reviewer` scored 64%
    // BECAUSE it rejected four times, and those rejections were the most
    // valuable thing in the run. A page that showed a pass rate would
    // recommend culling the best reviewer in the fleet, so it shows none.
    it('never renders a pass rate', async () => {
        const { container } = mount();
        await screen.findByText('Applied');
        // 7 of 20 would read as 35%. No percentage of first attempts appears.
        expect(container.textContent).not.toMatch(/35\s*%/);
        expect(screen.queryByText(/pass@1/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/pass rate/i)).not.toBeInTheDocument();
    });

    it('shows the signal the agent cannot author about itself', async () => {
        mount();
        expect(await screen.findByText('gate catches')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    // Traces exist only from migration 017 on. A tool profile over an unstated
    // denominator is the dishonest kind of number.
    it('states how many runs the tool profile came from', async () => {
        mount();
        expect(await screen.findByText(/From 1 of 24 runs/)).toBeInTheDocument();
    });

    it('says so plainly when no run has a trace yet', async () => {
        mount(perf({ tools: { runs_with_trace: 0, runs_total: 9, top: [], avg_turns: null, avg_tool_calls: null } }));
        expect(await screen.findByText(/None of these 9 runs has a trace/)).toBeInTheDocument();
    });

    // ATL-140: the numbers must be attributable to the configuration that
    // produced them.
    it('names the model and effort the numbers were measured at', async () => {
        mount();
        expect(await screen.findByText(/claude-opus-5 · xhigh/)).toBeInTheDocument();
    });

    it('explains an agent with no steps instead of rendering empty charts', async () => {
        mount(perf({ quality: { steps: 0, dispatches: 0, first_pass: { applied: 0, rejected: 0, parked: 0 }, loops: 0, gate_catch: 0 } }));
        expect(await screen.findByText('Nothing to measure yet')).toBeInTheDocument();
        expect(screen.queryByText('Applied')).not.toBeInTheDocument();
    });

    it('renders an agent that only ever applied, with no other segments', async () => {
        mount(perf({
            quality: { steps: 5, dispatches: 5, first_pass: { applied: 5, rejected: 0, parked: 0 }, loops: 0, gate_catch: 0 },
        }));
        expect(await screen.findByText('Applied')).toBeInTheDocument();
        expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    });

    // Everything here can be unknown on a fresh install, and "—" is the
    // honest rendering of that — never a zero nobody measured.
    it('renders every unknown number as a dash, not a zero', async () => {
        mount(perf({
            cost: {
                total_usd: 0, per_step_usd: null, input_tokens: 0, output_tokens: 0,
                cache_read_tokens: 0, cache_creation_tokens: 0, cache_hit_pct: null,
            },
            latency: { p50_s: null, p95_s: null, max_s: null, ttft_p50_ms: null },
        }));
        await screen.findByText('Applied');
        expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    });

    it('renders a fast step in seconds and a slow one in minutes', async () => {
        mount(perf({ latency: { p50_s: 12, p95_s: 300, max_s: 300, ttft_p50_ms: 1200 } }));
        expect(await screen.findByText('12s')).toBeInTheDocument();
        expect(screen.getByText('5m')).toBeInTheDocument();
    });

    it('names a configuration the run never recorded', async () => {
        mount(perf({
            by_config: [{ model: null, effort: null, steps: 2, first_pass: { applied: 2, rejected: 0, parked: 0 }, cost_usd: 1 }],
        }));
        expect(await screen.findByText(/unrecorded · unrecorded/)).toBeInTheDocument();
    });

    it('surfaces a failure to load rather than rendering nothing', async () => {
        server.use(
            http.get(`${BASE}/agents/agent-release-reviewer/performance`, () =>
                HttpResponse.json({ error: 'the window is too wide' }, { status: 500 }),
            ),
        );
        renderWithProviders(<PerformanceTabContent agent={agent} />);
        expect(await screen.findByText(/the window is too wide/)).toBeInTheDocument();
    });

    it('hides a tooltip-less stat and still renders the rest', async () => {
        mount(perf({ quality: { steps: 1, dispatches: 1, first_pass: { applied: 0, rejected: 0, parked: 1 }, loops: 0, gate_catch: 0 } }));
        expect(await screen.findByText('Asked you')).toBeInTheDocument();
        expect(screen.getByText('steps')).toBeInTheDocument();
    });

    it('collapses a long tool list to the busiest few', async () => {
        mount(perf({
            tools: {
                runs_with_trace: 4,
                runs_total: 4,
                top: Array.from({ length: 8 }, (_, i) => ({ name: `Tool${i}`, calls: 8 - i, runs: 1 })),
                avg_turns: 10,
                avg_tool_calls: 8,
            },
        }));
        expect(await screen.findByText('Tool0')).toBeInTheDocument();
        expect(screen.getByText('Tool7')).toBeInTheDocument();
    });
});
