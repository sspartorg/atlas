import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { SecretsBundleDialog } from './SecretsBundleDialog.js';

const BASE = 'http://localhost:3000/api';

describe('SecretsBundleDialog', () => {
    it('exports only once the passphrase is long enough and confirmed', async () => {
        let body: unknown;
        server.use(
            http.post(`${BASE}/secrets-bundle/export`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ format: 'atlas-secrets' });
            })
        );
        URL.createObjectURL = vi.fn(() => 'blob:x');
        URL.revokeObjectURL = vi.fn();
        const onClose = vi.fn();
        renderWithProviders(<SecretsBundleDialog mode="export" onClose={onClose} />);
        const exportBtn = screen.getByRole('button', { name: 'Export' });

        await userEvent.type(screen.getByLabelText('Passphrase'), 'short');
        expect(exportBtn).toBeDisabled();
        await userEvent.type(screen.getByLabelText('Passphrase'), ' enough');
        await userEvent.type(screen.getByLabelText('Confirm passphrase'), 'short enough');
        await userEvent.click(exportBtn);

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(body).toEqual({ passphrase: 'short enough' });
    });

    it('imports the chosen file and keeps the dialog open on a wrong passphrase', async () => {
        server.use(
            http.post(`${BASE}/secrets-bundle/import`, () =>
                HttpResponse.json({ error: 'Wrong passphrase, or the secrets file is damaged', kind: 'credentials_invalid' }, { status: 400 })
            )
        );
        const onClose = vi.fn();
        renderWithProviders(<SecretsBundleDialog mode="import" onClose={onClose} />);
        await userEvent.upload(
            screen.getByLabelText('Secrets file'),
            new File(['{"format":"atlas-secrets"}'], 'atlas-secrets.json', { type: 'application/json' })
        );
        await userEvent.type(screen.getByLabelText('Passphrase'), 'nope');
        await userEvent.click(screen.getByRole('button', { name: 'Import' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/Wrong passphrase/);
        expect(onClose).not.toHaveBeenCalled();
    });
});
