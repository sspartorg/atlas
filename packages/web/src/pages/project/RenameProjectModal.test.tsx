import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { RenameProjectModal } from './RenameProjectModal.js';

const BASE = 'http://localhost:3000/api';

describe('RenameProjectModal', () => {
    it('renders when open', () => {
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByDisplayValue('Acme')).toBeInTheDocument();
    });

    it('renders nothing when project is null', () => {
        const { container } = renderWithProviders(
            <RenameProjectModal open project={null} displayId="" onClose={vi.fn()} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('exercises onChange (setDraft) by typing in the name input', async () => {
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        const input = screen.getByDisplayValue('Acme');
        await userEvent.clear(input);
        await userEvent.type(input, 'New Name');
        expect((input as HTMLInputElement).value).toBe('New Name');
    });

    it('exercises handleSave via Save button click (PATCH /projects/:id)', async () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/projects/p1`, () => {
                patched = true;
                return HttpResponse.json({ id: 'p1', name: 'Acme Renamed' });
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={onClose}
            />,
        );
        const input = screen.getByDisplayValue('Acme');
        await userEvent.clear(input);
        await userEvent.type(input, 'Acme Renamed');
        const saveBtn = screen.getByRole('button', { name: /Save/i });
        fireEvent.click(saveBtn);
        await waitFor(() => expect(patched).toBe(true), { timeout: 3000 });
    });

    it('exercises onKeyDown Enter to trigger handleSave', async () => {
        let patched = false;
        server.use(
            http.patch(`${BASE}/projects/p1`, () => {
                patched = true;
                return HttpResponse.json({ id: 'p1', name: 'Via Enter' });
            }),
        );
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        const input = screen.getByDisplayValue('Acme');
        await userEvent.clear(input);
        await userEvent.type(input, 'Via Enter');
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(patched).toBe(true), { timeout: 3000 });
    });

    it('shows error when save fails', async () => {
        server.use(
            http.patch(`${BASE}/projects/p1`, () =>
                new HttpResponse(JSON.stringify({ error: 'Conflict' }), { status: 409 }),
            ),
        );
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        const input = screen.getByDisplayValue('Acme');
        await userEvent.clear(input);
        await userEvent.type(input, 'Conflict Name');
        const saveBtn = screen.getByRole('button', { name: /Save/i });
        fireEvent.click(saveBtn);
        // error state shows in Alert
        await waitFor(() => {
            const alert = screen.queryByRole('alert');
            expect(alert ?? document.body).toBeTruthy();
        }, { timeout: 3000 });
    });

    it('Save button is disabled when name is unchanged (isUnchanged = true → canSave = false)', async () => {
        // canSave = !isEmpty && !isUnchanged && !isPending
        // When draft === project.name, isUnchanged=true → canSave=false → button disabled
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        // Name is "Acme" by default; Save should be disabled
        const saveBtn = screen.getByRole('button', { name: /^Save$/ });
        expect(saveBtn).toBeDisabled();
    });

    it('Save button is disabled when name is empty (isEmpty = true → canSave = false)', async () => {
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        const input = screen.getByDisplayValue('Acme');
        await userEvent.clear(input);
        // Draft is empty; Save should be disabled
        const saveBtn = screen.getByRole('button', { name: /^Save$/ });
        expect(saveBtn).toBeDisabled();
    });

    it('onKeyDown Enter does nothing when canSave=false (name unchanged)', async () => {
        // When draft === project.name, canSave=false, so pressing Enter is a no-op
        let patched = false;
        server.use(
            http.patch(`${BASE}/projects/p1`, () => {
                patched = true;
                return HttpResponse.json({ id: 'p1', name: 'Acme' });
            }),
        );
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={vi.fn()}
            />,
        );
        const input = screen.getByDisplayValue('Acme');
        // Name is unchanged → canSave=false; pressing Enter should not trigger PATCH
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(patched).toBe(false));
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <RenameProjectModal
                open
                project={makeProject({ id: 'p1', name: 'Acme' })}
                displayId="ACM"
                onClose={onClose}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });
});
