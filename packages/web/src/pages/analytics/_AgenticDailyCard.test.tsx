import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgenticDailyCard } from './_AgenticDailyCard.js';

describe('AgenticDailyCard', () => {
    it('renders the empty-state message when every row is zero', () => {
        renderWithProviders(
            <AgenticDailyCard
                data={[
                    { date: 'May 1', cost: 0, input: 0, output: 0, cached: 0, runs: 0 },
                    { date: 'May 2', cost: 0, input: 0, output: 0, cached: 0, runs: 0 },
                ]}
                monthLabel="May 2026"
                daysActive={0}
                runCount={0}
                totalAgentTokens={0}
                totalAgentCost={0}
            />,
        );
        expect(screen.getByText(/No agent runs for May 2026/i)).toBeInTheDocument();
    });

    it('renders the populated chart sub-line when data exists', () => {
        renderWithProviders(
            <AgenticDailyCard
                data={[
                    { date: 'May 1', cost: 0.5, input: 1000, output: 500, cached: 200, runs: 1 },
                    { date: 'May 2', cost: 0.8, input: 1200, output: 600, cached: 300, runs: 2 },
                ]}
                monthLabel="May 2026"
                daysActive={2}
                runCount={3}
                totalAgentTokens={3_800}
                totalAgentCost={1.3}
            />,
        );
        expect(screen.getByText(/Autonomous runs — May 2026/i)).toBeInTheDocument();
        expect(screen.getByText(/2 active days/i)).toBeInTheDocument();
    });
});
