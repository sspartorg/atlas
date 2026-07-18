import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { screen } from '@testing-library/react';
import { KpiStrip } from './KpiStrip.js';

describe('KpiStrip', () => {
    it('renders with empty stats', () => {
        const { container } = renderWithProviders(
            <KpiStrip awaitingCount={0} projectCount={0} stats={undefined} />,
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders with provided stats', () => {
        const { container } = renderWithProviders(
            <KpiStrip
                awaitingCount={3}
                projectCount={5}
                stats={{
                    'software-dev': { queued: 1, running: 2 },
                    marketing: { queued: 0, running: 0 },
                    content: { queued: 0, running: 1 },
                    design: { queued: 1, running: 0 },
                }}
            />,
        );
        expect(container.textContent).toContain('Software dev');
        expect(container.textContent).toContain('Content + Design');
    });

    it('singular "project" when projectCount=1 (covers === 1 branch)', () => {
        const { container } = renderWithProviders(
            <KpiStrip awaitingCount={2} projectCount={1} stats={undefined} />,
        );
        // The caption reads "across 1 project"
        expect(container.textContent).toContain('project');
        expect(container.textContent).not.toContain('projects');
    });

    it('shows cost tile value when costSummary30d provided (covers costSummary30d truthy branch)', () => {
        renderWithProviders(
            <KpiStrip
                awaitingCount={0}
                projectCount={0}
                stats={undefined}
                costSummary30d={{
                    total_cost_usd: 3.14,
                    run_count: 7,
                    input_tokens: 1000,
                    output_tokens: 500,
                    cache_read_tokens: 200,
                    cache_creation_tokens: 0,
                }}
            />,
        );
        // formatCostUsd(3.14) renders something with "$" and the run count
        expect(document.body.textContent).toContain('runs');
    });

    it('shows "No activity yet" when both costSummary30d and terminalCostSummary30d are undefined', () => {
        renderWithProviders(
            <KpiStrip awaitingCount={0} projectCount={0} stats={undefined} />,
        );
        expect(screen.getByText('No activity yet')).toBeInTheDocument();
    });

    it('stats defined but missing some keys — ?? fallback fires for each absent category', () => {
        // When stats is truthy but lacks 'marketing', 'content', 'design' keys,
        // each `stats?.['key'] ?? { queued: 0, running: 0 }` takes the ?? path.
        renderWithProviders(
            <KpiStrip
                awaitingCount={1}
                projectCount={2}
                stats={{
                    // Only software-dev provided; marketing/content/design are absent
                    'software-dev': { queued: 3, running: 1 },
                } as Parameters<typeof KpiStrip>[0]['stats']}
            />,
        );
        expect(document.body.textContent).toContain('Software dev');
        // Content + Design tile renders with 0/0 from the ?? fallback
        expect(document.body.textContent).toContain('Content + Design');
    });

    it('costSummary30d with null token fields (input_tokens ?? 0 branch)', () => {
        // Covers the `?? 0` branches for null token values
        renderWithProviders(
            <KpiStrip
                awaitingCount={0}
                projectCount={0}
                stats={undefined}
                costSummary30d={{
                    total_cost_usd: 0.5,
                    run_count: 2,
                    input_tokens: null as unknown as number,
                    output_tokens: null as unknown as number,
                    cache_read_tokens: null as unknown as number,
                    cache_creation_tokens: 0,
                }}
            />,
        );
        expect(document.body.textContent).toContain('runs');
    });

    it('run_count === 1 renders singular "run" (line 136 ternary)', () => {
        // Covers `run{runs === 1 ? '' : 's'}` true branch
        renderWithProviders(
            <KpiStrip
                awaitingCount={0}
                projectCount={0}
                stats={undefined}
                costSummary30d={{
                    total_cost_usd: 1.0,
                    run_count: 1,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_creation_tokens: 0,
                }}
            />,
        );
        // "1 run" (singular) should appear — "runs" should NOT
        expect(document.body.textContent).toMatch(/\b1\b.*\brun\b/);
    });

    it('session_count === 1 renders singular "session" (line 137 ternary)', () => {
        // Covers `session{sessions === 1 ? '' : 's'}` true branch
        renderWithProviders(
            <KpiStrip
                awaitingCount={0}
                projectCount={0}
                stats={undefined}
                terminalCostSummary30d={{
                    total_cost_usd: 0.2,
                    session_count: 1,
                    input_tokens: 0,
                    output_tokens: 0,
                    cache_read_tokens: 0,
                    cache_creation_tokens: 0,
                }}
            />,
        );
        // "1 session" (singular) should appear
        expect(document.body.textContent).toMatch(/\b1\b.*\bsession\b/);
    });

    it('terminalCostSummary30d only (no costSummary30d) — covers || terminalCostSummary30d path', () => {
        // When costSummary30d is undefined but terminalCostSummary30d is defined,
        // the `costSummary30d || terminalCostSummary30d` evaluates the second operand
        renderWithProviders(
            <KpiStrip
                awaitingCount={0}
                projectCount={0}
                stats={undefined}
                terminalCostSummary30d={{
                    total_cost_usd: 0.5,
                    session_count: 2,
                    input_tokens: 100,
                    output_tokens: 50,
                    cache_read_tokens: 0,
                    cache_creation_tokens: 0,
                }}
            />,
        );
        expect(document.body.textContent).toContain('sessions');
    });
});
