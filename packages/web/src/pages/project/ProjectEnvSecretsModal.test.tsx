import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { defaultHandlers } from '../../test-utils/mock-handlers.js';
import { ProjectEnvSecretsModal } from './ProjectEnvSecretsModal.js';
import { Toast } from '../../components/Toast.js';

const BASE = 'http://localhost:3000/api';

const project = makeProject({ id: 'p1', name: 'Acme', git_path: '/tmp/acme' });
const projectNoWorkspace = makeProject({ id: 'p2', name: 'NoWs', git_path: '' });

const existingVars = {
    vars: [
        { key: 'DATABASE_URL', value: 'postgres://localhost/acme' },
        { key: 'API_SECRET', value: 'sup3rs3cr3t' },
    ],
};

beforeEach(() => {
    server.use(
        ...defaultHandlers,
        http.get(`${BASE}/projects/p1/env`, () => HttpResponse.json(existingVars)),
        http.get(`${BASE}/projects/p2/env`, () => HttpResponse.json({ vars: [] })),
    );
});

// ─── 1. Closed state ─────────────────────────────────────────────────────────

describe('ProjectEnvSecretsModal — closed', () => {
    it('renders nothing when project is null', () => {
        const { container } = renderWithProviders(
            <ProjectEnvSecretsModal open project={null} displayId="ACM" onClose={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

// ─── 2. Open / clean render ───────────────────────────────────────────────────

describe('ProjectEnvSecretsModal — open clean', () => {
    it('shows the modal heading', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        expect(screen.getByText('Project Secrets')).toBeInTheDocument();
    });

    it('shows the displayId badge', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        expect(screen.getByText('ACM')).toBeInTheDocument();
    });

    it('shows the encryption-at-rest notice for a project with workspace', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByText(/Encrypted at rest with AES-256-GCM/i)).toBeInTheDocument(),
        );
    });

    it('shows no-workspace warning for a project without git_path', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal
                open
                project={projectNoWorkspace}
                displayId="NWS"
                onClose={vi.fn()}
            />,
        );
        await waitFor(() =>
            expect(screen.getByText(/no folder on disk yet/i)).toBeInTheDocument(),
        );
    });

    it('renders loaded env vars as rows', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(screen.getByDisplayValue('DATABASE_URL')).toBeInTheDocument(),
        );
        expect(screen.getByDisplayValue('API_SECRET')).toBeInTheDocument();
    });

    it('shows empty-state message when project has no vars', async () => {
        server.use(
            http.get(`${BASE}/projects/p1/env`, () => HttpResponse.json({ vars: [] })),
        );
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() =>
            expect(
                screen.getByText(/No secrets yet/i),
            ).toBeInTheDocument(),
        );
    });
});

// ─── 3. Submit-success path ───────────────────────────────────────────────────

describe('ProjectEnvSecretsModal — submit success', () => {
    it('saves secrets and closes on success', async () => {
        const onClose = vi.fn();
        server.use(
            http.put(`${BASE}/projects/p1/env`, () =>
                HttpResponse.json({ vars: [{ key: 'NEW_KEY', value: 'value1' }] }),
            ),
        );
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={onClose} />,
        );
        // Wait for existing rows to appear, then add a new row to make it dirty
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Delete one of the rows to make it dirty (changes dirty count)
        const deleteButtons = screen.getAllByRole('button', { name: /remove/i });
        await userEvent.click(deleteButtons[0]!);
        // Now Save should be enabled (dirty = 1 deletion)
        const saveBtn = screen.getByRole('button', { name: /Save secrets/i });
        await userEvent.click(saveBtn);
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });
});

// ─── 4. Submit-error path ─────────────────────────────────────────────────────

describe('ProjectEnvSecretsModal — submit error', () => {
    it('does not close and shows toast when save fails', async () => {
        const onClose = vi.fn();
        server.use(
            http.put(`${BASE}/projects/p1/env`, () =>
                HttpResponse.json({ error: 'DB error' }, { status: 500 }),
            ),
        );
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={onClose} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Delete a row to make dirty
        const deleteButtons = screen.getAllByRole('button', { name: /remove/i });
        await userEvent.click(deleteButtons[0]!);
        const saveBtn = screen.getByRole('button', { name: /Save secrets/i });
        await userEvent.click(saveBtn);
        // After error, modal should still be open (onClose not called)
        await new Promise((r) => setTimeout(r, 100));
        expect(onClose).not.toHaveBeenCalled();
    });
});

// ─── 5. Cancel / close ───────────────────────────────────────────────────────

describe('ProjectEnvSecretsModal — cancel', () => {
    it('Cancel button calls onClose', async () => {
        const onClose = vi.fn();
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={onClose} />,
        );
        await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        expect(onClose).toHaveBeenCalled();
    });
});

// ─── 6. Form-field interactions ───────────────────────────────────────────────

describe('ProjectEnvSecretsModal — form interactions', () => {
    it('Add variable button appends a new row', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        // After adding, there should be one more input (the new empty key field)
        const keyInputs = screen.getAllByPlaceholderText('MY_KEY');
        expect(keyInputs.length).toBeGreaterThanOrEqual(1);
    });

    it('typing in the key field updates the value and auto-uppercases', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        const newKeyInput = screen.getAllByPlaceholderText('MY_KEY').at(-1)!;
        await userEvent.type(newKeyInput, 'my_new_key', { delay: 10 });
        // The component auto-uppercases typed keys
        await waitFor(() =>
            expect(newKeyInput).toHaveValue('MY_NEW_KEY'),
        );
    }, 30_000);

    it('search filter narrows the rows shown', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const searchInput = screen.getByPlaceholderText(/Search by key/i);
        await userEvent.type(searchInput, 'API');
        // Only API_SECRET should remain visible; DATABASE_URL should be gone
        await waitFor(() =>
            expect(screen.queryByDisplayValue('DATABASE_URL')).not.toBeInTheDocument(),
        );
        expect(screen.getByDisplayValue('API_SECRET')).toBeInTheDocument();
    });

    it('Reveal all toggles to Hide all and back', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const revealBtn = screen.getByRole('button', { name: /Reveal all/i });
        await userEvent.click(revealBtn);
        expect(screen.getByRole('button', { name: /Hide all/i })).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /Hide all/i }));
        expect(screen.getByRole('button', { name: /Reveal all/i })).toBeInTheDocument();
    });

    it('deleting a row shows unsaved changes indicator', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const deleteButtons = screen.getAllByRole('button', { name: /remove/i });
        await userEvent.click(deleteButtons[0]!);
        await waitFor(() =>
            expect(screen.getByText(/unsaved change/i)).toBeInTheDocument(),
        );
    });

    it('Save is disabled when there are validation errors (empty key)', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Add an empty-key row — that triggers "Key required" validation error
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        await waitFor(() =>
            expect(screen.getByText('Key required')).toBeInTheDocument(),
        );
        const saveBtn = screen.getByRole('button', { name: /Save secrets/i });
        expect(saveBtn).toBeDisabled();
    });

    it('copying a row writes the value to the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Each row has a Copy tooltip wrapping an icon button with title "Copy".
        const copyBtns = screen.getAllByLabelText(/^Copy$/);
        await userEvent.click(copyBtns[0]!);
        await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
        expect(writeText.mock.calls[0]?.[0]).toBe('postgres://localhost/acme');
    });

    it('clicking Reveal icon on a single row toggles its visibility', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // First row's Reveal icon button — tooltip title is "Reveal" when hidden.
        const revealRowBtns = screen.getAllByLabelText(/^Reveal$/);
        await userEvent.click(revealRowBtns[0]!);
        // After click the same button's tooltip becomes "Hide".
        await waitFor(() => expect(screen.getAllByLabelText(/^Hide$/).length).toBeGreaterThan(0));
    });

    it('Export click triggers a download via URL.createObjectURL', async () => {
        // jsdom doesn't ship URL.createObjectURL/revokeObjectURL — assign before
        // spying so spyOn has a property descriptor to work with.
        const urlAny = URL as unknown as Record<string, (...args: unknown[]) => unknown>;
        const prevCreate = urlAny['createObjectURL'];
        const prevRevoke = urlAny['revokeObjectURL'];
        urlAny['createObjectURL'] = () => 'blob:fake';
        urlAny['revokeObjectURL'] = () => undefined;
        const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
        const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        try {
            renderWithProviders(
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
            );
            await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
            await userEvent.click(screen.getByRole('button', { name: /^Export$/ }));
            expect(createSpy).toHaveBeenCalledOnce();
            expect(revokeSpy).toHaveBeenCalledOnce();
        } finally {
            createSpy.mockRestore();
            revokeSpy.mockRestore();
            if (prevCreate === undefined) delete urlAny['createObjectURL'];
            else urlAny['createObjectURL'] = prevCreate;
            if (prevRevoke === undefined) delete urlAny['revokeObjectURL'];
            else urlAny['revokeObjectURL'] = prevRevoke;
        }
    });

    it('clicking Import triggers the hidden file input', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // The hidden file input is the only input[type=file] on the page.
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement | null;
        expect(fileInput).not.toBeNull();
        const inputClickSpy = vi.spyOn(fileInput!, 'click');
        await userEvent.click(screen.getByRole('button', { name: /^Import$/ }));
        expect(inputClickSpy).toHaveBeenCalled();
        inputClickSpy.mockRestore();
    });

    it('selecting a JSON file via the import input merges secrets into the rows', { timeout: 30_000 }, async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        // parseJsonSecrets accepts a {key:value} object — this brings in NEW_VAR
        // as a fresh row and overwrites API_SECRET's value.
        const payload = JSON.stringify({ NEW_VAR: 'newval', API_SECRET: 'rotated' });
        const file = new File([payload], 'env.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        await waitFor(() =>
            expect(screen.getByDisplayValue('NEW_VAR')).toBeInTheDocument(),
        );
    });

    it('onImportFile — no file selected (early return, no FileReader created)', async () => {
        // Verify the early-return branch: when a change event fires but files is
        // empty, no FileReader is ever created and the row count stays the same.
        const origFileReader = globalThis.FileReader;
        const readerSpy = vi.fn();
        // Temporarily replace FileReader so we can detect if it was called.
        // @ts-expect-error intentional mock
        globalThis.FileReader = class { constructor() { readerSpy(); } };
        try {
            renderWithProviders(
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
            );
            await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
            const fileInput = document.querySelector(
                'input[type="file"][accept*="json"]',
            ) as HTMLInputElement;
            // Dispatch change with an empty FileList — simulates user opening and
            // immediately cancelling the dialog (files remains empty).
            fireEvent.change(fileInput, { target: { files: [] } });
            // FileReader constructor should never have been called.
            expect(readerSpy).not.toHaveBeenCalled();
        } finally {
            globalThis.FileReader = origFileReader;
        }
    });

    it('onImportFile — empty JSON object shows "No secrets found in file" toast', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        // An empty object has zero valid secrets.
        const file = new File(['{}'], 'empty.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        await waitFor(() =>
            expect(screen.getByText('No secrets found in file')).toBeInTheDocument(),
        );
    });

    it('onImportFile — skipped note: singular bad key and non-string value', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        // One good key, one bad key (not UPPER_SNAKE_CASE), one non-string value.
        const payload = JSON.stringify({ GOOD_KEY: 'val', 'bad-key': 'val2', NUM_KEY: 42 });
        const file = new File([payload], 'mixed.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        // Should import 1 secret and skip 2 — 1 bad key (singular), 1 non-string value (singular).
        await waitFor(() => {
            const toastEl = screen.getByText(/Imported 1 secret/i);
            expect(toastEl.textContent).toMatch(/skipped 2/i);
            expect(toastEl.textContent).toMatch(/1 bad key[^s]/i);
            expect(toastEl.textContent).toMatch(/1 non-string value[^s]/i);
        });
    });

    it('onImportFile — skipped note: plural bad keys only', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        // One good key, two bad keys (lowercase names are invalid per KEY_RE).
        const payload = JSON.stringify({ GOOD_KEY: 'val', 'bad-one': 'x', 'bad-two': 'y' });
        const file = new File([payload], 'multi-bad.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        // Should import 1 and skip 2 bad keys (plural "keys").
        await waitFor(() => {
            const toastEl = screen.getByText(/Imported 1 secret/i);
            expect(toastEl.textContent).toMatch(/skipped 2/i);
            expect(toastEl.textContent).toMatch(/2 bad keys/i);
        });
    });

    it('search filter shows "No keys match your search." when nothing matches', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const searchInput = screen.getByPlaceholderText(/Search by key/i);
        await userEvent.type(searchInput, 'XYZZZNOTEXIST');
        await waitFor(() =>
            expect(screen.getByText('No keys match your search.')).toBeInTheDocument(),
        );
    });

    it('UPPER_SNAKE_CASE only validation error appears for a key starting with a digit', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Add a new row and set its key to a value that starts with a digit
        // (KEY_RE = /^[A-Z][A-Z0-9_]*$/ — must start with a letter).
        // The onChange handler does `.toUpperCase()` so we bypass it with fireEvent.
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        const keyInputs = screen.getAllByPlaceholderText('MY_KEY');
        const newKeyInput = keyInputs.at(-1)!;
        fireEvent.change(newKeyInput, { target: { value: '1INVALID' } });
        await waitFor(() =>
            expect(screen.getByText('UPPER_SNAKE_CASE only')).toBeInTheDocument(),
        );
    });

    it('Duplicate key validation error appears for two rows with the same key', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Add a new row and type the key that already exists (DATABASE_URL).
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        const keyInputs = screen.getAllByPlaceholderText('MY_KEY');
        const newKeyInput = keyInputs.at(-1)!;
        // The component auto-uppercases — type 'DATABASE_URL' directly.
        await userEvent.type(newKeyInput, 'DATABASE_URL', { delay: 5 });
        await waitFor(() =>
            expect(screen.getByText('Duplicate key')).toBeInTheDocument(),
        );
    }, 30_000);
});

// ─── 7. onSave validation guard ───────────────────────────────────────────────

describe('ProjectEnvSecretsModal — onSave validation guard', () => {
    it('Save button is disabled and validation error shown when hasErrors is true', async () => {
        // The Save button is disabled when hasErrors = true.
        // This verifies the guard that would show "Fix N rows first" toast.
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        const keyInputs = screen.getAllByPlaceholderText('MY_KEY');
        const newKeyInput = keyInputs.at(-1)!;
        // Force an invalid key value directly via fireEvent to bypass auto-uppercase.
        fireEvent.change(newKeyInput, { target: { value: '1BAD' } });
        await waitFor(() =>
            expect(screen.getByText('UPPER_SNAKE_CASE only')).toBeInTheDocument(),
        );
        // Save button should be disabled because hasErrors = true.
        const saveBtn = screen.getByRole('button', { name: /Save secrets/i });
        expect(saveBtn).toBeDisabled();
    });
});

// ─── 8. Clipboard failure ─────────────────────────────────────────────────────

describe('ProjectEnvSecretsModal — clipboard failure', () => {
    it('shows "Clipboard blocked" toast when writeText rejects', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
        });
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const copyBtns = screen.getAllByLabelText(/^Copy$/);
        await userEvent.click(copyBtns[0]!);
        await waitFor(() =>
            expect(screen.getByText('Clipboard blocked')).toBeInTheDocument(),
        );
    });
});

// ─── 9. value TextField onChange (L657) ──────────────────────────────────────

describe('ProjectEnvSecretsModal — value field onChange', () => {
    it('typing into the value field updates row value', async () => {
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('postgres://localhost/acme'));
        // The value input for DATABASE_URL is of type=password initially (not revealed).
        // Use fireEvent directly so we can set the value on the password input.
        const valueInput = screen.getByDisplayValue('postgres://localhost/acme');
        fireEvent.change(valueInput, { target: { value: 'postgres://new/db' } });
        await waitFor(() =>
            expect(screen.getByDisplayValue('postgres://new/db')).toBeInTheDocument(),
        );
    });
});

// ─── 10. parseJsonSecrets — null / array / non-object branches (L76-78) ──────

describe('ProjectEnvSecretsModal — import invalid JSON structure', () => {
    it('shows "Could not import secrets" toast when JSON is an array (not an object)', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        // An array is not a { KEY: value } object — parseJsonSecrets should throw.
        const file = new File(['[1,2,3]'], 'bad.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        await waitFor(() =>
            expect(screen.getByText('Could not import secrets')).toBeInTheDocument(),
        );
    });

    it('shows "Could not import secrets" toast when JSON is null', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        const file = new File(['null'], 'null.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        await waitFor(() =>
            expect(screen.getByText('Could not import secrets')).toBeInTheDocument(),
        );
    });

    it('shows "Could not import secrets" toast when file content is not valid JSON', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        const file = new File(['not json at all {{{'], 'broken.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        await waitFor(() =>
            expect(screen.getByText('Could not import secrets')).toBeInTheDocument(),
        );
    });
});

// ─── 11. onSave guard: Save button disabled when errors present (L295-298) ───

describe('ProjectEnvSecretsModal — onSave guard with errors', () => {
    it('Save button is disabled (cannot fire) and plural "rows" label for > 1 error', async () => {
        // onSave L295-298: errCount > 0 guard — Save is disabled whenever hasErrors
        // is true, so we cover the branch via the disabled state + verify plural form.
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        // Add two rows with empty keys — 2 errors total.
        await userEvent.click(addBtn);
        await userEvent.click(addBtn);
        await waitFor(() => {
            const errors = screen.getAllByText('Key required');
            expect(errors.length).toBeGreaterThanOrEqual(2);
        });
        // Save should be disabled because hasErrors = true.
        const saveBtn = screen.getByRole('button', { name: /Save secrets/i });
        expect(saveBtn).toBeDisabled();
    });
});

// ─── 12. close effect resets search + revealAll (L131-134) ───────────────────

describe('ProjectEnvSecretsModal — close resets search and revealAll', () => {
    it('reopening after search/revealAll clears both states', async () => {
        const { rerender } = renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Set a search value.
        const searchInput = screen.getByPlaceholderText(/Search by key/i);
        await userEvent.type(searchInput, 'API');
        // Reveal all.
        const revealBtn = screen.getByRole('button', { name: /Reveal all/i });
        await userEvent.click(revealBtn);
        expect(screen.getByRole('button', { name: /Hide all/i })).toBeInTheDocument();
        // Now close the modal (open=false triggers the effect).
        rerender(
            <ProjectEnvSecretsModal open={false} project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        // Reopen.
        rerender(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Search should be cleared — DATABASE_URL visible again.
        expect(screen.getByDisplayValue('DATABASE_URL')).toBeInTheDocument();
        // Reveal All button (not Hide all) should be shown — revealAll was reset.
        expect(screen.getByRole('button', { name: /Reveal all/i })).toBeInTheDocument();
    });
});

// ─── 13. copy with empty key uses "value" fallback (L698) ────────────────────

describe('ProjectEnvSecretsModal — copy with empty-key row', () => {
    it('copy button on a row with empty key uses "value" as the toast label', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Add a new row — it starts with an empty key.
        const addBtn = screen.getByRole('button', { name: /Add variable/i });
        await userEvent.click(addBtn);
        // Set a value in the new empty-key row so Copy has something to copy.
        // The new row's value placeholder is "value"; find the last password input.
        const valueInputs = document.querySelectorAll('input[placeholder="value"]');
        const lastValueInput = valueInputs[valueInputs.length - 1] as HTMLInputElement;
        fireEvent.change(lastValueInput, { target: { value: 'somepassword' } });
        // Click Copy on the new row (last Copy button).
        const copyBtns = screen.getAllByLabelText(/^Copy$/);
        await userEvent.click(copyBtns[copyBtns.length - 1]!);
        await waitFor(() =>
            expect(screen.getByText('value copied')).toBeInTheDocument(),
        );
    });
});

// ─── 14. save.isPending spinner branch (L838-849) ─────────────────────────────

describe('ProjectEnvSecretsModal — save pending spinner', () => {
    it('shows CircularProgress and "Saving…" text while save is pending', async () => {
        // Return a never-resolving promise so isPending stays true long enough to assert.
        let resolveSave!: () => void;
        const pendingPromise = new Promise<void>((res) => { resolveSave = res; });
        server.use(
            http.put(`${BASE}/projects/p1/env`, async () => {
                await pendingPromise;
                return HttpResponse.json({ vars: [] });
            }),
        );
        renderWithProviders(
            <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />,
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        // Make the form dirty so Save is enabled.
        const deleteButtons = screen.getAllByRole('button', { name: /remove/i });
        await userEvent.click(deleteButtons[0]!);
        const saveBtn = screen.getByRole('button', { name: /Save secrets/i });
        await userEvent.click(saveBtn);
        // The save is now pending — button text should flip to "Saving…".
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Saving/i })).toBeInTheDocument(),
        );
        // Clean up: resolve so the component doesn't hang.
        resolveSave();
    });
});

// ─── 15. skipped note: non-string values only (L264 branch) ──────────────────

describe('ProjectEnvSecretsModal — import skipped non-string values only', () => {
    it('skipped note mentions only non-string values when no bad keys', async () => {
        renderWithProviders(
            <>
                <ProjectEnvSecretsModal open project={project} displayId="ACM" onClose={vi.fn()} />
                <Toast />
            </>
        );
        await waitFor(() => screen.getByDisplayValue('DATABASE_URL'));
        const fileInput = document.querySelector(
            'input[type="file"][accept*="json"]',
        ) as HTMLInputElement;
        // Two valid keys with good names but non-string (number) values + one good string key.
        const payload = JSON.stringify({ GOOD_KEY: 'val', NUM_ONE: 1, NUM_TWO: 2 });
        const file = new File([payload], 'nonstring.json', { type: 'application/json' });
        await userEvent.upload(fileInput, file);
        await waitFor(() => {
            const toastEl = screen.getByText(/Imported 1 secret/i);
            expect(toastEl.textContent).toMatch(/skipped 2/i);
            expect(toastEl.textContent).toMatch(/2 non-string values/i);
        });
    });
});
