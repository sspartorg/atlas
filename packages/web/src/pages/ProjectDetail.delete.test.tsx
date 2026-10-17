import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeProject } from '../test-utils/factories.js';
import { ProjectDetail } from './ProjectDetail.js';

// Deleting a project from its own page: the finished delete drops the
// project's cache, the page refetches it, gets a 404 and falls to "Project
// not found" — and the delete dialog used to be unmounted with it, so the
// success view and "Back to projects" vanished (found by
// e2e/flows/projects-full.spec.ts).

const JOB_ID = 'job-detail-delete';
vi.mock('../hooks/sse-hub.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    newJobId: () => JOB_ID,
}));

class StubEventSource {
    static instances: StubEventSource[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
        StubEventSource.instances.push(this);
    }
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
    fire(data: unknown): void {
        this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
}

const BASE = 'http://localhost:3000/api';

beforeEach(() => {
    StubEventSource.instances = [];
    vi.stubGlobal('EventSource', StubEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('ProjectDetail — delete from the project page', () => {
    it('keeps the success view after the project 404s, and "Back to projects" lands on /projects', async () => {
        let deleted = false;
        server.use(
            http.get(`${BASE}/projects/p1`, () =>
                deleted
                    ? HttpResponse.json({ error: 'Project not found', kind: 'not_found' }, { status: 404 })
                    : HttpResponse.json(makeProject({ id: 'p1', name: 'Acme', issue_key_prefix: 'ACM' }))
            ),
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: JOB_ID }, { status: 202 })),
            ...defaultHandlers
        );
        renderWithProviders(
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/projects" element={<p>Projects list</p>} />
            </Routes>,
            { initialEntries: ['/projects/p1'] }
        );
        await userEvent.click(await screen.findByRole('button', { name: 'Project actions' }));
        await userEvent.click(screen.getByRole('menuitem', { name: /Delete project/ }));
        await userEvent.click(await screen.findByRole('button', { name: /Remove from Atlas/ }));
        expect(await screen.findByText(/Deleting project/)).toBeInTheDocument();

        deleted = true;
        act(() =>
            StubEventSource.instances.forEach((es) => {
                es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'unregister' });
                // The runner's projectsService.delete broadcasts this too.
                es.fire({ type: 'counts_changed' });
            })
        );
        expect(await screen.findByText('Project deleted')).toBeInTheDocument();
        // The page under the dialog has lost its project (skeleton or "Project not found")…
        await waitFor(() => expect(screen.queryByRole('tab', { name: /Overview/ })).not.toBeInTheDocument());
        // …and the dialog is still there to say the delete worked.
        expect(screen.getByText('Project deleted')).toBeInTheDocument();
        expect(screen.getByText('Unregistered from Atlas. Workspace folder kept on disk.')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Back to projects/ }));
        expect(await screen.findByText('Projects list')).toBeInTheDocument();
    });
});
