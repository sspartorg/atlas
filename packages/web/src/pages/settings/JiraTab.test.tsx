import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IJiraConfig, IProjectRepo, IWorkflow } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { makeProject } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Toast } from '../../components/Toast.js';
import { JiraTab } from './JiraTab.js';

const apiBase = 'http://localhost:3000/api';

const CONFIG: IJiraConfig = {
    enabled: true,
    site_url: 'https://acme.atlassian.net',
    email: 'me@acme.test',
    api_token_set: true,
    poll_interval_minutes: 60,
    extra_fields: [],
    last_sync_at: null,
    last_sync_ok: null,
    last_sync_message: null,
};

const repo = (id: string, project_id: string, name: string) =>
    ({ id, project_id, name }) as IProjectRepo;

const workflow = (
    id: string,
    name: string,
    input_kind: 'item' | 'none' = 'item',
    project_id: string | null = 'p1'
) => ({ id, name, input_kind, project_id }) as IWorkflow;

interface MountOptions {
    /** Seed config overrides — e.g. a config with no token stored yet. */
    config?: Partial<IJiraConfig>;
    /** Make every PUT fail with this message, to drive the save-error path. */
    putError?: string;
}

function mount(
    onPut: (body: unknown) => void = () => undefined,
    { config, putError }: MountOptions = {}
) {
    let current = { ...CONFIG, ...config };
    server.use(
        http.get(`${apiBase}/integrations/jira`, () => HttpResponse.json(current)),
        http.put(`${apiBase}/integrations/jira`, async ({ request }) => {
            const body = (await request.json()) as Partial<IJiraConfig>;
            onPut(body);
            if (putError) {
                return HttpResponse.json({ error: putError }, { status: 500 });
            }
            current = { ...current, ...body };
            return HttpResponse.json(current);
        }),
        http.get(`${apiBase}/projects`, () =>
            HttpResponse.json([
                makeProject({ id: 'p1', name: 'Sandbox' }),
                makeProject({ id: 'p2', name: 'Site' }),
            ])
        ),
        http.get(`${apiBase}/repos`, () =>
            HttpResponse.json([
                repo('p1', 'p1', 'core'),
                repo('r-web', 'p1', 'web'),
                repo('p2', 'p2', 'site'),
            ])
        ),
        http.get(`${apiBase}/workflows`, () =>
            HttpResponse.json([
                workflow('wf-dev', 'Development'),
                workflow('wf-qa', 'QA', 'item', null),
                workflow('wf-news', 'News', 'none'),
                workflow('wf-site', 'Site delivery', 'item', 'p2'),
            ])
        )
    );
    // `<Toast />` is mounted alongside the tab so the toast copy each handler
    // emits is asserted as rendered text rather than through a spy —
    // `ToastProvider` on its own supplies context and renders nothing.
    renderWithProviders(
        <>
            <JiraTab />
            <Toast />
        </>
    );
}

describe('JiraTab', () => {
    it('shows the saved connection without the token', async () => {
        mount();
        expect(await screen.findByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument();
        expect(screen.getByLabelText('Jira API token')).toHaveValue('');
        expect(screen.getByPlaceholderText('Stored. Type to replace.')).toBeInTheDocument();
    });

    // Sources moved to each project's Jira tab (migration 010); their tests
    // live in pages/project/ProjectJiraCard.test.tsx.
    it('points at the project tab instead of listing sources', async () => {
        mount();
        expect(await screen.findByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument();
        expect(screen.queryByLabelText('Source JQL')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();
        expect(screen.getByText(/Sources live on each project/)).toBeInTheDocument();
    });

    // ─── Connection fields: commit on blur, not on keystroke ────────────────
    //
    // Every field here saves on blur. If a field saved per keystroke the
    // Owner's half-typed site URL would be PUT to the API and the encrypted
    // token dropped with it (the API clears a stored token when the site or
    // email changes without one). These tests pin the blur contract.

    it('saves a changed site URL on blur', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByPlaceholderText('https://your-site.atlassian.net');
        await userEvent.clear(field);
        await userEvent.type(field, 'https://new.atlassian.net');
        // Nothing is sent while typing.
        expect(puts).toEqual([]);
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ site_url: 'https://new.atlassian.net' }]));
        expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();
    });

    it('sends nothing when the site URL is blurred unchanged', async () => {
        // A tab-through of the settings form must not churn the config —
        // an unchanged PUT would re-stamp the row for no reason.
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByPlaceholderText('https://your-site.atlassian.net');
        await userEvent.click(field);
        await userEvent.tab();
        await waitFor(() =>
            expect(screen.getByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument()
        );
        expect(puts).toEqual([]);
    });

    it('clears the site URL to null rather than an empty string', async () => {
        // The API column is nullable; '' and null are different states and
        // only null reads back as "not configured".
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByPlaceholderText('https://your-site.atlassian.net');
        await userEvent.clear(field);
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ site_url: null }]));
    });

    it('saves a changed email on blur', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByPlaceholderText('you@example.com');
        await userEvent.clear(field);
        await userEvent.type(field, 'new@acme.test');
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ email: 'new@acme.test' }]));
    });

    it('sends the token together with the site and email, then clears the box', async () => {
        // The API drops a stored token whenever the site or email changes
        // without one, so the three must land in a single PUT. Splitting them
        // silently de-authenticates the integration.
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const token = await screen.findByLabelText('Jira API token');
        await userEvent.type(token, '  secret-token  ');
        await userEvent.tab();
        await waitFor(() =>
            expect(puts).toEqual([
                {
                    api_token: 'secret-token',
                    site_url: 'https://acme.atlassian.net',
                    email: 'me@acme.test',
                },
            ])
        );
        expect(await screen.findByText('API token saved')).toBeInTheDocument();
        // The secret must not linger in a DOM node after it is saved.
        expect(token).toHaveValue('');
    });

    it('does not PUT when the token box is blurred empty', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await userEvent.click(await screen.findByLabelText('Jira API token'));
        await userEvent.tab();
        await waitFor(() =>
            expect(screen.getByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument()
        );
        expect(puts).toEqual([]);
    });

    it('surfaces the API message when a save fails', async () => {
        // Without this the field would look saved while the config on disk
        // still held the old value — the worst kind of silent settings bug.
        mount(() => undefined, { putError: 'site_url must be https' });
        const field = await screen.findByPlaceholderText('https://your-site.atlassian.net');
        await userEvent.clear(field);
        await userEvent.type(field, 'http://insecure.example');
        await userEvent.tab();
        expect(await screen.findByText('Could not save')).toBeInTheDocument();
        expect(await screen.findByText('site_url must be https')).toBeInTheDocument();
    });

    // ─── Import settings ────────────────────────────────────────────────────

    it('toggles sync off and names the new state in the toast', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await userEvent.click(await screen.findByLabelText('Jira sync enabled'));
        await waitFor(() => expect(puts).toEqual([{ enabled: false }]));
        expect(await screen.findByText('Jira sync off')).toBeInTheDocument();
    });

    it('toggles sync back on', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b), { config: { enabled: false } });
        await userEvent.click(await screen.findByLabelText('Jira sync enabled'));
        await waitFor(() => expect(puts).toEqual([{ enabled: true }]));
        expect(await screen.findByText('Jira sync on')).toBeInTheDocument();
    });

    it('saves a new poll interval on blur', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByLabelText('Poll interval in minutes');
        await userEvent.clear(field);
        await userEvent.type(field, '15');
        await userEvent.tab();
        await waitFor(() => expect(puts).toEqual([{ poll_interval_minutes: 15 }]));
    });

    it('rejects an interval under five minutes and restores the saved value', async () => {
        // Five minutes is the API's floor; a 1-minute poll would hammer
        // Atlassian into rate-limiting the whole site. The field snapping
        // back is the Owner's only signal that the value was refused.
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByLabelText('Poll interval in minutes');
        await userEvent.clear(field);
        await userEvent.type(field, '2');
        await userEvent.tab();
        await waitFor(() => expect(field).toHaveValue(60));
        expect(puts).toEqual([]);
    });

    it('rejects a non-integer interval', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByLabelText('Poll interval in minutes');
        await userEvent.clear(field);
        await userEvent.tab();
        await waitFor(() => expect(field).toHaveValue(60));
        expect(puts).toEqual([]);
    });

    it('splits extra fields on commas and drops the blanks', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        const field = await screen.findByPlaceholderText('Acceptance Criteria, customfield_10016');
        await userEvent.type(field, ' Acceptance Criteria , , customfield_10016 ');
        await userEvent.tab();
        await waitFor(() =>
            expect(puts).toEqual([{ extra_fields: ['Acceptance Criteria', 'customfield_10016'] }])
        );
    });

    it('sends nothing when the extra-field list is blurred unchanged', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b), { config: { extra_fields: ['Story Points'] } });
        const field = await screen.findByDisplayValue('Story Points');
        await userEvent.click(field);
        await userEvent.tab();
        await waitFor(() =>
            expect(screen.getByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument()
        );
        expect(puts).toEqual([]);
    });

    // ─── Test connection / Sync now ─────────────────────────────────────────

    it('names the authenticated Jira account after a successful test', async () => {
        mount();
        server.use(
            http.post(`${apiBase}/integrations/jira/test`, () =>
                HttpResponse.json({ ok: true, display_name: 'Ada Lovelace' })
            )
        );
        await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
        expect(await screen.findByText('Connected to Jira as Ada Lovelace')).toBeInTheDocument();
    });

    it('reports why a connection test failed', async () => {
        mount();
        server.use(
            http.post(`${apiBase}/integrations/jira/test`, () =>
                HttpResponse.json({ error: 'Unauthorized (401)' }, { status: 401 })
            )
        );
        await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
        expect(await screen.findByText('Jira connection failed')).toBeInTheDocument();
        expect(await screen.findByText('Unauthorized (401)')).toBeInTheDocument();
    });

    it('cannot test or sync before a token is stored', async () => {
        // Both calls need the encrypted token server-side; enabling them
        // without one only produces a confusing 401.
        mount(() => undefined, { config: { api_token_set: false } });
        expect(await screen.findByRole('button', { name: 'Test connection' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
    });

    // The token is write-only over the config read, so the field could never show
    // which token is in place. Reveal is a separate, audited call. There is no
    // local unmask mode: every field here saves on blur, so clicking the eye
    // commits what you typed first — "show me what I'm about to save" can't happen.
    it('fetches the stored token on demand and hides it again', async () => {
        let reveals = 0;
        server.use(
            http.post(`${apiBase}/integrations/jira/reveal-token`, () => {
                reveals++;
                return HttpResponse.json({ value: 'stored-tok' });
            })
        );
        mount();
        const field = await screen.findByLabelText('Jira API token');
        expect(field).toHaveAttribute('type', 'password');

        await userEvent.click(screen.getByRole('button', { name: 'Show Jira API token' }));
        await waitFor(() => expect(field).toHaveValue('stored-tok'));
        expect(field).toHaveAttribute('type', 'text');
        expect(reveals).toBe(1);

        await userEvent.click(screen.getByRole('button', { name: 'Hide Jira API token' }));
        expect(field).toHaveValue('');
        expect(field).toHaveAttribute('type', 'password');
    });

    it('says so when the reveal call fails', async () => {
        server.use(
            http.post(`${apiBase}/integrations/jira/reveal-token`, () =>
                HttpResponse.json({ error: 'Vault unreachable' }, { status: 500 })
            )
        );
        mount();
        await userEvent.click(
            await screen.findByRole('button', { name: 'Show Jira API token' })
        );
        expect(await screen.findByText('Could not reveal')).toBeInTheDocument();
        expect(screen.getByLabelText('Jira API token')).toHaveAttribute('type', 'password');
    });

    it('cannot reveal when no token is stored', async () => {
        mount(() => undefined, { config: { api_token_set: false } });
        expect(await screen.findByRole('button', { name: 'Show Jira API token' })).toBeDisabled();
    });

    // G-014: a manual sync writes comments to real Jira issues, so it follows the
    // same switch the poller does. Running it from a switched-off bridge posted
    // one comment and then went silent, which read like a broken workflow.
    it('cannot sync while the bridge is switched off', async () => {
        mount(() => undefined, { config: { enabled: false } });
        const sync = await screen.findByRole('button', { name: 'Sync now' });
        expect(sync).toBeDisabled();
        expect(sync).toHaveAttribute('title', expect.stringContaining('Turn on Import'));
        // Testing the connection is still fine — it writes nothing.
        expect(screen.getByRole('button', { name: 'Test connection' })).toBeEnabled();
    });

    it('reports what a manual sync imported and commented', async () => {
        mount();
        server.use(
            http.post(`${apiBase}/integrations/jira/sync`, () =>
                HttpResponse.json({ imported: 3, comments_posted: 2 })
            )
        );
        await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
        expect(
            await screen.findByText('Jira sync: 3 imported, 2 comment(s) posted')
        ).toBeInTheDocument();
    });

    it('reports why a manual sync failed', async () => {
        mount();
        server.use(
            http.post(`${apiBase}/integrations/jira/sync`, () =>
                HttpResponse.json({ error: 'JQL is invalid' }, { status: 400 })
            )
        );
        await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }));
        expect(await screen.findByText('Jira sync failed')).toBeInTheDocument();
        expect(await screen.findByText('JQL is invalid')).toBeInTheDocument();
    });
});
