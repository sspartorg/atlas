import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AgentsEmptyState } from './AgentsEmptyState.js';

describe('AgentsEmptyState', () => {
    it('renders the "No agents installed" title', () => {
        renderWithProviders(<AgentsEmptyState onBrowse={vi.fn()} />);
        expect(screen.getByText('No agents installed')).toBeTruthy();
    });

    it('renders the "Browse the Marketplace" button', () => {
        renderWithProviders(<AgentsEmptyState onBrowse={vi.fn()} />);
        expect(screen.getByRole('button', { name: /browse the marketplace/i })).toBeTruthy();
    });

    it('calls onBrowse when the button is clicked', async () => {
        const onBrowse = vi.fn();
        renderWithProviders(<AgentsEmptyState onBrowse={onBrowse} />);
        await userEvent.click(screen.getByRole('button', { name: /browse the marketplace/i }));
        expect(onBrowse).toHaveBeenCalledTimes(1);
    });
});
