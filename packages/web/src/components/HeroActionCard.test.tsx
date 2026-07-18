import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { HeroActionCard } from './HeroActionCard.js';

describe('HeroActionCard', () => {
    it('renders title, description, and fires the CTA', async () => {
        const onClick = vi.fn();
        renderWithProviders(
            <HeroActionCard
                icon={<span data-testid="icon" />}
                title="Connect a project"
                description="Hook up your first repo"
                cta={{ label: 'Connect', onClick }}
            />,
        );
        expect(screen.getByText('Connect a project')).toBeInTheDocument();
        expect(screen.getByText('Hook up your first repo')).toBeInTheDocument();
        expect(screen.getByTestId('icon')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Connect/ }));
        expect(onClick).toHaveBeenCalled();
    });
});
