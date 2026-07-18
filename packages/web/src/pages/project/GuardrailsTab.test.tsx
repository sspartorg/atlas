import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';

// Mock the lazy-loaded ProjectGuardrailsBody so the Suspense boundary resolves
// synchronously and we can assert props are passed through correctly.
vi.mock('../ProjectGuardrails.js', () => ({
    ProjectGuardrailsBody: ({
        projectId,
        projectName,
    }: {
        projectId: string;
        projectName?: string;
    }) => (
        <div data-testid="guardrails-body">
            {projectId}:{projectName}
        </div>
    ),
}));

import { GuardrailsTab } from './GuardrailsTab.js';

const BASE = 'http://localhost:3000/api';

const stubProject = makeProject({ id: 'proj-1', name: 'Test Project' });

describe('GuardrailsTab', () => {
    it('renders the lazy Suspense wrapper (Skeleton or guardrails body)', async () => {
        server.use(
            http.get(`${BASE}/projects/proj-1/guardrails`, () => HttpResponse.json([])),
            http.get(`${BASE}/guardrails`, () => HttpResponse.json([])),
        );
        const { container } = renderWithProviders(<GuardrailsTab project={stubProject} />);
        // Either a skeleton or the guardrails content renders
        await waitFor(() => {
            // The Suspense boundary renders something
            expect(container.firstChild).not.toBeNull();
        });
    });

    it('passes projectId and projectName through to ProjectGuardrailsBody', async () => {
        renderWithProviders(<GuardrailsTab project={stubProject} />);
        // With the mock, the lazy chunk resolves immediately — the body renders
        await waitFor(() => {
            expect(screen.getByTestId('guardrails-body')).toBeInTheDocument();
        });
        expect(screen.getByTestId('guardrails-body')).toHaveTextContent('proj-1:Test Project');
    });
});
