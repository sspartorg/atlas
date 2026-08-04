import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CliSessionDiffFile } from '@atlas/shared';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { server } from '../../test-setup.js';
import { DiffFilePane } from './DiffFilePane.js';

const BASE = 'http://localhost:3000/api';

const PATCH_TEXT = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '-const alpha = 1;',
    '+const beta = 2;',
].join('\n');

function file(overrides: Partial<CliSessionDiffFile> = {}): CliSessionDiffFile {
    return {
        path: 'src/foo.ts',
        old_path: null,
        status: 'modified',
        code: ' M',
        additions: 3,
        deletions: 1,
        binary: false,
        too_large: false,
        ...overrides,
    };
}

function stubPatch(body?: unknown, capture?: (url: URL) => void) {
    server.use(
        http.get(`${BASE}/cli/sessions/sess-1/diff/file`, ({ request }) => {
            if (capture) capture(new URL(request.url));
            return HttpResponse.json(
                body ?? {
                    path: 'src/foo.ts',
                    scope: 'uncommitted',
                    patch: PATCH_TEXT,
                    binary: false,
                    truncated: false,
                    byte_size: 140,
                },
            );
        }),
    );
}

function renderPane(overrides: Partial<React.ComponentProps<typeof DiffFilePane>> = {}) {
    const props: React.ComponentProps<typeof DiffFilePane> = {
        sessionId: 'sess-1',
        scope: 'uncommitted',
        file: file(),
        viewMode: 'unified',
        wrap: false,
        onBack: undefined,
        ...overrides,
    };
    renderWithProviders(<DiffFilePane {...props} />);
    return props;
}

describe('DiffFilePane', () => {
    it('renders an empty state when no file is selected', () => {
        renderPane({ file: null });
        expect(screen.getByText(/select a file to see its changes/i)).toBeInTheDocument();
    });

    it('renders the file path in the header', async () => {
        stubPatch();
        renderPane();
        expect(await screen.findByText('src/foo.ts')).toBeInTheDocument();
    });

    it('shows the rename arrow in the header for a renamed file', async () => {
        stubPatch();
        renderPane({ file: file({ status: 'renamed', old_path: 'src/old.ts' }) });
        expect(await screen.findByText('src/old.ts → src/foo.ts')).toBeInTheDocument();
    });

    it('renders diff rows once the patch loads', async () => {
        stubPatch();
        renderPane();
        expect(await screen.findByText('beta')).toBeInTheDocument();
        expect(screen.getByText('keep')).toBeInTheDocument();
    });

    it('shows an error alert when the request fails', async () => {
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1/diff/file`, () =>
                HttpResponse.json({ error: 'gone' }, { status: 409 }),
            ),
        );
        renderPane();
        expect(await screen.findByText(/could not load this diff/i)).toBeInTheDocument();
    });

    // Never fetch a binary — the server would only return a marker anyway,
    // and the request is pure waste when arrow-keying through a file list.
    it('never requests a patch for a binary file', async () => {
        let called = false;
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1/diff/file`, () => {
                called = true;
                return HttpResponse.json({});
            }),
        );
        renderPane({ file: file({ binary: true }) });
        expect(await screen.findByText(/binary file/i)).toBeInTheDocument();
        expect(called).toBe(false);
    });

    it('never requests a patch for an over-large file', async () => {
        let called = false;
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1/diff/file`, () => {
                called = true;
                return HttpResponse.json({});
            }),
        );
        renderPane({ file: file({ too_large: true }) });
        expect(await screen.findByText(/too large to diff/i)).toBeInTheDocument();
        expect(called).toBe(false);
    });

    // A 3 MB download per keystroke while browsing the list is not acceptable.
    it('gates a large diff behind a confirmation before fetching', async () => {
        let called = false;
        server.use(
            http.get(`${BASE}/cli/sessions/sess-1/diff/file`, () => {
                called = true;
                return HttpResponse.json({
                    path: 'src/foo.ts',
                    scope: 'uncommitted',
                    patch: PATCH_TEXT,
                    binary: false,
                    truncated: false,
                    byte_size: 140,
                });
            }),
        );
        renderPane({ file: file({ additions: 9_000, deletions: 1_000 }) });
        expect(await screen.findByText(/large diff — 10000 changed lines/i)).toBeInTheDocument();
        expect(called).toBe(false);

        fireEvent.click(screen.getByRole('button', { name: /show anyway/i }));
        await waitFor(() => expect(called).toBe(true));
        expect(await screen.findByText('beta')).toBeInTheDocument();
    });

    it('reports a server-truncated patch instead of rendering it', async () => {
        stubPatch({
            path: 'src/foo.ts',
            scope: 'uncommitted',
            patch: null,
            binary: false,
            truncated: true,
            byte_size: 900_000,
        });
        renderPane();
        expect(await screen.findByText(/diff truncated by the server/i)).toBeInTheDocument();
    });

    it('explains a patch with no textual changes', async () => {
        stubPatch({
            path: 'src/foo.ts',
            scope: 'uncommitted',
            patch: 'diff --git a/src/foo.ts b/src/foo.ts\nold mode 100644\nnew mode 100755\n',
            binary: false,
            truncated: false,
            byte_size: 80,
        });
        renderPane();
        expect(await screen.findByText(/no textual changes/i)).toBeInTheDocument();
    });

    it('requests context=3 by default', async () => {
        let url: URL | null = null;
        stubPatch(undefined, (u) => {
            url = u;
        });
        renderPane();
        await screen.findByText('beta');
        expect(url!.searchParams.get('context')).toBe('3');
        expect(url!.searchParams.get('scope')).toBe('uncommitted');
        expect(url!.searchParams.get('path')).toBe('src/foo.ts');
    });

    it('refetches with more context when the hunk separator is expanded', async () => {
        const seen: string[] = [];
        stubPatch(
            {
                path: 'src/foo.ts',
                scope: 'uncommitted',
                patch: [
                    'diff --git a/src/foo.ts b/src/foo.ts',
                    '--- a/src/foo.ts',
                    '+++ b/src/foo.ts',
                    '@@ -1,2 +1,2 @@',
                    '-a',
                    '+A',
                    '@@ -20,2 +20,2 @@',
                    '-b',
                    '+B',
                ].join('\n'),
                binary: false,
                truncated: false,
                byte_size: 200,
            },
            (u) => seen.push(u.searchParams.get('context') ?? ''),
        );
        renderPane();
        const sep = await screen.findByText(/17 unchanged lines/);
        fireEvent.click(sep);
        await waitFor(() => expect(seen).toContain('25'));
    });

    it('renders a back button only when onBack is provided', async () => {
        stubPatch();
        const onBack = vi.fn();
        renderPane({ onBack });
        const btn = await screen.findByRole('button', { name: /back to file list/i });
        fireEvent.click(btn);
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('omits the back button on desktop', async () => {
        stubPatch();
        renderPane();
        await screen.findByText('src/foo.ts');
        expect(screen.queryByRole('button', { name: /back to file list/i })).not.toBeInTheDocument();
    });

    it('renders split mode when asked', async () => {
        stubPatch();
        renderPane({ viewMode: 'split' });
        // Split renders context on both sides.
        await waitFor(() => expect(screen.getAllByText('keep')).toHaveLength(2));
    });
});
