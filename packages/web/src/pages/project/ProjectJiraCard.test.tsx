import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IJiraSource } from '@atlas/shared';
import { makeProject, makeProjectRepo } from '../../test-utils/factories.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { Toast } from '../../components/Toast.js';
import { ProjectJiraCard } from './ProjectJiraCard.js';

const BASE = 'http://localhost:3000/api';
const PROJECT = makeProject({ id: 'p1', name: 'Acme' });

const SOURCE: IJiraSource = {
    id: 1,
    project_id: 'p1',
    jql: 'project = ATL AND labels = api',
    workflow_id: 'wf-1',
    repo_ids: ['r-api'],
};

let posted: unknown[] = [];

function mockSources(initial: IJiraSource[]) {
    let rows = [...initial];
    server.use(
        http.get(`${BASE}/projects/p1/jira-sources`, () => HttpResponse.json(rows)),
        http.get(`${BASE}/projects/p1/repos`, () =>
            HttpResponse.json([
                makeProjectRepo({ id: 'r-api', project_id: 'p1', name: 'api' }),
                makeProjectRepo({ id: 'r-web', project_id: 'p1', name: 'web' }),
            ])
        ),
        http.get(`${BASE}/workflows`, () =>
            HttpResponse.json([
                makeWorkflow({ id: 'wf-1', name: 'Delivery', project_id: 'p1' }),
                // A sub-workflow can't take a Task, so it must not be offered.
                makeWorkflow({ id: 'wf-sub', name: 'Build sub-task', input_kind: 'sub_task' }),
                makeWorkflow({ id: 'wf-other', name: 'Other project', project_id: 'p2' }),
            ])
        ),
        http.get(`${BASE}/integrations/jira`, () =>
            HttpResponse.json({ api_token_set: true, enabled: true })
        ),
        http.post(`${BASE}/projects/p1/jira-sources`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            posted.push(body);
            const row = { id: rows.length + 1, project_id: 'p1', ...body } as IJiraSource;
            rows = [...rows, row];
            return HttpResponse.json(row, { status: 201 });
        }),
        http.patch(`${BASE}/projects/p1/jira-sources/:id`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>;
            posted.push(body);
            return HttpResponse.json({ ...SOURCE, ...body });
        }),
        http.delete(`${BASE}/projects/p1/jira-sources/:id`, () => {
            rows = [];
            return new HttpResponse(null, { status: 204 });
        })
    );
}

function renderCard() {
    renderWithProviders(
        <>
            <Toast />
            <ProjectJiraCard project={PROJECT} />
        </>
    );
}

beforeEach(() => {
    posted = [];
});

describe('ProjectJiraCard', () => {
    it('lists a source as its query, workflow and repos', async () => {
        mockSources([SOURCE]);
        renderCard();
        expect(await screen.findByText('project = ATL AND labels = api')).toBeInTheDocument();
        expect(screen.getByText('Delivery')).toBeInTheDocument();
        expect(screen.getByText('api')).toBeInTheDocument();
    });

    it('says so when the project has no sources', async () => {
        mockSources([]);
        renderCard();
        expect(await screen.findByText('No Jira sources yet')).toBeInTheDocument();
    });

    it('adds a combo, offering only workflows that take this project’s Tasks', async () => {
        mockSources([]);
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: /Add source/i }));

        await userEvent.type(screen.getByLabelText(/JQL/i), 'labels = web');
        await userEvent.click(screen.getByLabelText(/Workflow/i));
        const listbox = await screen.findByRole('listbox');
        expect(within(listbox).getByText('Delivery')).toBeInTheDocument();
        // A sub-workflow and another project's workflow can't work these Tasks.
        expect(within(listbox).queryByText('Build sub-task')).not.toBeInTheDocument();
        expect(within(listbox).queryByText('Other project')).not.toBeInTheDocument();
        await userEvent.click(within(listbox).getByText('Delivery'));

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() =>
            expect(posted).toContainEqual(
                expect.objectContaining({ jql: 'labels = web', workflow_id: 'wf-1' })
            )
        );
    });

    it('edits a source without recreating it — the id is the global order', async () => {
        mockSources([SOURCE]);
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: /Actions for source 1/i }));
        await userEvent.click(await screen.findByText('Edit'));

        const jql = screen.getByLabelText(/JQL/i);
        await userEvent.clear(jql);
        await userEvent.type(jql, 'project = ATL');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(posted).toContainEqual(expect.objectContaining({ jql: 'project = ATL' }))
        );
    });

    it('removes a source after confirmation', async () => {
        mockSources([SOURCE]);
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: /Actions for source 1/i }));
        await userEvent.click(await screen.findByText('Remove'));
        await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
        expect(await screen.findByText('No Jira sources yet')).toBeInTheDocument();
    });

    it('points at Settings when no Jira site is connected', async () => {
        mockSources([]);
        server.use(
            http.get(`${BASE}/integrations/jira`, () =>
                HttpResponse.json({ api_token_set: false, enabled: false })
            )
        );
        renderCard();
        expect(await screen.findByText(/Connect your Jira site in/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Sync now/i })).toBeDisabled();
    });

    // Connected but switched off is the silent case: sources look configured and
    // nothing is polled, so the card has to say so rather than look healthy.
    it('warns when the site is connected but Import is switched off', async () => {
        mockSources([]);
        server.use(
            http.get(`${BASE}/integrations/jira`, () =>
                HttpResponse.json({ api_token_set: true, enabled: false })
            )
        );
        renderCard();
        expect(await screen.findByText(/Import is switched off/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Sync now/i })).toBeDisabled();
        expect(screen.queryByText(/Connect your Jira site in/)).not.toBeInTheDocument();
    });
});
