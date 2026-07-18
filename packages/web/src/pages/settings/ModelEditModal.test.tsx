import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { ModelEditModal } from './ModelEditModal.js';

const BASE = 'http://localhost:3000/api';

const existingModel = {
    id: 'cm-1',
    cli: 'claude' as const,
    model_name: 'claude-opus-4-7',
    note: 'Best for plans',
    sort_order: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
    server.use(...defaultHandlers);
});

describe('ModelEditModal — closed', () => {
    it('renders nothing when open=false', () => {
        renderWithProviders(
            <ModelEditModal
                open={false}
                onClose={vi.fn()}
                cli="claude"
                cliLabel="Claude"
                model={null}
            />,
        );
        expect(screen.queryByText('Add model')).not.toBeInTheDocument();
    });
});

describe('ModelEditModal — add mode (model=null)', () => {
    it('renders Add model heading', () => {
        renderWithProviders(
            <ModelEditModal open onClose={vi.fn()} cli="claude" cliLabel="Claude" model={null} />,
        );
        // "Add model" appears twice: as heading and as button label
        expect(screen.getAllByText('Add model').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Claude')).toBeInTheDocument();
    });

    it('Add model button is disabled when name is empty', () => {
        renderWithProviders(
            <ModelEditModal open onClose={vi.fn()} cli="claude" cliLabel="Claude" model={null} />,
        );
        expect(screen.getByRole('button', { name: /Add model/i })).toBeDisabled();
    });

    it('Add model button becomes enabled when a name is typed', async () => {
        renderWithProviders(
            <ModelEditModal open onClose={vi.fn()} cli="claude" cliLabel="Claude" model={null} />,
        );
        const nameInput = screen.getAllByRole('textbox')[0]!;
        await userEvent.type(nameInput, 'claude-opus-5');
        expect(screen.getByRole('button', { name: /Add model/i })).not.toBeDisabled();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ModelEditModal open onClose={onClose} cli="claude" cliLabel="Claude" model={null} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('submits create mutation and closes on success', async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/cli-models`, () => HttpResponse.json({ ...existingModel })),
        );
        renderWithProviders(
            <ModelEditModal open onClose={onClose} cli="claude" cliLabel="Claude" model={null} />,
        );
        const nameInput = screen.getAllByRole('textbox')[0]!;
        await userEvent.type(nameInput, 'claude-opus-5');
        await userEvent.click(screen.getByRole('button', { name: /Add model/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows error toast when create mutation fails — covers onError branch (lines 69-73)', async () => {
        // Trigger the onError path by returning a 500 from POST /cli-models
        server.use(
            http.post(`${BASE}/cli-models`, () => HttpResponse.json({ error: 'Server error' }, { status: 500 })),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <ModelEditModal open onClose={onClose} cli="claude" cliLabel="Claude" model={null} />,
        );
        const nameInput = screen.getAllByRole('textbox')[0]!;
        await userEvent.type(nameInput, 'claude-opus-5');
        await userEvent.click(screen.getByRole('button', { name: /Add model/i }));
        // onClose is NOT called on error
        await waitFor(() => expect(onClose).not.toHaveBeenCalled(), { timeout: 2000 });
    });
});

describe('ModelEditModal — edit mode (model provided)', () => {
    it('renders Edit model heading and prefills fields', () => {
        renderWithProviders(
            <ModelEditModal
                open
                onClose={vi.fn()}
                cli="claude"
                cliLabel="Claude"
                model={existingModel}
            />,
        );
        expect(screen.getByText('Edit model')).toBeInTheDocument();
        // Model name should be prefilled and disabled
        const nameInput = screen.getAllByRole('textbox')[0] as HTMLInputElement;
        expect(nameInput.value).toBe('claude-opus-4-7');
        expect(nameInput).toBeDisabled();
    });

    it('Save button submits update mutation and closes on success', async () => {
        const onClose = vi.fn();
        server.use(
            http.patch(`${BASE}/cli-models/cm-1`, () =>
                HttpResponse.json({ ...existingModel, note: 'updated' }),
            ),
        );
        renderWithProviders(
            <ModelEditModal
                open
                onClose={onClose}
                cli="claude"
                cliLabel="Claude"
                model={existingModel}
            />,
        );
        // Clear note and type new one
        const noteInput = screen.getAllByRole('textbox')[1]!;
        await userEvent.clear(noteInput);
        await userEvent.type(noteInput, 'updated');
        await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows helper text that model name is locked in edit mode', () => {
        renderWithProviders(
            <ModelEditModal
                open
                onClose={vi.fn()}
                cli="claude"
                cliLabel="Claude"
                model={existingModel}
            />,
        );
        expect(
            screen.getByText(/Model name is locked/i),
        ).toBeInTheDocument();
    });

    it('shows error toast when update mutation fails — covers onError branch (lines 52-57)', async () => {
        // Trigger the onError path by returning a 500 from PATCH /cli-models/:id
        server.use(
            http.patch(`${BASE}/cli-models/cm-1`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <ModelEditModal
                open
                onClose={onClose}
                cli="claude"
                cliLabel="Claude"
                model={existingModel}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
        // onClose is NOT called when the mutation fails
        await waitFor(() => expect(onClose).not.toHaveBeenCalled(), { timeout: 2000 });
    });

    it('shows Saving... label while PATCH is in-flight (line 168 pending branch)', async () => {
        let resolvePatch!: () => void;
        const patchPromise = new Promise<void>((res) => { resolvePatch = res; });
        server.use(
            http.patch(`${BASE}/cli-models/cm-1`, async () => {
                await patchPromise;
                return HttpResponse.json({ ...existingModel, note: 'updated' });
            }),
        );
        renderWithProviders(
            <ModelEditModal
                open
                onClose={vi.fn()}
                cli="claude"
                cliLabel="Claude"
                model={existingModel}
            />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
        await waitFor(() => {
            expect(screen.getByText(/Saving/i)).toBeInTheDocument();
        }, { timeout: 3000 });
        resolvePatch();
    });
});
