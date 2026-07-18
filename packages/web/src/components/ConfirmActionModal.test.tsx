import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { ConfirmActionModal } from './ConfirmActionModal.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';

describe('ConfirmActionModal', () => {
    it('renders title and body', () => {
        renderWithProviders(
            <ConfirmActionModal
                open
                title="Detach agent?"
                body="This cannot be undone."
                confirmLabel="Detach"
                onConfirm={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.getByText('Detach agent?')).toBeInTheDocument();
        expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    });

    it('fires onConfirm and onCancel from the right buttons', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        renderWithProviders(
            <ConfirmActionModal
                open
                title="Title"
                body="Body"
                confirmLabel="Confirm"
                onConfirm={onConfirm}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('renders destructive tone', () => {
        renderWithProviders(
            <ConfirmActionModal
                open
                title="Delete"
                body="Body"
                confirmLabel="Delete"
                tone="destructive"
                onConfirm={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('renders warning tone', () => {
        renderWithProviders(
            <ConfirmActionModal
                open
                title="Dismiss"
                body="Body"
                confirmLabel="Dismiss"
                tone="warning"
                onConfirm={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('shows "Working…" and disables buttons when busy', () => {
        renderWithProviders(
            <ConfirmActionModal
                open
                title="Title"
                body="Body"
                confirmLabel="Confirm"
                busy
                onConfirm={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.getByRole('button', { name: /working/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('does not render when open=false', () => {
        renderWithProviders(
            <ConfirmActionModal
                open={false}
                title="Hidden"
                body="Body"
                confirmLabel="OK"
                onConfirm={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    });
});
