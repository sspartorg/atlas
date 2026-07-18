import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { CredentialRowMenu } from './CredentialRowMenu.js';

describe('CredentialRowMenu', () => {
    it('exposes edit + delete actions', async () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        renderWithProviders(<CredentialRowMenu onEdit={onEdit} onDelete={onDelete} />);
        await userEvent.click(screen.getByRole('button', { name: /Credential actions/i }));
        await userEvent.click(await screen.findByText(/Delete credential/));
        expect(onDelete).toHaveBeenCalled();
    });
});
