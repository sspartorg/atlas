import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { SpendByAgentCard } from './_SpendByAgentCard.js';

describe('SpendByAgentCard', () => {
    it('renders the empty-state message when byAgent is empty', () => {
        renderWithProviders(<SpendByAgentCard byAgent={[]} totalAgentCost={0} />);
        expect(screen.getByText(/No agent spend this month/i)).toBeInTheDocument();
    });

    it('renders the legend even when every agent has zero cost (donut handles all-zero gracefully)', () => {
        renderWithProviders(
            <SpendByAgentCard
                byAgent={[
                    { agent_id: 'a1', agent_name: 'Coder', total_cost_usd: 0, run_count: 0 },
                ]}
                totalAgentCost={0}
            />,
        );
        // Legend still renders the agent name with 0.0% — the empty state
        // is only used when byAgent itself is empty.
        expect(screen.getAllByText(/Coder/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/0\.0%/).length).toBeGreaterThan(0);
    });

    it('renders the populated donut + legend when data exists', () => {
        renderWithProviders(
            <SpendByAgentCard
                byAgent={[
                    { agent_id: 'a1', agent_name: 'Coder', total_cost_usd: 3.0, run_count: 6 },
                    { agent_id: 'a2', agent_name: 'Reviewer', total_cost_usd: 1.0, run_count: 2 },
                ]}
                totalAgentCost={4.0}
            />,
        );
        expect(screen.getAllByText(/Coder/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Reviewer/).length).toBeGreaterThan(0);
        expect(screen.getByText(/2 agents ran this month/i)).toBeInTheDocument();
    });
});
