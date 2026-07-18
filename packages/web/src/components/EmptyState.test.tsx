import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
    it('renders title, description, and actions', () => {
        renderWithProviders(
            <EmptyState
                icon={<span data-testid="icon" />}
                title="Nothing yet"
                description="Add your first item"
                actions={<button>Add</button>}
                supplemental={<span>extra</span>}
            />,
        );
        expect(screen.getByText('Nothing yet')).toBeInTheDocument();
        expect(screen.getByText('Add your first item')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
        expect(screen.getByText('extra')).toBeInTheDocument();
        expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('renders the dashed variant', () => {
        renderWithProviders(
            <EmptyState
                icon={<span data-testid="icon" />}
                title="Empty"
                variant="dashed"
            />,
        );
        expect(screen.getByText('Empty')).toBeInTheDocument();
    });
});
