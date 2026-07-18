import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { GenerateAiScaffoldDialog } from './GenerateAiScaffoldDialog.js';

const project = makeProject({ id: 'p1', git_path: '/tmp/x' });

describe('GenerateAiScaffoldDialog', () => {
    it('renders the body referencing the project git_path', () => {
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={() => {}} />,
        );
        expect(screen.getByText('Generate AI scaffold')).toBeInTheDocument();
        expect(screen.getByText('/tmp/x')).toBeInTheDocument();
    });

    it('fires onClose when Cancel is clicked', () => {
        const onClose = vi.fn();
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={onClose} />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('starts generation, calls onClose on success', async () => {
        server.use(
            http.post('http://localhost:3000/api/projects/p1/generate-ai-scaffold', () =>
                HttpResponse.json({ run_id: 'r99' }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={onClose} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows a toast on error and keeps the dialog open', async () => {
        server.use(
            http.post(
                'http://localhost:3000/api/projects/p1/generate-ai-scaffold',
                () => new HttpResponse('boom', { status: 500 }),
            ),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <GenerateAiScaffoldDialog project={project} open onClose={onClose} />,
        );
        fireEvent.click(screen.getByRole('button', { name: /generate/i }));
        await waitFor(() => {
            // Pending finished (button no longer says "Starting…")
            expect(
                screen.getByRole('button', { name: /generate/i }),
            ).not.toBeDisabled();
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
