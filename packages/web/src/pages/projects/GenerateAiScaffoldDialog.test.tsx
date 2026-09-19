import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { GenerateAiScaffoldDialog } from './GenerateAiScaffoldDialog.js';

const BASE = 'http://localhost:3000/api';
const project = makeProject({ id: 'p1' });

function reposAre(...repos: ReturnType<typeof makeProjectRepo>[]) {
    return http.get(`${BASE}/projects/p1/repos`, () => HttpResponse.json(repos));
}

describe('GenerateAiScaffoldDialog', () => {
    it('renders the body naming the repo it will analyse', async () => {
        server.use(reposAre(makeProjectRepo({ id: 'r1', name: 'atlas', git_path: '/tmp/x' })));
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={() => {}} />,
        );
        expect(screen.getByText('Generate AI scaffold')).toBeInTheDocument();
        expect(await screen.findByText('/tmp/x')).toBeInTheDocument();
        expect(screen.getByText('atlas')).toBeInTheDocument();
    });

    it('fires onClose when Cancel is clicked', () => {
        const onClose = vi.fn();
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={onClose} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('starts generation for the single ready repo, calls onClose on success', async () => {
        let body: unknown = null;
        server.use(
            reposAre(makeProjectRepo({ id: 'r1', name: 'atlas' })),
            http.post(`${BASE}/projects/p1/generate-ai-scaffold`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ run_id: 'r99', workflow_id: 'wf-1' });
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={onClose} />,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /generate/i })).not.toBeDisabled(),
        );
        fireEvent.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body).toEqual({ repo_id: 'r1' });
    });

    it('lets the Owner pick which repo to analyse when several are ready', async () => {
        let body: unknown = null;
        server.use(
            reposAre(
                makeProjectRepo({ id: 'r1', name: 'atlas', git_path: '/tmp/atlas' }),
                makeProjectRepo({ id: 'r2', name: 'docs', git_path: '/tmp/docs' }),
            ),
            http.post(`${BASE}/projects/p1/generate-ai-scaffold`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ run_id: 'r99', workflow_id: 'wf-1' });
            }),
        );
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={vi.fn()} />,
        );
        // Defaults to the first ready repo.
        expect(await screen.findByText('/tmp/atlas')).toBeInTheDocument();
        fireEvent.mouseDown(screen.getByRole('combobox'));
        fireEvent.click(await screen.findByRole('option', { name: 'docs' }));
        await waitFor(() => expect(screen.getByText('/tmp/docs')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => expect(body).toEqual({ repo_id: 'r2' }));
    });

    it('offers no picker and no Generate when the project has no ready repo', async () => {
        server.use(reposAre(makeProjectRepo({ id: 'r1', clone_status: 'cloning' })));
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={vi.fn()} />,
        );
        expect(
            await screen.findByText(/no repo ready to analyze/i),
        ).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
    });

    it('shows a toast on error and keeps the dialog open', async () => {
        server.use(
            reposAre(makeProjectRepo({ id: 'r1' })),
            http.post(
                `${BASE}/projects/p1/generate-ai-scaffold`,
                () => new HttpResponse('boom', { status: 500 }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={onClose} />,
        );
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /generate/i })).not.toBeDisabled(),
        );
        fireEvent.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => {
            // Pending finished (button no longer says "Starting…")
            expect(screen.getByRole('button', { name: /generate/i })).not.toBeDisabled();
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not render when open=false', () => {
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open={false} onClose={() => {}} />,
        );
        expect(screen.queryByText('Generate AI scaffold')).not.toBeInTheDocument();
    });
});
