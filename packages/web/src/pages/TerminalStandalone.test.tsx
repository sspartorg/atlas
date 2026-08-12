/**
 * TerminalStandalone — the standalone-terminals list page.
 *
 * The behaviours worth pinning here are the ones that distinguish this page
 * from /terminal: it must ask the server for standalone rows ONLY (the list
 * endpoint caps at 200, so client-side filtering would silently drop rows),
 * and it must show the folder + credential in place of project + branch.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ICliSession, ICredential } from '@atlas/shared';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { Toast } from '../components/Toast.js';
import { TerminalStandalone } from './TerminalStandalone.js';

const BASE = 'http://localhost:3000/api';

function makeStandaloneSession(overrides: Partial<ICliSession> = {}): ICliSession {
    return {
        id: 'sess-standalone-1',
        project_id: null,
        title: 'atlas',
        status: 'active',
        cli: 'claude',
        worktree_path: '/Users/owner/code/atlas',
        worktree_branch: null,
        credential_id: 'cred-1',
        claude_session_id: 'cli-uuid',
        model: 'claude-sonnet-4-5',
        initial_prompt: null,
        created_at: '2026-08-12T10:00:00Z',
        updated_at: '2026-08-12T10:00:00Z',
        last_active_at: new Date().toISOString(),
        closed_at: null,
        finalize_pr_url: null,
        item_id: null,
        total_cost_usd: 1.23,
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        ...overrides,
    };
}

const CREDENTIAL = {
    id: 'cred-1',
    label: 'Work PAT',
    host: 'github',
    kind: 'pat',
    scope: '',
} as unknown as ICredential;

/** Records every /cli/sessions request URL so the query string can be asserted. */
let requestedUrls: string[] = [];

function stubSessions(rows: ICliSession[]) {
    return http.get(`${BASE}/cli/sessions`, ({ request }) => {
        requestedUrls.push(request.url);
        return HttpResponse.json(rows);
    });
}

beforeEach(() => {
    requestedUrls = [];
    server.use(
        ...defaultHandlers,
        http.get(`${BASE}/credentials`, () => HttpResponse.json([CREDENTIAL])),
        http.get(`${BASE}/cli/models`, () => HttpResponse.json([])),
    );
});

describe('TerminalStandalone', () => {
    it('requests standalone rows only', async () => {
        server.use(stubSessions([makeStandaloneSession()]));
        renderWithProviders(<TerminalStandalone />);

        await waitFor(() => expect(requestedUrls.length).toBeGreaterThan(0));
        expect(requestedUrls[0]).toContain('standalone=true');
    });

    it('shows the folder path and the credential label on a card', async () => {
        server.use(stubSessions([makeStandaloneSession()]));
        renderWithProviders(<TerminalStandalone />);

        expect(await screen.findByText('atlas')).toBeInTheDocument();
        expect(screen.getByText('/Users/owner/code/atlas')).toBeInTheDocument();
        expect(screen.getByText('Work PAT')).toBeInTheDocument();
    });

    it('labels a session with no credential as using the machine git config', async () => {
        server.use(stubSessions([makeStandaloneSession({ credential_id: null })]));
        renderWithProviders(<TerminalStandalone />);

        expect(await screen.findByText('machine git config')).toBeInTheDocument();
    });

    it('renders the empty state with an Open folder CTA', async () => {
        server.use(stubSessions([]));
        renderWithProviders(<TerminalStandalone />);

        expect(await screen.findByText('No standalone terminals yet')).toBeInTheDocument();
    });

    it('opens the create dialog from the header button', async () => {
        server.use(stubSessions([makeStandaloneSession()]));
        renderWithProviders(<TerminalStandalone />);

        const [openButton] = await screen.findAllByRole('button', { name: /open folder/i });
        await userEvent.click(openButton!);

        expect(await screen.findByText('Open a standalone terminal')).toBeInTheDocument();
    });

    it('opens the create dialog from the empty-state CTA', async () => {
        server.use(stubSessions([]));
        renderWithProviders(<TerminalStandalone />);

        const buttons = await screen.findAllByRole('button', { name: /open folder/i });
        // The empty-state CTA is the second one — the header button is first.
        await userEvent.click(buttons[buttons.length - 1]!);

        expect(await screen.findByText('Open a standalone terminal')).toBeInTheDocument();
    });

    it('falls back to the raw id when the credential is no longer in the list', async () => {
        server.use(stubSessions([makeStandaloneSession({ credential_id: 'cred-deleted' })]));
        renderWithProviders(<TerminalStandalone />);

        expect(await screen.findByText('cred-deleted')).toBeInTheDocument();
    });

    it('summarises counts and spend across statuses', async () => {
        server.use(
            stubSessions([
                makeStandaloneSession({ id: 'a', status: 'active', total_cost_usd: 1 }),
                makeStandaloneSession({ id: 'b', status: 'paused', total_cost_usd: 2 }),
                // Null spend must contribute 0, not NaN.
                makeStandaloneSession({ id: 'c', status: 'closed', total_cost_usd: null }),
            ]),
        );
        renderWithProviders(<TerminalStandalone />);

        expect(
            await screen.findByText(/3 sessions · 1 active · 1 paused/),
        ).toBeInTheDocument();
        // 1 + 2 + 0 — a NaN here would mean the null branch was skipped.
        expect(screen.getByText(/\$3\.00 spent/)).toBeInTheDocument();
    });

    it('renders each relative-time bucket and omits spend when it is null', async () => {
        const minutesAgo = (n: number) =>
            new Date(Date.now() - n * 60_000).toISOString();
        server.use(
            stubSessions([
                makeStandaloneSession({ id: 'a', title: 'mins', last_active_at: minutesAgo(5) }),
                makeStandaloneSession({ id: 'b', title: 'hours', last_active_at: minutesAgo(120) }),
                makeStandaloneSession({ id: 'c', title: 'days', last_active_at: minutesAgo(60 * 24 * 3) }),
                // A future timestamp yields '' rather than a negative age.
                makeStandaloneSession({
                    id: 'd',
                    title: 'future',
                    last_active_at: new Date(Date.now() + 60_000).toISOString(),
                    total_cost_usd: null,
                }),
            ]),
        );
        renderWithProviders(<TerminalStandalone />);

        expect(await screen.findByText('last active 5m ago')).toBeInTheDocument();
        expect(screen.getByText('last active 2h ago')).toBeInTheDocument();
        expect(screen.getByText('last active 3d ago')).toBeInTheDocument();
        expect(screen.getByText('last active')).toBeInTheDocument();
    });

    it('shows a placeholder when the session carries no folder path', async () => {
        server.use(stubSessions([makeStandaloneSession({ worktree_path: null })]));
        renderWithProviders(<TerminalStandalone />);

        // Title still renders; the folder line is simply empty rather than 'null'.
        expect(await screen.findByText('atlas')).toBeInTheDocument();
        expect(screen.queryByText('null')).not.toBeInTheDocument();
    });

    it('navigates to the new session and toasts after the dialog creates one', async () => {
        server.use(
            stubSessions([]),
            http.get(`${BASE}/fs/stat`, ({ request }) => {
                const path = new URL(request.url).searchParams.get('path') ?? '';
                return HttpResponse.json({ path, exists: true, is_directory: true });
            }),
            http.post(`${BASE}/cli/sessions/standalone`, () =>
                HttpResponse.json({ id: 'sess-new', title: 'atlas' }, { status: 201 }),
            ),
        );
        renderWithProviders(
            <>
                <TerminalStandalone />
                <Toast />
            </>,
            { initialEntries: ['/terminal/standalone'] },
        );

        const buttons = await screen.findAllByRole('button', { name: /open folder/i });
        await userEvent.click(buttons[0]!);
        await userEvent.type(
            await screen.findByPlaceholderText('Pick any folder on this machine'),
            '/tmp/x',
        );
        await userEvent.click(screen.getByRole('button', { name: /open terminal/i }));

        expect(await screen.findByText(/Terminal "atlas" opened/)).toBeInTheDocument();
    });
});
