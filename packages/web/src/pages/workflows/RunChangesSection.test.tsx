import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CliSessionDiffSummaryResponse, WorkflowRunDiffResponse, WorkflowRunRepoDiff } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { server } from '../../test-setup.js';
import { DIFF_PREFS_KEY } from '../../components/diff/diffViewPrefs.js';
import { RunChangesSection } from './RunChangesSection.js';

const BASE = 'http://localhost:3000/api';

const PATCH_TEXT = [
    'diff --git a/src/done.ts b/src/done.ts',
    '--- a/src/done.ts',
    '+++ b/src/done.ts',
    '@@ -1,1 +1,1 @@',
    '-const alpha = 1;',
    '+const beta = 2;',
].join('\n');

const file = (path: string, status: 'added' | 'untracked' = 'added') => ({
    path,
    old_path: null,
    status,
    code: status === 'untracked' ? '??' : null,
    additions: 1,
    deletions: 1,
    binary: false,
    too_large: false,
});

const scope = (paths: string[], status: 'added' | 'untracked' = 'added') => ({
    files: paths.map((p) => file(p, status)),
    total_files: paths.length,
    truncated: false,
    additions: paths.length,
    deletions: paths.length,
});

const SUMMARY: CliSessionDiffSummaryResponse = {
    uncommitted: scope(['src/wip.ts'], 'untracked'),
    committed: scope(['src/done.ts']),
    current_branch: 'atlas/wf/ATL-7',
    base_ref: 'origin/main',
    base_sha: 'a'.repeat(40),
    commits_ahead_of_base: 1,
};

function repo(overrides: Partial<WorkflowRunRepoDiff> = {}): WorkflowRunRepoDiff {
    return { repo_id: 'r-core', repo_name: 'core', source: 'worktree', reason: null, summary: SUMMARY, ...overrides };
}

function stub(body: WorkflowRunDiffResponse | null, patchUrls: URL[] = []) {
    server.use(
        http.get(`${BASE}/workflow-runs/run-1/diff`, () =>
            body ? HttpResponse.json(body) : HttpResponse.json({ error: 'boom', kind: 'internal_error' }, { status: 500 })
        ),
        http.get(`${BASE}/workflow-runs/run-1/diff/file`, ({ request }) => {
            const url = new URL(request.url);
            patchUrls.push(url);
            return HttpResponse.json({
                path: url.searchParams.get('path'),
                scope: url.searchParams.get('scope'),
                patch: PATCH_TEXT,
                binary: false,
                truncated: false,
                byte_size: PATCH_TEXT.length,
            });
        })
    );
}

const runDiff = (repos: WorkflowRunRepoDiff[]): WorkflowRunDiffResponse => ({
    run_id: 'run-1',
    branch: 'atlas/wf/ATL-7',
    repos,
});

// The section fetches only once it nears the viewport. By default every
// observed element reports itself visible straight away; `holdVisibility`
// keeps it off-screen until the test calls `reveal`.
let observerCallbacks: IntersectionObserverCallback[] = [];
let autoReveal = true;
function reveal() {
    act(() => {
        for (const cb of observerCallbacks) {
            cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        }
    });
}
beforeEach(() => {
    observerCallbacks = [];
    autoReveal = true;
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            constructor(private cb: IntersectionObserverCallback) {
                observerCallbacks.push(cb);
            }
            observe() {
                if (autoReveal) this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
            }
            disconnect() {}
            unobserve() {}
            takeRecords() {
                return [];
            }
        },
    );
});

afterEach(() => {
    window.localStorage.clear();
});

describe('RunChangesSection', () => {
    it("shows the committed files of the run's checkout and lazy-loads the selected file's patch", async () => {
        const urls: URL[] = [];
        stub(runDiff([repo()]), urls);
        renderWithProviders(<RunChangesSection runId="run-1" />);

        expect(await screen.findByText(/read from the run's checkout/i)).toBeInTheDocument();
        expect(screen.getByText(/compared with origin\/main/i)).toBeInTheDocument();
        expect(await screen.findByText('beta')).toBeInTheDocument();
        expect(urls[0]?.searchParams.get('repo_id')).toBe('r-core');
        expect(urls[0]?.searchParams.get('scope')).toBe('committed');
        expect(urls[0]?.searchParams.get('path')).toBe('src/done.ts');
        // Read-only: no staging checkboxes, even on the uncommitted scope.
        fireEvent.click(screen.getByRole('tab', { name: /uncommitted \(1\)/i }));
        await waitFor(() => expect(urls.some((u) => u.searchParams.get('path') === 'src/wip.ts')).toBe(true));
        expect(screen.queryByRole('checkbox', { name: /src\/wip\.ts/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    });

    it('remembers the split/unified choice', async () => {
        stub(runDiff([repo()]));
        renderWithProviders(<RunChangesSection runId="run-1" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Unified' }));
        expect(JSON.parse(window.localStorage.getItem(DIFF_PREFS_KEY) ?? '{}').viewMode).toBe('unified');
        fireEvent.click(screen.getByRole('switch', { name: 'Wrap long lines' }));
        expect(JSON.parse(window.localStorage.getItem(DIFF_PREFS_KEY) ?? '{}').wrap).toBe(false);
    });

    it('says when it read the pushed branch after delivery', async () => {
        stub(runDiff([repo({ source: 'branch', summary: { ...SUMMARY, uncommitted: scope([]) } })]));
        renderWithProviders(<RunChangesSection runId="run-1" />);
        expect(await screen.findByText(/checkout was removed after delivery/i)).toBeInTheDocument();
    });

    it('picks between repos, and says honestly when one has nothing left to diff', async () => {
        stub(
            runDiff([
                repo(),
                repo({
                    repo_id: 'r-web',
                    repo_name: 'web',
                    source: 'unavailable',
                    summary: null,
                    reason: 'The branch atlas/wf/ATL-7 is gone from web.',
                }),
            ])
        );
        renderWithProviders(<RunChangesSection runId="run-1" />);
        const webTab = await screen.findByRole('tab', { name: 'web' });
        expect(screen.getByRole('tab', { name: 'core' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(webTab);
        expect(await screen.findByText('The branch atlas/wf/ATL-7 is gone from web.')).toBeInTheDocument();
    });

    it('explains a run with no checkout', async () => {
        stub(runDiff([]));
        renderWithProviders(<RunChangesSection runId="run-1" />);
        expect(await screen.findByText(/no repository checkout/i)).toBeInTheDocument();
    });

    it('shows a skeleton, then an error when the diff fails', async () => {
        stub(null);
        const { container } = renderWithProviders(<RunChangesSection runId="run-1" />);
        expect(container.querySelector('.MuiSkeleton-root')).not.toBeNull();
        expect(await screen.findByText(/could not load the changes/i)).toBeInTheDocument();
    });

    it('scrolls into view when opened from the Task page link', async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        stub(runDiff([]));
        renderWithProviders(<RunChangesSection runId="run-1" />, { initialEntries: ['/w/runs/run-1#changes'] });
        await waitFor(() => expect(scroll).toHaveBeenCalled());
    });

    it('does not fetch the diff until the section nears the viewport', async () => {
        autoReveal = false;
        let calls = 0;
        server.use(
            http.get(`${BASE}/workflow-runs/run-1/diff`, () => {
                calls += 1;
                return HttpResponse.json(runDiff([repo()]));
            })
        );
        renderWithProviders(<RunChangesSection runId="run-1" />);
        expect(screen.getByRole('region', { name: 'Changes' })).toBeInTheDocument();
        await new Promise((r) => setTimeout(r, 50));
        expect(calls).toBe(0);
        reveal();
        expect(await screen.findByText('src/done.ts')).toBeInTheDocument();
        expect(calls).toBe(1);
    });
});
