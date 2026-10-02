import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { NotFound } from './NotFound.js';

describe('NotFound', () => {
    it('names the missing path and links back to the Dashboard', () => {
        renderWithProviders(<NotFound />, { initialEntries: ['/no-such-page'] });
        expect(screen.getByText('Page not found')).toBeInTheDocument();
        expect(screen.getByText(/\/no-such-page/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go to Dashboard' })).toHaveAttribute('href', '/');
    });
});
