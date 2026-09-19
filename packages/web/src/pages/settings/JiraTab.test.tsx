import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IJiraConfig, IWorkflow } from '@atlas/shared';
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
    jql: 'project = DHEQ',
    project_id: 'p1',
    poll_interval_minutes: 60,
    extra_fields: [],
    label_workflows: [{ label: 'development', project_id: null, workflow_id: 'wf-dev' }],
    last_sync_at: null,
    last_sync_ok: null,
    last_sync_message: null,
};

const workflow = (id: string, name: string, input_kind: 'item' | 'none' = 'item') =>
    ({ id, name, input_kind, project_id: 'p1' }) as IWorkflow;

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
            HttpResponse.json([makeProject({ id: 'p1', name: 'Sandbox' })])
        ),
        http.get(`${apiBase}/workflows`, () =>
            HttpResponse.json([
                workflow('wf-dev', 'Development'),
                workflow('wf-qa', 'QA'),
                workflow('wf-news', 'News', 'none'),
            ])
        )
    );
    renderWithProviders(<JiraTab />);
}

describe('JiraTab', () => {
    it('routes a label to a project without a workflow', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await screen.findByDisplayValue('https://acme.atlassian.net');

        await userEvent.type(screen.getByLabelText('Jira label'), 'infra');
        await userEvent.click(screen.getByLabelText('Project for label'));
        await userEvent.click(within(await screen.findByRole('listbox')).getByText('Sandbox'));
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(puts).toContainEqual({
                label_workflows: [
                    { label: 'development', project_id: null, workflow_id: 'wf-dev' },
                    { label: 'infra', project_id: 'p1', workflow_id: null },
                ],
            })
        );
    });

    it('shows the saved connection without the token, and the label mapping', async () => {
        mount();
        expect(await screen.findByDisplayValue('https://acme.atlassian.net')).toBeInTheDocument();
        expect(screen.getByLabelText('Jira API token')).toHaveValue('');
        expect(screen.getByPlaceholderText('Stored. Type to replace.')).toBeInTheDocument();
        expect(await screen.findByText('Default project · Development')).toBeInTheDocument();
    });

    it('adds a label mapping, offering only workflows that take Tasks', async () => {
        const puts: unknown[] = [];
        mount((b) => puts.push(b));
        await screen.findByDisplayValue('https://acme.atlassian.net');

        await userEvent.type(screen.getByLabelText('Jira label'), 'qa');
        await userEvent.click(screen.getByLabelText('Workflow for label'));
        const listbox = await screen.findByRole('listbox');
        expect(within(listbox).queryByText('News')).not.toBeInTheDocument();
        await userEvent.click(within(listbox).getByText('QA'));
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));

        await waitFor(() =>
            expect(puts).toContainEqual({
                label_workflows: [
                    { label: 'development', project_id: null, workflow_id: 'wf-dev' },
                    { label: 'qa', project_id: null, workflow_id: 'wf-qa' },
                ],
            })
        );
    });
});
