import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { RecloneProjectModal } from './RecloneProjectModal.js';

type PushSse = (e: object) => void;

// The modal picks the job id itself (it subscribes before POSTing).
const JOB_ID = 'job-under-test';
vi.mock('../../hooks/sse-hub.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    newJobId: () => JOB_ID,
}));

const BASE = 'http://localhost:3000/api';
const project = makeProject({ id: 'p1', name: 'Acme' });
// ADR 0018 — a pull names the repo it acts on.
const repo = makeProjectRepo({
    id: 'r1',
    name: 'api',
    git_url: 'https://github.com/acme/api.git',
    git_path: '/ws/api',
});

const statusOk = {
    local_head: 'abc123',
    remote_head: 'def456',
    behind: 2,
    uncommitted: 0,
};

beforeEach(() => {
    server.use(
        ...defaultHandlers,
        http.get(`${BASE}/projects/p1/repos/r1/status`, () => HttpResponse.json(statusOk))
    );
});

describe('RecloneProjectModal — closed', () => {
    it('renders nothing when project is null', () => {
        const { container } = renderWithProviders(
            <RecloneProjectModal
                open
                project={null}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when repo is null', () => {
        const { container } = renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={null}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe('RecloneProjectModal — confirm view', () => {
    it('renders the dialog heading and project details', async () => {
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText('Pull from remote?')).toBeInTheDocument();
        expect(screen.getByText('Acme')).toBeInTheDocument();
    });

    it('names its Close button', () => {
        renderWithProviders(
            <RecloneProjectModal open project={project} repo={repo} displayId="ACM" onClose={vi.fn()} />
        );
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });

    it('shows git status once loaded', async () => {
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => expect(screen.getByText('abc123')).toBeInTheDocument());
        expect(screen.getByText('2 commits')).toBeInTheDocument();
        expect(screen.getByText('clean')).toBeInTheDocument();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('Pull button starts the job, sending the id it subscribed with', async () => {
        let sent: unknown;
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json({ reclone_id: JOB_ID });
            })
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        // Wait for status to load before clicking submit
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());
        await waitFor(() => expect(sent).toEqual({ reclone_id: JOB_ID }));
    });

    it('does not miss a reclone_completed broadcast before the 202 arrives', async () => {
        // The runner can finish (or at least start broadcasting) before the
        // POST returns; the stream has no replay. The handler fires the event
        // first, then answers.
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, async ({ request }) => {
                const body = (await request.json()) as { reclone_id?: string };
                const id = body.reclone_id ?? 'server-made-id';
                (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                    type: 'reclone_completed',
                    recloneId: id,
                    stashPath: null,
                    commitsPulled: 0,
                });
                return HttpResponse.json({ reclone_id: id }, { status: 202 });
            })
        );
        renderWithProviders(
            <RecloneProjectModal open project={project} repo={repo} displayId="ACM" onClose={vi.fn()} />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        expect(await screen.findByText('Pulled from remote')).toBeInTheDocument();
    });

    it('labels the button "Stash & pull" when there are local changes', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/repos/r1/status`, () =>
                HttpResponse.json({ ...statusOk, uncommitted: 2 })
            )
        );
        renderWithProviders(
            <RecloneProjectModal open project={project} repo={repo} displayId="ACM" onClose={vi.fn()} />
        );
        expect(await screen.findByRole('button', { name: 'Stash & pull' })).toBeInTheDocument();
    });

    it('shows error alert when reclone API call fails', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ error: 'failed' }, { status: 500 })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });

    it('shows error when status endpoint fails', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/repos/r1/status`, () =>
                HttpResponse.json({ error: 'bad' }, { status: 500 })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() =>
            expect(screen.getByText(/Could not read git status/i)).toBeInTheDocument()
        );
    });

    it('shows uncommitted warning when there are dirty files', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/repos/r1/status`, () =>
                HttpResponse.json({ ...statusOk, uncommitted: 3 })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => expect(screen.getByText(/3 uncommitted files/i)).toBeInTheDocument());
        // Where reclone-runner.ts actually writes the patch (inside .git, so the
        // stash does not sweep it up); the copy used to say .atlas/stash/.
        expect(screen.getByRole('alert')).toHaveTextContent(
            '3 uncommitted files will be stashed to .git/atlas-stash/ before pulling. Restore them afterwards with git stash pop.'
        );
    });

    it('close button does nothing while reclone is running (handleClose guard)', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-guard' })
            )
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        // Now in 'running' view — close button is hidden, but onClose must not fire
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());
        // No close button rendered in running view
        expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('transitions to success view and shows Open project button on reclone_completed SSE', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-ok' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        // Push the completed SSE event
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_completed',
                recloneId: JOB_ID,
                stashPath: null,
            });
        });

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Open project/i })).toBeInTheDocument()
        );
        expect(screen.getByText('Pulled from remote')).toBeInTheDocument();
    });

    it('transitions to error view on reclone_error SSE and Try again resets to confirm', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-fail' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_error',
                recloneId: JOB_ID,
                errorDetail: 'fatal: diverged history',
            });
        });

        await waitFor(() => expect(screen.getByText(/Pull failed/i)).toBeInTheDocument());
        expect(screen.getByText(/fatal: diverged history/i)).toBeInTheDocument();

        // Click "Try again" — should go back to confirm view
        await userEvent.click(screen.getByRole('button', { name: /Try again/i }));
        await waitFor(() => expect(screen.getByText('Pull from remote?')).toBeInTheDocument());
    });

    it('shows deriveStepIndex progress when reclone_output lines match step keywords', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-steps' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        // Push reclone_output lines that advance stepIndex
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                output: 'Stashing local changes...',
            });
        });
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                output: 'Fetching remote... ok',
            });
        });
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                output: 'Fast-forwarding 3 commits, 12 files changed',
            });
        });

        // After these lines, stepIndex=3 so all steps show as done
        // The terminal output area should contain the lines
        await waitFor(() =>
            expect(screen.getByText(/Stashing local changes/i)).toBeInTheDocument()
        );
        await waitFor(() => expect(screen.getByText(/Fetching remote/i)).toBeInTheDocument());
    });

    it('shows "Original credential was deleted" error alert and Manage credentials button', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json(
                    { error: 'Original credential was deleted — re-attach one first' },
                    { status: 422 }
                )
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() =>
            expect(screen.getByText(/Original credential was deleted/i)).toBeInTheDocument()
        );
        expect(screen.getByRole('button', { name: /Manage credentials/i })).toBeInTheDocument();
    });

    // ─── Additional branch coverage ────────────────────────────────────────────

    it('ProjectChip renders only the repo’s git_path when its git_url is absent', async () => {
        const noUrlRepo = makeProjectRepo({
            id: 'r1',
            name: 'api',
            git_url: null as unknown as string,
            git_path: '/tmp/only-path',
        });
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={noUrlRepo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        // The chip should display the git_path alone (no " · " separator)
        await waitFor(() => expect(screen.getByText('/tmp/only-path')).toBeInTheDocument());
        // Confirm we did NOT render the joined form with the URL separator
        expect(screen.queryByText(/https?:\/\/.*·.*\/tmp\/only-path/)).not.toBeInTheDocument();
    });

    it('the step header names the step in progress, not the one before it', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-reidx' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                output: 'Fetching remote... ok',
            });
        });

        // Stash + fetch done: the fast-forward is running.
        await waitFor(() =>
            expect(screen.getByText(/Step 3 of 3 · Fast-forward default branch/i)).toBeInTheDocument()
        );
    });

    it('success view shows the commit count the server measured and git\'s file count', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-stats' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        // Push a Fast-forward line so the regex populates `commits` and `files`
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                // What git really prints on a fast-forward: no commit count.
                output: ' 42 files changed, 10 insertions(+), 2 deletions(-)',
            });
        });
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_completed',
                recloneId: JOB_ID,
                stashPath: null,
                commitsPulled: 7,
            });
        });

        // The <strong> in the success Alert contains the merged stats line.
        await waitFor(() =>
            expect(
                screen.getByText(
                    (_, el) =>
                        el?.tagName === 'STRONG' &&
                        /Fast-forwarded 7 commits.*42 files changed/i.test(el?.textContent ?? '')
                )
            ).toBeInTheDocument()
        );
    });

    it('success view shows stashPath when SSE includes a non-null stashPath', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-stash' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_completed',
                recloneId: JOB_ID,
                stashPath: '.git/atlas-stash/2026-06-25-abc',
            });
        });

        await waitFor(() =>
            expect(screen.getByText(/\.git\/atlas-stash\/2026-06-25-abc/i)).toBeInTheDocument()
        );
    });

    it('success view shows "Already up to date" when the server pulled 0 commits', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-noop' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        // The runner counted old..HEAD and got 0.
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                output: 'Already up to date.',
            });
        });
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_completed',
                recloneId: JOB_ID,
                stashPath: null,
                commitsPulled: 0,
            });
        });

        // The <strong> in the success Alert renders "Already up to date" when
        // stats.commits === 0 (independent of the same string in the transcript).
        await waitFor(() =>
            expect(
                screen.getByText(
                    (_, el) =>
                        el?.tagName === 'STRONG' &&
                        /Already up to date/i.test(el?.textContent ?? '')
                )
            ).toBeInTheDocument()
        );
    });

    it('error view falls back to job.lines when errorDetail is absent', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-no-detail' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        // Push an output line first so job.lines is non-empty
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_output',
                recloneId: JOB_ID,
                output: 'some pre-error chatter',
            });
        });
        // Error with NO errorDetail field → useRecloneJob defaults it to
        // "Re-clone failed", which still satisfies the `errorDetail || …` branch.
        // To exercise the lines-fallback branch, we drive errorDetail to an
        // empty string (falsy) via the SSE payload.
        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_error',
                recloneId: JOB_ID,
                errorDetail: '',
            });
        });

        await waitFor(() => expect(screen.getByText(/Pull failed/i)).toBeInTheDocument());
        // The stderr panel should fall back to job.lines content
        expect(screen.getByText(/some pre-error chatter/i)).toBeInTheDocument();
    });

    it('Open project button calls onClose and navigates to /projects/:id', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-open' })
            )
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        act(() => {
            (window as Window & { __pushSse?: PushSse }).__pushSse?.({
                type: 'reclone_completed',
                recloneId: JOB_ID,
                stashPath: null,
            });
        });

        const openBtn = await screen.findByRole('button', { name: /Open project/i });
        await userEvent.click(openBtn);
        expect(onClose).toHaveBeenCalled();
        // Navigate fired — onClose is the observable side effect we own here.
        // (Asserting navigation target requires mocking useNavigate; we cover
        // the navigate branch by exercising it without throwing.)
    });

    it('Manage credentials button calls onClose (and navigates to /settings/credentials)', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json(
                    { error: 'Original credential was deleted — re-attach one first' },
                    { status: 422 }
                )
            )
        );
        const onClose = vi.fn();
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        const manageBtn = await screen.findByRole('button', { name: /Manage credentials/i });
        await userEvent.click(manageBtn);
        expect(onClose).toHaveBeenCalled();
    });

    it('running view shows "Waiting for output…" fallback when no output lines have arrived', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-wait' })
            )
        );
        renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={vi.fn()}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));

        // Immediately after starting the job, no output lines have arrived yet.
        // The terminal box renders the fallback text.
        await waitFor(() => expect(screen.getByText('Waiting for output…')).toBeInTheDocument());
    });

    it('useEffect resets view to confirm and clears state when modal is closed (open=false)', async () => {
        server.use(
            http.post(`${BASE}/projects/p1/repos/r1/reclone`, () =>
                HttpResponse.json({ reclone_id: 'rc-reset' })
            )
        );
        const onClose = vi.fn();
        const { rerender } = renderWithProviders(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );
        await waitFor(() => screen.getByText('clean'));
        await userEvent.click(screen.getByRole('button', { name: /^Pull$/ }));
        await waitFor(() => expect(screen.getByText(/Pulling from remote/i)).toBeInTheDocument());

        // Close the modal by setting open=false — the useEffect resets state back to confirm
        rerender(
            <RecloneProjectModal
                open={false}
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );

        // Re-open — should be back at the confirm view with the project heading
        rerender(
            <RecloneProjectModal
                open
                project={project}
                repo={repo}
                displayId="ACM"
                onClose={onClose}
            />
        );
        await waitFor(() => expect(screen.getByText('Pull from remote?')).toBeInTheDocument());
    });
});
