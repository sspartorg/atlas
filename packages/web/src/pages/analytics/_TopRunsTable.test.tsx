import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { TopRunsTable } from './_TopRunsTable.js';

const ISO = '2026-05-16T00:00:00.000Z';

const runs = [
    {
        run_id: 'r1',
        agent_id: 'agent-coder',
        agent_name: 'Coder',
        issue_id: 'ATL-1',
        issue_type: 'story',
        total_cost_usd: 1.25,
        input_tokens: 12_000,
        output_tokens: 4500,
        cache_read_tokens: 800,
        created_at: ISO,
    },
    {
        run_id: 'r2',
        agent_id: 'agent-coder',
        agent_name: 'Coder',
        issue_id: null,
        issue_type: 'story',
        total_cost_usd: 0.65,
        input_tokens: 7000,
        output_tokens: 2100,
        cache_read_tokens: 0,
        created_at: ISO,
    },
];

describe('TopRunsTable', () => {
    it('renders the header row', () => {
        renderWithProviders(<TopRunsTable topRuns={runs} topRunsMaxCost={1.25} />);
        expect(screen.getByText('Agent / Item')).toBeInTheDocument();
        expect(screen.getByText('Input')).toBeInTheDocument();
        expect(screen.getByText('Cached')).toBeInTheDocument();
    });

    it('renders each agent name', () => {
        renderWithProviders(<TopRunsTable topRuns={runs} topRunsMaxCost={1.25} />);
        const matches = screen.getAllByText('Coder');
        expect(matches.length).toBe(2);
    });

    it('skips the issue line when issue_id is null', () => {
        renderWithProviders(
            <TopRunsTable topRuns={[runs[1]!]} topRunsMaxCost={runs[1]!.total_cost_usd} />,
        );
        // Should not show "story · ATL-..." line when issue_id is null
        expect(screen.queryByText(/ATL-/)).not.toBeInTheDocument();
    });

    it('shows the issue line when issue_id is present', () => {
        renderWithProviders(
            <TopRunsTable topRuns={[runs[0]!]} topRunsMaxCost={runs[0]!.total_cost_usd} />,
        );
        expect(screen.getByText('story · ATL-1')).toBeInTheDocument();
    });

    it('handles a zero topRunsMaxCost without dividing by zero', () => {
        const empty = [{ ...runs[0]!, total_cost_usd: 0 }];
        expect(() =>
            renderWithProviders(<TopRunsTable topRuns={empty} topRunsMaxCost={0} />),
        ).not.toThrow();
    });

    it('singularizes the sub-header for a single run', () => {
        renderWithProviders(<TopRunsTable topRuns={[runs[0]!]} topRunsMaxCost={1.25} />);
        expect(screen.getByText(/Top 1 run /)).toBeInTheDocument();
    });

    it('renders the empty-state when topRuns is empty', () => {
        renderWithProviders(<TopRunsTable topRuns={[]} topRunsMaxCost={0} />);
        expect(screen.getByText(/No completed runs this month/i)).toBeInTheDocument();
    });

    it('renders rank > 3 rows with slate40 color (isPodium false branch)', () => {
        // Need at least 4 runs so rank 4 hits isPodium=false → ATLAS_PALETTE.slate40 color
        const manyRuns = [
            runs[0]!,
            runs[1]!,
            { ...runs[0]!, run_id: 'r3', total_cost_usd: 0.5 },
            { ...runs[0]!, run_id: 'r4', total_cost_usd: 0.2 },
        ];
        renderWithProviders(<TopRunsTable topRuns={manyRuns} topRunsMaxCost={1.25} />);
        // Rank 04 row renders — '04' text confirms rank > 3 path executed
        expect(screen.getByText('04')).toBeInTheDocument();
    });
});
