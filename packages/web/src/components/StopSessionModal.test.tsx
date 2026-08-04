import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { StopSessionModal, type StopSessionResult } from './StopSessionModal.js';
import { Toast } from './Toast.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import { DIFF_PREFS_KEY } from './diff/diffViewPrefs.js';

const BASE = 'http://localhost:3000/api';

const PREFLIGHT_EMPTY = {
    unstaged: [],
    current_branch: 'feature/my-branch',
    ahead_of_remote: 2,
};

const PREFLIGHT_WITH_FILES = {
    unstaged: [
        { path: 'src/foo.ts', code: ' M' },
        { path: 'src/bar.ts', code: '??' },
    ],
    current_branch: 'feature/my-branch',
    ahead_of_remote: 1,
};

const EMPTY_SCOPE = {
    files: [],
    total_files: 0,
    truncated: false,
    additions: 0,
    deletions: 0,
};

const DIFF_EMPTY = {
    uncommitted: EMPTY_SCOPE,
    committed: EMPTY_SCOPE,
    current_branch: 'feature/my-branch',
    base_ref: 'origin/main',
    base_sha: 'a'.repeat(40),
    commits_ahead_of_base: 2,
};

const DIFF_WITH_FILES = {
    uncommitted: {
        files: [
            {
                path: 'src/foo.ts',
                old_path: null,
                status: 'modified',
                code: ' M',
                additions: 3,
                deletions: 1,
                binary: false,
                too_large: false,
            },
            {
                path: 'src/bar.ts',
                old_path: null,
                status: 'untracked',
                code: '??',
                additions: 5,
                deletions: 0,
                binary: false,
                too_large: false,
            },
        ],
        total_files: 2,
        truncated: false,
        additions: 8,
        deletions: 1,
    },
    committed: {
        files: [
            {
                path: 'src/committed.ts',
                old_path: null,
                status: 'added',
                code: null,
                additions: 10,
                deletions: 0,
                binary: false,
                too_large: false,
            },
        ],
        total_files: 1,
        truncated: false,
        additions: 10,
        deletions: 0,
    },
    current_branch: 'feature/my-branch',
    base_ref: 'origin/main',
    base_sha: 'b'.repeat(40),
    commits_ahead_of_base: 1,
};

const PATCH_FOO = {
    path: 'src/foo.ts',
    scope: 'uncommitted',
    patch:
        'diff --git a/src/foo.ts b/src/foo.ts\n' +
        '--- a/src/foo.ts\n' +
        '+++ b/src/foo.ts\n' +
        '@@ -1,3 +1,3 @@\n' +
        ' keep\n' +
        '-const alpha = 1;\n' +
        '+const beta = 2;\n',
    binary: false,
    truncated: false,
    byte_size: 140,
};

const STOP_OK = {
    session: { id: 'sess-1', status: 'closed' },
    pushed: true,
    committed: false,
    finalize_pr_url: null,
};

/**
 * MSW runs with `onUnhandledRequest: 'error'`, and the modal now fires the
 * diff summary alongside preflight, so both must always be stubbed.
 */
function stubEndpoints(
    opts: { preflight?: unknown; diff?: unknown; patch?: unknown } = {},
) {
    server.use(
        http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
            HttpResponse.json(opts.preflight ?? PREFLIGHT_EMPTY),
        ),
        http.get(`${BASE}/cli/sessions/sess-1/diff`, () =>
            HttpResponse.json(opts.diff ?? DIFF_EMPTY),
        ),
        http.get(`${BASE}/cli/sessions/sess-1/diff/file`, () =>
            HttpResponse.json(opts.patch ?? PATCH_FOO),
        ),
    );
}

function stubStop(capture?: (body: Record<string, unknown>) => void) {
    server.use(
        http.post(`${BASE}/cli/sessions/sess-1/stop`, async ({ request }) => {
            if (capture) capture((await request.json()) as Record<string, unknown>);
            return HttpResponse.json(STOP_OK);
        }),
    );
}

interface ModalProps {
    open?: boolean;
    sessionId?: string;
    onClose?: () => void;
    onClosed?: (result: StopSessionResult) => void;
}

function renderModal(overrides: ModalProps = {}) {
    const props = {
        open: true,
        sessionId: 'sess-1',
        onClose: vi.fn(),
        onClosed: vi.fn(),
        ...overrides,
    };
    renderWithProviders(
        <>
            <StopSessionModal {...props} />
            <Toast />
        </>,
    );
    return props;
}

const confirmButton = () =>
    screen.getByRole('button', { name: /^stop (session|& open pr)$/i });

// Prefs persist to localStorage, so they leak between tests without this.
beforeEach(() => {
    window.localStorage.removeItem(DIFF_PREFS_KEY);
});
afterEach(() => {
    window.localStorage.removeItem(DIFF_PREFS_KEY);
});

describe('StopSessionModal — loading state', () => {
    it('shows a spinner while preflight is pending', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () => new Promise(() => {})),
            http.get(`${BASE}/cli/sessions/sess-1/diff`, () => HttpResponse.json(DIFF_EMPTY)),
        );
        renderModal();
        await screen.findByText(/inspecting worktree/i);
        expect(document.querySelectorAll('[role="progressbar"]').length).toBeGreaterThan(0);
    });
});

describe('StopSessionModal — nothing to review', () => {
    beforeEach(() => stubEndpoints());

    it('renders the dialog title', async () => {
        renderModal();
        expect(await screen.findByText(/stop session — review/i)).toBeInTheDocument();
    });

    it('shows the branch as a chip', async () => {
        renderModal();
        expect(await screen.findByText('feature/my-branch')).toBeInTheDocument();
    });

    it('shows the ahead-of-origin commit count', async () => {
        renderModal();
        expect(await screen.findByText(/2 commits ahead of origin/i)).toBeInTheDocument();
    });

    it('explains that the branch is pushed as-is', async () => {
        renderModal();
        expect(await screen.findByText(/no changes to review/i)).toBeInTheDocument();
    });

    it('enables the confirm button once preflight resolves', async () => {
        renderModal();
        await screen.findByText(/no changes to review/i);
        await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    });

    it('calls onClose when Cancel is clicked', async () => {
        const props = renderModal();
        await screen.findByText(/no changes to review/i);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(props.onClose).toHaveBeenCalledTimes(1);
    });
});

describe('StopSessionModal — stop result', () => {
    beforeEach(() => stubEndpoints());

    it('passes the full result through to onClosed', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () =>
                HttpResponse.json({ ...STOP_OK, finalize_pr_url: 'https://gh/x/y/pull/7' }),
            ),
        );
        const props = renderModal();
        await screen.findByText(/no changes to review/i);
        fireEvent.click(confirmButton());
        await waitFor(() =>
            expect(props.onClosed).toHaveBeenCalledWith({
                pushed: true,
                committed: false,
                prUrl: 'https://gh/x/y/pull/7',
            }),
        );
    });

    it('reports a null prUrl when no PR was opened', async () => {
        stubStop();
        const props = renderModal();
        await screen.findByText(/no changes to review/i);
        fireEvent.click(confirmButton());
        await waitFor(() =>
            expect(props.onClosed).toHaveBeenCalledWith(
                expect.objectContaining({ prUrl: null }),
            ),
        );
    });

    it('shows an error toast when stop fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () =>
                HttpResponse.json({ error: 'Git error' }, { status: 500 }),
            ),
        );
        renderModal();
        await screen.findByText(/no changes to review/i);
        fireEvent.click(confirmButton());
        expect(await screen.findByText(/could not finalize session/i)).toBeInTheDocument();
    });

    it('shows "Stopping…" while the mutation is pending', async () => {
        server.use(http.post(`${BASE}/cli/sessions/sess-1/stop`, () => new Promise(() => {})));
        renderModal();
        await screen.findByText(/no changes to review/i);
        fireEvent.click(confirmButton());
        expect(await screen.findByText(/stopping…/i)).toBeInTheDocument();
    });
});

describe('StopSessionModal — reviewing changes', () => {
    beforeEach(() =>
        stubEndpoints({ preflight: PREFLIGHT_WITH_FILES, diff: DIFF_WITH_FILES }),
    );

    it('renders both scope tabs with counts', async () => {
        renderModal();
        expect(await screen.findByRole('tab', { name: /uncommitted \(2\)/i })).toBeInTheDocument();
        expect(
            await screen.findByRole('tab', { name: /committed on branch \(1\)/i }),
        ).toBeInTheDocument();
    });

    it('lists changed files with their line counts', async () => {
        renderModal();
        expect(await screen.findByText('foo.ts')).toBeInTheDocument();
        expect(await screen.findByText('bar.ts')).toBeInTheDocument();
        expect(await screen.findByText('+3')).toBeInTheDocument();
    });

    it('switches to the committed scope on tab click', async () => {
        renderModal();
        fireEvent.click(await screen.findByRole('tab', { name: /committed on branch/i }));
        expect(await screen.findByText('committed.ts')).toBeInTheDocument();
    });

    // The tokenizer splits each line into per-token spans, so assert on a
    // token rather than the whole line — a whole-line regex can never match a
    // single element here.
    it('renders diff content for the auto-selected first file', async () => {
        renderModal();
        // Wait for the lazy panel + summary query first; only then does the
        // effect pick a file and fire the patch query. Asserting on the diff
        // text directly would race that whole chain inside one timeout.
        await screen.findByText('foo.ts');
        expect(await screen.findByText('beta', {}, { timeout: 5_000 })).toBeInTheDocument();
        expect(screen.getByText('alpha')).toBeInTheDocument();
        // Split view puts the removed line on the left and the added one on
        // the right, so shared tokens render once per side.
        expect(screen.getAllByText('const')).toHaveLength(2);
    });

    it('offers a split/unified toggle', async () => {
        renderModal();
        const unified = await screen.findByRole('button', { name: /unified/i });
        fireEvent.click(unified);
        await waitFor(() => expect(unified).toHaveAttribute('aria-pressed', 'true'));
    });

    it('shows the commit message field', async () => {
        renderModal();
        expect(await screen.findByLabelText(/commit message/i)).toBeInTheDocument();
    });

    it('disables confirm when the commit message is cleared', async () => {
        renderModal();
        const field = await screen.findByLabelText(/commit message/i);
        fireEvent.change(field, { target: { value: '' } });
        await waitFor(() => expect(confirmButton()).toBeDisabled());
    });

    it('stages every unstaged path by default', async () => {
        let body: Record<string, unknown> | null = null;
        stubStop((b) => {
            body = b;
        });
        renderModal();
        await screen.findByText('foo.ts');
        fireEvent.click(confirmButton());
        await waitFor(() => expect(body).not.toBeNull());
        expect(body!['files_to_stage']).toEqual(['src/foo.ts', 'src/bar.ts']);
        expect(body!['commit_message']).toBe('Terminal session changes');
    });

    it('drops a path from files_to_stage when its checkbox is unchecked', async () => {
        let body: Record<string, unknown> | null = null;
        stubStop((b) => {
            body = b;
        });
        renderModal();
        fireEvent.click(await screen.findByRole('checkbox', { name: /stage src\/bar\.ts/i }));
        fireEvent.click(confirmButton());
        await waitFor(() => expect(body).not.toBeNull());
        expect(body!['files_to_stage']).toEqual(['src/foo.ts']);
    });

    it('hides checkboxes in the read-only committed scope', async () => {
        renderModal();
        fireEvent.click(await screen.findByRole('tab', { name: /committed on branch/i }));
        await screen.findByText('committed.ts');
        expect(
            screen.queryByRole('checkbox', { name: /stage src\/committed\.ts/i }),
        ).not.toBeInTheDocument();
    });
});

// ── The PR bypass ───────────────────────────────────────────────────────────

describe('StopSessionModal — open_pull_request', () => {
    beforeEach(() => stubEndpoints());

    it('defaults to checked, preserving the pre-toggle behaviour', async () => {
        renderModal();
        expect(
            await screen.findByRole('checkbox', { name: /open a pull request/i }),
        ).toBeChecked();
    });

    it('relabels the confirm button when unchecked', async () => {
        renderModal();
        fireEvent.click(await screen.findByRole('checkbox', { name: /open a pull request/i }));
        expect(
            await screen.findByRole('button', { name: /^stop session$/i }),
        ).toBeInTheDocument();
    });

    it('sends open_pull_request:false when unchecked', async () => {
        let body: Record<string, unknown> | null = null;
        stubStop((b) => {
            body = b;
        });
        renderModal();
        fireEvent.click(await screen.findByRole('checkbox', { name: /open a pull request/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^stop session$/i }));
        await waitFor(() => expect(body).not.toBeNull());
        expect(body!['open_pull_request']).toBe(false);
    });

    it('sends open_pull_request:true by default', async () => {
        let body: Record<string, unknown> | null = null;
        stubStop((b) => {
            body = b;
        });
        renderModal();
        await screen.findByText(/no changes to review/i);
        fireEvent.click(confirmButton());
        await waitFor(() => expect(body).not.toBeNull());
        expect(body!['open_pull_request']).toBe(true);
    });

    it('persists the choice to localStorage', async () => {
        renderModal();
        fireEvent.click(await screen.findByRole('checkbox', { name: /open a pull request/i }));
        await waitFor(() =>
            expect(window.localStorage.getItem(DIFF_PREFS_KEY)).toContain('"openPr":false'),
        );
    });

    it('restores the saved choice on a fresh mount', async () => {
        window.localStorage.setItem(
            DIFF_PREFS_KEY,
            JSON.stringify({ openPr: false, viewMode: 'split', wrap: true }),
        );
        renderModal();
        expect(
            await screen.findByRole('checkbox', { name: /open a pull request/i }),
        ).not.toBeChecked();
        expect(screen.getByRole('button', { name: /^stop session$/i })).toBeInTheDocument();
    });

    // Mirrors the server, which only opens a PR when the push shipped something.
    it('is disabled when there is nothing to push', async () => {
        stubEndpoints({
            preflight: { unstaged: [], current_branch: 'feature/x', ahead_of_remote: 0 },
        });
        renderModal();
        const box = await screen.findByRole('checkbox', { name: /open a pull request/i });
        await waitFor(() => expect(box).toBeDisabled());
        expect(box).not.toBeChecked();
    });

    it('explains that the push is not optional', async () => {
        renderModal();
        expect(await screen.findByText(/the branch is always pushed/i)).toBeInTheDocument();
    });
});

describe('StopSessionModal — degraded states', () => {
    it('renders nothing when closed', () => {
        renderModal({ open: false });
        expect(screen.queryByText(/stop session — review/i)).not.toBeInTheDocument();
    });

    it('shows an error toast when preflight fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ error: 'nope' }, { status: 500 }),
            ),
            http.get(`${BASE}/cli/sessions/sess-1/diff`, () => HttpResponse.json(DIFF_EMPTY)),
        );
        renderModal();
        expect(await screen.findByText(/could not inspect worktree/i)).toBeInTheDocument();
    });

    // A broken diff must not block the stop action — finalizing is the point
    // of the modal, reviewing is the optional part.
    it('still allows stopping when the diff request fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json(PREFLIGHT_WITH_FILES),
            ),
            http.get(`${BASE}/cli/sessions/sess-1/diff`, () =>
                HttpResponse.json({ error: 'worktree gone' }, { status: 409 }),
            ),
        );
        renderModal();
        expect(await screen.findByText(/could not load the diff/i)).toBeInTheDocument();
        expect(confirmButton()).not.toBeDisabled();
    });
});
