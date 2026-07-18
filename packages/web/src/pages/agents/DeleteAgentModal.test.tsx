import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { DeleteAgentModal } from './DeleteAgentModal.js';

describe('DeleteAgentModal', () => {
    it('renders nothing when agent is null', () => {
        const { container } = renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={null}
                onConfirm={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        // No dialog rendered — container has only the react root div
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('renders dialog with agent name when open and agent provided', () => {
        const agent = makeAgent({ name: 'Coder' });
        renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={agent}
                onConfirm={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText(/delete coder\?/i)).toBeTruthy();
    });

    it('renders Cancel and Delete agent buttons', () => {
        const agent = makeAgent();
        renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={agent}
                onConfirm={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /delete agent/i })).toBeTruthy();
    });

    it('calls onClose when Cancel is clicked', async () => {
        const onClose = vi.fn();
        const agent = makeAgent();
        renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={agent}
                onConfirm={vi.fn()}
                onClose={onClose}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm when Delete agent is clicked', async () => {
        const onConfirm = vi.fn();
        const agent = makeAgent();
        renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={agent}
                onConfirm={onConfirm}
                onClose={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /delete agent/i }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('disables buttons and shows "Deleting…" when busy', () => {
        const agent = makeAgent();
        renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={agent}
                busy={true}
                onConfirm={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText('Deleting…')).toBeTruthy();
        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        const deleteBtn = screen.getByRole('button', { name: /deleting/i });
        expect(cancelBtn).toBeDisabled();
        expect(deleteBtn).toBeDisabled();
    });

    it('shows warning about queued runs being dropped', () => {
        const agent = makeAgent({ name: 'Coder' });
        renderWithProviders(
            <DeleteAgentModal
                open={true}
                agent={agent}
                onConfirm={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByText(/queued runs/i)).toBeTruthy();
    });
});
