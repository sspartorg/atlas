import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { TerminalSession } from './TerminalSession.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';

const BASE = 'http://localhost:3000/api';

// Mock TerminalXterm since it needs xterm.js canvas
vi.mock('../components/TerminalXterm.js', () => ({
    TerminalXterm: ({ sessionId }: { sessionId: string }) => (
        <div data-testid="terminal-xterm" data-session-id={sessionId} />
    ),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'sess-1',
        project_id: 'p1',
        title: 'Live Session',
        status: 'active',
        cli: 'claude',
        worktree_path: null,
        worktree_branch: 'feature/my-branch',
        claude_session_id: 'claude-abc-123',
        model: 'claude-opus-4',
        initial_prompt: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_active_at: '2026-01-01T00:00:00.000Z',
        closed_at: null,
        finalize_pr_url: null,
        item_id: null,
        ...overrides,
    };
}

function renderSession(id: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/terminal/:id" element={<TerminalSession />} />
        </Routes>,
        { initialEntries: [`/terminal/${id}`] },
    );
}

beforeEach(() => {
    server.use(...defaultHandlers);
});

describe('TerminalSession — missing id param', () => {
    it('shows error alert when no id param (renders on root path)', () => {
        // Render without the :id route param by using a path that has no match
        renderWithProviders(<TerminalSession />, {
            initialEntries: ['/terminal'],
        });
        expect(screen.getByText(/missing session id/i)).toBeInTheDocument();
    });
});

describe('TerminalSession — loading', () => {
    it('shows loading spinner while session loads', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1`, () => new Promise(() => {})),
        );
        renderSession('sess-1');
        expect(document.querySelector('[role="progressbar"]')).toBeInTheDocument();
    });
});

describe('TerminalSession — error state', () => {
    it('shows error alert when session not found', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-bad`, () =>
                HttpResponse.json({ error: 'Not found' }, { status: 404 }),
            ),
        );
        renderSession('sess-bad');
        await screen.findByText(/session not found/i);
    });
});

describe('TerminalSession — active session', () => {
    beforeEach(() => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.post(`${BASE}/cli/sessions/sess-1/pause`, () =>
                HttpResponse.json(makeSession({ status: 'paused' })),
            ),
            http.post(`${BASE}/cli/sessions/sess-1/resume`, () =>
                HttpResponse.json(makeSession({ status: 'active' })),
            ),
        );
    });

    it('renders session title', async () => {
        renderSession('sess-1');
        await screen.findByText('Live Session');
    });

    it('renders status chip', async () => {
        renderSession('sess-1');
        await screen.findByTestId('session-status-chip');
        expect(screen.getByTestId('session-status-chip')).toHaveTextContent('active');
    });

    it('renders CLI chip', async () => {
        renderSession('sess-1');
        await screen.findByTestId('session-cli-chip');
        expect(screen.getByTestId('session-cli-chip')).toHaveTextContent('claude');
    });

    it('renders branch info', async () => {
        renderSession('sess-1');
        await screen.findByText('feature/my-branch');
    });

    it('renders model info', async () => {
        renderSession('sess-1');
        await screen.findByText('claude-opus-4');
    });

    it('renders claude session id', async () => {
        renderSession('sess-1');
        await screen.findByText('claude-abc-123');
    });

    it('renders session id as dash when no claude_session_id', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1`, () =>
                HttpResponse.json(makeSession({ claude_session_id: null })),
            ),
        );
        renderSession('sess-1');
        await screen.findByText('Live Session');
        const dashes = screen.getAllByText('—');
        expect(dashes.length).toBeGreaterThan(0);
    });

    it('renders item chip when session has item_id', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1`, () =>
                HttpResponse.json(makeSession({ item_id: 'ATL-5' })),
            ),
        );
        renderSession('sess-1');
        await screen.findByTestId('session-item-chip');
        expect(screen.getByTestId('session-item-chip')).toHaveTextContent('ATL-5');
    });

    it('renders TerminalXterm component', async () => {
        renderSession('sess-1');
        await screen.findByTestId('terminal-xterm');
    });
});

describe('TerminalSession — terminal status redirect (closed)', () => {
    it('renders null for closed session (redirect in progress)', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-closed`, () =>
                HttpResponse.json(makeSession({ id: 'sess-closed', status: 'closed' })),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/terminal/:id" element={<TerminalSession />} />
                <Route path="/terminal/:id/history" element={<div data-testid="history-page">History</div>} />
            </Routes>,
            { initialEntries: ['/terminal/sess-closed'] },
        );
        // Effect triggers redirect; history page should appear
        await screen.findByTestId('history-page');
    });
});

describe('TerminalSession — paused session', () => {
    it('renders for paused session', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1`, () =>
                HttpResponse.json(makeSession({ status: 'paused' })),
            ),
            http.post(`${BASE}/cli/sessions/sess-1/resume`, () =>
                HttpResponse.json(makeSession({ status: 'active' })),
            ),
        );
        renderSession('sess-1');
        await screen.findByText('Live Session');
        expect(screen.getByTestId('session-status-chip')).toHaveTextContent('paused');
    });
});
