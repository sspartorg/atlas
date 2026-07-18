import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { PaneChrome } from './PaneChrome.js';
import { Toast } from './Toast.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import type { ICliSession } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';
const ISO = '2026-01-01T00:00:00.000Z';

function makeSession(overrides: Record<string, unknown> = {}): ICliSession {
    return {
        id: 'sess-1',
        project_id: 'p1',
        title: 'My Session',
        status: 'active',
        cli: 'claude',
        worktree_path: null,
        worktree_branch: 'feature/branch',
        claude_session_id: null,
        model: 'claude-opus-4',
        initial_prompt: null,
        created_at: ISO,
        updated_at: ISO,
        last_active_at: ISO,
        closed_at: null,
        finalize_pr_url: null,
        item_id: null,
        ...overrides,
    } as ICliSession;
}

// Renders PaneChrome + Toast so toast text is visible.
function renderChrome(
    session: ICliSession,
    { onDetach = vi.fn(), onStopped }: { onDetach?: () => void; onStopped?: () => void } = {},
) {
    renderWithProviders(
        <>
            <PaneChrome session={session} onDetach={onDetach} {...(onStopped !== undefined ? { onStopped } : {})} />
            <Toast />
        </>,
    );
    return { onDetach, onStopped };
}

// Stub default mutation endpoints
beforeEach(() => {
    server.use(
        http.post(`${BASE}/cli/sessions/sess-1/pause`, () =>
            HttpResponse.json(makeSession({ status: 'paused' })),
        ),
        http.post(`${BASE}/cli/sessions/sess-1/resume`, () =>
            HttpResponse.json(makeSession({ status: 'active' })),
        ),
    );
});

describe('PaneChrome — renders', () => {
    it('renders without crashing', () => {
        renderChrome(makeSession());
        expect(screen.getByText('My Session')).toBeInTheDocument();
    });

    it('shows the session title', () => {
        renderChrome(makeSession({ title: 'Alpha Session' }));
        expect(screen.getByText('Alpha Session')).toBeInTheDocument();
    });

    it('shows the status dot with correct title for active session', () => {
        renderChrome(makeSession({ status: 'active' }));
        expect(document.querySelector('[title="active"]')).toBeInTheDocument();
    });

    it('shows the status dot with correct title for paused session', () => {
        renderChrome(makeSession({ status: 'paused' }));
        expect(document.querySelector('[title="paused"]')).toBeInTheDocument();
    });

    it('shows the status dot with correct title for errored session', () => {
        renderChrome(makeSession({ status: 'errored' }));
        expect(document.querySelector('[title="errored"]')).toBeInTheDocument();
    });

    it('shows the status dot with correct title for closed session', () => {
        renderChrome(makeSession({ status: 'closed' }));
        expect(document.querySelector('[title="closed"]')).toBeInTheDocument();
    });

    it('renders the kebab icon button', () => {
        renderChrome(makeSession());
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('renders correctly for copilot session', () => {
        renderChrome(makeSession({ cli: 'copilot' }));
        expect(screen.getByText('My Session')).toBeInTheDocument();
    });
});

describe('PaneChrome — kebab menu', () => {
    it('opens Menu when kebab button is clicked', async () => {
        renderChrome(makeSession());
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Open in single view');
        expect(screen.getByText('Detach pane (keep session)')).toBeInTheDocument();
    });

    it('shows Pause menu item for active session', async () => {
        renderChrome(makeSession({ status: 'active' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Pause');
    });

    it('shows Stop menu item for active session', async () => {
        renderChrome(makeSession({ status: 'active' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Stop');
    });

    it('shows Resume menu item for paused session', async () => {
        renderChrome(makeSession({ status: 'paused' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Resume');
    });

    it('does not show Pause menu item for paused session', async () => {
        renderChrome(makeSession({ status: 'paused' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Resume');
        expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    });

    it('does not show Pause/Resume/Stop for closed session', async () => {
        renderChrome(makeSession({ status: 'closed' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Open in single view');
        expect(screen.queryByText('Pause')).not.toBeInTheDocument();
        expect(screen.queryByText('Resume')).not.toBeInTheDocument();
        expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('calls onDetach when Detach pane is clicked', async () => {
        const onDetach = vi.fn();
        renderChrome(makeSession(), { onDetach });
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Detach pane (keep session)');
        fireEvent.click(screen.getByText('Detach pane (keep session)'));
        expect(onDetach).toHaveBeenCalledTimes(1);
    });

    it('clicking Pause fires the pause mutation', async () => {
        let pauseCalled = false;
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/pause`, () => {
                pauseCalled = true;
                return HttpResponse.json(makeSession({ status: 'paused' }));
            }),
        );
        renderChrome(makeSession({ status: 'active' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Pause');
        fireEvent.click(screen.getByText('Pause'));
        await waitFor(() => {
            expect(pauseCalled).toBe(true);
        });
    });

    it('clicking Resume fires the resume mutation', async () => {
        let resumeCalled = false;
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/resume`, () => {
                resumeCalled = true;
                return HttpResponse.json(makeSession({ status: 'active' }));
            }),
        );
        renderChrome(makeSession({ status: 'paused' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Resume');
        fireEvent.click(screen.getByText('Resume'));
        await waitFor(() => {
            expect(resumeCalled).toBe(true);
        });
    });

    it('clicking Stop opens the StopSessionModal', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ unstaged: [], current_branch: 'main', ahead_of_remote: 0 }),
            ),
        );
        renderChrome(makeSession({ status: 'active' }));
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Stop');
        fireEvent.click(screen.getByText('Stop'));
        // StopSessionModal title appears
        await screen.findByText(/stop session — finalize worktree/i);
    });

    it('Open in single view navigates (click does not throw)', async () => {
        renderChrome(makeSession());
        const kebabBtn = screen.getAllByRole('button')[0]!;
        fireEvent.click(kebabBtn);
        await screen.findByText('Open in single view');
        // Should not throw — navigation is a no-op in MemoryRouter
        expect(() => fireEvent.click(screen.getByText('Open in single view'))).not.toThrow();
    });
});
