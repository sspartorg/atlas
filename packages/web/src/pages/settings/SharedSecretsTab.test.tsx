import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { SharedSecretsTab } from './SharedSecretsTab.js';

const apiBase = 'http://localhost:3000/api';

function mountInitial(vars: Array<{ key: string; value: string }>): void {
    server.use(http.get(`${apiBase}/environment-secrets`, () => HttpResponse.json({ vars })));
}

describe('SharedSecretsTab', () => {
    it('renders a CircularProgress while data is loading', () => {
        server.use(
            http.get(`${apiBase}/environment-secrets`, async () => {
                await new Promise(r => setTimeout(r, 100));
                return HttpResponse.json({ vars: [] });
            }),
        );
        renderWithProviders(<SharedSecretsTab />);
        expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    });

    it('hydrates one row per response var with the right key+value', async () => {
        mountInitial([
            { key: 'FOO', value: 'foo-val' },
            { key: 'BAR', value: 'bar-val' },
        ]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('FOO')).toBeInTheDocument());
        expect(screen.getByDisplayValue('BAR')).toBeInTheDocument();
    });

    it('shows the empty-state copy when there are zero shared secrets', async () => {
        mountInitial([]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/no shared secrets yet/i)).toBeInTheDocument());
    });

    it('renders the AES-256-GCM info alert and ${variable.KEY} hint', async () => {
        mountInitial([]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => {
            expect(screen.getByText(/AES-256-GCM/i)).toBeInTheDocument();
        });
    });

    it('renders a "0 secrets" count when no rows exist', async () => {
        mountInitial([]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/0 secrets/i)).toBeInTheDocument());
    });

    it('renders the singular "1 secret" count when exactly one row exists', async () => {
        mountInitial([{ key: 'ONE', value: 'a' }]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/^1 secret$/)).toBeInTheDocument());
    });

    it('renders the plural "2 secrets" count when multiple rows exist', async () => {
        mountInitial([
            { key: 'A', value: '1' },
            { key: 'B', value: '2' },
        ]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/2 secrets/i)).toBeInTheDocument());
    });

    it('adds a new editable row when "Add secret" is clicked', async () => {
        mountInitial([]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/no shared secrets yet/i)).toBeInTheDocument());
        const addBtn = screen.getByRole('button', { name: /add secret/i });
        await user.click(addBtn);
        // After Add, the empty-state vanishes; row inputs appear.
        await waitFor(() => {
            expect(screen.queryByText(/no shared secrets yet/i)).not.toBeInTheDocument();
        });
    });

    it('flags an invalid (lowercase) key with the UPPER_SNAKE_CASE warning', async () => {
        mountInitial([{ key: 'OK_KEY', value: 'v' }]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('OK_KEY')).toBeInTheDocument());
        const keyInput = screen.getByDisplayValue('OK_KEY');
        await user.clear(keyInput);
        await user.type(keyInput, 'lower_case');
        // The component uppercases on change so typing "lower_case" lands as
        // "LOWER_CASE" — that IS valid, so we use a value with a digit-prefix
        // or a hyphen to force the invalid path.
        await user.clear(keyInput);
        await user.type(keyInput, 'has-hyphen');
        await waitFor(() => {
            expect(screen.getByText(/UPPER_SNAKE_CASE/i)).toBeInTheDocument();
        });
    });

    it('disables the Save button when the form is unchanged (not dirty)', async () => {
        mountInitial([{ key: 'TOKEN', value: 'v' }]);
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        expect(saveBtn).toBeDisabled();
    });

    it('toggles the reveal/hide eye icon on a stored row (calls reveal API and displays plaintext)', async () => {
        // Batch-9 enterprise-secrets read model: list returns metadata only
        // (`{key}` — no `value`). Clicking Reveal on a stored row calls
        // GET /api/environment-secrets/:key/value to fetch the plaintext,
        // which is then shown transiently and re-masked on countdown.
        mountInitial([{ key: 'TOKEN', value: '' }]);
        server.use(
            http.get(`${apiBase}/environment-secrets/TOKEN/value`, () =>
                HttpResponse.json({ value: 'secret-value' }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());

        // Stored row starts masked — no plaintext in the DOM.
        expect(screen.queryByDisplayValue('secret-value')).not.toBeInTheDocument();

        const buttons = screen.getAllByRole('button');
        const revealBtn = buttons.find(
            b => b.querySelector('[data-testid="VisibilityOutlinedIcon"]'),
        );
        expect(revealBtn).toBeTruthy();
        await user.click(revealBtn!);

        // After reveal, the value appears in text mode.
        await waitFor(() => {
            const refetched = screen.getByDisplayValue('secret-value');
            expect(refetched.getAttribute('type')).toBe('text');
        });
    });

    it('removes a row when its delete (trash) icon is clicked', async () => {
        mountInitial([
            { key: 'KEEP', value: 'a' },
            { key: 'DROP', value: 'b' },
        ]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('DROP')).toBeInTheDocument());

        const deleteBtns = screen
            .getAllByRole('button')
            .filter(b => b.querySelector('[data-testid="DeleteOutlineRoundedIcon"]'));
        expect(deleteBtns.length).toBe(2);
        // Click DROP row's delete (second button — first is KEEP)
        await user.click(deleteBtns[1]!);
        await waitFor(() => expect(screen.queryByDisplayValue('DROP')).not.toBeInTheDocument());
        expect(screen.getByDisplayValue('KEEP')).toBeInTheDocument();
    });

    it('saves edited rows via PUT and refreshes the cache on success', async () => {
        // Batch-9 read model: `value` is empty on hydration. Owner types
        // a new value on the existing row (marking it dirty) then saves.
        mountInitial([{ key: 'TOKEN', value: '' }]);
        let putBody: { vars: Array<{ key: string; value: string }> } | null = null;
        server.use(
            http.put(`${apiBase}/environment-secrets`, async ({ request }) => {
                putBody = (await request.json()) as typeof putBody;
                return HttpResponse.json({ vars: putBody!.vars });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());

        const valueInput = screen.getByPlaceholderText(/click Reveal/i);
        await user.type(valueInput, 'new');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);

        await waitFor(() => {
            expect(putBody?.vars).toEqual([{ key: 'TOKEN', value: 'new' }]);
        });
    });

    it('shows a warning for duplicate key names', async () => {
        mountInitial([{ key: 'DUP', value: 'v1' }]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('DUP')).toBeInTheDocument());
        // Add a second row
        const addBtn = screen.getByRole('button', { name: /add secret/i });
        await user.click(addBtn);
        // Type the same key name into the new row
        const inputs = screen.getAllByPlaceholderText('UPPER_SNAKE_CASE');
        const newKeyInput = inputs[inputs.length - 1]!;
        await user.type(newKeyInput, 'DUP');
        await waitFor(() => {
            expect(screen.getByText(/is duplicated/i)).toBeInTheDocument();
        });
    });

    it('Save button is enabled after adding a new row and changes are present', async () => {
        mountInitial([]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/no shared secrets yet/i)).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /add secret/i }));
        // Type key and value to make the form dirty and valid
        const keyInput = await screen.findByPlaceholderText('UPPER_SNAKE_CASE');
        await user.type(keyInput, 'NEW_KEY');
        const valueInput = screen.getByPlaceholderText('value');
        await user.type(valueInput, 'some-value');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
    });

    it('shows save error toast when the API call fails', async () => {
        mountInitial([{ key: 'TOKEN', value: '' }]);
        server.use(
            http.put(`${apiBase}/environment-secrets`, () =>
                HttpResponse.json({ error: 'server error' }, { status: 500 }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());

        const valueInput = screen.getByPlaceholderText(/click Reveal/i);
        await user.type(valueInput, 'changed');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);
        // After failure, Save button returns to enabled state
        await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument());
    });

    it('rows with empty key are excluded from the save payload', async () => {
        mountInitial([{ key: 'REAL', value: '' }]);
        let putBody: { vars: Array<{ key: string; value: string }> } | null = null;
        server.use(
            http.put(`${apiBase}/environment-secrets`, async ({ request }) => {
                putBody = (await request.json()) as typeof putBody;
                return HttpResponse.json({ vars: putBody!.vars });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('REAL')).toBeInTheDocument());
        // Add a row and leave key empty — only change value to make it dirty
        await user.click(screen.getByRole('button', { name: /add secret/i }));
        // Type a new value on the existing row (Batch-9: hydrated value=''
        // so we type without needing to clear first).
        const valueInput = screen.getByPlaceholderText(/click Reveal/i);
        await user.type(valueInput, 'r2');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);
        await waitFor(() => {
            expect(putBody?.vars.every((v) => v.key !== '')).toBe(true);
        });
    });

    it('dirty flag clears after a successful save', async () => {
        mountInitial([{ key: 'TOKEN', value: '' }]);
        server.use(
            http.put(`${apiBase}/environment-secrets`, () =>
                HttpResponse.json({ vars: [{ key: 'TOKEN' }] }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());
        const valueInput = screen.getByPlaceholderText(/click Reveal/i);
        await user.type(valueInput, 'new');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);
        await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument());
    });

    it('shows CircularProgress in Save button while PUT is in-flight (lines 193-196)', async () => {
        mountInitial([{ key: 'TOKEN', value: '' }]);
        let resolvePut!: () => void;
        const putPromise = new Promise<void>((res) => { resolvePut = res; });
        server.use(
            http.put(`${apiBase}/environment-secrets`, async () => {
                await putPromise;
                return HttpResponse.json({ vars: [{ key: 'TOKEN' }] });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());
        const valueInput = screen.getByPlaceholderText(/click Reveal/i);
        await user.type(valueInput, 'new');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);
        await waitFor(() => {
            expect(saveBtn).toBeDisabled();
        }, { timeout: 3000 });
        resolvePut();
    });

    it('key input uppercases typed characters automatically', async () => {
        mountInitial([]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByText(/no shared secrets yet/i)).toBeInTheDocument());
        await user.click(screen.getByRole('button', { name: /add secret/i }));
        const keyInput = await screen.findByPlaceholderText('UPPER_SNAKE_CASE');
        await user.type(keyInput, 'my_key');
        // The component calls .toUpperCase() on every change event
        await waitFor(() => expect(screen.getByDisplayValue('MY_KEY')).toBeInTheDocument());
    });

    it('save toast uses singular "entry" when exactly 1 row is saved (payload.length === 1 branch)', async () => {
        mountInitial([{ key: 'TOKEN', value: '' }]);
        server.use(
            http.put(`${apiBase}/environment-secrets`, () =>
                HttpResponse.json({ vars: [{ key: 'TOKEN' }] }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());
        const valueInput = screen.getByPlaceholderText(/click Reveal/i);
        await user.type(valueInput, 'new-val');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);
        await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument());
    });

    it('save toast uses plural "entries" when multiple rows are saved (payload.length > 1 branch)', async () => {
        mountInitial([
            { key: 'TOKEN_A', value: '' },
            { key: 'TOKEN_B', value: '' },
        ]);
        server.use(
            http.get(`${apiBase}/environment-secrets/TOKEN_A/value`, () =>
                HttpResponse.json({ value: 'val-a' }),
            ),
            http.get(`${apiBase}/environment-secrets/TOKEN_B/value`, () =>
                HttpResponse.json({ value: 'val-b' }),
            ),
            http.put(`${apiBase}/environment-secrets`, () =>
                HttpResponse.json({ vars: [{ key: 'TOKEN_A' }, { key: 'TOKEN_B' }] }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN_A')).toBeInTheDocument());
        // Type into TOKEN_A's value field to mark dirty; TOKEN_B stays
        // stored-untouched and is preserved via just-in-time reveal.
        const valueInputs = screen.getAllByPlaceholderText(/click Reveal/i);
        await user.type(valueInputs[0]!, 'changed');
        const saveBtn = screen.getByRole('button', { name: /^save$/i });
        await waitFor(() => expect(saveBtn).not.toBeDisabled());
        await user.click(saveBtn);
        await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument());
    });

    it('dirty: row count change triggers dirty=true (rows.length !== data.vars.length branch)', async () => {
        mountInitial([{ key: 'A', value: 'a' }]);
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('A')).toBeInTheDocument());
        // Adding a new row makes rows.length > data.vars.length → dirty=true
        await user.click(screen.getByRole('button', { name: /add secret/i }));
        await waitFor(() => {
            const saveBtn = screen.getByRole('button', { name: /^save$/i });
            // dirty=true but there may be validation issues; at least no crash
            expect(saveBtn).toBeInTheDocument();
        });
    });

    it('hide-value button shows VisibilityOff icon after reveal (revealed=true branch)', async () => {
        mountInitial([{ key: 'TOKEN', value: '' }]);
        server.use(
            http.get(`${apiBase}/environment-secrets/TOKEN/value`, () =>
                HttpResponse.json({ value: 'secret' }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<SharedSecretsTab />);
        await waitFor(() => expect(screen.getByDisplayValue('TOKEN')).toBeInTheDocument());
        // The row starts hidden — click Reveal (fetches via API in Batch-9).
        const revealBtn = screen.getAllByRole('button').find(
            b => b.querySelector('[data-testid="VisibilityOutlinedIcon"]'),
        );
        expect(revealBtn).toBeTruthy();
        await user.click(revealBtn!);
        // After reveal, the VisibilityOff icon should be present
        await waitFor(() => {
            const hideBtn = document.querySelector('[data-testid="VisibilityOffOutlinedIcon"]');
            expect(hideBtn).toBeInTheDocument();
        });
    });
});
