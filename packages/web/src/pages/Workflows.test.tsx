import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { IWorkflowTemplate } from '@atlas/shared';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { makeAgent, makeProject } from '../test-utils/factories.js';
import { makeWorkflow } from '../test-utils/workflowFixtures.js';
import { Workflows } from './Workflows.js';

const BASE = 'http://localhost:3000/api';

const DEV_TEMPLATE: IWorkflowTemplate = {
    id: 'dev',
    name: 'Development',
    description: 'Architect, coder and reviewer — one PR per story.',
    input_kind: 'item',
    trigger: 'item_ready',
    use_worktree: true,
    push_code: true,
    raises_pr: true,
    graph: makeWorkflow().graph,
};

function mount(workflows = [makeWorkflow()]) {
    server.use(
        http.get(`${BASE}/workflows`, () => HttpResponse.json(workflows)),
        http.get(`${BASE}/workflows/templates`, () => HttpResponse.json([DEV_TEMPLATE])),
        http.get(`${BASE}/projects`, () => HttpResponse.json([makeProject({ id: 'p1', name: 'Atlas' })])),
        http.get(`${BASE}/agents`, () => HttpResponse.json([makeAgent({ id: 'agent-coder', name: 'Coder' })])),
    );
    return renderWithProviders(
        <Routes>
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/workflows/:id" element={<div>builder page</div>} />
        </Routes>,
        { initialEntries: ['/workflows'] },
    );
}

describe('Workflows page', () => {
    it('renders a card per workflow', async () => {
        mount([makeWorkflow(), makeWorkflow({ id: 'wf-2', name: 'Planning', status: 'inactive', input_kind: 'none', trigger: 'manual' })]);
        expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
        const dev = (await screen.findByText('Development')).closest('[role="button"]') as HTMLElement;
        expect(within(dev).getByText('Active')).toBeInTheDocument();
        expect(within(dev).getByText('On item ready')).toBeInTheDocument();
        expect(within(dev).getByText('Per item')).toBeInTheDocument();
        await waitFor(() => expect(within(dev).getByText(/Atlas/)).toBeInTheDocument());
        const planning = screen.getByText('Planning').closest('[role="button"]') as HTMLElement;
        expect(within(planning).getByText('Inactive')).toBeInTheDocument();
        expect(within(planning).getByText('Project run')).toBeInTheDocument();
    });

    it('shows the empty state when there are no workflows', async () => {
        mount([]);
        expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
    });

    it('creates a workflow from a template and opens the builder', async () => {
        const user = userEvent.setup();
        let sent: unknown = null;
        mount([]);
        server.use(
            http.post(`${BASE}/workflows/from-template`, async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json(makeWorkflow({ id: 'wf-new' }), { status: 201 });
            }),
        );

        await user.click(await screen.findByRole('button', { name: 'New workflow' }));
        const dialog = await screen.findByRole('dialog');
        const create = within(dialog).getByRole('button', { name: 'Create workflow' });
        expect(create).toBeDisabled();

        await user.click(within(dialog).getByLabelText('Project'));
        await user.click(await screen.findByRole('option', { name: 'Atlas' }));
        const template = await within(dialog).findByRole('radio', { name: 'Development' });
        expect(within(template).getByText('Coder')).toBeInTheDocument();
        // Uninstalled catalog agents read as names and are flagged for install.
        expect(within(template).getByText('Reviewer')).toBeInTheDocument();
        await user.click(template);
        expect(within(dialog).getByText(/Installs from the marketplace: Reviewer/)).toBeInTheDocument();

        await user.click(create);
        await waitFor(() => expect(sent).toEqual({ template_id: 'dev', project_id: 'p1' }));
        expect(await screen.findByText('builder page')).toBeInTheDocument();
    });
});
