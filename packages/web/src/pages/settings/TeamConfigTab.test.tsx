import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ITeamConfig, ITeamConfigHelp } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Toast } from '../../components/Toast.js';
import { TeamConfigTab } from './TeamConfigTab.js';

const apiBase = 'http://localhost:3000/api';

const CONFIG: ITeamConfig = {
    role: 'subscriber',
    repo_url: 'https://github.com/acme/team.git',
    credential_id: 'c1',
    branch: 'main',
    interval_minutes: 60,
    last_sync_at: null,
    last_sync_ok: null,
    last_sync_message: null,
    last_commit: null,
};

interface MountOptions {
    config?: Partial<ITeamConfig>;
    help?: ITeamConfigHelp;
    putError?: string;
    syncError?: string;
}

function mount(onPut: (body: unknown) => void = () => undefined, opts: MountOptions = {}) {
    let current = { ...CONFIG, ...opts.config };
    const syncs: unknown[] = [];
    server.use(
        http.get(`${apiBase}/team-config`, () => HttpResponse.json(current)),
        http.put(`${apiBase}/team-config`, async ({ request }) => {
            const body = (await request.json()) as Partial<ITeamConfig>;
            onPut(body);
            if (opts.putError) return HttpResponse.json({ error: opts.putError }, { status: 400 });
            current = { ...current, ...body };
            return HttpResponse.json(current);
        }),
        http.post(`${apiBase}/team-config/sync`, () => {
            syncs.push(true);
            if (opts.syncError) return HttpResponse.json({ error: opts.syncError }, { status: 502 });
            current = { ...current, last_sync_at: '2026-10-07T10:00:00.000Z', last_sync_ok: true, last_sync_message: 'Up to date with abc1234' };
            return HttpResponse.json({ message: 'Up to date with abc1234', config: current });
        }),
        http.get(`${apiBase}/team-config/help`, () => HttpResponse.json(opts.help ?? { readme_md: '', projects: [] })),
        http.get(`${apiBase}/credentials`, () =>
            HttpResponse.json([
                { id: 'c1', label: 'My GitHub' },
                { id: 'c2', label: 'Work GitHub' },
            ])
        )
    );
    renderWithProviders(
        <>
            <TeamConfigTab />
            <Toast />
        </>
    );
    return { syncs };
}

async function pick(label: string, option: string) {
    await userEvent.click(await screen.findByRole('combobox', { name: label }));
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: option }));
}

describe('TeamConfigTab', () => {
    it('shows the saved connection and explains the role', async () => {
        mount();
        expect(await screen.findByDisplayValue('https://github.com/acme/team.git')).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Team config role' })).toHaveTextContent('Subscriber');
        expect(screen.getByText(/my own items are never touched/)).toBeInTheDocument();
        expect(await screen.findByRole('combobox', { name: 'Team config credential' })).toHaveTextContent('My GitHub');
        expect(screen.getByDisplayValue('main')).toBeInTheDocument();
        expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    });

    it('saves the role as soon as it is picked', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await pick('Team config role', 'Publisher');
        await waitFor(() => expect(puts).toEqual([{ role: 'publisher' }]));
        expect(await screen.findByText('Team config saved')).toBeInTheDocument();
        expect(await screen.findByText(/pushed within a minute of a change/)).toBeInTheDocument();
    });

    it('saves the credential as soon as it is picked', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await pick('Team config credential', 'Work GitHub');
        await waitFor(() => expect(puts).toEqual([{ credential_id: 'c2' }]));
    });

    it('saves the repo URL on blur, and only when it changed', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByDisplayValue('https://github.com/acme/team.git');
        await userEvent.click(field);
        await userEvent.tab();
        expect(puts).toEqual([]);
        await userEvent.clear(field);
        await userEvent.type(field, 'https://github.com/acme/other.git');
        expect(puts).toEqual([]);
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ repo_url: 'https://github.com/acme/other.git' }]));
    });

    it('clears the repo URL to null when emptied', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await userEvent.clear(await screen.findByDisplayValue('https://github.com/acme/team.git'));
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ repo_url: null }]));
    });

    it('shows why a save was refused', async () => {
        mount(undefined, { putError: 'Use an https:// git URL' });
        const field = await screen.findByDisplayValue('https://github.com/acme/team.git');
        await userEvent.clear(field);
        await userEvent.type(field, 'http://github.com/acme/team.git');
        await userEvent.tab();
        expect(await screen.findByText('Could not save')).toBeInTheDocument();
        expect(screen.getByText('Use an https:// git URL')).toBeInTheDocument();
    });

    it('saves the branch on blur and restores it when blanked', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByDisplayValue('main');
        await userEvent.clear(field);
        await userEvent.tab();
        expect(field).toHaveValue('main');
        expect(puts).toEqual([]);
        await userEvent.clear(field);
        await userEvent.type(field, 'atlas-sync');
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ branch: 'atlas-sync' }]));
    });

    it('saves a valid interval and reverts one under five minutes', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByLabelText('Sync interval in minutes');
        await userEvent.clear(field);
        await userEvent.type(field, '2');
        await userEvent.tab();
        expect(field).toHaveValue(60);
        expect(puts).toEqual([]);
        await userEvent.clear(field);
        await userEvent.type(field, '15');
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ interval_minutes: 15 }]));
    });

    it('syncs on demand and shows the result', async () => {
        const { syncs } = mount();
        await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
        expect(await screen.findByText('Team config synced')).toBeInTheDocument();
        expect(syncs).toHaveLength(1);
        expect(await screen.findByText(/Last sync/)).toHaveTextContent('Up to date with abc1234');
    });

    it('shows a failed sync', async () => {
        mount(undefined, { syncError: 'remote: Repository not found.' });
        await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
        expect(await screen.findByText('Team config sync failed')).toBeInTheDocument();
        expect(screen.getByText('remote: Repository not found.')).toBeInTheDocument();
    });

    it('shows the last sync message, including a subscriber note per line', async () => {
        mount(undefined, {
            config: { last_sync_at: '2026-10-07T10:00:00.000Z', last_sync_ok: false, last_sync_message: 'MYO: your local project "Mine" already uses this key' },
        });
        expect(await screen.findByText(/already uses this key/)).toBeInTheDocument();
    });

    it.each([
        ['the role is off', { role: 'off' as const }],
        ['there is no repo URL', { repo_url: null }],
        ['there is no credential', { credential_id: null }],
    ])('disables Sync now while %s', async (_case, config) => {
        mount(undefined, { config });
        expect(await screen.findByRole('button', { name: 'Sync now' })).toBeDisabled();
    });

    it('renders the team README once there is one', async () => {
        mount(undefined, { help: { readme_md: '# Our team\n\nUse currentUser() in JQL.', projects: [] } });
        expect(await screen.findByText('Team guide')).toBeInTheDocument();
        expect(screen.getByText('Our team')).toBeInTheDocument();
    });

    it('hides the guide before the first sync', async () => {
        mount();
        await screen.findByDisplayValue('https://github.com/acme/team.git');
        expect(screen.queryByText('Team guide')).not.toBeInTheDocument();
    });
});
