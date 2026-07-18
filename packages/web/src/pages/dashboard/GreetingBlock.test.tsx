import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { GreetingBlock } from './GreetingBlock.js';
import { __GREETING_BANK, randomGreeting } from './greetingMessages.js';

describe('GreetingBlock', () => {
    it('renders a known kicker with the owner name', () => {
        renderWithProviders(<GreetingBlock ownerFirstName="Bob" awaitingCount={0} />);
        // The rendered kicker is one of the 30 bank greetings, uppercased,
        // appended with the owner name. Find a kicker by scanning the bank.
        const found = __GREETING_BANK.some((g) => {
            const expected = `${g.toUpperCase()}, BOB`;
            return screen.queryByText(expected) !== null;
        });
        expect(found).toBe(true);
    });

    it('renders zero count copy', () => {
        renderWithProviders(<GreetingBlock ownerFirstName="Bob" awaitingCount={0} />);
        expect(screen.getByText(/Nothing needs you/)).toBeInTheDocument();
    });

    it('renders singular count copy', () => {
        renderWithProviders(<GreetingBlock ownerFirstName="Bob" awaitingCount={1} />);
        expect(screen.getByText(/1 thing needs you/)).toBeInTheDocument();
    });

    it('renders plural count copy', () => {
        renderWithProviders(<GreetingBlock ownerFirstName="Bob" awaitingCount={5} />);
        expect(screen.getByText(/5 things need you/)).toBeInTheDocument();
    });
});

describe('greeting bank invariants', () => {
    it('contains exactly 30 greetings across all time buckets', () => {
        expect(__GREETING_BANK).toHaveLength(30);
    });

    it('has no empty entries', () => {
        for (const greeting of __GREETING_BANK) {
            expect(greeting.trim().length).toBeGreaterThan(0);
        }
    });

    it('randomGreeting() returns a string from the bank for every hour of the day', () => {
        for (let hour = 0; hour < 24; hour++) {
            const now = new Date(2026, 0, 1, hour, 0, 0);
            const picked = randomGreeting(now);
            expect(__GREETING_BANK).toContain(picked);
        }
    });
});
