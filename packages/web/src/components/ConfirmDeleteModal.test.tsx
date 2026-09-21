import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { ConfirmDeleteModal, IssueDeleteAction } from './ConfirmDeleteModal.js';

describe('ConfirmDeleteModal', () => {
    it('renders entity-specific copy', () => {
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="task"
                entityTitle="Task A"
                onConfirm={() => Promise.resolve()}
                onClose={() => undefined}
            />
        );
        expect(screen.getByText(/Delete this task\?/i)).toBeInTheDocument();
        expect(screen.getByText('Task A')).toBeInTheDocument();
    });

    it('fires onConfirm then onClose on the destructive button', async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        const onClose = vi.fn();
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="sub_task"
                entityTitle="Sub-task A"
                onConfirm={onConfirm}
                onClose={onClose}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /Delete sub-task/i }));
        await waitFor(() => expect(onConfirm).toHaveBeenCalled());
        expect(onClose).toHaveBeenCalled();
    });

    it('surfaces an error alert when onConfirm rejects', async () => {
        const onConfirm = vi.fn().mockRejectedValue(new Error('nope'));
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="task"
                entityTitle="E1"
                onConfirm={onConfirm}
                onClose={() => undefined}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /Delete task/i }));
        expect(await screen.findByText('nope')).toBeInTheDocument();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="sub_task"
                entityTitle="T"
                onConfirm={() => Promise.resolve()}
                onClose={onClose}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('X (close) button calls onClose directly', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="task"
                entityTitle="S1"
                onConfirm={() => Promise.resolve()}
                onClose={onClose}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /Close/i }));
        expect(onClose).toHaveBeenCalled();
    });

    it('surfaces a non-Error rejection (String(err) branch)', async () => {
        const onConfirm = vi.fn().mockRejectedValue('plain string error');
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="sub_task"
                entityTitle="B1"
                onConfirm={onConfirm}
                onClose={() => undefined}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /Delete sub-task/i }));
        expect(await screen.findByText('plain string error')).toBeInTheDocument();
    });

    it('renders scratch_pad entity copy (different describeImpact)', () => {
        renderWithProviders(
            <ConfirmDeleteModal
                open
                entityKind="scratch_pad"
                entityTitle="My note"
                onConfirm={() => Promise.resolve()}
                onClose={() => undefined}
            />
        );
        expect(screen.getByText(/Delete this scratch tile\?/i)).toBeInTheDocument();
    });
});

describe('IssueDeleteAction', () => {
    it('shows the modal when the kebab menu Delete is clicked', async () => {
        const onDelete = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <IssueDeleteAction entityKind="task" entityTitle="S1" onDelete={onDelete} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Task actions/i }));
        await userEvent.click(await screen.findByText(/Delete this task…/i));
        expect(await screen.findByText(/Delete this task\?/i)).toBeInTheDocument();
    });

    it('renders Clone menu item when onClone is provided (onClone branch)', async () => {
        const onClone = vi.fn();
        const onDelete = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <IssueDeleteAction
                entityKind="task"
                entityTitle="E1"
                onDelete={onDelete}
                onClone={onClone}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /Task actions/i }));
        const cloneItem = await screen.findByText(/Clone item…/i);
        expect(cloneItem).toBeInTheDocument();
        await userEvent.click(cloneItem);
        expect(onClone).toHaveBeenCalled();
    });

    it('uses redirectTo for navigation after delete (redirectTo branch)', async () => {
        const onDelete = vi.fn().mockResolvedValue(undefined);
        renderWithProviders(
            <IssueDeleteAction
                entityKind="sub_task"
                entityTitle="S2"
                onDelete={onDelete}
                redirectTo="/tasks/ATL-1"
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /Sub-task actions/i }));
        await userEvent.click(await screen.findByText(/Delete this sub-task…/i));
        await userEvent.click(await screen.findByRole('button', { name: /Delete sub-task/i }));
        await waitFor(() => expect(onDelete).toHaveBeenCalled());
    });
});
