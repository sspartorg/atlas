import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProjectRepo } from '../../test-utils/factories.js';
import { SetupTab, scriptSummary } from './SetupTab.js';
import { Toast } from '../../components/Toast.js';

const BASE = '/api';
const PROJECT_ID = 'p1';

// ADR 0018 — setup scripts hang off a repo, so every fixture is a repo row.
const repo = (overrides = {}) => makeProjectRepo({ id: 'r1', name: 'atlas', ...overrides });

function mockRepos(rows: ReturnType<typeof makeProjectRepo>[]) {
    return http.get(`${BASE}/projects/${PROJECT_ID}/repos`, () => HttpResponse.json(rows));
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function openRepo(name: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Edit setup scripts for ${name}` }));
    return screen.findByRole('dialog');
}

describe('scriptSummary', () => {
    it('counts lines and calls a blank script empty', () => {
        expect(scriptSummary('')).toBe('empty');
        expect(scriptSummary(null)).toBe('empty');
        expect(scriptSummary('  \n\n')).toBe('empty');
        expect(scriptSummary('echo hi')).toBe('1 line');
        expect(scriptSummary('a\nb\n')).toBe('2 lines');
    });
});

describe('SetupTab — list', () => {
    it('shows a loading spinner before the repos are fetched', () => {
        server.use(
            http.get(`${BASE}/projects/${PROJECT_ID}/repos`, async () => {
                await new Promise((r) => setTimeout(r, 50));
                return HttpResponse.json([repo()]);
            })
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('says so when the repos fail to load, instead of spinning', async () => {
        server.use(http.get(`${BASE}/projects/${PROJECT_ID}/repos`, () => HttpResponse.json({ error: 'x' }, { status: 500 })));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        expect(await screen.findByText(/Could not load this project's repos/)).toBeInTheDocument();
    });

    it('tells the Owner when the project has no repos to hold scripts', async () => {
        server.use(mockRepos([]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        expect(await screen.findByText(/no repos yet/i)).toBeInTheDocument();
    });

    it('lists every repo with what each of its two scripts holds, and no editors', async () => {
        server.use(
            mockRepos([
                repo({ id: 'r1', name: 'web', setup_sh_body: 'a\nb\nc', setup_ps1_body: '' }),
                repo({ id: 'r2', name: 'api', setup_sh_body: '', setup_ps1_body: 'Write-Host hi' }),
            ])
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const web = await screen.findByRole('button', { name: 'Edit setup scripts for web' });
        expect(web).toHaveTextContent('.sh · 3 lines');
        expect(web).toHaveTextContent('.ps1 · empty');
        const api = screen.getByRole('button', { name: 'Edit setup scripts for api' });
        expect(api).toHaveTextContent('.sh · empty');
        expect(api).toHaveTextContent('.ps1 · 1 line');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
        expect(screen.getByText(/before the agent CLI starts/i)).toBeInTheDocument();
    });
});

describe('SetupTab — dialog', () => {
    it('opens the clicked repo with its two scripts and the secrets help collapsed', async () => {
        server.use(
            mockRepos([
                repo({ id: 'r1', name: 'web', setup_sh_body: 'echo web' }),
                repo({ id: 'r2', name: 'api', setup_sh_body: 'echo api', setup_ps1_body: 'Write-Host api' }),
            ])
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const dialog = await openRepo('api');
        expect(within(dialog).getByText('api')).toBeInTheDocument();
        expect(within(dialog).getByLabelText('Bash setup script')).toHaveValue('echo api');
        expect(within(dialog).getByLabelText('PowerShell setup script')).toHaveValue('Write-Host api');
        const help = within(dialog).getByText('Using secrets in your scripts').closest('details')!;
        expect(help.open).toBe(false);
        expect(help).toHaveTextContent('UPPER_SNAKE_CASE');
        expect(help).not.toHaveTextContent('[A-Za-z_]');
        expect(within(dialog).getByRole('button', { name: 'Save scripts' })).toBeDisabled();
    });

    it('saves both scripts of that repo, toasts, closes, and the list updates', async () => {
        let body: unknown;
        let stored = repo({ id: 'r2', name: 'api', setup_sh_body: '', setup_ps1_body: '' });
        server.use(
            http.get(`${BASE}/projects/${PROJECT_ID}/repos`, () => HttpResponse.json([stored])),
            http.patch(`${BASE}/projects/${PROJECT_ID}/repos/r2`, async ({ request }) => {
                body = await request.json();
                stored = { ...stored, ...(body as object) };
                return HttpResponse.json(stored);
            })
        );
        renderWithProviders(
            <>
                <SetupTab projectId={PROJECT_ID} />
                <Toast />
            </>
        );
        const dialog = await openRepo('api');
        fireEvent.change(within(dialog).getByLabelText('Bash setup script'), { target: { value: 'npm ci\nnpm run build' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save scripts' }));
        expect(await screen.findByText('Setup scripts saved for api')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(body).toEqual({ setup_sh_body: 'npm ci\nnpm run build', setup_ps1_body: '' });
        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Edit setup scripts for api' })).toHaveTextContent('.sh · 2 lines')
        );
    });

    it('a failed save keeps the dialog and the edits, and says why', async () => {
        server.use(
            mockRepos([repo()]),
            http.patch(`${BASE}/projects/${PROJECT_ID}/repos/r1`, () => HttpResponse.json({ error: 'disk full' }, { status: 500 }))
        );
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const dialog = await openRepo('atlas');
        fireEvent.change(within(dialog).getByLabelText('PowerShell setup script'), { target: { value: 'exit 1' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save scripts' }));
        expect(await within(dialog).findByText(/Could not save: .*disk full/)).toBeInTheDocument();
        expect(within(dialog).getByLabelText('PowerShell setup script')).toHaveValue('exit 1');
    });

    it('closing with unsaved edits asks first; Keep editing keeps them, Discard drops them', async () => {
        server.use(mockRepos([repo({ setup_sh_body: 'orig' })]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        let dialog = await openRepo('atlas');
        fireEvent.change(within(dialog).getByLabelText('Bash setup script'), { target: { value: 'changed' } });

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(within(dialog).getByText('Discard your unsaved changes?')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
        expect(within(dialog).getByLabelText('Bash setup script')).toHaveValue('changed');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        dialog = await openRepo('atlas');
        expect(within(dialog).getByLabelText('Bash setup script')).toHaveValue('orig');
    });

    it('closing a clean dialog does not ask', async () => {
        server.use(mockRepos([repo()]));
        renderWithProviders(<SetupTab projectId={PROJECT_ID} />);
        const dialog = await openRepo('atlas');
        fireEvent.keyDown(dialog, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});
