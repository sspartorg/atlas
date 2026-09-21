import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// `PageFab` renders only on mobile. Flipping this drives the FAB path that
// the desktop tests never reach — the FAB is the only way to create a
// workflow on a phone, because the header button is `display: none` there.
let isMobile = false;
vi.mock('../hooks/useIsMobile.js', () => ({
    useIsMobile: () => isMobile,
}));

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
    beforeEach(() => {
        isMobile = false;
    });

    it('renders a card per workflow', async () => {
        mount([makeWorkflow(), makeWorkflow({ id: 'wf-2', name: 'Planning', status: 'inactive', input_kind: 'none', trigger: 'manual' })]);
        expect(screen.getByRole('heading', { name: 'Workflows' })).toBeInTheDocument();
        const dev = (await screen.findByText('Development')).closest('[role="button"]') as HTMLElement;
        expect(within(dev).getByText('Active')).toBeInTheDocument();
        expect(within(dev).getByText('On item ready')).toBeInTheDocument();
        expect(within(dev).getByText('Per Task')).toBeInTheDocument();
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

    it('opens the builder when a card is clicked', async () => {
        mount([makeWorkflow({ id: 'wf-7', name: 'Release' })]);
        await userEvent.click(await screen.findByText('Release'));
        expect(await screen.findByText('builder page')).toBeInTheDocument();
    });

    it('opens the builder when a focused card is activated with Enter', async () => {
        // The card is a `role="button"` with `tabIndex={0}`, which promises
        // keyboard operability. Without the Enter handler that promise is a
        // lie to every screen-reader and keyboard-only user.
        mount([makeWorkflow({ id: 'wf-7', name: 'Release' })]);
        const card = (await screen.findByText('Release')).closest('[role="button"]') as HTMLElement;
        card.focus();
        await userEvent.keyboard('{Enter}');
        expect(await screen.findByText('builder page')).toBeInTheDocument();
    });

    it('leaves the card alone for other keys', async () => {
        mount([makeWorkflow({ id: 'wf-7', name: 'Release' })]);
        const card = (await screen.findByText('Release')).closest('[role="button"]') as HTMLElement;
        card.focus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByText('builder page')).not.toBeInTheDocument();
    });

    // NOTE: the two header buttons are matched by regex, not exact name. Their
    // Material-Symbols ligature span is not `aria-hidden`, so their accessible
    // names are literally "addNew workflow" and "uploadImport" (see the A11Y
    // note in the report — systemic across all 152 icon spans, not this page's
    // doing). An exact-name query here would paper over that.
    it('opens the new-workflow dialog from the header button', async () => {
        mount([makeWorkflow()]);
        await screen.findByText('Development');
        await userEvent.click(screen.getByRole('button', { name: /New workflow/ }));
        expect(
            within(await screen.findByRole('dialog')).getByRole('button', {
                name: 'Create workflow',
            }),
        ).toBeInTheDocument();
    });

    it('opens and dismisses the import dialog without leaving the list', async () => {
        // Import is destructive-adjacent (it installs agents), so backing out
        // of the dialog must return the Owner to the list untouched.
        mount([makeWorkflow()]);
        await screen.findByText('Development');
        await userEvent.click(screen.getByRole('button', { name: /Import/ }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Import workflow')).toBeInTheDocument();

        await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByText('Import workflow')).not.toBeInTheDocument());
        expect(screen.getByText('Development')).toBeInTheDocument();
    });

    it('offers the create FAB on mobile, where the header button is hidden', async () => {
        // On a phone the header's "New workflow" button is `display: none`,
        // so the FAB is the only way to start one. If its handler regresses,
        // creating a workflow becomes impossible on mobile.
        isMobile = true;
        mount([makeWorkflow()]);
        await screen.findByText('Development');
        const fab = screen.getByRole('button', { name: 'New workflow' });
        await userEvent.click(fab);
        expect(
            within(await screen.findByRole('dialog')).getByRole('button', {
                name: 'Create workflow',
            }),
        ).toBeInTheDocument();
    });
});
