import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { server } from '../../test-setup.js';
import { ImportAgentZipModal } from './ImportAgentZipModal.js';
import * as apiModule from '../../api/api.js';

const BASE = 'http://localhost:3000/api';

describe('ImportAgentZipModal', () => {
    beforeEach(() => {
        server.use(...defaultHandlers);
    });

    it('renders the dialog when open=true', () => {
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows "Import agent from zip" title', () => {
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        expect(screen.getByText('Import agent from zip')).toBeInTheDocument();
    });

    it('does not render dialog when open=false', () => {
        renderWithProviders(
            <ImportAgentZipModal open={false} onClose={vi.fn()} onImported={vi.fn()} />,
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ImportAgentZipModal open onClose={onClose} onImported={vi.fn()} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onClose).toHaveBeenCalled();
    });

    it('Import button is disabled when no file selected', () => {
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
    });

    it('selecting a file enables Import button', () => {
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });
        expect(screen.getByRole('button', { name: /^import$/i })).not.toBeDisabled();
    });

    it('successful import calls onImported', async () => {
        const agent = makeAgent({ id: 'imported-agent', name: 'Imported Agent' });
        server.use(
            http.post(`${BASE}/agents/import`, () => HttpResponse.json(agent)),
        );
        const onImported = vi.fn();
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={onImported} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
            expect(onImported).toHaveBeenCalledWith(agent);
        });
    });

    it('server 409 conflict shows slug rename field', async () => {
        server.use(
            http.post(`${BASE}/agents/import`, () =>
                HttpResponse.json(
                    {
                        error: 'Slug conflict',
                        details: {
                            conflicting_id: 'existing-agent',
                            suggested_id: 'existing-agent-2',
                        },
                    },
                    { status: 409 },
                ),
            ),
        );
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
            expect(screen.getByLabelText(/new slug/i)).toBeInTheDocument();
        });
    });

    it('server error shows error message', async () => {
        server.use(
            http.post(`${BASE}/agents/import`, () =>
                HttpResponse.json({ error: 'Import failed: bad zip' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
            expect(screen.getByText(/import failed: bad zip/i)).toBeInTheDocument();
        });
    });

    it('typing in Override slug field sets agentId state (opts.agent_id branch)', () => {
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        // The "Override slug" text field should be visible when slugTaken is null
        const slugField = screen.getByLabelText(/override slug/i) as HTMLInputElement;
        expect(slugField).toBeInTheDocument();
        fireEvent.change(slugField, { target: { value: 'my-custom-slug' } });
        expect(slugField.value).toBe('my-custom-slug');
    });

    it('shows error text when server returns 500 (catch block err instanceof Error branch)', async () => {
        server.use(
            http.post(`${BASE}/agents/import`, () =>
                HttpResponse.json({ error: 'Import failed: something broke' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
            const txt = document.body.textContent ?? '';
            expect(/import failed|error|failed|something broke/i.test(txt)).toBe(true);
        }, { timeout: 5000 });
    });

    it('non-Error throw from importZip shows the generic "Import failed" fallback message', async () => {
        // err instanceof Error is false → falls to the `: 'Import failed'` branch (L74)
        const importSpy = vi
            .spyOn(apiModule.api.agents, 'importZip')
            .mockRejectedValueOnce('a plain string rejection, not an Error');
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
            expect(screen.getByText('Import failed')).toBeInTheDocument();
        });
        importSpy.mockRestore();
    });

    it('Cancel is a no-op while uploading (handleClose early-return)', async () => {
        // Delay the importZip resolution so `uploading` stays true while we click Cancel.
        let resolveImport!: (v: unknown) => void;
        const pending = new Promise((res) => { resolveImport = res; });
        const importSpy = vi
            .spyOn(apiModule.api.agents, 'importZip')
            .mockReturnValueOnce(pending as ReturnType<typeof apiModule.api.agents.importZip>);
        const onClose = vi.fn();
        renderWithProviders(
            <ImportAgentZipModal open onClose={onClose} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        // While the import is in-flight, the Import button shows "Importing…" and Cancel is disabled
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Importing…/i })).toBeInTheDocument(),
        );
        const cancelBtn = screen.getByRole('button', { name: /cancel/i });
        expect(cancelBtn).toBeDisabled();
        // Force-click despite disabled — handleClose should still early-return because uploading=true
        fireEvent.click(cancelBtn);
        expect(onClose).not.toHaveBeenCalled();

        resolveImport(makeAgent({ id: 'imported-agent-2' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Import$/i })).toBeInTheDocument(),
        );
        importSpy.mockRestore();
    });

    it('Escape key is a no-op while uploading (handleClose early-return via Dialog onClose)', async () => {
        // The Cancel button is disabled while uploading, so a native click never
        // reaches handleClose. Escape still routes through Dialog's onClose prop
        // (also handleClose), which is the only way to exercise the `uploading`
        // true branch of the early-return.
        let resolveImport!: (v: unknown) => void;
        const pending = new Promise((res) => { resolveImport = res; });
        const importSpy = vi
            .spyOn(apiModule.api.agents, 'importZip')
            .mockReturnValueOnce(pending as ReturnType<typeof apiModule.api.agents.importZip>);
        const onClose = vi.fn();
        renderWithProviders(
            <ImportAgentZipModal open onClose={onClose} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Importing…/i })).toBeInTheDocument(),
        );

        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();

        resolveImport(makeAgent({ id: 'imported-agent-3' }));
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /^Import$/i })).toBeInTheDocument(),
        );
        importSpy.mockRestore();
    });

    it('Escape key closes and resets the dialog when not uploading (handleClose non-early-return path)', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ImportAgentZipModal open onClose={onClose} onImported={vi.fn()} />,
        );
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('selecting an empty file list clears the selection (files?.[0] ?? null fallback)', () => {
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });
        expect(screen.getByRole('button', { name: /^import$/i })).not.toBeDisabled();

        // Re-firing change with an empty FileList drives files?.[0] to undefined,
        // falling back to null and disabling Import again.
        fireEvent.change(input, { target: { files: [] } });
        expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
        expect(screen.getByText('Click to choose a .zip file')).toBeInTheDocument();
    });

    it('submitting with a blank Override slug omits agent_id from the request (agentId.trim() false branch)', async () => {
        const importSpy = vi
            .spyOn(apiModule.api.agents, 'importZip')
            .mockResolvedValueOnce(makeAgent({ id: 'imported-agent-4' }));
        renderWithProviders(
            <ImportAgentZipModal open onClose={vi.fn()} onImported={vi.fn()} />,
        );
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        const mockFile = new File(['content'], 'agent.zip', { type: 'application/zip' });
        fireEvent.change(input, { target: { files: [mockFile] } });

        // Override slug field is left blank — agentId.trim() is falsy.
        await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

        await waitFor(() => {
            expect(importSpy).toHaveBeenCalledWith(mockFile, {});
        });
        importSpy.mockRestore();
    });
});
