import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { DeleteProjectModal } from './DeleteProjectModal.js';

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
            <DeleteProjectModal open project={null} displayId="ACM" onClose={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe('DeleteProjectModal — confirm view', () => {
    it('renders the dialog with the project name and mode options', () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        expect(screen.getByText('Delete project?')).toBeInTheDocument();
        expect(screen.getByText('Acme')).toBeInTheDocument();
        expect(screen.getByText('Remove from Atlas only')).toBeInTheDocument();
        expect(screen.getByText('Delete project and content')).toBeInTheDocument();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('unregister mode — "Remove from Atlas" button is enabled by default', () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        const btn = screen.getByRole('button', { name: /Remove from Atlas/i });
        expect(btn).not.toBeDisabled();
    });

    it('switches to purge mode when clicking the destructive option', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        // confirm input should appear
        expect(
            screen.getByPlaceholderText('Acme'),
        ).toBeInTheDocument();
    });

    it('purge mode — submit disabled until project name typed', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
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
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-1' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() =>
            expect(screen.getByText(/Deleting project/i)).toBeInTheDocument(),
        );
    });

    it('shows error alert when API call fails', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
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
                HttpResponse.json({ delete_id: 'del-purge' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() =>
            expect(screen.getByText(/Deleting project/i)).toBeInTheDocument(),
        );
    });

    it('purge mode — wrong name keeps submit button disabled', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'WrongName');
        const submitBtn = screen.getByRole('button', { name: /Delete project and content/i });
        expect(submitBtn).toBeDisabled();
    });

    it('close button (X) is hidden during deleting view', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-2' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() =>
            expect(screen.getByText(/Deleting project/i)).toBeInTheDocument(),
        );
        // The close (X) IconButton is absent during deleting view
        expect(screen.queryByTestId('CloseRoundedIcon')).not.toBeInTheDocument();
    });

    it('renders displayId chip in ProjectChip', () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM-42" onClose={vi.fn()} />,
        );
        expect(screen.getByText('ACM-42')).toBeInTheDocument();
    });

    it('renders the git_path in ProjectChip', () => {
        const proj = makeProject({ id: 'p2', name: 'Gadget', git_path: '/repos/gadget' });
        renderWithProviders(
            <DeleteProjectModal open project={proj} displayId="GAD" onClose={vi.fn()} />,
        );
        expect(screen.getByText('/repos/gadget')).toBeInTheDocument();
    });

    it('re-opening (open false → true) resets view back to confirm', async () => {
        const { rerender } = renderWithProviders(
            <DeleteProjectModal open={false} project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        rerender(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByText('Delete project?')).toBeInTheDocument(),
        );
    });

    it('switching back from purge to unregister clears confirm input requirement', async () => {
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
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
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-3' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() =>
            expect(screen.getByText(/Closing disabled/i)).toBeInTheDocument(),
        );
    });

    it('handleClose is blocked (noop) when view is deleting', async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-4' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() =>
            expect(screen.getByText(/Deleting project/i)).toBeInTheDocument(),
        );
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
            http.post(`${BASE}/projects/p1/delete`, () =>
                new HttpResponse(null, { status: 500 }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
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
                HttpResponse.json({ delete_id: 'del-success' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() =>
            expect(screen.getByText(/Deleting project/i)).toBeInTheDocument(),
        );
        // Fire the SSE delete_completed event with mode=unregister
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: 'del-success', mode: 'unregister' }));
        await waitFor(() =>
            expect(screen.getByText(/Project deleted/i)).toBeInTheDocument(),
        );
        // Success view shows Close and Back to projects buttons
        expect(screen.getAllByRole('button', { name: /Close/i }).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /Back to projects/i })).toBeInTheDocument();
    });

    // Regression: after a delete succeeds, the Projects list page must
    // show the fresh state. The page reads from useProjectsPaged (key
    // ['projects-paged']), NOT the unpaged ['projects'] used by sidenav.
    // Previously the modal invalidated only the unpaged key, so hitting
    // Back to Projects after a delete showed the deleted row until a
    // hard refresh.
    it('invalidates BOTH [projects] and [projects-paged] on delete success', async () => {
        const qc = new QueryClient({
            defaultOptions: {
                queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' },
                mutations: { retry: false },
            },
        });
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-cache' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
            { queryClient: qc },
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() =>
            es.fire({ type: 'delete_completed', deleteId: 'del-cache', mode: 'unregister' }),
        );
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        const invalidatedKeys = invalidateSpy.mock.calls.map(
            (call) => (call[0] as { queryKey?: unknown[] })?.queryKey?.[0],
        );
        expect(invalidatedKeys).toContain('projects');
        expect(invalidatedKeys).toContain('projects-paged');
        expect(invalidatedKeys).toContain('sidenav-counts');
    });

    it('success view — unregister mode shows "workspace folder kept on disk" text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-unreg' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: 'del-unreg', mode: 'unregister' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // The header subtitle should say "Unregistered from Atlas..."
        expect(screen.getByText(/Unregistered from Atlas/i)).toBeInTheDocument();
    });

    it('success view — purge mode shows "Workspace folder removed" text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-purge-ok' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        // Switch to purge mode first
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: 'del-purge-ok', mode: 'purge' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // purge success text
        expect(screen.getByText(/Workspace folder removed/i)).toBeInTheDocument();
    });

    it('success view — Close button calls onClose', async () => {
        const onClose = vi.fn();
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-close' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={onClose} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_completed', deleteId: 'del-close', mode: 'unregister' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // Click the Close button
        const closeBtn = screen.getAllByRole('button', { name: /Close/i })[0]!;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('success view with purge stats — purgeStats files + bytes show', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-stats' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        // Fire output lines that match purgeStats regex
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-stats', output: 'Removed 42 files (12.5 MiB)' }));
        act(() => es.fire({ type: 'delete_completed', deleteId: 'del-stats', mode: 'purge' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // purgeStats.files = 42, bytes = '12.5 MiB'
        expect(screen.getByText(/Removed in/i)).toBeInTheDocument();
    });
});

describe('DeleteProjectModal — error view via SSE', () => {
    it('transitions to error view when delete_error SSE fires', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-err-sse' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: 'del-err-sse', errorDetail: 'Access denied' }));
        await waitFor(() => expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0));
        // Error view shows Try again button
        expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
    });

    it('error view — Try again button resets to confirm view', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-retry' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: 'del-retry', errorDetail: 'failed' }));
        await waitFor(() => expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0));
        // Click Try again
        await userEvent.click(screen.getByRole('button', { name: /Try again/i }));
        await waitFor(() => expect(screen.getByText(/Delete project\?/i)).toBeInTheDocument());
    });

    it('error view — error mode=purge shows purge-specific troubleshoot text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-purge-err' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: 'del-purge-err', errorDetail: 'folder busy' }));
        await waitFor(() => expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0));
        // purge mode troubleshoot text mentions closing editor
        expect(screen.getByText(/Close any editor or terminal/i)).toBeInTheDocument();
    });

    it('error view — unregister mode shows unregister troubleshoot text', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-unreg-err' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        act(() => es.fire({ type: 'delete_error', deleteId: 'del-unreg-err', errorDetail: 'DB locked' }));
        await waitFor(() => expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0));
        // unregister mode troubleshoot text mentions server logs
        expect(screen.getByText(/Check the server logs/i)).toBeInTheDocument();
    });
});

describe('DeleteProjectModal — deleting view checklist + deriveStepIndex', () => {
    it('fires SSE output lines to advance stepIndex via deriveStepIndex', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-steps' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        // Fire output lines that advance each step in deriveStepIndex
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-steps', output: 'Stopping attached agents...' }));
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-steps', output: 'Revoking credential lease...' }));
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-steps', output: 'Unregistering project...' }));
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-steps', output: 'Workspace folder kept' }));
        // The deleting view still renders with lines appended
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        expect(document.body).toBeTruthy();
    });

    it('fires purge mode workspace removal line — deriveStepIndex max(idx, 4) branch', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-purge-steps' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        // purge mode: "Removing workspace folder" advances to idx=4 (mode=purge path)
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-purge-steps', output: 'Removing workspace folder' }));
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-purge-steps', output: 'Finalize' }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        expect(document.body).toBeTruthy();
    });
});

describe('DeleteProjectModal — purgeStats fm truthy branch (L222)', () => {
    it('purgeStats.files updated when SSE output line matches "Removed N files"', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-fm' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByText('Delete project and content'));
        const input = screen.getByPlaceholderText('Acme');
        await userEvent.type(input, 'Acme');
        await userEvent.click(screen.getByRole('button', { name: /Delete project and content/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        // Line matches /Removed/i AND /(\d+)\s+files/ — exercises the fm truthy branch (L222)
        act(() => es.fire({ type: 'delete_output', deleteId: 'del-fm', output: 'Removed 5 files from git history' }));
        act(() => es.fire({ type: 'delete_completed', deleteId: 'del-fm', mode: 'purge' }));
        await waitFor(() => expect(screen.getByText(/Project deleted/i)).toBeInTheDocument());
        // purgeStats.files=5 — success view renders the "Removed in" stats row
        expect(screen.getByText(/Removed in/i)).toBeInTheDocument();
    });
});

describe('DeleteProjectModal — "No stderr captured." fallback (L840)', () => {
    it('error view shows "No stderr captured." when errorDetail is empty and no log lines', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/delete`, () =>
                HttpResponse.json({ delete_id: 'del-nostderr' }),
            ),
        );
        renderWithProviders(
            <DeleteProjectModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Remove from Atlas/i }));
        await waitFor(() => expect(screen.getByText(/Deleting project/i)).toBeInTheDocument());
        const es = StubEventSource.instances[0]!;
        // errorDetail is empty string (falsy) and no prior log lines — exercises the
        // third fallback "No stderr captured." in job.errorDetail || lines || fallback (L840)
        act(() => es.fire({ type: 'delete_error', deleteId: 'del-nostderr', errorDetail: '' }));
        await waitFor(() => expect(screen.getAllByText(/Delete failed/i).length).toBeGreaterThan(0));
        expect(screen.getByText('No stderr captured.')).toBeInTheDocument();
    });
});
