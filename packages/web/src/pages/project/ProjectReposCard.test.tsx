import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { IProjectRepo } from '@atlas/shared';
import { makeProjectRepo } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Toast } from '../../components/Toast.js';
import { ProjectReposCard } from './ProjectReposCard.js';

const BASE = 'http://localhost:3000/api';

const PRIMARY = makeProjectRepo({
    name: 'api',
    git_url: 'https://github.com/acme/api.git',
    git_path: '/ws/api',
    credential_id: 'cred-1',
});
const WEB = makeProjectRepo({
    id: 'r-web',
    name: 'web',
    primary: false,
    git_url: 'https://github.com/acme/web.git',
    git_path: '/ws/web',
    default_branch: 'develop',
});
const CREDENTIAL = {
    id: 'cred-1',
    label: 'My PAT',
    kind: 'pat',
    scope: 'repo',
    username: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
};

/** Serves the list from a mutable array so a POST / DELETE shows on refetch. */
function mockRepos(initial: IProjectRepo[]) {
    const rows = [...initial];
    server.use(
        http.get(`${BASE}/projects/p1/repos`, () => HttpResponse.json(rows)),
        http.get(`${BASE}/credentials`, () => HttpResponse.json([CREDENTIAL])),
        http.get(`${BASE}/fs/stat`, () => HttpResponse.json({ exists: true, is_directory: true })),
        http.get(`${BASE}/projects/folder-origin`, () => HttpResponse.json({ origin: null }))
    );
    return rows;
}

function renderCard() {
    return renderWithProviders(
        <>
            <ProjectReposCard projectId="p1" />
            <Toast />
        </>
    );
}

async function fillConnectForm() {
    fireEvent.click(await screen.findByRole('button', { name: /add repo/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /use existing folder/i }));
    fireEvent.change(within(dialog).getByLabelText('Existing folder'), {
        target: { value: '/ws/web' },
    });
    fireEvent.change(within(dialog).getByLabelText(/repository url/i), {
        target: { value: 'https://github.com/acme/web.git' },
    });
    // The name follows the URL until typed over.
    await waitFor(() => expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('web'));
    return dialog;
}

describe('ProjectReposCard', () => {
    it('lists the repos; only extra repos can be edited or removed', async () => {
        mockRepos([PRIMARY, WEB]);
        renderCard();

        const primaryRow = await screen.findByTestId('repo-row-api');
        expect(within(primaryRow).getByText('Primary')).toBeInTheDocument();
        expect(within(primaryRow).getByText('github.com/acme/api')).toHaveAttribute(
            'href',
            'https://github.com/acme/api.git'
        );
        expect(within(primaryRow).queryByRole('button', { name: /remove/i })).toBeNull();
        expect(within(primaryRow).queryByRole('button', { name: /edit/i })).toBeNull();

        const webRow = screen.getByTestId('repo-row-web');
        expect(within(webRow).queryByText('Primary')).toBeNull();
        expect(within(webRow).getByText('develop')).toBeInTheDocument();
        expect(within(webRow).getByRole('button', { name: 'Remove web' })).toBeInTheDocument();
        expect(within(webRow).getByRole('button', { name: 'Edit web' })).toBeInTheDocument();
    });

    it('connects a local clone and shows it in the list', async () => {
        const rows = mockRepos([PRIMARY]);
        let body: unknown;
        server.use(
            http.post(`${BASE}/projects/p1/repos`, async ({ request }) => {
                body = await request.json();
                rows.push(WEB);
                return HttpResponse.json(WEB, { status: 201 });
            })
        );
        renderCard();

        const dialog = await fillConnectForm();
        const submit = within(dialog).getByRole('button', { name: /verify & add/i });
        await waitFor(() => expect(submit).toBeEnabled());
        fireEvent.click(submit);

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(body).toEqual({
            mode: 'connect',
            name: 'web',
            folder_path: '/ws/web',
            repo_url: 'https://github.com/acme/web.git',
            credential_id: 'cred-1',
        });
        expect(await screen.findByTestId('repo-row-web')).toBeInTheDocument();
        expect(screen.getByText('Repo added — web')).toBeInTheDocument();
    });

    it('renders a failed connect check like the New project dialog', async () => {
        mockRepos([PRIMARY]);
        server.use(
            http.post(`${BASE}/projects/p1/repos`, () =>
                HttpResponse.json(
                    {
                        ok: false,
                        checks: {
                            folder_exists: true,
                            has_git: true,
                            origin_matches: false,
                            ls_remote_ok: false,
                        },
                        error_kind: 'origin_mismatch',
                        folder_origin: 'https://github.com/acme/other.git',
                        head_branch: 'main',
                        head_sha: 'abc1234',
                    },
                    { status: 400 }
                )
            )
        );
        renderCard();

        const dialog = await fillConnectForm();
        const submit = within(dialog).getByRole('button', { name: /verify & add/i });
        await waitFor(() => expect(submit).toBeEnabled());
        fireEvent.click(submit);

        expect(await within(dialog).findByText('Remote URL mismatch')).toBeInTheDocument();
        expect(within(dialog).getAllByText(/acme\/other\.git/).length).toBeGreaterThan(0);
        // Back to the form to fix the details.
        fireEvent.click(within(dialog).getByRole('button', { name: /edit details/i }));
        expect(within(dialog).getByLabelText(/repository url/i)).toBeInTheDocument();
    });

    it('clones a repo and closes when the clone registers it', async () => {
        const rows = mockRepos([PRIMARY]);
        let body: unknown;
        server.use(
            http.post(`${BASE}/projects/p1/repos`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(
                    { clone_id: 'c9', destination: '/ws/acme-web' },
                    { status: 202 }
                );
            })
        );
        renderCard();

        fireEvent.click(await screen.findByRole('button', { name: /add repo/i }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/repository url/i), {
            target: { value: 'https://github.com/acme/web.git' },
        });
        const submit = within(dialog).getByRole('button', { name: /clone repo/i });
        await waitFor(() => expect(submit).toBeEnabled());
        fireEvent.click(submit);

        expect(await within(dialog).findByText('Cloning…')).toBeInTheDocument();
        expect(body).toEqual({
            mode: 'clone',
            name: 'web',
            repo_url: 'https://github.com/acme/web.git',
            credential_id: 'cred-1',
            default_branch: 'main',
        });

        rows.push(WEB);
        const pushSse = (window as Window & { __pushSse?: (e: object) => void }).__pushSse;
        act(() =>
            pushSse?.({ type: 'clone_completed', cloneId: 'c9', status: 'ready', repo: WEB })
        );

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(await screen.findByTestId('repo-row-web')).toBeInTheDocument();
    });

    it('removes an extra repo after confirming', async () => {
        const rows = mockRepos([PRIMARY, WEB]);
        let deleted = false;
        server.use(
            http.delete(`${BASE}/projects/p1/repos/r-web`, () => {
                deleted = true;
                rows.pop();
                return new HttpResponse(null, { status: 204 });
            })
        );
        renderCard();

        fireEvent.click(await screen.findByRole('button', { name: 'Remove web' }));
        const confirm = await screen.findByRole('dialog');
        expect(within(confirm).getByText('Remove web?')).toBeInTheDocument();
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(deleted).toBe(true));
        await waitFor(() => expect(screen.queryByTestId('repo-row-web')).toBeNull());
    });

    it('saves an extra repo’s default branch and setup scripts', async () => {
        mockRepos([PRIMARY, WEB]);
        let body: unknown;
        server.use(
            http.patch(`${BASE}/projects/p1/repos/r-web`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ ...WEB, default_branch: 'main' });
            })
        );
        renderCard();

        fireEvent.click(await screen.findByRole('button', { name: 'Edit web' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/default branch/i), {
            target: { value: 'main' },
        });
        fireEvent.change(within(dialog).getByLabelText('.sh'), {
            target: { value: 'npm ci' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(body).toEqual({
                default_branch: 'main',
                setup_sh_body: 'npm ci',
                setup_ps1_body: '',
            })
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});
