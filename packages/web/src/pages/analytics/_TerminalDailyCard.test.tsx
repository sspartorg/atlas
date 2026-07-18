import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { TerminalDailyCard } from './_TerminalDailyCard.js';

describe('TerminalDailyCard', () => {
    it('renders the empty-state message when every row is zero', () => {
        renderWithProviders(
            <TerminalDailyCard
                data={[
                    { date: 'May 1', cost: 0, input: 0, output: 0, cached: 0, sessions: 0 },
                ]}
                monthLabel="May 2026"
                activeDays={0}
                sessionCount={0}
                totalTerminalTokens={0}
                totalTerminalCost={0}
            />,
        );
        expect(screen.getByText(/No terminal sessions for May 2026/i)).toBeInTheDocument();
    });

    it('renders the populated chart sub-line when data exists', () => {
        renderWithProviders(
            <TerminalDailyCard
                data={[
                    { date: 'May 1', cost: 0.2, input: 800, output: 200, cached: 100, sessions: 1 },
                    { date: 'May 2', cost: 0.4, input: 1000, output: 400, cached: 200, sessions: 1 },
                ]}
                monthLabel="May 2026"
                activeDays={2}
                sessionCount={2}
                totalTerminalTokens={2_700}
                totalTerminalCost={0.6}
            />,
        );
        expect(
            screen.getByText(/Manual terminal sessions — May 2026/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/2 sessions closed/i)).toBeInTheDocument();
    });
});
