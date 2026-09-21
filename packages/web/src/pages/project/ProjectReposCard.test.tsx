import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { IProjectRepo } from '@atlas/shared';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Toast } from '../../components/Toast.js';
import { ProjectReposCard } from './ProjectReposCard.js';

const BASE = 'http://localhost:3000/api';

const PROJECT = makeProject({ id: 'p1', name: 'Acme' });

const API = makeProjectRepo({
    name: 'api',
    git_url: 'https://github.com/acme/api.git',
    git_path: '/ws/api',
    credential_id: 'cred-1',
});
const WEB = makeProjectRepo({
    id: 'r-web',
    name: 'web',
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

const ROW_ACTIONS = [
    'Edit',
    'Auto-fetch schedule…',
    'Re-clone from remote',
    'Open folder',
    'Remove',
];

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
            <ProjectReposCard project={PROJECT} displayId="ACM" />
            <Toast />
        </>
    );
}

/** Opens a row's kebab menu and returns the open <Menu>. */
async function openRowMenu(repoName: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${repoName}` }));
    return screen.findByRole('menu');
}

async function clickRowAction(repoName: string, action: string) {
    const menu = await openRowMenu(repoName);
    fireEvent.click(within(menu).getByRole('menuitem', { name: action }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
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
    it('lists the repos; no repo is primary and every row offers the same actions', async () => {
        mockRepos([API, WEB]);
        renderCard();

        const apiRow = await screen.findByTestId('repo-row-api');
        expect(within(apiRow).getByText('github.com/acme/api')).toHaveAttribute(
            'href',
            'https://github.com/acme/api.git'
        );
        // ADR 0018 — the "Primary" chip is gone; the repos are all equal.
        expect(screen.queryByText('Primary')).toBeNull();

        const webRow = screen.getByTestId('repo-row-web');
        expect(within(webRow).getByText('develop')).toBeInTheDocument();

        // Both rows — including the first, which used to be the locked-down
        // primary — carry the same menu.
        for (const name of ['api', 'web']) {
            const menu = await openRowMenu(name);
            for (const action of ROW_ACTIONS) {
                expect(within(menu).getByRole('menuitem', { name: action })).toBeInTheDocument();
            }
            fireEvent.keyDown(menu, { key: 'Escape' });
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
        }
    });

    it('shows an empty state when the project has no repos', async () => {
        mockRepos([]);
        renderCard();

        expect(await screen.findByText('No repos yet')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add repo/i })).toBeInTheDocument();
    });

    it('connects a local clone and shows it in the list', async () => {
        const rows = mockRepos([API]);
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
        mockRepos([API]);
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
        const rows = mockRepos([API]);
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

    it('removes a repo after confirming', async () => {
        const rows = mockRepos([API, WEB]);
        let deleted = false;
        server.use(
            http.delete(`${BASE}/projects/p1/repos/r-web`, () => {
                deleted = true;
                rows.pop();
                return new HttpResponse(null, { status: 204 });
            })
        );
        renderCard();

        await clickRowAction('web', 'Remove');
        const confirm = await screen.findByRole('dialog');
        expect(within(confirm).getByText('Remove web?')).toBeInTheDocument();
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(deleted).toBe(true));
        await waitFor(() => expect(screen.queryByTestId('repo-row-web')).toBeNull());
    });

    it('removes the LAST repo too — the folder stays on disk', async () => {
        const rows = mockRepos([API]);
        let deleted = false;
        server.use(
            http.delete(`${BASE}/projects/p1/repos/${API.id}`, () => {
                deleted = true;
                rows.pop();
                return new HttpResponse(null, { status: 204 });
            })
        );
        renderCard();

        await clickRowAction('api', 'Remove');
        const confirm = await screen.findByRole('dialog');
        expect(within(confirm).getByText('Remove api?')).toBeInTheDocument();
        expect(within(confirm).getByText(/folder stays on disk/i)).toBeInTheDocument();
        fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));

        await waitFor(() => expect(deleted).toBe(true));
        await waitFor(() => expect(screen.queryByTestId('repo-row-api')).toBeNull());
        expect(await screen.findByText('No repos yet')).toBeInTheDocument();
    });

    it('saves a repo’s default branch; setup scripts moved to the Setup tab', async () => {
        mockRepos([API, WEB]);
        let body: unknown;
        server.use(
            http.patch(`${BASE}/projects/p1/repos/r-web`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ ...WEB, default_branch: 'main' });
            })
        );
        renderCard();

        await clickRowAction('web', 'Edit');
        const dialog = await screen.findByRole('dialog');
        // The script editors live on the Setup tab now — exactly one place.
        expect(within(dialog).queryByLabelText('.sh')).toBeNull();
        expect(within(dialog).queryByLabelText('.ps1')).toBeNull();
        fireEvent.change(within(dialog).getByLabelText(/default branch/i), {
            target: { value: 'main' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(body).toEqual({ default_branch: 'main' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('opens the repo folder through the repo-scoped reveal endpoint', async () => {
        mockRepos([API, WEB]);
        let revealed: string | null = null;
        server.use(
            http.post(`${BASE}/projects/p1/repos/r-web/reveal`, () => {
                revealed = '/ws/web';
                return HttpResponse.json({ ok: true, path: '/ws/web' });
            })
        );
        renderCard();

        await clickRowAction('web', 'Open folder');
        await waitFor(() => expect(revealed).toBe('/ws/web'));
        expect(await screen.findByText('Opened in File Explorer')).toBeInTheDocument();
    });

    it('re-clones the repo the row menu names', async () => {
        mockRepos([API, WEB]);
        server.use(
            http.get(`${BASE}/projects/p1/repos/r-web/status`, () =>
                HttpResponse.json({
                    local_head: 'abc123',
                    remote_head: 'def456',
                    behind: 1,
                    uncommitted: 0,
                })
            )
        );
        renderCard();

        await clickRowAction('web', 'Re-clone from remote');
        expect(await screen.findByText('Re-clone from remote?')).toBeInTheDocument();
        // The status panel is keyed on the repo, not the project.
        expect(await screen.findByText('abc123')).toBeInTheDocument();
    });

    it('opens the auto-fetch schedule for the repo the row menu names', async () => {
        mockRepos([API, WEB]);
        server.use(
            http.get(`${BASE}/projects/p1/repos/r-web/schedule`, () =>
                HttpResponse.json({
                    repo_id: 'r-web',
                    project_id: 'p1',
                    enabled: false,
                    preset: 'daily',
                    cron_expression: '0 6 * * *',
                    time_of_day: '06:00',
                    weekday: 1,
                    skip_if_dirty: true,
                    pause_while_agents_active: true,
                    conflict_policy: 'skip',
                    last_run_at: null,
                    last_run_status: null,
                    last_run_detail: null,
                    next_run_at: null,
                    auth_failure_count: 0,
                    created_at: '2026-01-01T00:00:00.000Z',
                    updated_at: '2026-01-01T00:00:00.000Z',
                })
            )
        );
        renderCard();

        await clickRowAction('web', 'Auto-fetch schedule…');
        expect(await screen.findByText('Auto-fetch schedule')).toBeInTheDocument();
        // The branch it pulls is the repo's, not the project's.
        expect(await screen.findByText(/origin\/develop/)).toBeInTheDocument();
    });

    // ─── Backing out of a row action ────────────────────────────────────────
    //
    // Every one of these dialogs is opened from the kebab of a specific row.
    // Dismissing one must leave that repo exactly as it was — a Cancel that
    // silently acts, or a dialog that won't close, is worse than no dialog.

    it('keeps the repo when the Remove confirmation is cancelled', async () => {
        mockRepos([API, WEB]);
        let deleted = false;
        server.use(
            http.delete(`${BASE}/projects/p1/repos/r-web`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            })
        );
        renderCard();

        await clickRowAction('web', 'Remove');
        const confirm = await screen.findByRole('dialog');
        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByText('Remove web?')).toBeNull());
        expect(deleted).toBe(false);
        expect(screen.getByTestId('repo-row-web')).toBeInTheDocument();
    });

    it('closes the re-clone dialog without re-cloning', async () => {
        mockRepos([API, WEB]);
        let recloned = false;
        server.use(
            http.get(`${BASE}/projects/p1/repos/r-web/status`, () =>
                HttpResponse.json({
                    local_head: 'abc123',
                    remote_head: 'def456',
                    behind: 1,
                    uncommitted: 0,
                })
            ),
            http.post(`${BASE}/projects/p1/repos/r-web/reclone`, () => {
                recloned = true;
                return HttpResponse.json({ clone_id: 'c1' });
            })
        );
        renderCard();

        await clickRowAction('web', 'Re-clone from remote');
        await screen.findByText('Re-clone from remote?');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByText('Re-clone from remote?')).toBeNull());
        expect(recloned).toBe(false);
    });

    it('closes the auto-fetch schedule dialog without saving', async () => {
        mockRepos([API, WEB]);
        let saved = false;
        server.use(
            http.get(`${BASE}/projects/p1/repos/r-web/schedule`, () =>
                HttpResponse.json({
                    repo_id: 'r-web',
                    project_id: 'p1',
                    enabled: false,
                    preset: 'daily',
                    cron_expression: '0 6 * * *',
                    time_of_day: '06:00',
                    weekday: 1,
                    skip_if_dirty: true,
                    pause_while_agents_active: true,
                    conflict_policy: 'skip',
                    last_run_at: null,
                    last_run_status: null,
                    last_run_detail: null,
                    next_run_at: null,
                    auth_failure_count: 0,
                    created_at: '2026-01-01T00:00:00.000Z',
                    updated_at: '2026-01-01T00:00:00.000Z',
                })
            ),
            http.put(`${BASE}/projects/p1/repos/r-web/schedule`, () => {
                saved = true;
                return HttpResponse.json({});
            })
        );
        renderCard();

        await clickRowAction('web', 'Auto-fetch schedule…');
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(saved).toBe(false);
    });

    it('keeps the edit dialog open and names the error when the branch save fails', async () => {
        // Closing on failure would look like it saved. The Owner would walk
        // away believing the default branch changed when it did not.
        mockRepos([API, WEB]);
        server.use(
            http.patch(`${BASE}/projects/p1/repos/r-web`, () =>
                HttpResponse.json({ error: 'branch "main" does not exist on the remote' }, { status: 400 })
            )
        );
        renderCard();

        await clickRowAction('web', 'Edit');
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/default branch/i), {
            target: { value: 'main' },
        });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        expect(
            await screen.findByText('branch "main" does not exist on the remote')
        ).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // ─── Add-repo dialog form fields (AddRepoDialog) ────────────────────────

    it('lets the Owner type over the name the repo URL filled in', async () => {
        // The name is the repo's folder inside every Task workspace, so it is
        // a deliberate choice, not a derived value. If typing stopped taking,
        // two repos from the same URL would collide on one folder.
        mockRepos([API]);
        renderCard();
        const dialog = await fillConnectForm();

        fireEvent.change(within(dialog).getByLabelText(/^name/i), {
            target: { value: 'web-ui' },
        });
        await waitFor(() => expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('web-ui'));
    });

    it('offers a default branch only when cloning, and takes an edit to it', async () => {
        // A connected folder already has whatever branch is checked out; only
        // a fresh clone needs to be told which to take.
        mockRepos([API]);
        renderCard();
        fireEvent.click(await screen.findByRole('button', { name: /add repo/i }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.change(within(dialog).getByLabelText(/repository url/i), {
            target: { value: 'https://github.com/acme/web.git' },
        });
        await waitFor(() => expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('web'));

        const branch = within(dialog).getByLabelText(/default branch/i);
        fireEvent.change(branch, { target: { value: 'develop' } });
        expect(branch).toHaveValue('develop');

        // Switching to "use existing folder" retires the field entirely.
        fireEvent.click(within(dialog).getByRole('button', { name: /use existing folder/i }));
        await waitFor(() =>
            expect(within(dialog).queryByLabelText(/default branch/i)).toBeNull()
        );
    });

    it('leaves the dialog for Settings → Credentials when asked to manage them', async () => {
        // The Owner hits this when the repo needs a credential they have not
        // created yet; leaving the dialog open behind the navigation would
        // strand a modal over the settings page.
        mockRepos([API]);
        renderCard();
        fireEvent.click(await screen.findByRole('button', { name: /add repo/i }));
        const dialog = await screen.findByRole('dialog');

        fireEvent.click(within(dialog).getByText('manage in Settings'));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});
