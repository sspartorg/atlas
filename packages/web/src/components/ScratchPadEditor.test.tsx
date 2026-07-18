import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IScratchPad } from '@atlas/shared';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
// formatSavedAgo is internal; we test it via observable output in the component
import { ScratchPadEditor, inferTitle } from './ScratchPadEditor.js';

const BASE = 'http://localhost:3000/api';

function makeTile(overrides: Partial<IScratchPad> = {}): IScratchPad {
    return {
        id: 'tile-1',
        title: '',
        body_md: '',
        created_at: new Date('2026-05-30T12:00:00Z').toISOString(),
        updated_at: new Date('2026-05-30T12:00:00Z').toISOString(),
        ...overrides,
    };
}

describe('inferTitle (web)', () => {
    it('returns the title verbatim when non-blank', () => {
        expect(inferTitle('Meeting', 'whatever')).toBe('Meeting');
    });

    it('falls back to the first 3 words of the body when title is blank', () => {
        expect(inferTitle('', 'one two three four five')).toBe('one two three');
    });

    it('treats whitespace-only title as blank', () => {
        expect(inferTitle('   ', 'fix the bug today')).toBe('fix the bug');
    });

    it('returns "Untitled" when title and body are both blank', () => {
        expect(inferTitle('', '')).toBe('Untitled');
        expect(inferTitle('  ', '   ')).toBe('Untitled');
    });

    it('handles fewer than 3 words gracefully', () => {
        expect(inferTitle('', 'solo')).toBe('solo');
    });
});

describe('ScratchPadEditor — plain Google-Keep surface', () => {
    it('does NOT render Edit / Split / Preview chips or a MarkdownPreview surface', () => {
        renderWithProviders(
            <ScratchPadEditor open onClose={vi.fn()} tile={makeTile({ body_md: '# heading' })} />,
        );
        // Chips
        expect(screen.queryByText('Edit')).not.toBeInTheDocument();
        expect(screen.queryByText('Split')).not.toBeInTheDocument();
        expect(screen.queryByText('Preview')).not.toBeInTheDocument();
        // MarkdownPreview emits this placeholder for blank source — proves
        // we no longer mount it even for non-blank body.
        expect(screen.queryByText(/Empty document/i)).not.toBeInTheDocument();
    });

    it('renders the body inside a single editable textarea', () => {
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ title: 'Hello', body_md: 'world' })}
            />,
        );
        const textareas = screen.getAllByRole('textbox');
        // One textbox for the title input + one for the body textarea.
        expect(textareas).toHaveLength(2);
        // The body textarea is the actual <textarea>; placeholder is the
        // Google-Keep-style prompt.
        const body = screen.getByPlaceholderText('Take a note...');
        expect(body.tagName).toBe('TEXTAREA');
        expect((body as HTMLTextAreaElement).value).toBe('world');
    });

    it('infers the title from the first 3 words of the body when closing with a blank title', async () => {
        const user = userEvent.setup({ delay: null });
        const onClose = vi.fn();
        const patches: Array<{ id: string; body: { title?: string; body_md?: string } }> = [];

        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request, params }) => {
                const body = (await request.json()) as { title?: string; body_md?: string };
                patches.push({ id: params['id'] as string, body });
                return HttpResponse.json(
                    makeTile({
                        id: params['id'] as string,
                        title: body.title ?? '',
                        body_md: body.body_md ?? '',
                    }),
                );
            }),
        );

        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={onClose}
                tile={makeTile({ id: 'tile-7', title: '', body_md: '' })}
            />,
        );

        const bodyArea = screen.getByPlaceholderText('Take a note...');
        await user.type(bodyArea, 'Refactor the autosave debounce path');

        const closeBtn = screen.getByRole('button', { name: /Close/i });
        await user.click(closeBtn);

        await waitFor(() => expect(patches.length).toBeGreaterThan(0));
        const last = patches[patches.length - 1]!;
        expect(last.id).toBe('tile-7');
        expect(last.body.title).toBe('Refactor the autosave');
        expect(last.body.body_md).toBe('Refactor the autosave debounce path');
        expect(onClose).toHaveBeenCalled();
    }, 15_000);

    it('infers "Untitled" when both title and body are blank on close', async () => {
        const user = userEvent.setup({ delay: null });
        const onClose = vi.fn();
        const patches: Array<{ title?: string; body_md?: string }> = [];

        // Seed local state with content, then clear it, so the close
        // diff detects a real change (otherwise the flush short-circuits
        // and skips the PATCH).
        const tile = makeTile({ id: 'tile-8', title: 'previous', body_md: 'previous' });

        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                const body = (await request.json()) as { title?: string; body_md?: string };
                patches.push(body);
                return HttpResponse.json(
                    makeTile({
                        id: 'tile-8',
                        title: body.title ?? '',
                        body_md: body.body_md ?? '',
                    }),
                );
            }),
        );

        renderWithProviders(<ScratchPadEditor open onClose={onClose} tile={tile} />);

        const title = screen.getByPlaceholderText(/Title \(auto from first 3 words/);
        const bodyArea = screen.getByPlaceholderText('Take a note...');
        await user.clear(title);
        await user.clear(bodyArea);

        await user.click(screen.getByRole('button', { name: /Close/i }));

        await waitFor(() => expect(patches.length).toBeGreaterThan(0));
        const last = patches[patches.length - 1]!;
        expect(last.title).toBe('Untitled');
        expect(last.body_md).toBe('');
    }, 15_000);

    it('opens ConfirmDeleteModal when delete is clicked (matches sibling delete convention)', async () => {
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ id: 'tile-9', title: 'My note' })}
            />,
        );
        // No confirm modal visible initially.
        expect(screen.queryByText(/Delete this scratch tile\?/i)).not.toBeInTheDocument();
        // Click the delete icon.
        await userEvent.click(screen.getByRole('button', { name: /Delete tile/i }));
        // The shared ConfirmDeleteModal heading appears, with the tile's title in
        // the impact copy and a primary "Delete scratch tile" action button.
        expect(screen.getByText(/Delete this scratch tile\?/i)).toBeInTheDocument();
        expect(screen.getByText('My note')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /Delete scratch tile/i }),
        ).toBeInTheDocument();
    });

    it('issues a DELETE and closes the editor when the modal is confirmed', async () => {
        const onClose = vi.fn();
        let deleted = false;
        server.use(
            http.delete(`${BASE}/scratch-pad/:id`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            }),
        );

        renderWithProviders(
            <ScratchPadEditor open onClose={onClose} tile={makeTile({ id: 'tile-10' })} />,
        );

        await userEvent.click(screen.getByRole('button', { name: /Delete tile/i }));
        await userEvent.click(screen.getByRole('button', { name: /Delete scratch tile/i }));

        await waitFor(() => expect(deleted).toBe(true));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('Cancel in the delete modal closes the confirm dialog but keeps the editor open', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ScratchPadEditor open onClose={onClose} tile={makeTile({ id: 'tile-11' })} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /Delete tile/i }));
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
        await waitFor(() =>
            expect(screen.queryByText(/Delete this scratch tile\?/i)).not.toBeInTheDocument(),
        );
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not render a formatting toolbar', () => {
        renderWithProviders(
            <ScratchPadEditor open onClose={vi.fn()} tile={makeTile({ body_md: 'x' })} />,
        );
        // No B/I/H1/H2 style buttons; the only buttons in the dialog are
        // Delete tile + Close.
        const buttons = screen.getAllByRole('button');
        const labels = buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
        const formattingLabels = labels.filter((l) =>
            /\b(Bold|Italic|H1|H2|H3|Heading|Bullet)\b/i.test(l),
        );
        expect(formattingLabels).toHaveLength(0);
    });

    it('renders nothing when tile is null (tile=null branch)', () => {
        const { container } = renderWithProviders(
            <ScratchPadEditor open onClose={vi.fn()} tile={null} />,
        );
        // When tile is null, the dialog should still render (open=true) but
        // delete button should be disabled (disabled={!tile})
        expect(container).toBeInTheDocument();
    });

    it('closing with tile=null calls onClose without issuing a PATCH (flushAndClose !tile branch)', async () => {
        const patchSpy = vi.fn();
        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                patchSpy(await request.json());
                return HttpResponse.json(makeTile());
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(<ScratchPadEditor open onClose={onClose} tile={null} />);
        await userEvent.click(screen.getByRole('button', { name: /Close/i }));
        expect(onClose).toHaveBeenCalled();
        expect(patchSpy).not.toHaveBeenCalled();
    });

    it('body textarea fires onChange and updates local state', async () => {
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ title: 'Note', body_md: 'initial' })}
            />,
        );
        const bodyArea = screen.getByPlaceholderText('Take a note...') as HTMLTextAreaElement;
        await userEvent.clear(bodyArea);
        await userEvent.type(bodyArea, 'updated content');
        expect(bodyArea.value).toBe('updated content');
    });

    it('shows "Not saved yet" footer label on first open (savedAt=null branch)', () => {
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ title: 'Fresh', body_md: '' })}
            />,
        );
        expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    });

    it('flushAndClose: does NOT fire PATCH when content is unchanged (no-op close branch)', async () => {
        // tile has content matching local state → flushAndClose detects no diff → no PATCH
        const patchSpy = vi.fn();
        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                const body = await request.json() as Record<string, unknown>;
                patchSpy(body);
                return HttpResponse.json(makeTile({ id: 'tile-1', title: String(body['title'] ?? ''), body_md: String(body['body_md'] ?? '') }));
            }),
        );
        const onClose = vi.fn();
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={onClose}
                tile={makeTile({ id: 'tile-1', title: 'Existing', body_md: 'Content' })}
            />,
        );
        // Close immediately without making any changes
        await userEvent.click(screen.getByRole('button', { name: /Close/i }));
        expect(onClose).toHaveBeenCalled();
        // patchSpy should NOT have been called (no-op branch)
        expect(patchSpy).not.toHaveBeenCalled();
    }, 10_000);

    it('renders correctly when open=false (autosave useEffect !open early return)', () => {
        // open=false → both autosave effect and re-tick effect hit early return
        const { container } = renderWithProviders(
            <ScratchPadEditor open={false} onClose={vi.fn()} tile={makeTile()} />,
        );
        expect(container).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('does not autosave when open=true but tile=null (autosave !tile guard)', async () => {
        vi.useFakeTimers();
        const patchSpy = vi.fn();
        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                patchSpy(await request.json());
                return HttpResponse.json(makeTile());
            }),
        );
        renderWithProviders(<ScratchPadEditor open onClose={vi.fn()} tile={null} />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6_000);
        });
        expect(patchSpy).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('formatSavedAgo buckets: just now / seconds / minutes / hours', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                const body = (await request.json()) as { title?: string; body_md?: string };
                return HttpResponse.json(
                    makeTile({ id: 'tile-timing', title: body.title ?? '', body_md: body.body_md ?? '' }),
                );
            }),
        );

        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ id: 'tile-timing', title: 'Original', body_md: 'Original body' })}
            />,
        );

        const bodyArea = screen.getByPlaceholderText('Take a note...') as HTMLTextAreaElement;
        fireEvent.change(bodyArea, { target: { value: 'Changed body' } });

        // Advance past the 5s autosave delay -> savedAt = now.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });
        // Immediately after save (elapsed < 5s): "Saved just now"
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(screen.getByText('Saved just now')).toBeInTheDocument();

        // Advance to 10s elapsed since save -> "Saved · Ns ago"
        await act(async () => {
            await vi.advanceTimersByTimeAsync(9_000);
        });
        expect(screen.getByText(/Saved · \d+s ago/)).toBeInTheDocument();

        // Advance to ~2 minutes elapsed -> "Saved · Nm ago"
        await act(async () => {
            await vi.advanceTimersByTimeAsync(110_000);
        });
        expect(screen.getByText(/Saved · \d+m ago/)).toBeInTheDocument();

        // Advance to ~2 hours elapsed -> "Saved · Nh ago"
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
        });
        expect(screen.getByText(/Saved · \d+h ago/)).toBeInTheDocument();

        vi.useRealTimers();
    }, 15_000);

    it('autosave skips the PATCH when content reverts to the saved value before the timer fires', async () => {
        vi.useFakeTimers();
        const patchSpy = vi.fn();
        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                patchSpy(await request.json());
                return HttpResponse.json(makeTile());
            }),
        );
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ id: 'tile-revert', title: 'Kept', body_md: 'Kept body' })}
            />,
        );
        const bodyArea = screen.getByPlaceholderText('Take a note...') as HTMLTextAreaElement;
        fireEvent.change(bodyArea, { target: { value: 'Temporary change' } });
        fireEvent.change(bodyArea, { target: { value: 'Kept body' } });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(6_000);
        });
        expect(patchSpy).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('shows "Saving..." while the autosave PATCH is in flight (isPending branch)', async () => {
        vi.useFakeTimers();
        let resolvePatch: () => void = () => {};
        server.use(
            http.patch(`${BASE}/scratch-pad/:id`, async ({ request }) => {
                const body = (await request.json()) as { title?: string; body_md?: string };
                await new Promise<void>((resolve) => {
                    resolvePatch = resolve;
                });
                return HttpResponse.json(
                    makeTile({ id: 'tile-pending', title: body.title ?? '', body_md: body.body_md ?? '' }),
                );
            }),
        );
        renderWithProviders(
            <ScratchPadEditor
                open
                onClose={vi.fn()}
                tile={makeTile({ id: 'tile-pending', title: 'Orig', body_md: 'Orig body' })}
            />,
        );
        const bodyArea = screen.getByPlaceholderText('Take a note...') as HTMLTextAreaElement;
        fireEvent.change(bodyArea, { target: { value: 'Pending change' } });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(screen.getByText('Saving...')).toBeInTheDocument();

        resolvePatch();
        vi.useRealTimers();
    }, 15_000);
});
