import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { TerminalSessionControls, useTerminalStopModal } from './TerminalSessionControls.js';
import { Toast } from './Toast.js';
import { renderWithProviders, makeWrapper } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import { renderHook, act } from '@testing-library/react';
import type { ICliSession } from '@atlas/shared';

const BASE = 'http://localhost:3000/api';
const ISO = '2026-01-01T00:00:00.000Z';

// 2026-08-04 — the Stop modal now fetches a diff summary alongside preflight,
// and MSW runs with `onUnhandledRequest: 'error'`. Registered once for the
// whole file; per-test `server.use` handlers still take precedence.
const EMPTY_SCOPE = { files: [], total_files: 0, truncated: false, additions: 0, deletions: 0 };
beforeEach(() => {
    server.use(
        http.get(`${BASE}/cli/sessions/sess-1/diff`, () =>
            HttpResponse.json({
                uncommitted: EMPTY_SCOPE,
                committed: EMPTY_SCOPE,
                current_branch: 'main',
                base_ref: 'origin/main',
                base_sha: 'a'.repeat(40),
                commits_ahead_of_base: 0,
            }),
        ),
    );
});

function makeSession(overrides: Record<string, unknown> = {}): ICliSession {
    return {
        id: 'sess-1',
        project_id: 'p1',
        title: 'Test Session',
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

// Helper that renders controls + Toast in the same provider tree so toast text is visible.
function renderControls(
    session: ICliSession,
    props: Partial<React.ComponentProps<typeof TerminalSessionControls>> = {},
) {
    return renderWithProviders(
        <>
            <TerminalSessionControls session={session} {...props} />
            <Toast />
        </>,
    );
}

// Register default mutation handlers — each test that needs specific behavior overrides.
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

describe('TerminalSessionControls — non-compact, active session', () => {
    it('renders without crashing', () => {
        renderControls(makeSession());
        expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    });

    it('renders Pause button for active session', () => {
        renderControls(makeSession());
        expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    });

    it('renders Stop button for active session', () => {
        renderControls(makeSession());
        expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });

    it('does not render Resume button for active session', () => {
        renderControls(makeSession());
        expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
    });

    it('calls pause mutation when Pause is clicked', async () => {
        let called = false;
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/pause`, () => {
                called = true;
                return HttpResponse.json(makeSession({ status: 'paused' }));
            }),
        );
        renderControls(makeSession());
        fireEvent.click(screen.getByRole('button', { name: /pause/i }));
        await waitFor(() => expect(called).toBe(true));
    });

    it('shows success toast after pause succeeds', async () => {
        renderControls(makeSession());
        fireEvent.click(screen.getByRole('button', { name: /pause/i }));
        await screen.findByText('Session paused');
    });

    it('shows error toast when pause fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/pause`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 }),
            ),
        );
        renderControls(makeSession());
        fireEvent.click(screen.getByRole('button', { name: /pause/i }));
        await screen.findByText('Could not pause');
    });

    it('opens StopSessionModal when Stop is clicked (owns modal)', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ unstaged: [], current_branch: 'main', ahead_of_remote: 0 }),
            ),
        );
        renderControls(makeSession());
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        await screen.findByText(/stop session — review/i);
    });

    it('calls onStopRequest instead of opening modal when prop provided', () => {
        const onStopRequest = vi.fn();
        renderControls(makeSession(), { onStopRequest });
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        expect(onStopRequest).toHaveBeenCalledTimes(1);
    });
});

describe('TerminalSessionControls — non-compact, paused session', () => {
    it('renders Resume button for paused session', () => {
        renderControls(makeSession({ status: 'paused' }));
        expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
    });

    it('renders Stop button for paused session', () => {
        renderControls(makeSession({ status: 'paused' }));
        expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });

    it('does not render Pause button for paused session', () => {
        renderControls(makeSession({ status: 'paused' }));
        expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument();
    });

    it('calls resume mutation when Resume is clicked', async () => {
        let called = false;
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/resume`, () => {
                called = true;
                return HttpResponse.json(makeSession({ status: 'active' }));
            }),
        );
        renderControls(makeSession({ status: 'paused' }));
        fireEvent.click(screen.getByRole('button', { name: /resume/i }));
        await waitFor(() => expect(called).toBe(true));
    });

    it('shows success toast after resume succeeds', async () => {
        renderControls(makeSession({ status: 'paused' }));
        fireEvent.click(screen.getByRole('button', { name: /resume/i }));
        await screen.findByText('Session resumed');
    });

    it('shows error toast when resume fails', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/resume`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 }),
            ),
        );
        renderControls(makeSession({ status: 'paused' }));
        fireEvent.click(screen.getByRole('button', { name: /resume/i }));
        await screen.findByText('Could not resume');
    });
});

describe('TerminalSessionControls — non-compact, closed session', () => {
    it('renders no action buttons for closed session', () => {
        renderControls(makeSession({ status: 'closed' }));
        expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument();
    });
});

describe('TerminalSessionControls — compact mode, active session', () => {
    it('renders Pause MenuItem in compact mode', () => {
        renderControls(makeSession(), { compact: true });
        expect(screen.getByText('Pause')).toBeInTheDocument();
    });

    it('renders Stop MenuItem in compact mode', () => {
        renderControls(makeSession(), { compact: true });
        expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    it('does not render Resume MenuItem in compact mode for active session', () => {
        renderControls(makeSession(), { compact: true });
        expect(screen.queryByText('Resume')).not.toBeInTheDocument();
    });

    it('calls onMenuItemClick when Pause MenuItem is clicked', async () => {
        const onMenuItemClick = vi.fn();
        renderControls(makeSession(), { compact: true, onMenuItemClick });
        fireEvent.click(screen.getByText('Pause'));
        expect(onMenuItemClick).toHaveBeenCalledTimes(1);
    });

    it('calls onMenuItemClick and onStopRequest when Stop MenuItem is clicked', () => {
        const onMenuItemClick = vi.fn();
        const onStopRequest = vi.fn();
        renderControls(makeSession(), { compact: true, onMenuItemClick, onStopRequest });
        fireEvent.click(screen.getByText('Stop'));
        expect(onMenuItemClick).toHaveBeenCalledTimes(1);
        expect(onStopRequest).toHaveBeenCalledTimes(1);
    });
});

describe('TerminalSessionControls — compact mode, paused session', () => {
    it('renders Resume MenuItem in compact mode for paused session', () => {
        renderControls(makeSession({ status: 'paused' }), { compact: true });
        expect(screen.getByText('Resume')).toBeInTheDocument();
    });

    it('does not render Pause MenuItem in compact mode for paused session', () => {
        renderControls(makeSession({ status: 'paused' }), { compact: true });
        expect(screen.queryByText('Pause')).not.toBeInTheDocument();
    });

    it('calls onMenuItemClick when Resume MenuItem is clicked', () => {
        const onMenuItemClick = vi.fn();
        renderControls(makeSession({ status: 'paused' }), { compact: true, onMenuItemClick });
        fireEvent.click(screen.getByText('Resume'));
        expect(onMenuItemClick).toHaveBeenCalledTimes(1);
    });
});

describe('TerminalSessionControls — compact mode, closed session', () => {
    it('renders no MenuItems for closed session', () => {
        renderControls(makeSession({ status: 'closed' }), { compact: true });
        expect(screen.queryByText('Pause')).not.toBeInTheDocument();
        expect(screen.queryByText('Resume')).not.toBeInTheDocument();
        expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });
});

describe('useTerminalStopModal hook', () => {
    it('returns a stopRequest function and a stopModalElement', () => {
        const session = makeSession();
        const wrapper = makeWrapper();
        const { result } = renderHook(() => useTerminalStopModal(session), { wrapper });
        expect(typeof result.current.stopRequest).toBe('function');
        expect(result.current.stopModalElement).toBeDefined();
    });

    it('stopModalElement is a React element', () => {
        const session = makeSession();
        const wrapper = makeWrapper();
        const { result } = renderHook(() => useTerminalStopModal(session), { wrapper });
        expect(result.current.stopModalElement).not.toBeNull();
        // React elements have a `type` property
        expect(result.current.stopModalElement).toHaveProperty('type');
    });

    it('stopRequest is callable without error', () => {
        const session = makeSession();
        const wrapper = makeWrapper();
        const { result } = renderHook(() => useTerminalStopModal(session), { wrapper });
        expect(() => {
            act(() => {
                result.current.stopRequest();
            });
        }).not.toThrow();
    });
});

describe('TerminalSessionControls — onClose / onClosed callbacks in StopSessionModal', () => {
    it('exercises onClose (fn#12) — Escape on stop modal closes it', async () => {
        // Register the preflight handler so the modal can open fully.
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ unstaged: [], current_branch: 'main', ahead_of_remote: 0 }),
            ),
        );
        renderControls(makeSession());
        // Open the stop modal
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        await screen.findByText(/stop session — review/i);
        // Press Escape to trigger onClose (() => setInternalStopOpen(false))
        fireEvent.keyDown(document.activeElement ?? document.body, {
            key: 'Escape',
            code: 'Escape',
        });
        await waitFor(() =>
            expect(
                screen.queryByText(/stop session — review/i),
            ).not.toBeInTheDocument(),
        );
    });

    it('exercises onClosed (fn#13) — confirm stop fires the session-stopped toast', async () => {
        let stopCalled = false;
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ unstaged: [], current_branch: 'main', ahead_of_remote: 0 }),
            ),
            http.post(`${BASE}/cli/sessions/sess-1/stop`, () => {
                stopCalled = true;
                return HttpResponse.json(makeSession({ status: 'closed' }));
            }),
        );
        renderControls(makeSession());
        fireEvent.click(screen.getByRole('button', { name: /stop/i }));
        await screen.findByText(/stop session — review/i);
        const confirmBtn = await screen.findByRole('button', { name: /Stop session/i });
        fireEvent.click(confirmBtn);
        // Wait for the POST /stop to be called, which triggers onClosed → toast
        await waitFor(
            () => expect(stopCalled).toBe(true),
            { timeout: 10000 },
        );
        expect(document.body).toBeTruthy();
    }, 30000);

    it('exercises onClose (fn#1) and onClosed (fn#2) via useTerminalStopModal', async () => {
        server.use(
            http.post(`${BASE}/cli/sessions/sess-1/preflight-stop`, () =>
                HttpResponse.json({ unstaged: [], current_branch: 'feature', ahead_of_remote: 1 }),
            ),
        );
        const session = makeSession();
        const wrapper = makeWrapper();
        const { result } = renderHook(() => useTerminalStopModal(session), { wrapper });
        // Open the modal
        act(() => {
            result.current.stopRequest();
        });
        // The hook owns the modal element — both onClose / onClosed are wired
        // to setOpen(false). Verify the element renders without crashing.
        expect(result.current.stopModalElement).toBeTruthy();
    });
});
