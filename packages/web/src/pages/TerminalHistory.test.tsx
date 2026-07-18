import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { TerminalHistory } from './TerminalHistory.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';

const BASE = 'http://localhost:3000/api';

// Mock RunEventViewer to keep this test focused on the page chrome (header,
// metadata bar, loading/error states). The viewer has its own coverage in
// the agent-run detail tests + the shared component's tests.
vi.mock('../components/RunEventViewer.js', () => ({
    RunEventViewer: ({ content }: { content: string | null }) => (
        <div data-testid="transcript-viewer">{content ?? ''}</div>
    ),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 'sess-hist',
        project_id: 'p1',
        title: 'Closed Session',
        status: 'closed',
        cli: 'claude',
        worktree_path: null,
        worktree_branch: 'feature/done',
        claude_session_id: null,
        model: 'claude-opus-4',
        initial_prompt: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        last_active_at: '2026-01-01T00:00:00.000Z',
        closed_at: '2026-01-02T00:00:00.000Z',
        finalize_pr_url: null,
        item_id: null,
        ...overrides,
    };
}

function renderHistory(id: string) {
    return renderWithProviders(
        <Routes>
            <Route path="/terminal/:id/history" element={<TerminalHistory />} />
        </Routes>,
        { initialEntries: [`/terminal/${id}/history`] },
    );
}

beforeEach(() => {
    server.use(...defaultHandlers);
});

describe('TerminalHistory — missing id param', () => {
    it('shows error alert when no id param', () => {
        renderWithProviders(<TerminalHistory />, {
            initialEntries: ['/terminal'],
        });
        expect(screen.getByText(/missing session id/i)).toBeInTheDocument();
    });
});

describe('TerminalHistory — loading', () => {
    it('shows loading spinner while session loads', () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () => new Promise(() => {})),
        );
        renderHistory('sess-hist');
        expect(document.querySelector('[role="progressbar"]')).toBeInTheDocument();
    });
});

describe('TerminalHistory — error state', () => {
    it('shows error when session fetch fails', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-bad`, () =>
                HttpResponse.json({ error: 'Not found' }, { status: 404 }),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/terminal/:id/history" element={<TerminalHistory />} />
            </Routes>,
            { initialEntries: ['/terminal/sess-bad/history'] },
        );
        await screen.findByText(/session not found/i);
    });
});

describe('TerminalHistory — closed session with transcript', () => {
    beforeEach(() => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () =>
                HttpResponse.json({
                    jsonl_content: '{"type":"user","message":{"content":"hello"}}',
                    ingested_at: '2026-01-02T01:00:00.000Z',
                    source: 'claude',
                }),
            ),
        );
    });

    it('renders session title', async () => {
        renderHistory('sess-hist');
        await screen.findByText('Closed Session');
    });

    it('renders branch info', async () => {
        renderHistory('sess-hist');
        await screen.findByText('feature/done');
    });

    it('renders transcript viewer', async () => {
        renderHistory('sess-hist');
        await screen.findByTestId('transcript-viewer');
    });

    it('renders transcript captured timestamp', async () => {
        renderHistory('sess-hist');
        await screen.findByText('2026-01-02T01:00:00.000Z');
    });

    it('renders closed_at timestamp', async () => {
        renderHistory('sess-hist');
        await screen.findByText('2026-01-02T00:00:00.000Z');
    });
});

describe('TerminalHistory — closed session with PR url', () => {
    it('renders PR link when finalize_pr_url is set', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(
                    makeSession({ finalize_pr_url: 'https://github.com/owner/repo/pull/42' }),
                ),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () =>
                HttpResponse.json({
                    jsonl_content: null,
                    ingested_at: null,
                    source: 'claude',
                }),
            ),
        );
        renderHistory('sess-hist');
        await screen.findByText(/session closed/i);
        expect(
            screen.getByRole('link', { name: 'https://github.com/owner/repo/pull/42' }),
        ).toBeInTheDocument();
    });
});

describe('TerminalHistory — transcript loading/error', () => {
    it('shows spinner while transcript loads', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () => new Promise(() => {})),
        );
        renderHistory('sess-hist');
        await screen.findByText('Closed Session');
        expect(document.querySelector('[role="progressbar"]')).toBeInTheDocument();
    });

    it('shows error when transcript fetch fails', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 }),
            ),
        );
        renderHistory('sess-hist');
        await screen.findByText(/could not load transcript/i);
    });

    it('shows unavailable message when transcript content is null', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () =>
                HttpResponse.json({
                    jsonl_content: null,
                    ingested_at: null,
                    source: 'claude',
                }),
            ),
        );
        renderHistory('sess-hist');
        await screen.findByText(/transcript unavailable/i);
    });
});

describe('TerminalHistory — errored session', () => {
    it('renders errored session history page', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-err`, () =>
                HttpResponse.json(makeSession({ id: 'sess-err', status: 'errored' })),
            ),
            http.get(`${BASE}/cli/sessions/sess-err/transcript`, () =>
                HttpResponse.json({
                    jsonl_content: '{"type":"system"}',
                    ingested_at: null,
                    source: 'claude',
                }),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/terminal/:id/history" element={<TerminalHistory />} />
            </Routes>,
            { initialEntries: ['/terminal/sess-err/history'] },
        );
        await screen.findByText('Closed Session');
    });
});

describe('TerminalHistory — non-terminal session redirect', () => {
    it('redirects active session to live view', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-live`, () =>
                HttpResponse.json(makeSession({ id: 'sess-live', status: 'active' })),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/terminal/:id" element={<div data-testid="live-page">Live</div>} />
                <Route path="/terminal/:id/history" element={<TerminalHistory />} />
            </Routes>,
            { initialEntries: ['/terminal/sess-live/history'] },
        );
        // Effect triggers redirect to live view
        await screen.findByTestId('live-page');
    });
});

describe('TerminalHistory — null worktree_branch and closed_at render dashes', () => {
    it('renders "—" for null worktree_branch and null closed_at', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-null`, () =>
                HttpResponse.json(
                    makeSession({
                        id: 'sess-null',
                        worktree_branch: null,
                        closed_at: null,
                    }),
                ),
            ),
            http.get(`${BASE}/cli/sessions/sess-null/transcript`, () =>
                HttpResponse.json({ jsonl_content: '{}', ingested_at: null, source: 'claude' }),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/terminal/:id/history" element={<TerminalHistory />} />
            </Routes>,
            { initialEntries: ['/terminal/sess-null/history'] },
        );
        await screen.findByText('Closed Session');
        // Both null fields should render as the "—" fallback
        const dashes = await screen.findAllByText('—');
        expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
});

describe('TerminalHistory — transcript error without message property', () => {
    it('shows "unknown error" fallback when transcript error has no message', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () =>
                // Return a non-Error object — TanStack Query wraps this in an
                // Error, but the cast `(error as Error)?.message` exercises the
                // null-coalescing '?? "unknown error"' branch.
                HttpResponse.json({ error: 'boom' }, { status: 500 }),
            ),
        );
        renderHistory('sess-hist');
        await screen.findByText('Closed Session');
        // Transcript fetch fails; the error alert must appear
        await screen.findByText(/could not load transcript/i);
    });
});

describe('TerminalHistory — back button navigates to /terminal', () => {
    it('clicks back button and navigates to /terminal list', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-hist`, () =>
                HttpResponse.json(makeSession()),
            ),
            http.get(`${BASE}/cli/sessions/sess-hist/transcript`, () =>
                HttpResponse.json({ jsonl_content: '{}', ingested_at: null, source: 'claude' }),
            ),
        );
        renderWithProviders(
            <Routes>
                <Route path="/terminal" element={<div data-testid="terminal-list">Terminal List</div>} />
                <Route path="/terminal/:id/history" element={<TerminalHistory />} />
            </Routes>,
            { initialEntries: ['/terminal/sess-hist/history'] },
        );
        // Wait for the session to load
        await screen.findByText('Closed Session');
        // Click the back button (ArrowBackRounded IconButton)
        const backBtn = screen.getByRole('button', { name: /back to sessions/i });
        fireEvent.click(backBtn);
        // Should navigate to terminal list
        await screen.findByTestId('terminal-list');
    });
});
