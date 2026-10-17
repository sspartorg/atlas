import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProjectRepo } from '../../test-utils/factories.js';
import { Toast } from '../../components/Toast.js';
import { AddRepoDialog } from './AddRepoDialog.js';

const BASE = 'http://localhost:3000/api';
const CREDENTIAL = {
    id: 'cred-1',
    label: 'My PAT',
    kind: 'pat',
    scope: 'repo',
    username: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};
const pushSse = (e: object) =>
    act(() => (window as Window & { __pushSse?: (e: object) => void }).__pushSse?.(e));

beforeEach(() => {
    server.use(
        http.get(`${BASE}/credentials`, () => HttpResponse.json([CREDENTIAL])),
        http.get(`${BASE}/fs/stat`, () => HttpResponse.json({ exists: true, is_directory: true })),
        http.get(`${BASE}/projects/folder-origin`, () => HttpResponse.json({ origin: null }))
    );
});

function renderDialog(onClose = vi.fn()) {
    renderWithProviders(
        <>
            <AddRepoDialog projectId="p1" onClose={onClose} />
            <Toast />
        </>
    );
    return onClose;
}

const url = () => screen.getByLabelText(/repository url/i);
const name = () => screen.getByLabelText(/^name/i);
const cloneButton = () => screen.getByRole('button', { name: 'Clone repo' });

describe('AddRepoDialog', () => {
    it('clone mode: the name follows the URL and the branch defaults to main', async () => {
        renderDialog();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/Orion_Web.git' } });

        expect(name()).toHaveValue('orion-web');
        expect(screen.getByLabelText('Default branch')).toHaveValue('main');
        await waitFor(() => expect(cloneButton()).toBeEnabled());
    });

    it('keeps submit disabled for a non-github or http URL', async () => {
        renderDialog();
        await screen.findByText(/My PAT/);
        for (const bad of ['http://github.com/acme/web.git', 'https://gitlab.com/acme/web.git']) {
            fireEvent.change(url(), { target: { value: bad } });
            fireEvent.change(name(), { target: { value: 'web' } });
            expect(cloneButton()).toBeDisabled();
        }
    });

    it('flags an invalid name and keeps submit disabled', async () => {
        renderDialog();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/web.git' } });
        fireEvent.change(name(), { target: { value: 'Web App' } });

        expect(screen.getByText('Lowercase letters, digits and dashes (max 40).')).toBeInTheDocument();
        expect(cloneButton()).toBeDisabled();
    });

    it('keeps submit disabled with an empty default branch', async () => {
        renderDialog();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/web.git' } });
        await waitFor(() => expect(cloneButton()).toBeEnabled());
        fireEvent.change(screen.getByLabelText('Default branch'), { target: { value: ' ' } });
        expect(cloneButton()).toBeDisabled();
    });

    it('clones, then closes with a toast when the clone registers the repo', async () => {
        let body: unknown;
        server.use(
            http.post(`${BASE}/projects/p1/repos`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ clone_id: 'c1', destination: '/ws/web' }, { status: 202 });
            })
        );
        const onClose = renderDialog();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/web.git' } });
        fireEvent.change(screen.getByLabelText('Default branch'), { target: { value: 'develop' } });
        await waitFor(() => expect(cloneButton()).toBeEnabled());
        fireEvent.click(cloneButton());

        expect(await screen.findByText('Cloning…')).toBeInTheDocument();
        expect(body).toEqual({
            mode: 'clone',
            name: 'web',
            repo_url: 'https://github.com/acme/web.git',
            credential_id: 'cred-1',
            default_branch: 'develop',
        });
        // Busy: no way out until the clone ends.
        expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

        pushSse({
            type: 'clone_completed',
            cloneId: 'c1',
            status: 'ready',
            repo: makeProjectRepo({ name: 'web' }),
        });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(screen.getByText('Repo added — web')).toBeInTheDocument();
    });

    it('shows the API error when the clone cannot start, and stays open', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos`, () =>
                HttpResponse.json({ error: 'A repo named "web" already exists' }, { status: 409 })
            )
        );
        const onClose = renderDialog();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/web.git' } });
        await waitFor(() => expect(cloneButton()).toBeEnabled());
        fireEvent.click(cloneButton());

        expect(await screen.findByText('A repo named "web" already exists')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        expect(cloneButton()).toBeEnabled();
    });

    it('shows a failed clone and goes back to the form on "Edit details"', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos`, () =>
                HttpResponse.json({ clone_id: 'c2', destination: '/ws/web' }, { status: 202 })
            )
        );
        renderDialog();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/web.git' } });
        await waitFor(() => expect(cloneButton()).toBeEnabled());
        fireEvent.click(cloneButton());
        await screen.findByText('Cloning…');

        pushSse({ type: 'clone_error', cloneId: 'c2', status: 'error', errorDetail: 'auth failed' });
        expect(await screen.findByText('auth failed')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /edit details/i }));
        expect(url()).toHaveValue('https://github.com/acme/web.git');
    });

    it('connect mode: needs a folder, then verifies and adds the existing clone', async () => {
        let body: unknown;
        server.use(
            http.post(`${BASE}/projects/p1/repos`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(makeProjectRepo({ name: 'web' }), { status: 201 });
            })
        );
        const onClose = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: /use existing folder/i }));
        expect(screen.queryByLabelText('Default branch')).toBeNull();
        fireEvent.change(url(), { target: { value: 'https://github.com/acme/web.git' } });
        const verify = screen.getByRole('button', { name: 'Verify & add' });
        await screen.findByText(/My PAT/);
        expect(verify).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Existing folder'), { target: { value: '/ws/web' } });
        await waitFor(() => expect(verify).toBeEnabled());
        fireEvent.click(verify);

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body).toEqual({
            mode: 'connect',
            name: 'web',
            folder_path: '/ws/web',
            repo_url: 'https://github.com/acme/web.git',
            credential_id: 'cred-1',
        });
        expect(screen.getByText('Repo added — web')).toBeInTheDocument();
    });
});
