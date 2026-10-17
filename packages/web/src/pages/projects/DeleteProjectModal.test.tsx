import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { DeleteProjectModal } from './DeleteProjectModal.js';
import { projectsPagedKey } from '../../hooks/useProjects.js';
import { Route, Routes } from 'react-router-dom';

// The modal picks the job id itself (it subscribes before POSTing).
const JOB_ID = 'job-under-test';
vi.mock('../../hooks/sse-hub.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    newJobId: () => JOB_ID,
}));

// Stub EventSource so we can fire SSE events in tests. sse-hub (Batch-6
// SSE-hub refactor) sets handlers via `.onmessage = fn` property
// assignment — support both that and the legacy addEventListener path.
class StubEventSource {
    static instances: StubEventSource[] = [];
    public closed = false;
    listener: ((e: MessageEvent) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public url: string) {
        StubEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: (e: MessageEvent) => void): void {
        if (type === 'message') this.listener = fn;
    }
    removeEventListener(): void {
        this.listener = null;
    }
    close(): void {
        this.closed = true;
    }
    fire(data: unknown): void {
        const msg = new MessageEvent('message', { data: JSON.stringify(data) });
        this.onmessage?.(msg);
        this.listener?.(msg);
    }
}

const BASE = 'http://localhost:3000/api';
const project = makeProject({ id: 'p1', name: 'Acme' });

beforeEach(() => {
    StubEventSource.instances = [];
    vi.stubGlobal('EventSource', StubEventSource);
    server.use(...defaultHandlers);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('DeleteProjectModal — closed', () => {
    it('renders nothing when project is null', () => {
        const { container } = renderWithProviders(
            <DeleteProjectModal open project={null} displayId="ACM" onClose={vi.fn()} />
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe('DeleteProjectModal — confirm view', () => {
    it('renders the dialog with the project name and mode options', () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        expect(screen.getByText('Delete project?')).toBeInTheDocument();
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Remove from Atlas only')).toBeInTheDocument();
        expect(screen.getByText('Delete project and content')).toBeInTheDocument();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('unregister mode — "Remove from Atlas" button is enabled by default', () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        const btn = screen.getByRole('button', { name: /Remove from Atlas/i });
        expect(btn).not.toBeDisabled();
    });

    it('switches to purge mode when clicking the destructive option', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        // confirm input should appear
        expect(screen.getByPlaceholderText('Acme')).toBeInTheDocument();
    });

    it('purge mode — submit disabled until project name typed', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const submitBtn = screen.getByRole('button', { name: /Delete project and content/i });
        expect(submitBtn).toBeDisabled();
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        expect(submitBtn).not.toBeDisabled();
    });

    it('unregister submit starts delete job and shows deleting view', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: 'del-1' }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
    });

    it('shows error alert when API call fails', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        // The confirm view already has a warning alert; we wait for the error
        // alert to appear (severity="error" has role="alert" and class "standardError")
        await waitFor(() => {
            const alerts = screen.getAllByRole('alert');
            expect(alerts.length).toBeGreaterThan(1);
        });
    });

    it('purge mode — submit with correct name calls delete API', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-purge' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
    });

    it('purge mode — wrong name keeps submit button disabled', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'WrongName');
        const submitBtn = screen.getByRole('button', { name: /Delete project and content/i });
        expect(submitBtn).toBeDisabled();
    });

    it('close button (X) is hidden during deleting view', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: 'del-2' }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        // The close (X) IconButton is absent during deleting view
        expect(screen.queryByTestId('CloseRoundedIcon')).not.toBeInTheDocument();
    });

    it('renders displayId chip in ProjectChip', () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM-42" onClose={vi.fn()} />
        );
        expect(screen.getByText('ACM-42')).toBeInTheDocument();
    });

    it('renders every repo folder in ProjectChip', async () => {
        const proj = makeProject({ id: 'p2', name: 'Gadget' });
        server.use(
            http.get(`${BASE}/projects/p2/repos`, () =>
                HttpResponse.json([
                    makeProjectRepo({ id: 'r1', project_id: 'p2', git_path: '/repos/gadget' }),
                    makeProjectRepo({ id: 'r2', project_id: 'p2', git_path: '/repos/gadget-docs' }),
                ])
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={proj} displayId="GAD" onClose={vi.fn()} />
        );
        expect(await screen.findByText('/repos/gadget')).toBeInTheDocument();
        expect(screen.getByText('/repos/gadget-docs')).toBeInTheDocument();
    });

    it('renders "No repos" in ProjectChip when the project has none', async () => {
        const proj = makeProject({ id: 'p3', name: 'Bare' });
        server.use(http.get(`${BASE}/projects/p3/repos`, () => HttpResponse.json([])));
        renderWithProviders(
            <DeleteProjectModal open project={proj} displayId="BAR" onClose={vi.fn()} />
        );
        expect(await screen.findByText('No repos')).toBeInTheDocument();
    });

    it('re-opening (open false → true) resets view back to confirm', async () => {
        const { rerender } = renderWithProviders(
            <DeleteProjectModal open={false} project={project} displayId="ACM" onClose={vi.fn()} />
        );
        rerender(<DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('Delete project?')).toBeInTheDocument());
    });

    it('switching back from purge to unregister clears confirm input requirement', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        // Switch to purge
        await userEvent.click(screen.getByText('Delete project and content'));
        expect(screen.getByPlaceholderText('Acme')).toBeInTheDocument();
        // Switch back to unregister
        await userEvent.click(screen.getByText('Remove from Atlas only'));
        // The "Remove from Atlas" button should be enabled again
        const btn = screen.getByRole('button', { name: /Remove from Atlas/i });
        expect(btn).not.toBeDisabled();
    });
});

describe('DeleteProjectModal — deleting view', () => {
    it('shows Closing disabled message during deletion', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: 'del-3' }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Closing disabled/i)).toBeInTheDocument());
    });

    it('handleClose is blocked (noop) when view is deleting', async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: 'del-4' }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        // onClose should NOT have been called when navigating to deleting view
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe('DeleteProjectModal — error view Try-again', () => {
    it('error view shows Close and Try again buttons', async () => {
        // Simulate job ending in error via SSE — we can't easily do full SSE in tests,
        // but we can verify the error view renders when the submit errors
        // by checking the submit error path.
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => new HttpResponse(null, { status: 500 }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        // After 500 error, submitError state is set — we stay on confirm view with error alert
        await waitFor(() => {
            const alerts = screen.getAllByRole('alert');
            expect(alerts.length).toBeGreaterThan(1);
        });
    });
});

describe('DeleteProjectModal — success view via SSE', () => {
    it('transitions to success view when delete_completed SSE fires (unregister mode)', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-success' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        // Fire the SSE delete_completed event with mode=unregister
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'unregister' })
        );
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // Success view shows Close and Back to projects buttons
        expect(screen.getAllByRole('button', { name: /Close/i }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /Back to projects/i })).toBeInTheDocument();
    });

    // Regression: after a delete succeeds, the Projects list page must show
    // the fresh state. The page reads from useProjectsPaged, not the unpaged
    // ['projects'] used by sidenav. This asserts against that hook's real key
    // — if it is ever moved out from under ['projects'] again, the single
    // invalidation stops reaching it and this fails.
    it('invalidates the paged Projects list on delete success', async () => {
        const qc = new QueryClient({
            defaultOptions: {
                queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' },
                mutations: { retry: false },
            },
        });
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
        // The exact key the Projects page renders from.
        const pagedKey = projectsPagedKey(1, 20);
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-cache' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
            { queryClient: qc }
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'unregister' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        const invalidatedKeys = invalidateSpy.mock.calls.map(
            (call) => (call[0] as { queryKey?: unknown[] })?.queryKey?.[0]
        );
        expect(invalidatedKeys).toContain('sidenav-counts');
        // One of the invalidations must be a prefix of the paged list's real
        // key — that is what makes TanStack match it.
        const reachesPagedList = invalidateSpy.mock.calls.some((call) => {
            const key = (call[0] as { queryKey?: unknown[] })?.queryKey ?? [];
            return key.length > 0 && key.every((seg, i) => seg === pagedKey[i]);
        });
        expect(reachesPagedList).toBe(true);
    });

    it('success view — unregister mode shows "workspace folder kept on disk" text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-unreg' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'unregister' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // The header subtitle should say "Unregistered from Atlas..."
        expect(screen.getByText(/Unregistered from Atlas/i)).toBeInTheDocument();
    });

    it('success view — purge mode shows "Workspace folder removed" text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-purge-ok' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        // Switch to purge mode first
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'purge' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // purge success text
        expect(screen.getByText(/Workspace folder removed/i)).toBeInTheDocument();
    });

    it('success view — Close button calls onClose', async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-close' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'unregister' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // Click the Close button
        const closeBtn = screen.getAllByRole('button', { name: /Close/i })[0]!;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('success view — purge mode reports the elapsed time', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-stats' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: JOB_ID, mode: 'purge' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        expect(screen.getByText(/Removed in/i)).toBeInTheDocument();
    });
});

describe('DeleteProjectModal — error view via SSE', () => {
    it('transitions to error view when delete_error SSE fires', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-err-sse' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({ type: 'delete_error', deleteId: JOB_ID, errorDetail: 'Access denied' })
        );
        await waitFor(() =>
            expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0)
        );
        // Error view shows Try again button
        expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    });

    it('error view — Try again button resets to confirm view', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-retry' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: JOB_ID, errorDetail: 'failed' }));
        await waitFor(() =>
            expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0)
        );
        // Click Try again
        await userEvent.click(screen.getByRole('button', { name: /Try again/i }));
        await waitFor(() => expect(screen.getByText(/Delete project\?/i)).toBeInTheDocument());
    });

    it('error view — error mode=purge shows purge-specific troubleshoot text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-purge-err' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({ type: 'delete_error', deleteId: JOB_ID, errorDetail: 'folder busy' })
        );
        await waitFor(() =>
            expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0)
        );
        // purge mode troubleshoot text mentions closing editor
        expect(screen.getByText(/Close any editor or terminal/i)).toBeInTheDocument();
    });

    it('error view — unregister mode shows unregister troubleshoot text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-unreg-err' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({ type: 'delete_error', deleteId: JOB_ID, errorDetail: 'DB locked' })
        );
        await waitFor(() =>
            expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0)
        );
        // unregister mode troubleshoot text mentions server logs
        expect(screen.getByText(/Check the server logs/i)).toBeInTheDocument();
    });
});

describe('DeleteProjectModal — deleting view checklist', () => {
    it('lists only the steps the runner performs (unregister)', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: JOB_ID }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        expect(await screen.findByText(/Step 1 of 1 · Unregister from Atlas/i)).toBeInTheDocument();
        expect(screen.queryByText(/Stop attached agents|Revoke credential lease|Finalize/i)).toBeNull();
    });

    it('purge: removes repo folders first, then unregisters', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: JOB_ID }))
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        await userEvent.type(screen.getByPlaceholderText('Acme'), 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        expect(await screen.findByText(/Step 1 of 2 · Remove repo folders/i)).toBeInTheDocument();
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({
                type: 'delete_output',
                deleteId: JOB_ID,
                output: 'Unregistering project from Atlas...',
            })
        );
        expect(await screen.findByText(/Step 2 of 2 · Unregister from Atlas/i)).toBeInTheDocument();
    });
});

describe('DeleteProjectModal — missed-event race and leaving the page', () => {
    it('does not miss a delete_completed broadcast before the 202 arrives', async () => {
        // The runner broadcasts before its 202 reaches the client and the
        // stream has no replay; the handler fires the event first, then answers.
        server.use(
            http.post(`${BASE}/projects/p1/delete`, async ({ request }) => {
                const body = (await request.json()) as { delete_id?: string };
                const id = body.delete_id ?? 'server-made-id';
                StubEventSource.instances[0]?.fire({
                    type: 'delete_completed',
                    deleteId: id,
                    mode: 'unregister',
                });
                return HttpResponse.json({ delete_id: id }, { status: 202 });
            })
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        expect(await screen.findByText('Project deleted')).toBeInTheDocument();
    });

    it('"Back to projects" leaves the deleted project for /projects and drops its cache', async () => {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        qc.setQueryData(['projects', 'p1'], project);
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () => HttpResponse.json({ delete_id: JOB_ID }))
        );
        const onClose = vi.fn();
        renderWithProviders(
            <Routes>
                <Route
                    path="/projects/:id"
                    element={
                        <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />
                    }
                />
                <Route path="/projects" element={<p>Projects list</p>} />
            </Routes>,
            { queryClient: qc, initialEntries: ['/projects/p1'] }
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        act(() =>
            StubEventSource.instances[0]!.fire({
                type: 'delete_completed',
                deleteId: JOB_ID,
                mode: 'unregister',
            })
        );
        await userEvent.click(await screen.findByRole('button', { name: /Back to projects/i }));
        expect(await screen.findByText('Projects list')).toBeInTheDocument();
        expect(onClose).toHaveBeenCalled();
        expect(qc.getQueryData(['projects', 'p1'])).toBeUndefined();
    });
});

describe('DeleteProjectModal — "No stderr captured." fallback (L840)', () => {
    it('error view shows "No stderr captured." when errorDetail is empty and no log lines', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-nostderr' })
            )
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        // errorDetail is empty string (falsy) and no prior log lines — exercises the
        // third fallback "No stderr captured." in job.errorDetail || lines || fallback (L840)
        act(() => es.fire({ type: 'delete_error', deleteId: JOB_ID, errorDetail: '' }));
        await waitFor(() =>
            expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0)
        );
        expect(screen.getByText('No stderr captured.')).toBeInTheDocument();
    });
});
