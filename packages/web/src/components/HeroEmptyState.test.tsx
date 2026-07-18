import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { HeroEmptyState } from './HeroEmptyState.js';

describe('HeroEmptyState', () => {
    it('renders title and optional slots', () => {
        renderWithProviders(
            <HeroEmptyState
                icon={<span data-testid="icon" />}
                title="No projects"
                description="Connect your first repo"
                primaryAction={<button>Connect</button>}
                supplemental={<span>more help</span>}
            />,
        );
        expect(screen.getByText('No projects')).toBeInTheDocument();
        expect(screen.getByText('Connect your first repo')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
        expect(screen.getByText('more help')).toBeInTheDocument();
    });

    it('renders without optional fields', () => {
        renderWithProviders(<HeroEmptyState icon={<span />} title="Only title" />);
        expect(screen.getByText('Only title')).toBeInTheDocument();
    });
});
