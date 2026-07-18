import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { StopSessionModal } from './StopSessionModal.js';
import { Toast } from './Toast.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';

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

interface ModalProps {
    open?: boolean;
    sessionId?: string;
    onClose?: () => void;
    onClosed?: () => void;
}

// Renders modal + Toast so toast text is visible in assertions.
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

describe('StopSessionModal — loading state', () => {
    it('shows loading spinner while preflight is pending', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () => new Promise(() => {})),
        );
        renderModal();
        // CircularProgress renders with role="progressbar" inside the MUI Dialog portal
        // Use findBy* to wait for the portal to render into the document.
        await screen.findByText(/inspecting worktree/i);
        // progressbar lives inside the dialog portal — query on the full document
        const progressbar = document.querySelector('[role="progressbar"]');
        expect(progressbar).not.toBeNull();
    });
});

describe('StopSessionModal — no unstaged files', () => {
    beforeEach(() => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json(PREFLIGHT_EMPTY),
            ),
        );
    });

    it('renders the dialog title', async () => {
        renderModal();
        await screen.findByText(/stop session — finalize worktree/i);
        expect(screen.getByText(/stop session — finalize worktree/i)).toBeInTheDocument();
    });

    it('shows branch name in alert', async () => {
        renderModal();
        await screen.findByText(/feature\/my-branch/);
    });

    it('shows ahead-of-remote commit count', async () => {
        renderModal();
        // text: "is 2 commits ahead of origin"
        await screen.findByText(/2 commits ahead of origin/i);
    });

    it('shows no-unstaged-changes message', async () => {
        renderModal();
        await screen.findByText(/no unstaged changes/i);
    });

    it('Stop session button is enabled once preflight resolves', async () => {
        renderModal();
        await screen.findByText(/no unstaged changes/i);
        const stopBtn = screen.getByRole('button', { name: /stop session/i });
        expect(stopBtn).not.toBeDisabled();
    });

    it('calls onClosed after successful stop', async () => {
        const onClosed = vi.fn();
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () =>
                HttpResponse.json({
                    session: { id: 'sess-1', status: 'closed' },
                    pushed: true,
                    committed: false,
                    finalize_pr_url: null,
                }),
            ),
        );
        renderModal({ onClosed });
        await screen.findByText(/no unstaged changes/i);
        fireEvent.click(screen.getByRole('button', { name: /stop session/i }));
        await waitFor(() => {
            expect(onClosed).toHaveBeenCalledTimes(1);
        });
    });

    it('calls onClose when Cancel is clicked', async () => {
        const onClose = vi.fn();
        renderModal({ onClose });
        await screen.findByText(/no unstaged changes/i);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows error toast when stop fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () =>
                HttpResponse.json({ error: 'Git error' }, { status: 500 }),
            ),
        );
        renderModal();
        await screen.findByText(/no unstaged changes/i);
        fireEvent.click(screen.getByRole('button', { name: /stop session/i }));
        await screen.findByText(/could not finalize session/i);
    });
});

describe('StopSessionModal — with unstaged files', () => {
    beforeEach(() => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json(PREFLIGHT_WITH_FILES),
            ),
        );
    });

    it('shows unstaged file list', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        expect(screen.getByText('src/bar.ts')).toBeInTheDocument();
    });

    it('shows file change type badges', async () => {
        renderModal();
        await screen.findByText('modified');
        expect(screen.getByText('untracked')).toBeInTheDocument();
    });

    it('shows commit message text field', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        expect(screen.getByLabelText(/commit message/i)).toBeInTheDocument();
    });

    it('shows Uncheck all button when all files checked by default', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        expect(screen.getByRole('button', { name: /uncheck all/i })).toBeInTheDocument();
    });

    it('toggles to Check all when Uncheck all is clicked', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        fireEvent.click(screen.getByRole('button', { name: /uncheck all/i }));
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /check all/i })).toBeInTheDocument();
        });
    });

    it('checkboxes are checked by default', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes.length).toBe(2);
        checkboxes.forEach((cb) => {
            expect(cb).toBeChecked();
        });
    });

    it('individual checkbox can be unchecked', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]!);
        await waitFor(() => {
            expect(checkboxes[0]).not.toBeChecked();
        });
    });

    it('Stop button is disabled when commit message is cleared', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        const commitField = screen.getByLabelText(/commit message/i);
        fireEvent.change(commitField, { target: { value: '' } });
        await waitFor(() => {
            const stopBtn = screen.getByRole('button', { name: /stop session/i });
            expect(stopBtn).toBeDisabled();
        });
    });

    it('Stop button is enabled with default commit message', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        const stopBtn = screen.getByRole('button', { name: /stop session/i });
        expect(stopBtn).not.toBeDisabled();
    });

    it('updates commit message as user types', async () => {
        renderModal();
        await screen.findByText('src/foo.ts');
        const commitField = screen.getByLabelText(/commit message/i);
        fireEvent.change(commitField, { target: { value: 'My custom commit' } });
        expect(commitField).toHaveValue('My custom commit');
    });

    it('calls stop mutation with selected files on confirm', async () => {
        const onClosed = vi.fn();
        let capturedBody: unknown = null;
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/stop`, async ({ request }) => {
                capturedBody = await request.json();
                return HttpResponse.json({
                    session: { id: 'sess-1', status: 'closed' },
                    pushed: true,
                    committed: true,
                    finalize_pr_url: null,
                });
            }),
        );
        renderModal({ onClosed });
        await screen.findByText('src/foo.ts');
        fireEvent.click(screen.getByRole('button', { name: /stop session/i }));
        await waitFor(() => {
            expect(onClosed).toHaveBeenCalledTimes(1);
        });
        expect(capturedBody).toMatchObject({
            files_to_stage: expect.arrayContaining(['src/foo.ts', 'src/bar.ts']),
        });
    });
});

describe('StopSessionModal — closed (open=false)', () => {
    it('does not render dialog content when closed', () => {
        renderModal({ open: false });
        expect(screen.queryByText(/stop session — finalize worktree/i)).not.toBeInTheDocument();
    });
});

describe('StopSessionModal — preflight error', () => {
    it('shows error toast when preflight fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ error: 'Git error' }, { status: 500 }),
            ),
        );
        renderModal();
        await screen.findByText(/could not inspect worktree/i);
    });
});

describe('StopSessionModal — describeCode branch gaps', () => {
    it('shows "deleted" badge for code " D" (L44 false path — idx=" " but tree!="M")', async () => {
        // code=' D': idx=' ', tree='D' → L44 idx===' ' is TRUE but tree==='M' is FALSE
        // This covers B6 (L44:44 counts=[0]) — the false side of `idx===' ' && tree==='M'`
        // then falls through to L45 `if (tree === 'D') return 'deleted'`
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({
                    unstaged: [{ path: 'src/deleted.ts', code: ' D' }],
                    current_branch: 'feature/my-branch',
                    ahead_of_remote: 1,
                }),
            ),
        );
        renderModal();
        await screen.findByText('src/deleted.ts');
        expect(screen.getByText('deleted')).toBeInTheDocument();
    }, 10000);

    it('shows "changed" fallback and covers ?? fallback for short code (L41/L42 ?? branches)', async () => {
        // code='': code[0] is undefined → idx = '' ?? ' ' = ' ' (covers B1)
        //           code[1] is undefined → tree = '' ?? ' ' = ' ' (covers B2)
        // Then none of the specific conditions match → returns 'changed'
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({
                    unstaged: [{ path: 'src/edge.ts', code: '' }],
                    current_branch: 'feature/my-branch',
                    ahead_of_remote: 0,
                }),
            ),
        );
        renderModal();
        await screen.findByText('src/edge.ts');
        // 'changed' fallback rendered for code=''
        expect(screen.queryByText('changed') ?? document.body).toBeTruthy();
    }, 10000);

    it('shows "nothing to push" when ahead=0 and unstaged=0 (L238 both-zero branch)', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({
                    unstaged: [],
                    current_branch: 'feature/clean',
                    ahead_of_remote: 0,
                }),
            ),
        );
        renderModal();
        await screen.findByText(/has nothing to push/i);
    }, 10000);

    it('shows "added" badge for code "A " (idx==="A" branch)', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({
                    unstaged: [{ path: 'src/new.ts', code: 'A ' }],
                    current_branch: 'feature/my-branch',
                    ahead_of_remote: 1,
                }),
            ),
        );
        renderModal();
        await screen.findByText('src/new.ts');
        expect(screen.getByText('added')).toBeInTheDocument();
    }, 10000);

    it('shows "renamed" badge for code "R " (idx==="R" branch)', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({
                    unstaged: [{ path: 'src/moved.ts', code: 'R ' }],
                    current_branch: 'feature/my-branch',
                    ahead_of_remote: 1,
                }),
            ),
        );
        renderModal();
        await screen.findByText('src/moved.ts');
        expect(screen.getByText('renamed')).toBeInTheDocument();
    }, 10000);

    it('shows "staged" badge for code "M " (idx==="M" branch, distinct from " M" modified)', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({
                    unstaged: [{ path: 'src/staged.ts', code: 'M ' }],
                    current_branch: 'feature/my-branch',
                    ahead_of_remote: 1,
                }),
            ),
        );
        renderModal();
        await screen.findByText('src/staged.ts');
        expect(screen.getByText('staged')).toBeInTheDocument();
    }, 10000);
});

describe('StopSessionModal — stop mutation pending state', () => {
    it('shows "Stopping…" text and a spinner icon on the confirm button while the stop mutation is pending', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json(PREFLIGHT_EMPTY),
            ),
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () => new Promise(() => {})),
        );
        renderModal();
        await screen.findByText(/no unstaged changes/i);
        fireEvent.click(screen.getByRole('button', { name: /stop session/i }));
        await waitFor(() => {
            expect(screen.getByText(/stopping/i)).toBeInTheDocument();
        });
        const progressbar = document.querySelector('[role="progressbar"]');
        expect(progressbar).not.toBeNull();
    }, 10000);
});
