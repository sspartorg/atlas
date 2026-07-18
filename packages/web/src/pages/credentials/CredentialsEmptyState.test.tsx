import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { CredentialsEmptyState } from './CredentialsEmptyState.js';

describe('CredentialsEmptyState', () => {
    it('renders and fires the Add CTA', async () => {
        const onAdd = vi.fn();
        renderWithProviders(<CredentialsEmptyState onAdd={onAdd} />);
        expect(screen.getByText(/No credentials yet/)).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: /Add credential/ });
        await userEvent.click(buttons[0]!);
        expect(onAdd).toHaveBeenCalled();
    });
});
