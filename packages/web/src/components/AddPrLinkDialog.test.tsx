import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test-setup.js';
import { defaultHandlers } from '../test-utils/mock-handlers.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { AddPrLinkDialog } from './AddPrLinkDialog.js';

describe('AddPrLinkDialog', () => {
    it('does not render its body when open=false', () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <AddPrLinkDialog
                open={false}
                onClose={vi.fn()}
                issueType="story"
                issueId="S1"
            />,
        );
        expect(screen.queryByLabelText('GitHub PR URL')).not.toBeInTheDocument();
    });

    it('shows the URL field and Add/Cancel buttons when open', () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <AddPrLinkDialog
                open
                onClose={vi.fn()}
                issueType="story"
                issueId="S1"
            />,
        );
        expect(screen.getByLabelText('GitHub PR URL')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add link/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    });

    it('rejects a non-GitHub-PR URL with an inline error and does NOT hit the API', () => {
        const calls: string[] = [];
        server.use(
            ...defaultHandlers,
            http.post('http://localhost:3000/api/issues/story/S1/external-links', () => {
                calls.push('hit');
                return HttpResponse.json({ id: 1 });
            }),
        );
        renderWithProviders(
            <AddPrLinkDialog
                open
                onClose={vi.fn()}
                issueType="story"
                issueId="S1"
            />,
        );
        const input = screen.getByLabelText('GitHub PR URL');
        fireEvent.change(input, { target: { value: 'https://gitlab.com/foo/bar/-/merge_requests/1' } });
        fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
        expect(screen.getByText(/GitHub PR URL/i)).toBeInTheDocument();
        expect(calls).toEqual([]);
    });

    it('submits a valid URL, calls onClose on success', async () => {
        const onClose = vi.fn();
        let body: { url?: string; link_kind?: string } = {};
        server.use(
            ...defaultHandlers,
            http.post('http://localhost:3000/api/issues/story/S1/external-links', async ({ request }) => {
                body = (await request.json()) as typeof body;
                return HttpResponse.json({
                    id: 7,
                    item_id: 'S1',
                    link_kind: 'pull_request',
                    url: body.url ?? '',
                    title: null,
                    external_ref: '42',
                    created_at: '2026-06-30T00:00:00Z',
                    created_by_run_id: null,
                });
            }),
        );
        renderWithProviders(
            <AddPrLinkDialog open onClose={onClose} issueType="story" issueId="S1" />,
        );
        fireEvent.change(screen.getByLabelText('GitHub PR URL'), {
            target: { value: 'https://github.com/foo/bar/pull/42' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body.url).toBe('https://github.com/foo/bar/pull/42');
        expect(body.link_kind).toBe('pull_request');
    });

    it('Enter key in the URL field also submits', async () => {
        const onClose = vi.fn();
        server.use(
            ...defaultHandlers,
            http.post('http://localhost:3000/api/issues/story/S1/external-links', () =>
                HttpResponse.json({
                    id: 9,
                    item_id: 'S1',
                    link_kind: 'pull_request',
                    url: 'https://github.com/foo/bar/pull/9',
                    title: null,
                    external_ref: '9',
                    created_at: '2026-06-30T00:00:00Z',
                    created_by_run_id: null,
                }),
            ),
        );
        renderWithProviders(
            <AddPrLinkDialog open onClose={onClose} issueType="story" issueId="S1" />,
        );
        const input = screen.getByLabelText('GitHub PR URL');
        fireEvent.change(input, { target: { value: 'https://github.com/foo/bar/pull/9' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('Cancel calls onClose without hitting the API', () => {
        const onClose = vi.fn();
        const calls: string[] = [];
        server.use(
            ...defaultHandlers,
            http.post('http://localhost:3000/api/issues/story/S1/external-links', () => {
                calls.push('hit');
                return HttpResponse.json({});
            }),
        );
        renderWithProviders(
            <AddPrLinkDialog open onClose={onClose} issueType="story" issueId="S1" />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
        expect(onClose).toHaveBeenCalled();
        expect(calls).toEqual([]);
    });

    it('error is cleared when the URL input changes after a validation error', () => {
        server.use(...defaultHandlers);
        renderWithProviders(
            <AddPrLinkDialog open onClose={vi.fn()} issueType="story" issueId="S1" />,
        );
        const input = screen.getByLabelText('GitHub PR URL');
        // Trigger a validation error first
        fireEvent.change(input, { target: { value: 'not-a-valid-url' } });
        fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
        expect(screen.getByText(/GitHub PR URL/i)).toBeInTheDocument();
        // Now change the input — error should clear
        fireEvent.change(input, { target: { value: 'https://github.com/owner/repo/pull/1' } });
        // Error text should be gone (helper text reverts to ' ')
        expect(screen.queryByText(/Enter a GitHub PR URL/i)).not.toBeInTheDocument();
    });

    it('API error from the server is shown inline', async () => {
        server.use(
            ...defaultHandlers,
            http.post('http://localhost:3000/api/issues/story/S1/external-links', () =>
                HttpResponse.json({ message: 'Duplicate PR link' }, { status: 422 }),
            ),
        );
        renderWithProviders(
            <AddPrLinkDialog open onClose={vi.fn()} issueType="story" issueId="S1" />,
        );
        fireEvent.change(screen.getByLabelText('GitHub PR URL'), {
            target: { value: 'https://github.com/foo/bar/pull/42' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
        await waitFor(() =>
            expect(screen.getByText(/422/i)).toBeInTheDocument(),
        );
    });

    it('X button calls onClose', () => {
        const onClose = vi.fn();
        server.use(...defaultHandlers);
        renderWithProviders(
            <AddPrLinkDialog open onClose={onClose} issueType="story" issueId="S1" />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Close add PR link dialog/i }));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows "Adding…" and disables the Add button while mutation is in-flight (isPending branch)', async () => {
        // Use a delayed response to inspect isPending state
        let resolveRequest!: () => void;
        const requestStarted = new Promise<void>((r) => { resolveRequest = r; });
        server.use(
            ...defaultHandlers,
            http.post('http://localhost:3000/api/issues/story/S1/external-links', async () => {
                resolveRequest();
                // Never resolve — keeps isPending=true
                await new Promise(() => { /* hang */ });
                return HttpResponse.json({});
            }),
        );
        renderWithProviders(
            <AddPrLinkDialog open onClose={vi.fn()} issueType="story" issueId="S1" />,
        );
        fireEvent.change(screen.getByLabelText('GitHub PR URL'), {
            target: { value: 'https://github.com/owner/repo/pull/1' },
        });
        // Click Add — mutation starts
        fireEvent.click(screen.getByRole('button', { name: /Add link/i }));
        // Wait for request to start
        await requestStarted;
        // The button now shows "Adding…" (isPending=true branch)
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Adding/i })).toBeDisabled(),
        );
    });
});
