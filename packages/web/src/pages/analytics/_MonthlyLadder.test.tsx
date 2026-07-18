import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { MonthlyLadder } from './_MonthlyLadder.js';

describe('MonthlyLadder', () => {
    it('renders the chrome heading even with no data', () => {
        renderWithProviders(<MonthlyLadder momData={[]} />);
        // Match the literal title (case-sensitive) to avoid matching the
        // empty-state label's "trailing 12 months" substring.
        expect(screen.getByText('Trailing 12 months')).toBeInTheDocument();
    });

    it('renders the empty-state when momData is empty', () => {
        renderWithProviders(<MonthlyLadder momData={[]} />);
        expect(
            screen.getByText(/No spend in the trailing 12 months/i),
        ).toBeInTheDocument();
    });

    it('renders without crashing with sample monthly rows', () => {
        const months = [
            {
                month: 'Jan 26',
                key: '2026-01',
                cost: 12.5,
                terminalCost: 0,
                runs: 40,
                terminalSessions: 0,
                input: 100_000,
                output: 25_000,
                cached: 4000,
            },
            {
                month: 'Feb 26',
                key: '2026-02',
                cost: 17.2,
                terminalCost: 3.4,
                runs: 55,
                terminalSessions: 6,
                input: 150_000,
                output: 30_000,
                cached: 8000,
            },
        ];
        expect(() =>
            renderWithProviders(<MonthlyLadder momData={months} />),
        ).not.toThrow();
    });
});
