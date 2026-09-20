import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IJiraConfig, IProjectRepo, IWorkflow } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { makeProject } from '../../test-utils/factories.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { JiraTab } from './JiraTab.js';

const apiBase = 'http://localhost:3000/api';

const CONFIG: IJiraConfig = {
    enabled: true,
    site_url: 'https://acme.atlassian.net',
    email: 'me@acme.test',
    api_token_set: true,
    poll_interval_minutes: 60,
    extra_fields: [],
    sources: [{ repo_id: 'p1', jql: 'project = ATL', workflow_id: 'wf-dev' }],
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

function mount(onPut: (body: unknown) => void = () => undefined) {
    let current = CONFIG;
    server.use(
        http.get(`${apiBase}/integrations/jira`, () => HttpResponse.json(current)),
        http.put(`${apiBase}/integrations/jira`, async ({ request }) => {
            const body = (await request.json()) as Partial<IJiraConfig>;
            onPut(body);
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
    renderWithProviders(<JiraTab />);
}

describe('JiraTab', () => {
    it('shows the saved connection without the token, and each source', async () => {
        mount();
        expect(await screen.findByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument();
        expect(screen.getByLabelText('Jira API token')).toHaveValue('');
        expect(screen.getByPlaceholderText('Stored. Type to replace.')).toBeInTheDocument();
        expect(await screen.findByText('Sandbox / core')).toBeInTheDocument();
        expect(screen.getByText('project = ATL')).toBeInTheDocument();
        expect(await screen.findByText('Development')).toBeInTheDocument();
    });

    it("adds a source, offering only workflows that take Tasks in the repo's project", async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await screen.findByText('Sandbox / core');

        await userEvent.click(screen.getByLabelText('Source repo'));
        await userEvent.click(
            within(await screen.findByRole('listbox')).getByText('Sandbox / web')
        );
        await userEvent.type(screen.getByLabelText('Source JQL'), 'labels = web');
        await userEvent.click(screen.getByLabelText('Source workflow'));
        const listbox = await screen.findByRole('listbox');
        expect(within(listbox).queryByText('News')).not.toBeInTheDocument();
        expect(within(listbox).queryByText('Site delivery')).not.toBeInTheDocument();
        await userEvent.click(within(listbox).getByText('QA'));
        await userEvent.click(screen.getByRole('button', { name: 'Add source' }));

        await waitFor(() =>
            expect(puts).toContainEqual({
                sources: [
                    { repo_id: 'p1', jql: 'project = ATL', workflow_id: 'wf-dev' },
                    { repo_id: 'r-web', jql: 'labels = web', workflow_id: 'wf-qa' },
                ],
            })
        );
    });

    it('removes a source', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await userEvent.click(await screen.findByRole('button', { name: 'Remove source 1' }));
        await waitFor(() => expect(puts).toContainEqual({ sources: [] }));
    });
});
