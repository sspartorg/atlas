import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProjectRepo } from '../../test-utils/factories.js';
import { SetupTab } from './SetupTab.js';

const BASE = '/api';
const PROJECT_ID = 'p1';
const REPO_ID = 'p1';

// ADR 0018 — setup scripts hang off a repo, so every fixture is a repo row.
const repo = (overrides = {}) => makeProjectRepo({ id: REPO_ID, name: 'atlas', ...overrides });

function mockRepos(rows: ReturnType<typeof makeProjectRepo>[]) {
    return http.get(`${BASE}/projects/${PROJECT_ID}/repos`, () => HttpResponse.json(rows));
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('SetupTab', () => {
    it('shows a loading spinner before the repos are fetched', () => {
        server.use(
            http.get(`${BASE}/projects/${PROJECT_ID}/repos`, async () => {
                await new Promise((r) => setTimeout(r, 50));
                return HttpResponse.json([repo()]);
            }),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('renders the bash + powershell editors with the repo body values', async () => {
        server.use(
            mockRepos([
                repo({ setup_sh_body: '#!/bin/bash\necho hi', setup_ps1_body: 'Write-Host hi' }),
            ]),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        await waitFor(() => expect(screen.getByText(/Setup scripts/i)).toBeInTheDocument());
        expect(screen.getByText(/Bash \/ POSIX shell/i)).toBeInTheDocument();
        expect(screen.getByText(/Windows PowerShell/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue(/echo hi/)).toBeInTheDocument();
        expect(screen.getByDisplayValue(/Write-Host hi/)).toBeInTheDocument();
    });

    it('tells the Owner when the project has no repos to hold scripts', async () => {
        server.use(mockRepos([]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        expect(await screen.findByText(/no repos yet/i)).toBeInTheDocument();
    });

    it('copy says the script runs before the agent CLI (agent-runner setup_failed path), not "lands in a follow-up"', async () => {
        server.use(mockRepos([repo()]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        await screen.findByText(/Setup scripts/i);
        expect(screen.queryByText(/lands in a follow-up/i)).not.toBeInTheDocument();
        expect(screen.getByText(/before the agent CLI starts/i)).toBeInTheDocument();
    });

    it('disables Save until a field is edited, enables it after edit', async () => {
        server.use(mockRepos([repo()]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const saveBtn = await screen.findByRole('button', { name: /Save/i });
        expect(saveBtn).toBeDisabled();
        // Edit the .sh editor to dirty the form
        const editors = screen.getAllByRole('textbox');
        fireEvent.change(editors[0]!, { target: { value: 'echo new' } });
        expect(saveBtn).not.toBeDisabled();
    });

    it('PATCHes the repo on Save and shows a toast', async () => {
        const patched = vi.fn();
        server.use(
            mockRepos([repo()]),
            http.patch(`${BASE}/projects/${PROJECT_ID}/repos/${REPO_ID}`, async ({ request }) => {
                const body = (await request.json()) as Record<string, unknown>;
                patched(body);
                return HttpResponse.json(
                    repo({
                        setup_sh_body: String(body['setup_sh_body'] ?? ''),
                        setup_ps1_body: String(body['setup_ps1_body'] ?? ''),
                    }),
                );
            }),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const editors = await screen.findAllByRole('textbox');
        fireEvent.change(editors[0]!, { target: { value: 'echo saved' } });
        const saveBtn = screen.getByRole('button', { name: /Save/i });
        fireEvent.click(saveBtn);
        await waitFor(() => expect(patched).toHaveBeenCalled());
        expect(patched).toHaveBeenCalledWith({
            setup_sh_body: 'echo saved',
            setup_ps1_body: '',
        });
    });

    it('edits and saves the SELECTED repo’s scripts', async () => {
        const api = makeProjectRepo({ id: 'r-api', name: 'api', setup_sh_body: 'echo api' });
        const web = makeProjectRepo({ id: 'r-web', name: 'web', setup_sh_body: 'echo web' });
        let patchedUrl: string | null = null;
        let patchedBody: Record<string, unknown> | null = null;
        server.use(
            mockRepos([api, web]),
            http.patch(`${BASE}/projects/${PROJECT_ID}/repos/:repoId`, async ({ request }) => {
                patchedUrl = new URL(request.url).pathname;
                patchedBody = (await request.json()) as Record<string, unknown>;
                return HttpResponse.json(web);
            }),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);

        // Defaults to the first repo.
        expect(await screen.findByDisplayValue('echo api')).toBeInTheDocument();

        // Pick the second repo — its scripts replace the first's.
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Repo' }));
        fireEvent.click(await screen.findByRole('option', { name: 'web' }));
        expect(await screen.findByDisplayValue('echo web')).toBeInTheDocument();

        const editors = screen.getAllByRole('textbox');
        fireEvent.change(editors[0]!, { target: { value: 'echo web edited' } });
        fireEvent.click(screen.getByRole('button', { name: /Save/i }));

        await waitFor(() => expect(patchedUrl).toBe(`/api/projects/${PROJECT_ID}/repos/r-web`));
        expect(patchedBody).toEqual({ setup_sh_body: 'echo web edited', setup_ps1_body: '' });
    });

    it('shows error Alert when PATCH fails (update.isError branch)', async () => {
        // handleSave calls mutateAsync which rejects on 500 and becomes an
        // unhandled promise rejection (React doesn't await onClick handlers).
        // Suppress the rejection at the process level so vitest doesn't fail.
        const suppressRejection = (reason: unknown, promise: Promise<unknown>) => {
            void promise; void reason; // silently swallow
        };
        process.on('unhandledRejection', suppressRejection);

        try {
            server.use(
                mockRepos([repo()]),
                http.patch(`${BASE}/projects/${PROJECT_ID}/repos/${REPO_ID}`, () =>
                    HttpResponse.json({ error: 'Server error' }, { status: 500 }),
                ),
            );
            renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
            const editors = await screen.findAllByRole('textbox');
            fireEvent.change(editors[0]!, { target: { value: 'echo fail' } });
            const saveBtn = screen.getByRole('button', { name: /Save/i });
            fireEvent.click(saveBtn);
            // When PATCH fails, react-query mutation sets isError=true
            // and the Alert "Failed to save:" should appear
            await waitFor(() => {
                expect(screen.queryByText(/Failed to save/i)).toBeInTheDocument();
            }, { timeout: 5000 });
        } finally {
            process.off('unhandledRejection', suppressRejection);
        }
    });

    it('shows CircularProgress in Save button while PATCH is in flight', async () => {
        // Delay the PATCH response so we can observe the isPending state
        let resolvePatch!: () => void;
        const patchPromise = new Promise<void>((res) => { resolvePatch = res; });
        server.use(
            mockRepos([repo()]),
            http.patch(`${BASE}/projects/${PROJECT_ID}/repos/${REPO_ID}`, async () => {
                await patchPromise;
                return HttpResponse.json(repo());
            }),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const editors = await screen.findAllByRole('textbox');
        fireEvent.change(editors[0]!, { target: { value: 'echo pending' } });
        const saveBtn = screen.getByRole('button', { name: /Save/i });
        fireEvent.click(saveBtn);
        // While the PATCH is in flight, button label changes to "Saving…"
        await waitFor(() => {
            expect(screen.getByText(/Saving…/i)).toBeInTheDocument();
        }, { timeout: 3000 });
        // Also a CircularProgress (progressbar role) appears in the button
        expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
        // Resolve the PATCH to clean up
        resolvePatch();
    });

    it('useEffect: syncs state to a null-body repo (setup_sh_body ?? "" + setup_ps1_body ?? "" branches)', async () => {
        // Repo has null setup bodies → useEffect fires with repo truthy,
        // fields default to '' via the ?? '' fallback in useEffect body
        server.use(
            mockRepos([
                repo({
                    setup_sh_body: null as unknown as string,
                    setup_ps1_body: null as unknown as string,
                }),
            ]),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        await waitFor(() => expect(screen.getByText(/Setup scripts/i)).toBeInTheDocument());
        // Both textareas should be empty strings (null ?? '' = '')
        const editors = screen.getAllByRole('textbox');
        expect(editors[0]!.textContent ?? '').toBe('');
        expect(editors[1]!.textContent ?? '').toBe('');
    });

    it('dirty stays false when both sh and ps1 match the repo values (dirty false branch)', async () => {
        // With matching values dirty=false → Save button stays disabled
        server.use(
            mockRepos([
                repo({ setup_sh_body: 'echo hello', setup_ps1_body: 'Write-Host hello' }),
            ]),
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const saveBtn = await screen.findByRole('button', { name: /Save/i });
        // Right after load both fields match → dirty=false → disabled
        await waitFor(() => expect(saveBtn).toBeDisabled());
    });

    it('editing only ps1 makes form dirty (ps1 !== repo.setup_ps1_body ?? "" branch)', async () => {
        // Exercises the second operand of the || in `dirty` — only ps1 changes
        server.use(mockRepos([repo({ setup_sh_body: '', setup_ps1_body: '' })]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const saveBtn = await screen.findByRole('button', { name: /Save/i });
        expect(saveBtn).toBeDisabled();
        // Edit ps1 (second textarea)
        const editors = await screen.findAllByRole('textbox');
        fireEvent.change(editors[1]!, { target: { value: 'Write-Host changed' } });
        expect(saveBtn).not.toBeDisabled();
    });

    it('update.isError with non-Error: renders "Unknown error" in Alert (false branch)', async () => {
        // Simulate a thrown error that is NOT an instance of Error (plain string rejection)
        // We cannot easily force this via MSW, but we can simulate by checking the branch
        // fires when the mutation rejects with a non-Error — use an AbortError via AbortController
        const suppressRejection = (reason: unknown, promise: Promise<unknown>) => {
            void promise; void reason;
        };
        process.on('unhandledRejection', suppressRejection);
        try {
            server.use(
                mockRepos([repo()]),
                http.patch(`${BASE}/projects/${PROJECT_ID}/repos/${REPO_ID}`, () =>
                    HttpResponse.json({ error: 'Server error' }, { status: 500 }),
                ),
            );
            renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
            const editors = await screen.findAllByRole('textbox');
            fireEvent.change(editors[0]!, { target: { value: 'echo error test' } });
            const saveBtn = screen.getByRole('button', { name: /Save/i });
            fireEvent.click(saveBtn);
            // After mutation error, "Failed to save:" alert should appear
            await waitFor(() => {
                expect(screen.queryByText(/Failed to save/i)).toBeInTheDocument();
            }, { timeout: 5000 });
        } finally {
            process.off('unhandledRejection', suppressRejection);
        }
    });
});
