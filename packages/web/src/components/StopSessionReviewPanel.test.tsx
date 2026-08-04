import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CliSessionDiffSummaryResponse } from '@atlas/shared';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { server } from '../test-setup.js';
import { StopSessionReviewPanel } from './StopSessionReviewPanel.js';

const BASE = 'http://localhost:3000/api';

const PATCH_TEXT = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,2 +1,2 @@',
    '-const alpha = 1;',
    '+const beta = 2;',
].join('\n');

const SUMMARY: CliSessionDiffSummaryResponse = {
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
                path: 'src/done.ts',
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
    current_branch: 'feature/x',
    base_ref: 'origin/main',
    base_sha: 'a'.repeat(40),
    commits_ahead_of_base: 2,
};

function stubPatch() {
    server.use(
        http.get(`${BASE}/cli/sessions/sess-1/diff/file`, ({ request }) => {
            const path = new URL(request.url).searchParams.get('path') ?? '';
            return HttpResponse.json({
                path,
                scope: 'uncommitted',
                patch: PATCH_TEXT,
                binary: false,
                truncated: false,
                byte_size: 120,
            });
        }),
    );
}

function renderPanel(
    overrides: Partial<React.ComponentProps<typeof StopSessionReviewPanel>> = {},
) {
    const props: React.ComponentProps<typeof StopSessionReviewPanel> = {
        sessionId: 'sess-1',
        summary: SUMMARY,
        isLoading: false,
        error: null,
        scope: 'uncommitted',
        onScopeChange: vi.fn(),
        selected: { 'src/foo.ts': true, 'src/bar.ts': true },
        onToggle: vi.fn(),
        onToggleAll: vi.fn(),
        viewMode: 'unified',
        onViewModeChange: vi.fn(),
        wrap: false,
        onWrapChange: vi.fn(),
        ...overrides,
    };
    renderWithProviders(<StopSessionReviewPanel {...props} />);
    return props;
}

describe('StopSessionReviewPanel', () => {
    it('renders a skeleton while the summary loads', () => {
        renderPanel({ summary: undefined, isLoading: true });
        expect(document.querySelectorAll('.MuiSkeleton-root').length).toBeGreaterThan(0);
    });

    it('renders an error alert when the summary failed', () => {
        renderPanel({ summary: undefined, error: new Error('worktree gone') });
        expect(screen.getByText(/could not load the diff/i)).toBeInTheDocument();
        expect(screen.getByText(/you can still stop the session/i)).toBeInTheDocument();
    });

    it('renders both tabs with their counts', () => {
        stubPatch();
        renderPanel();
        expect(screen.getByRole('tab', { name: /uncommitted \(2\)/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /committed on branch \(1\)/i })).toBeInTheDocument();
    });

    it('fires onScopeChange when the other tab is clicked', () => {
        stubPatch();
        const props = renderPanel();
        fireEvent.click(screen.getByRole('tab', { name: /committed on branch/i }));
        expect(props.onScopeChange).toHaveBeenCalledWith('committed');
    });

    // `+10` shows twice — once in the toolbar total, once on the file row.
    // The point of the assertion is that the OTHER scope's total (+8) is absent.
    it('shows the stats for the ACTIVE scope only', () => {
        stubPatch();
        renderPanel({ scope: 'committed' });
        expect(screen.getAllByText('+10').length).toBeGreaterThan(0);
        expect(screen.queryByText('+8')).not.toBeInTheDocument();
    });

    it('lists the files of the active scope', () => {
        stubPatch();
        renderPanel();
        expect(screen.getByText('foo.ts')).toBeInTheDocument();
        expect(screen.getByText('bar.ts')).toBeInTheDocument();
        expect(screen.queryByText('done.ts')).not.toBeInTheDocument();
    });

    it('shows checkboxes only in the uncommitted scope', () => {
        stubPatch();
        renderPanel();
        expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    });

    it('hides checkboxes in the read-only committed scope', () => {
        stubPatch();
        renderPanel({ scope: 'committed' });
        expect(
            screen.queryByRole('checkbox', { name: /stage src\/done\.ts/i }),
        ).not.toBeInTheDocument();
    });

    // Auto-selecting keeps the right pane from opening empty.
    it('auto-selects the first file and loads its diff', async () => {
        stubPatch();
        renderPanel();
        expect(await screen.findByText('beta')).toBeInTheDocument();
    });

    it('switches the pane when another file is clicked', async () => {
        stubPatch();
        renderPanel();
        await screen.findByText('beta');
        fireEvent.click(screen.getByText('bar.ts'));
        await waitFor(() => expect(screen.getByText('src/bar.ts')).toBeInTheDocument());
    });

    it('forwards toolbar changes', () => {
        stubPatch();
        const props = renderPanel();
        fireEvent.click(screen.getByRole('button', { name: /split/i }));
        expect(props.onViewModeChange).toHaveBeenCalledWith('split');
        fireEvent.click(screen.getByLabelText('Wrap long lines'));
        expect(props.onWrapChange).toHaveBeenCalledWith(true);
    });

    it('forwards checkbox toggles', () => {
        stubPatch();
        const props = renderPanel();
        fireEvent.click(screen.getByRole('checkbox', { name: /stage src\/bar\.ts/i }));
        expect(props.onToggle).toHaveBeenCalledWith('src/bar.ts', false);
    });

    // Narrow viewport is master/detail: no auto-select (the list must stay
    // visible until you tap a file), split is force-rendered as unified, and
    // the pane gets a back button.
    describe('narrow viewport', () => {
        function matchNarrow() {
            vi.spyOn(window, 'matchMedia').mockImplementation(
                (query: string) =>
                    ({
                        matches: true,
                        media: query,
                        onchange: null,
                        addListener: vi.fn(),
                        removeListener: vi.fn(),
                        addEventListener: vi.fn(),
                        removeEventListener: vi.fn(),
                        dispatchEvent: vi.fn(),
                    }) as unknown as MediaQueryList,
            );
        }

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('does not auto-select a file', () => {
            matchNarrow();
            stubPatch();
            renderPanel();
            expect(screen.getByText(/select a file to see its changes/i)).toBeInTheDocument();
        });

        it('disables the split toggle', () => {
            matchNarrow();
            stubPatch();
            renderPanel();
            expect(screen.getByRole('button', { name: /split/i })).toBeDisabled();
        });

        it('shows the file list and a back button once a file is tapped', async () => {
            matchNarrow();
            stubPatch();
            renderPanel();
            fireEvent.click(screen.getByText('foo.ts'));
            expect(
                await screen.findByRole('button', { name: /back to file list/i }),
            ).toBeInTheDocument();
        });
    });

    it('handles a scope with no files', () => {
        const empty = {
            ...SUMMARY,
            uncommitted: { files: [], total_files: 0, truncated: false, additions: 0, deletions: 0 },
        };
        renderPanel({ summary: empty });
        expect(screen.getByText(/no changes in this view/i)).toBeInTheDocument();
        expect(screen.getByText(/select a file to see its changes/i)).toBeInTheDocument();
    });
});
