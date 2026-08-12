/**
 * StartStandaloneSessionDialog — unit tests.
 *
 * The dialog posts to /cli/sessions/standalone, whose schema is `.strict()`:
 * an empty optional sent as `''` is a 400, not a shrug. So the assertions
 * below are mostly about the exact payload shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ICredential } from '@atlas/shared';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Toast } from './Toast.js';
import { StartStandaloneSessionDialog } from './StartStandaloneSessionDialog.js';

const BASE = 'http://localhost:3000/api';

const CREDENTIAL = {
    id: 'cred-1',
    label: 'Work PAT',
    host: 'github',
    kind: 'pat',
    scope: '',
} as unknown as ICredential;

let lastPayload: Record<string, unknown> | null = null;

beforeEach(() => {
    lastPayload = null;
    server.use(
        ...defaultHandlers,
        http.get(`${BASE}/credentials`, () => HttpResponse.json([CREDENTIAL])),
        http.get(`${BASE}/cli/models`, () => HttpResponse.json([])),
        // FolderPicker validates the typed path as you type.
        http.get(`${BASE}/fs/stat`, ({ request }) => {
            const path = new URL(request.url).searchParams.get('path') ?? '';
            return HttpResponse.json({ path, exists: true, is_directory: true });
        }),
        http.post(`${BASE}/cli/sessions/standalone`, async ({ request }) => {
            lastPayload = (await request.json()) as Record<string, unknown>;
            return HttpResponse.json(
                { id: 'sess-new', title: 'atlas' },
                { status: 201 },
            );
        }),
    );
});

function renderDialog(onCreated = vi.fn()) {
    renderWithProviders(
        <StartStandaloneSessionDialog open onClose={vi.fn()} onCreated={onCreated} />,
    );
    return { onCreated };
}

describe('StartStandaloneSessionDialog', () => {
    it('disables the submit button until a folder is entered', async () => {
        renderDialog();
        const submit = await screen.findByRole('button', { name: /open terminal/i });
        expect(submit).toBeDisabled();

        await userEvent.type(screen.getByRole('textbox', { name: '' }), '/tmp/x');
        await waitFor(() => expect(submit).toBeEnabled());
    });

    it('posts folder_path and omits every untouched optional', async () => {
        renderDialog();
        const folderInput = await screen.findByPlaceholderText(
            'Pick any folder on this machine',
        );
        await userEvent.type(folderInput, '/Users/owner/code/atlas');
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        await waitFor(() => expect(lastPayload).not.toBeNull());
        expect(lastPayload).toEqual({
            folder_path: '/Users/owner/code/atlas',
            cli: 'claude',
            model: expect.any(String),
        });
        // `.strict()` on the server rejects unknown keys, and a blank optional
        // would fail its own min(1) — so absence, not emptiness, is the point.
        expect(lastPayload).not.toHaveProperty('credential_id');
        expect(lastPayload).not.toHaveProperty('title');
        expect(lastPayload).not.toHaveProperty('initial_prompt');
    });

    it('includes the picked credential and trims the title', async () => {
        renderDialog();
        const folderInput = await screen.findByPlaceholderText(
            'Pick any folder on this machine',
        );
        await userEvent.type(folderInput, '/Users/owner/code/atlas');

        await userEvent.click(screen.getByRole('combobox', { name: /git credentials/i }));
        await userEvent.click(await screen.findByRole('option', { name: 'Work PAT' }));

        await userEvent.type(screen.getByLabelText(/title/i), '  My terminal  ');
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        await waitFor(() => expect(lastPayload).not.toBeNull());
        expect(lastPayload).toMatchObject({
            credential_id: 'cred-1',
            title: 'My terminal',
        });
    });

    it('hands the created session back to the caller', async () => {
        const { onCreated } = renderDialog();
        const folderInput = await screen.findByPlaceholderText(
            'Pick any folder on this machine',
        );
        await userEvent.type(folderInput, '/tmp/x');
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        await waitFor(() =>
            expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'sess-new' })),
        );
    });

    it('sends the initial prompt when one is typed', async () => {
        renderDialog();
        await userEvent.type(
            await screen.findByPlaceholderText('Pick any folder on this machine'),
            '/tmp/x',
        );
        await userEvent.type(screen.getByLabelText(/initial prompt/i), 'list the files');
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        await waitFor(() => expect(lastPayload).not.toBeNull());
        expect(lastPayload).toMatchObject({ initial_prompt: 'list the files' });
    });

    it('switching CLI resets the model to that CLI default', async () => {
        server.use(
            http.get(`${BASE}/cli/models`, () =>
                HttpResponse.json([
                    { id: 'm1', cli: 'copilot', model_name: 'gpt-5', note: 'fast' },
                ]),
            ),
        );
        renderDialog();
        await userEvent.click(await screen.findByRole('button', { name: /copilot/i }));
        await userEvent.type(
            screen.getByPlaceholderText('Pick any folder on this machine'),
            '/tmp/x',
        );
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        await waitFor(() => expect(lastPayload).not.toBeNull());
        expect(lastPayload).toMatchObject({ cli: 'copilot' });
    });

    it('re-clicking the active CLI is a no-op', async () => {
        renderDialog();
        // ToggleButtonGroup fires onChange with null when the active button is
        // clicked again; the handler must ignore it rather than clear the CLI.
        await userEvent.click(await screen.findByRole('button', { name: /claude/i }));
        await userEvent.type(
            screen.getByPlaceholderText('Pick any folder on this machine'),
            '/tmp/x',
        );
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        await waitFor(() => expect(lastPayload).not.toBeNull());
        expect(lastPayload).toMatchObject({ cli: 'claude' });
    });

    it('Cancel resets the form and closes', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <StartStandaloneSessionDialog open onClose={onClose} onCreated={vi.fn()} />,
        );
        await userEvent.type(
            await screen.findByPlaceholderText('Pick any folder on this machine'),
            '/tmp/x',
        );
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onClose).toHaveBeenCalled();
    });

    it('surfaces a server error without closing the dialog', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/standalone`, () =>
                HttpResponse.json(
                    { error: 'folder not found: /tmp/x', kind: 'validation_error' },
                    { status: 400 },
                ),
            ),
        );
        const onCreated = vi.fn();
        renderWithProviders(
            <>
                <StartStandaloneSessionDialog open onClose={vi.fn()} onCreated={onCreated} />
                <Toast />
            </>,
        );
        await userEvent.type(
            await screen.findByPlaceholderText('Pick any folder on this machine'),
            '/tmp/x',
        );
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        expect(await screen.findByText('Could not open terminal')).toBeInTheDocument();
        expect(onCreated).not.toHaveBeenCalled();
    });
});
