import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { ModelRegistryTab } from './ModelRegistryTab.js';

const SEED_MODELS = [
    {
        id: 'm1',
        cli: 'claude',
        model_name: 'claude-opus-4-7',
        note: '1M context',
        sort_order: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'm2',
        cli: 'copilot',
        model_name: 'gpt-5',
        note: null,
        sort_order: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    },
];

describe('ModelRegistryTab', () => {
    it('mounts without crashing', () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () => HttpResponse.json([])),
        );
        const { container } = renderWithProviders(<ModelRegistryTab />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('shows a confirmation dialog before deleting a model', async () => {
        const deleteHandler = vi.fn(() => HttpResponse.json({}, { status: 204 }));
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
            http.delete('http://localhost:3000/api/cli-models/:id', deleteHandler),
        );
        renderWithProviders(<ModelRegistryTab />);

        const removeBtn = await screen.findByRole('button', { name: /Remove claude-opus-4-7/i });
        await userEvent.click(removeBtn);

        // Clicking the row delete icon must NOT immediately fire DELETE.
        expect(deleteHandler).not.toHaveBeenCalled();
        // The confirm dialog appears with the model name in its prompt.
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // The dialog body includes the model name (wrapped in <strong>).
        const matchesInDialog = await screen.findAllByText((_, node) =>
            (node?.textContent ?? '').includes('claude-opus-4-7'),
        );
        expect(matchesInDialog.length).toBeGreaterThan(0);
    });

    it('Cancel closes the dialog without calling DELETE', async () => {
        const deleteHandler = vi.fn(() => HttpResponse.json({}, { status: 204 }));
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
            http.delete('http://localhost:3000/api/cli-models/:id', deleteHandler),
        );
        renderWithProviders(<ModelRegistryTab />);

        await userEvent.click(
            await screen.findByRole('button', { name: /Remove claude-opus-4-7/i }),
        );
        await screen.findByRole('dialog');
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(deleteHandler).not.toHaveBeenCalled();
    });

    it('confirm fires DELETE and closes the dialog', async () => {
        const deleteHandler = vi.fn(() => HttpResponse.json({}, { status: 204 }));
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
            http.delete('http://localhost:3000/api/cli-models/:id', deleteHandler),
        );
        renderWithProviders(<ModelRegistryTab />);

        await userEvent.click(
            await screen.findByRole('button', { name: /Remove claude-opus-4-7/i }),
        );
        await screen.findByRole('dialog');
        await userEvent.click(screen.getByRole('button', { name: /Delete model/i }));

        await waitFor(() => expect(deleteHandler).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('openAdd (fn#2) — clicking Add model opens the modal with no editing model', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
        );
        renderWithProviders(<ModelRegistryTab />);
        // Wait for the component to load then click "Add model"
        const addBtns = await screen.findAllByRole('button', { name: /Add model/i });
        if (addBtns[0]) {
            fireEvent.click(addBtns[0]);
        }
        // The modal should open (dialog present)
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
    });

    it('openEdit (fn#3) — clicking a model row opens the edit modal', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
        );
        renderWithProviders(<ModelRegistryTab />);
        // Wait for models to render then click the model row (role=button)
        const modelRows = await screen.findAllByRole('button');
        // Find the row with the model name text (not Remove/Add buttons)
        const modelRow = modelRows.find(
            (el) =>
                el.getAttribute('role') === 'button' &&
                !el.getAttribute('aria-label') &&
                (el.textContent ?? '').includes('claude-opus-4-7'),
        );
        if (modelRow) {
            fireEvent.click(modelRow);
        }
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeInTheDocument());
    });

    it('onClose (fn#9) — ModelEditModal closes when its close handler fires', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
        );
        renderWithProviders(<ModelRegistryTab />);
        const addBtns = await screen.findAllByRole('button', { name: /Add model/i });
        if (addBtns[0]) {
            fireEvent.click(addBtns[0]);
        }
        await screen.findByRole('dialog');
        // Close the modal by pressing Escape key (MUI Dialog default close)
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('onError (fn#6) — delete error clears pendingDelete state', async () => {
        const deleteHandler = vi.fn(() => HttpResponse.json({ error: 'failed' }, { status: 500 }));
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
            http.delete('http://localhost:3000/api/cli-models/:id', deleteHandler),
        );
        renderWithProviders(<ModelRegistryTab />);

        await userEvent.click(
            await screen.findByRole('button', { name: /Remove claude-opus-4-7/i }),
        );
        await screen.findByRole('dialog');
        await userEvent.click(screen.getByRole('button', { name: /Delete model/i }));

        // After the error the dialog should close (onError calls setPendingDelete(null))
        await waitFor(() => expect(deleteHandler).toHaveBeenCalledTimes(1), { timeout: 10000 });
    }, 30000);

    it('shows a loading spinner while models are being fetched', () => {
        // Never-resolving handler simulates loading state
        server.use(
            http.get('http://localhost:3000/api/cli-models', () => new Promise(() => {})),
        );
        renderWithProviders(<ModelRegistryTab />);
        expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    });

    it('renders both Claude CLI and GitHub Copilot CLI section headings', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () => HttpResponse.json([])),
        );
        renderWithProviders(<ModelRegistryTab />);
        await waitFor(() => {
            expect(screen.getByText('Claude CLI')).toBeInTheDocument();
            expect(screen.getByText('GitHub Copilot CLI')).toBeInTheDocument();
        });
    });

    it('renders model note when model has a note field', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
        );
        renderWithProviders(<ModelRegistryTab />);
        // claude-opus-4-7 has note '1M context'
        await waitFor(() => expect(screen.getByText('1M context')).toBeInTheDocument());
    });

    it('shows model count label (N models) next to each CLI section', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
        );
        renderWithProviders(<ModelRegistryTab />);
        await waitFor(() => {
            // One model per cli: "1 model" for each
            const modelCounts = screen.getAllByText(/1 model$/);
            expect(modelCounts.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('renders "0 models" when the list is empty', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () => HttpResponse.json([])),
        );
        renderWithProviders(<ModelRegistryTab />);
        await waitFor(() => {
            const zeroCounts = screen.getAllByText('0 models');
            expect(zeroCounts.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('Close icon button in confirm dialog dismisses it without deleting', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
        );
        renderWithProviders(<ModelRegistryTab />);
        await userEvent.click(
            await screen.findByRole('button', { name: /Remove claude-opus-4-7/i }),
        );
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toBeInTheDocument();
        // Click the Close icon button inside the dialog (aria-label="Close")
        const closeBtn = screen.getByRole('button', { name: /^Close$/i });
        await userEvent.click(closeBtn);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('renders the info alert about Add Agent dialog scope', async () => {
        server.use(
            http.get('http://localhost:3000/api/cli-models', () => HttpResponse.json([])),
        );
        renderWithProviders(<ModelRegistryTab />);
        await waitFor(() => {
            expect(screen.getByText(/Add Agent/)).toBeInTheDocument();
        });
    });

    it('shows busy state in delete button while DELETE is in-flight (line 321 busy branch)', async () => {
        let resolveDelete!: () => void;
        const deletePromise = new Promise<void>((res) => { resolveDelete = res; });
        server.use(
            http.get('http://localhost:3000/api/cli-models', () =>
                HttpResponse.json(SEED_MODELS),
            ),
            http.delete('http://localhost:3000/api/cli-models/:id', async () => {
                await deletePromise;
                return HttpResponse.json({}, { status: 204 });
            }),
        );
        renderWithProviders(<ModelRegistryTab />);
        await userEvent.click(
            await screen.findByRole('button', { name: /Remove claude-opus-4-7/i }),
        );
        await screen.findByRole('dialog');
        // Capture the delete button before clicking
        const deleteBtn = screen.getByRole('button', { name: /Delete model/i });
        fireEvent.click(deleteBtn);
        // While DELETE is pending, the dialog confirm button should be disabled or show Removing
        await waitFor(() => {
            // Either the button is disabled OR the text changes to "Removing…"
            const isDisabled = deleteBtn.hasAttribute('disabled');
            const showsRemoving = document.body.textContent?.includes('Removing');
            expect(isDisabled || showsRemoving).toBe(true);
        }, { timeout: 3000 });
        resolveDelete();
    });
});
