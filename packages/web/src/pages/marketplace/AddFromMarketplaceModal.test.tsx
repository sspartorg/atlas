import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { AddFromMarketplaceModal } from './AddFromMarketplaceModal.js';
import type { IMarketplaceAgentSummary } from '@atlas/shared';

const agent: IMarketplaceAgentSummary = {
    id: 'agent-coder',
    name: 'Coder',
    category: 'software-dev',
    kind_slug: 'custom',
    summary: 'A coding agent',
    accent_color: '#0A0A0A',
    glyph: '',
    version: 3,
    is_installed: false,
    is_linked: false,
    installed_agent_id: null,
    installed_version: null,
    upgrade_available: false,
};

describe('AddFromMarketplaceModal', () => {
    it('renders title + version + kind in default state', () => {
        renderWithProviders(
            <AddFromMarketplaceModal
                open
                onClose={() => {}}
                agent={agent}
                installing={false}
                onConfirm={() => {}}
            />,
        );
        expect(screen.getByText('Add Coder to your agents')).toBeInTheDocument();
        expect(screen.getByText('v3')).toBeInTheDocument();
        expect(screen.getByText('custom')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /add to my agents/i }),
        ).toBeInTheDocument();
    });

    it('shows the rename input when slugTaken is set', () => {
        renderWithProviders(
            <AddFromMarketplaceModal
                open
                onClose={() => {}}
                agent={agent}
                installing={false}
                onConfirm={() => {}}
                slugTaken={{ conflictingId: 'agent-coder', suggestedId: 'agent-coder-2' }}
            />,
        );
        expect(screen.getByLabelText('New slug')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /install at new slug/i }),
        ).toBeInTheDocument();
    });

    it('fires onConfirm with the trimmed slug on Add', () => {
        const onConfirm = vi.fn();
        renderWithProviders(
            <AddFromMarketplaceModal
                open
                onClose={() => {}}
                agent={agent}
                installing={false}
                onConfirm={onConfirm}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /add to my agents/i }));
        expect(onConfirm).toHaveBeenCalledWith('agent-coder');
    });

    it('fires onClose on Cancel', () => {
        const onClose = vi.fn();
        renderWithProviders(
            <AddFromMarketplaceModal
                open
                onClose={onClose}
                agent={agent}
                installing={false}
                onConfirm={() => {}}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows "Adding…" and disables buttons while installing', () => {
        renderWithProviders(
            <AddFromMarketplaceModal
                open
                onClose={() => {}}
                agent={agent}
                installing
                onConfirm={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: /adding/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('disables submit when slug is empty/whitespace', () => {
        renderWithProviders(
            <AddFromMarketplaceModal
                open
                onClose={() => {}}
                agent={agent}
                installing={false}
                onConfirm={() => {}}
                slugTaken={{ conflictingId: 'agent-coder', suggestedId: 'agent-coder-2' }}
            />,
        );
        const input = screen.getByLabelText('New slug') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });
        expect(
            screen.getByRole('button', { name: /install at new slug/i }),
        ).toBeDisabled();
    });
});
