import { beforeAll, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeProject } from '../test-utils/factories.js';
import { makePublishedWorkflow, makeTemplates, makeWorkflow, stubReactFlowDom } from '../test-utils/workflowFixtures.js';
import { MarketplaceWorkflowDetail } from './MarketplaceWorkflowDetail.js';

const BASE = 'http://localhost:3000/api';

beforeAll(stubReactFlowDom);

function mount(templateId: string) {
    server.use(
        http.get(`${BASE}/workflows/templates`, () => HttpResponse.json(makeTemplates())),
        http.get(`${BASE}/agents`, () => HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'Coder' })])),
        http.get(`${BASE}/marketplace/agents`, () => HttpResponse.json([])),
        http.get(`${BASE}/projects`, () => HttpResponse.json([makeProject({ id: 'p1', name: 'Atlas' })])),
    );
    renderWithProviders(
        <Routes>
            <Route path="/agents/marketplace/workflows/:templateId" element={<MarketplaceWorkflowDetail />} />
            <Route path="/workflows/:id" element={<p>Builder page</p>} />
        </Routes>,
        { initialEntries: [`/agents/marketplace/workflows/${templateId}`] },
    );
}

describe('MarketplaceWorkflowDetail', () => {
    it('previews the graph and lists the agents it installs', async () => {
        mount('delivery');
        expect(await screen.findByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /export/i })).toHaveAttribute('href', '/api/workflows/templates/delivery/export');

        const agents = screen.getByRole('list', { name: 'Agents' });
        const po = within(agents).getByText('Po Writer').closest('li') as HTMLElement;
        expect(within(po).getByText('Installs from the marketplace')).toBeInTheDocument();
        const coder = within(agents).getByText('Coder').closest('li') as HTMLElement;
        expect(await within(coder).findByText('Installed')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Build sub-task' })).toBeInTheDocument();

        // The read-only canvas names the Sub-tasks step's template.
        const canvas = await screen.findByTestId('workflow-canvas');
        expect(await within(canvas).findByText('Build sub-task')).toBeInTheDocument();
    });

    it('creates the workflow in a project from “Use in a project”', async () => {
        let body: unknown = null;
        server.use(
            http.post(`${BASE}/workflows/from-template`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(makeWorkflow({ id: 'wf-new' }), { status: 201 });
            }),
        );
        mount('delivery');
        await userEvent.click(await screen.findByRole('button', { name: 'Use in a project' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('radio', { name: 'Delivery' })).toHaveAttribute('aria-checked', 'true');
        await userEvent.click(within(dialog).getByRole('combobox', { name: 'Project' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Atlas' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Create workflow' }));

        expect(await screen.findByText('Builder page')).toBeInTheDocument();
        expect(body).toEqual({ template_id: 'delivery', project_id: 'p1' });
    });

    it('says so when the template does not exist', async () => {
        mount('nope');
        expect(await screen.findByText('Marketplace workflow not found.')).toBeInTheDocument();
    });
});

describe('MarketplaceWorkflowDetail — published by you', () => {
    function mountPublished(found = true) {
        server.use(
            http.get(`${BASE}/marketplace/workflows/pw-1`, () =>
                found ? HttpResponse.json(makePublishedWorkflow()) : HttpResponse.json({ error: 'Published workflow not found' }, { status: 404 }),
            ),
            http.get(`${BASE}/agents`, () => HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'My Coder' })])),
            http.get(`${BASE}/marketplace/agents`, () => HttpResponse.json([])),
            http.get(`${BASE}/projects`, () => HttpResponse.json([makeProject({ id: 'p1', name: 'Atlas' })])),
        );
        renderWithProviders(
            <Routes>
                <Route path="/agents/marketplace/workflows/published/:publishedId" element={<MarketplaceWorkflowDetail />} />
                <Route path="/agents/marketplace" element={<p>Marketplace page</p>} />
                <Route path="/workflows/:id" element={<p>Builder page</p>} />
            </Routes>,
            { initialEntries: ['/agents/marketplace/workflows/published/pw-1'] },
        );
    }

    it('previews the graph, lists its agents and sub-workflows, and exports the stored bundle', async () => {
        mountPublished();
        expect(await screen.findByRole('heading', { name: 'My delivery' })).toBeInTheDocument();
        expect(screen.getByText('Published Sep 14', { exact: false })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /export/i })).toHaveAttribute('href', '/api/marketplace/workflows/pw-1/export');

        const agents = screen.getByRole('list', { name: 'Agents' });
        const coder = (await within(agents).findByText('My Coder')).closest('li') as HTMLElement;
        expect(within(coder).getByText('Installed')).toBeInTheDocument();
        const po = within(agents).getByText('Po Writer').closest('li') as HTMLElement;
        expect(within(po).getByText('Installs with this workflow')).toBeInTheDocument();
        expect(screen.getByText('Created with this workflow.')).toBeInTheDocument();

        const canvas = await screen.findByTestId('workflow-canvas');
        expect(await within(canvas).findByText('My build')).toBeInTheDocument();
    });

    it('adds it to a project from “Use in a project”', async () => {
        let body: unknown = null;
        server.use(
            http.post(`${BASE}/marketplace/workflows/pw-1/use`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(
                    { workflow: makeWorkflow({ id: 'wf-new' }), sub_workflows: [], installed_agents: [], reused_agents: [] },
                    { status: 201 },
                );
            }),
        );
        mountPublished();
        await userEvent.click(await screen.findByRole('button', { name: 'Use in a project' }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('combobox', { name: 'Project' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Atlas' }));
        await userEvent.click(within(dialog).getByRole('button', { name: 'Add workflow' }));

        expect(await screen.findByText('Builder page')).toBeInTheDocument();
        expect(body).toEqual({ project_id: 'p1' });
    });

    it('unpublishes after a confirm', async () => {
        let deleted = false;
        server.use(
            http.delete(`${BASE}/marketplace/workflows/pw-1`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            }),
        );
        mountPublished();
        await userEvent.click(await screen.findByRole('button', { name: 'Unpublish' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Unpublish My delivery?')).toBeInTheDocument();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Unpublish' }));

        expect(await screen.findByText('Marketplace page')).toBeInTheDocument();
        expect(deleted).toBe(true);
    });

    it('says so when the entry does not exist', async () => {
        mountPublished(false);
        expect(await screen.findByText('Marketplace workflow not found.')).toBeInTheDocument();
    });
});
