import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { SimulatedBadge } from './SimulatedBadge.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('SimulatedBadge', () => {
    it('renders with the default (md) size', () => {
        renderWithProviders(<SimulatedBadge />);
        expect(screen.getByRole('img', { name: /simulated/i })).toBeInTheDocument();
        expect(screen.getByText(/simulated/i)).toBeInTheDocument();
    });

    it('renders with size=sm', () => {
        renderWithProviders(<SimulatedBadge size="sm" />);
        expect(screen.getByRole('img', { name: /simulated/i })).toBeInTheDocument();
    });

    it('renders with size=md', () => {
        renderWithProviders(<SimulatedBadge size="md" />);
        expect(screen.getByRole('img', { name: /simulated/i })).toBeInTheDocument();
    });
});
