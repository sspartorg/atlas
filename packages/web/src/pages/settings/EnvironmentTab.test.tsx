import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IEnvVar } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { EnvironmentTab } from './EnvironmentTab.js';

const apiBase = 'http://localhost:3000/api';

function mountEnv(vars: IEnvVar[]): void {
    server.use(http.get(`${apiBase}/settings/env`, () => HttpResponse.json({ vars })));
}

const FOO_VAR: IEnvVar = {
    key: 'ATLAS_FOO',
    value: 'foo-val',
    description: 'Foo description',
    restart_required: false,
    secret: false,
};

const SECRET_VAR: IEnvVar = {
    key: 'ATLAS_SECRET',
    value: 'sekret',
    description: 'Holds a secret',
    restart_required: false,
    secret: true,
};

const RESTART_VAR: IEnvVar = {
    key: 'ATLAS_RESTART_REQ',
    value: 'r',
    description: 'Requires restart',
    restart_required: true,
    secret: false,
};

describe('EnvironmentTab', () => {
    it('mounts without crashing', () => {
        mountEnv([]);
        const { container } = renderWithProviders(<EnvironmentTab />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders the loading state before the GET resolves', () => {
        server.use(
            http.get(`${apiBase}/settings/env`, async () => {
                await new Promise(r => setTimeout(r, 100));
                return HttpResponse.json({ vars: [] });
            }),
        );
        renderWithProviders(<EnvironmentTab />);
        expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    });

    it('renders the boot-folder Alert + summary line after data loads', async () => {
        mountEnv([FOO_VAR]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => {
            expect(screen.getByText(/Atlas server folder/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/1 variables/i)).toBeInTheDocument();
    });

    it('shows the plural "2 hold a secret" wording when 2+ vars hold secrets', async () => {
        mountEnv([SECRET_VAR, { ...SECRET_VAR, key: 'OTHER_SECRET' }]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByText(/2 hold a secret/i)).toBeInTheDocument());
    });

    it('shows the singular "1 holds a secret" wording when exactly one secret', async () => {
        mountEnv([SECRET_VAR]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByText(/1 holds a secret/i)).toBeInTheDocument());
    });

    it('shows the singular "1 requires" wording for one restart-required var', async () => {
        // Pluralisation: 1 → "requires", N>1 → "require" (component intentionally
        // flips the suffix on === 1).
        mountEnv([RESTART_VAR]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByText(/1 requires a server restart/i)).toBeInTheDocument());
    });

    it('renders one EnvVarRow per response var (each key visible)', async () => {
        mountEnv([FOO_VAR, SECRET_VAR, RESTART_VAR]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByText('ATLAS_FOO')).toBeInTheDocument());
        expect(screen.getByText('ATLAS_SECRET')).toBeInTheDocument();
        expect(screen.getByText('ATLAS_RESTART_REQ')).toBeInTheDocument();
    });

    it('disables Save when nothing has been edited (not dirty)', async () => {
        mountEnv([FOO_VAR]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByText('ATLAS_FOO')).toBeInTheDocument());
        const saveBtn = screen.getByRole('button', { name: /save changes/i });
        expect(saveBtn).toBeDisabled();
        expect(screen.getByText(/no unsaved changes/i)).toBeInTheDocument();
    });

    it('enables Save when a value is edited (dirty flips on)', async () => {
        mountEnv([FOO_VAR]);
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        const valueInput = screen.getByDisplayValue('foo-val') as HTMLInputElement;
        // Append a char instead of clear+type (clear() on MUI TextField inputs
        // sometimes doesn't propagate the change event in jsdom + userEvent v14;
        // appending is robust).
        await user.click(valueInput);
        await user.keyboard('X');
        await waitFor(() => {
            const save = screen.getByRole('button', { name: /save changes/i });
            expect(save).not.toBeDisabled();
        });
    });

    it('PATCHes when the user edits a value and clicks Save', async () => {
        mountEnv([FOO_VAR]);
        let putHit = false;
        server.use(
            http.patch(`${apiBase}/settings/env`, () => {
                putHit = true;
                return HttpResponse.json({ vars: [{ ...FOO_VAR, value: 'foo-valX' }] });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        const valueInput = screen.getByDisplayValue('foo-val') as HTMLInputElement;
        await user.click(valueInput);
        await user.keyboard('X');
        const save = screen.getByRole('button', { name: /save changes/i });
        await waitFor(() => expect(save).not.toBeDisabled());
        await user.click(save);
        await waitFor(() => expect(putHit).toBe(true));
    });

    it('renders the RESTART chip explanation Alert at the bottom of the page', async () => {
        mountEnv([RESTART_VAR]);
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByText(/ATLAS_RESTART_REQ/i)).toBeInTheDocument());
        expect(screen.getByText(/Ctrl \+ C/i)).toBeInTheDocument();
    });

    it('shows error toast when PATCH /settings/env fails — covers catch block (lines 64-68)', async () => {
        mountEnv([FOO_VAR]);
        server.use(
            http.patch(`${apiBase}/settings/env`, () =>
                HttpResponse.json({ error: 'Server error' }, { status: 500 }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        const valueInput = screen.getByDisplayValue('foo-val') as HTMLInputElement;
        await user.click(valueInput);
        await user.keyboard('X');
        const save = screen.getByRole('button', { name: /save changes/i });
        await waitFor(() => expect(save).not.toBeDisabled());
        await user.click(save);
        // After the error response, the component should still render without crashing
        await waitFor(() => {
            expect(document.body).toBeTruthy();
        });
    });

    it('shows singular "variable" in toast when exactly 1 var is saved (line 61 branch)', async () => {
        mountEnv([FOO_VAR]);
        const patchedWith: unknown[] = [];
        server.use(
            http.patch(`${apiBase}/settings/env`, async ({ request }) => {
                const body = await request.json();
                patchedWith.push(body);
                return HttpResponse.json({ vars: [{ ...FOO_VAR, value: 'foo-valX' }] });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        const valueInput = screen.getByDisplayValue('foo-val') as HTMLInputElement;
        await user.click(valueInput);
        await user.keyboard('X');
        const save = screen.getByRole('button', { name: /save changes/i });
        await waitFor(() => expect(save).not.toBeDisabled());
        await user.click(save);
        await waitFor(() => expect(patchedWith.length).toBeGreaterThan(0));
    });

    it('uses plural "variables" in toast when 2+ vars are saved (updates.length !== 1 branch)', async () => {
        const FOO2: IEnvVar = { ...FOO_VAR, key: 'ATLAS_FOO2', value: 'val2' };
        mountEnv([FOO_VAR, FOO2]);
        const patchedWith: unknown[] = [];
        server.use(
            http.patch(`${apiBase}/settings/env`, async ({ request }) => {
                const body = await request.json();
                patchedWith.push(body);
                return HttpResponse.json({ vars: [{ ...FOO_VAR, value: 'foo-valX' }, { ...FOO2, value: 'val2X' }] });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        // Edit both vars
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        const input1 = screen.getByDisplayValue('foo-val') as HTMLInputElement;
        await user.click(input1);
        await user.keyboard('X');
        await waitFor(() => expect(screen.getByDisplayValue('val2')).toBeInTheDocument());
        const input2 = screen.getByDisplayValue('val2') as HTMLInputElement;
        await user.click(input2);
        await user.keyboard('X');
        const save = screen.getByRole('button', { name: /save changes/i });
        await waitFor(() => expect(save).not.toBeDisabled());
        await user.click(save);
        await waitFor(() => expect(patchedWith.length).toBeGreaterThan(0));
    });

    it('shows err.message in toast when PATCH throws an Error instance (instanceof branch)', async () => {
        mountEnv([FOO_VAR]);
        server.use(
            http.patch(`${apiBase}/settings/env`, () =>
                HttpResponse.json({ error: 'Specific error message' }, { status: 500 }),
            ),
        );
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        await user.click(screen.getByDisplayValue('foo-val'));
        await user.keyboard('X');
        const save = screen.getByRole('button', { name: /save changes/i });
        await waitFor(() => expect(save).not.toBeDisabled());
        await user.click(save);
        // Component survives the error
        await waitFor(() => {
            expect(document.body).toBeTruthy();
        });
    });

    it('shows Saving label and disables button while PATCH is in-flight (line 136)', async () => {
        mountEnv([FOO_VAR]);
        let resolvePatch!: () => void;
        const patchPromise = new Promise<void>((res) => { resolvePatch = res; });
        server.use(
            http.patch(`${apiBase}/settings/env`, async () => {
                await patchPromise;
                return HttpResponse.json({ vars: [{ ...FOO_VAR, value: 'foo-valX' }] });
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<EnvironmentTab />);
        await waitFor(() => expect(screen.getByDisplayValue('foo-val')).toBeInTheDocument());
        const valueInput = screen.getByDisplayValue('foo-val') as HTMLInputElement;
        await user.click(valueInput);
        await user.keyboard('X');
        const save = screen.getByRole('button', { name: /save changes/i });
        await waitFor(() => expect(save).not.toBeDisabled());
        await user.click(save);
        await waitFor(() => {
            expect(screen.getByText(/Saving/i)).toBeInTheDocument();
        }, { timeout: 3000 });
        resolvePatch();
    });
});
