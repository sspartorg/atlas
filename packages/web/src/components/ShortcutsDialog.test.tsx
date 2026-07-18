import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ShortcutsDialog } from './ShortcutsDialog.js';

describe('ShortcutsDialog', () => {
    it('renders the shortcut sections', () => {
        renderWithProviders(<ShortcutsDialog open onClose={vi.fn()} />);
        expect(screen.getByText(/Go to/i)).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        renderWithProviders(<ShortcutsDialog open={false} onClose={vi.fn()} />);
        expect(screen.queryByText(/Go to/i)).not.toBeInTheDocument();
    });
});
