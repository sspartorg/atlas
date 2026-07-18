import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { TerminalSessionsCard } from './_TerminalSessionsCard.js';

const emptySummary = {
    total_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    session_count: 0,
};

const populatedSummary = {
    total_cost_usd: 0.42,
    input_tokens: 12_000,
    output_tokens: 800,
    cache_read_tokens: 4_500,
    session_count: 3,
};

const byCli = [
    { cli: 'claude' as const, total_cost_usd: 0.30, session_count: 2, input_tokens: 9_000, output_tokens: 600 },
    { cli: 'copilot' as const, total_cost_usd: 0.12, session_count: 1, input_tokens: 3_000, output_tokens: 200 },
];

const topSessions = [
    {
        session_id: 'sess-aaa',
        project_name: 'Atlas',
        title: 'Refactor cache layer',
        cli: 'claude' as const,
        total_cost_usd: 0.20,
        input_tokens: 6_000,
        output_tokens: 400,
        cache_read_tokens: 3_000,
        closed_at: '2026-06-30T10:00:00.000Z',
        subagents: [],
    },
    {
        session_id: 'sess-bbb',
        project_name: 'Atlas',
        title: 'Fix flaky test',
        cli: 'copilot' as const,
        total_cost_usd: 0.12,
        input_tokens: 3_000,
        output_tokens: 200,
        cache_read_tokens: 0,
        closed_at: '2026-06-30T11:00:00.000Z',
        subagents: [],
    },
];

describe('TerminalSessionsCard', () => {
    it('renders the empty state when session_count is zero (TSC-EMPTY)', () => {
        renderWithProviders(
            <TerminalSessionsCard
                summary={emptySummary}
                byCli={[]}
                topSessions={[]}
                monthLabel="June"
            />,
        );
        // Empty-state copy explicitly mentions /terminal and the month.
        expect(screen.getByText(/No closed sessions this month/i)).toBeInTheDocument();
        expect(screen.getByText(/— no terminal sessions for June —/i)).toBeInTheDocument();
        // None of the metric tiles render in the empty state.
        expect(screen.queryByText(/Sessions closed/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Avg per session/i)).not.toBeInTheDocument();
    });

    it('renders metric tiles, CLI breakdown, and top sessions when populated (TSC-FULL)', () => {
        renderWithProviders(
            <TerminalSessionsCard
                summary={populatedSummary}
                byCli={byCli}
                topSessions={topSessions}
                monthLabel="June"
            />,
        );
        // Eyebrow + title for the populated state.
        expect(screen.getByText(/Manual terminal sessions/i)).toBeInTheDocument();
        expect(screen.getByText(/Owner-driven runs/i)).toBeInTheDocument();
        // Three metric tile labels.
        expect(screen.getByText(/Sessions closed/i)).toBeInTheDocument();
        expect(screen.getByText(/Total spend/i)).toBeInTheDocument();
        expect(screen.getByText(/Avg per session/i)).toBeInTheDocument();
        // Total spend value rendered via formatCostUsd.
        expect(screen.getByText('$0.42')).toBeInTheDocument();
        // Per-CLI breakdown surfaces both CLI labels. "Claude" appears at
        // least twice — once in the CLI-split bar and again as a chip on
        // the Claude top-session row — so use getAllByText.
        expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Copilot').length).toBeGreaterThan(0);
        // Top sessions table surfaces the session titles.
        expect(screen.getByText('Refactor cache layer')).toBeInTheDocument();
        expect(screen.getByText('Fix flaky test')).toBeInTheDocument();
    });

    it('links each top-session row to /terminal/<id>/history (TSC-LINKS)', () => {
        renderWithProviders(
            <TerminalSessionsCard
                summary={populatedSummary}
                byCli={byCli}
                topSessions={topSessions}
                monthLabel="June"
            />,
        );
        // Every visible top-session row is an <a> linking to /terminal/<id>/history.
        const aaa = screen.getByText('Refactor cache layer').closest('a');
        const bbb = screen.getByText('Fix flaky test').closest('a');
        expect(aaa).toHaveAttribute('href', '/terminal/sess-aaa/history');
        expect(bbb).toHaveAttribute('href', '/terminal/sess-bbb/history');
    });

    it('caps the top-sessions list at 5 rows even when more are passed (TSC-CAP-5)', () => {
        // Synthesize 8 top sessions so the .slice(0, 5) branch fires.
        const many = Array.from({ length: 8 }, (_, i) => ({
            session_id: `sess-${i}`,
            project_name: 'Atlas',
            title: `Session #${i}`,
            cli: 'claude' as const,
            total_cost_usd: 0.5 - i * 0.05,
            input_tokens: 1_000,
            output_tokens: 100,
            cache_read_tokens: 0,
            closed_at: '2026-06-29T10:00:00.000Z',
            subagents: [],
        }));
        renderWithProviders(
            <TerminalSessionsCard
                summary={{ ...populatedSummary, session_count: 8 }}
                byCli={byCli}
                topSessions={many}
                monthLabel="June"
            />,
        );
        // First 5 rendered; rows 6-8 (titles #5, #6, #7) suppressed.
        expect(screen.getByText('Session #0')).toBeInTheDocument();
        expect(screen.getByText('Session #4')).toBeInTheDocument();
        expect(screen.queryByText('Session #5')).not.toBeInTheDocument();
        expect(screen.queryByText('Session #7')).not.toBeInTheDocument();
    });

    it('shows percentage labels per CLI when totalCliCost > 0 (TSC-CLI-PCT)', () => {
        renderWithProviders(
            <TerminalSessionsCard
                summary={populatedSummary}
                byCli={byCli}
                topSessions={topSessions}
                monthLabel="June"
            />,
        );
        // Per-CLI percentages: claude = 0.30 / 0.42 ≈ 71.4%, copilot = 0.12 / 0.42 ≈ 28.6%.
        // Assert presence via partial regex so toFixed rounding doesn't break the test.
        expect(screen.getByText(/71\.4%/)).toBeInTheDocument();
        expect(screen.getByText(/28\.6%/)).toBeInTheDocument();
    });
});
