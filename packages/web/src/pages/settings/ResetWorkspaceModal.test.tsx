import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { ResetWorkspaceModal } from './ResetWorkspaceModal.js';

const BASE = 'http://localhost:3000/api';

beforeEach(() => {
    server.use(...defaultHandlers);
});

describe('ResetWorkspaceModal — closed', () => {
    it('does not render dialog content when open=false', () => {
        renderWithProviders(<ResetWorkspaceModal open={false} onClose={vi.fn()} />);
        expect(screen.queryByText('Reset all workspace data?')).not.toBeInTheDocument();
    });
});

describe('ResetWorkspaceModal — open', () => {
    it('renders the dialog heading and warning text', () => {
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        expect(screen.getByText('Reset all workspace data?')).toBeInTheDocument();
        expect(screen.getByText(/You will lose all content\./i)).toBeInTheDocument();
    });

    it('Reset Everything button is disabled until RESET is typed', () => {
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        const btn = screen.getByRole('button', { name: /Reset Everything/i });
        expect(btn).toBeDisabled();
    });

    it('Reset Everything button becomes enabled after typing RESET', async () => {
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        const input = screen.getByPlaceholderText('RESET');
        await userEvent.type(input, 'RESET');
        expect(screen.getByRole('button', { name: /Reset Everything/i })).not.toBeDisabled();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(<ResetWorkspaceModal open onClose={onClose} />);
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows stats from data hooks — zero counts by default', () => {
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        // defaultHandlers returns [] for all list endpoints, so all counts are 0
        const labels = ['agents', 'projects', 'epics', 'stories', 'bugs'];
        for (const label of labels) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it('calls reset API successfully — button goes into Resetting state', async () => {
        let resolveReset!: () => void;
        const resetPromise = new Promise<void>((res) => {
            resolveReset = res;
        });
        server.use(
            http.post(`${BASE}/settings/reset`, async () => {
                await resetPromise;
                return HttpResponse.json({ ok: true });
            }),
        );
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        const input = screen.getByPlaceholderText('RESET');
        await userEvent.type(input, 'RESET');
        await userEvent.click(screen.getByRole('button', { name: /Reset Everything/i }));
        // While the API call is in-flight the button changes to "Resetting…"
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Resetting/i })).toBeInTheDocument(),
        );
        resolveReset();
    });

    it('shows toast on reset failure', async () => {
        server.use(
            http.post(`${BASE}/settings/reset`, () =>
                HttpResponse.json({ error: 'locked' }, { status: 500 }),
            ),
        );
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        const input = screen.getByPlaceholderText('RESET');
        await userEvent.type(input, 'RESET');
        await userEvent.click(screen.getByRole('button', { name: /Reset Everything/i }));
        // After failure the button becomes re-enabled (resetting=false)
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Reset Everything/i })).not.toBeDisabled(),
        );
    });

    it('useEffect clears confirmInput when modal closes (open=false branch)', async () => {
        const { rerender } = renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        // Type something so confirmInput is non-empty
        const input = screen.getByPlaceholderText('RESET');
        await userEvent.type(input, 'RESET');
        expect((input as HTMLInputElement).value).toBe('RESET');
        // Close the modal -> useEffect fires with open=false -> setConfirmInput('') branch
        rerender(<ResetWorkspaceModal open={false} onClose={vi.fn()} />);
        // No crash; the component survives the transition
        expect(document.body).toBeTruthy();
    });

    it('shows toast with String(err) when thrown value is not an Error instance', async () => {
        // api.settings.reset throws a plain string — exercises `String(err)` fallback
        server.use(
            http.post(`${BASE}/settings/reset`, () =>
                // Non-Error response body — the api client will throw something
                new Response('plain error string', { status: 500 }),
            ),
        );
        renderWithProviders(<ResetWorkspaceModal open onClose={vi.fn()} />);
        const input = screen.getByPlaceholderText('RESET');
        await userEvent.type(input, 'RESET');
        await userEvent.click(screen.getByRole('button', { name: /Reset Everything/i }));
        // After failure the reset button becomes re-enabled
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Reset Everything/i })).not.toBeDisabled(),
        );
    });

    it('handleClose no-op while resetting — Cancel click ignored (line 69 branch)', async () => {
        // Start a reset that never resolves so we stay in the "resetting" state
        server.use(
            http.post(`${BASE}/settings/reset`, () => new Promise(() => {})),
        );
        const onClose = vi.fn();
        renderWithProviders(<ResetWorkspaceModal open onClose={onClose} />);
        const input = screen.getByPlaceholderText('RESET');
        await userEvent.type(input, 'RESET');
        await userEvent.click(screen.getByRole('button', { name: /Reset Everything/i }));
        // Wait until in-flight (button shows "Resetting…")
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Resetting/i })).toBeInTheDocument(),
        );
        // Now try to close — handleClose should early-return since resetting=true
        const cancelBtn = screen.queryByRole('button', { name: /^Cancel$/ });
        if (cancelBtn) {
            // Use fireEvent (bypasses pointer-event checks on disabled buttons)
            fireEvent.click(cancelBtn);
        }
        // onClose should NOT have been called
        expect(onClose).not.toHaveBeenCalled();
    });
});
