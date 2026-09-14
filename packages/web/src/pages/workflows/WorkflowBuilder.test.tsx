import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { IWorkflow, UpdateWorkflowInput } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent, makeProject } from '../../test-utils/factories.js';
import { makeWorkflow, stubReactFlowDom } from '../../test-utils/workflowFixtures.js';
import { WorkflowBuilder } from './WorkflowBuilder.js';

const BASE = 'http://localhost:3000/api';

beforeAll(stubReactFlowDom);

function mount(wf: IWorkflow) {
    server.use(
        http.get(`${BASE}/workflows/${wf.id}`, () => HttpResponse.json(wf)),
        http.get(`${BASE}/workflows`, () => HttpResponse.json([wf])),
        http.get(`${BASE}/agents`, () =>
            HttpResponse.json([
                makeAgent({ id: 'agent-coder', name: 'Coder' }),
                makeAgent({ id: 'agent-reviewer', name: 'Reviewer', accent_color: '#B33A30' }),
            ]),
        ),
        http.get(`${BASE}/projects`, () => HttpResponse.json([makeProject()])),
    );
    return renderWithProviders(
        <Routes>
            <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        </Routes>,
        { initialEntries: [`/workflows/${wf.id}`] },
    );
}

describe('WorkflowBuilder', () => {
    beforeEach(() => server.resetHandlers());

    it('loads the saved graph onto the canvas', async () => {
        mount(makeWorkflow());
        const canvas = await screen.findByTestId('workflow-canvas');
        expect(await within(canvas).findByText('Coder')).toBeInTheDocument();
        expect(within(canvas).getByText('Reviewer')).toBeInTheDocument();
        expect(within(canvas).getByText('Start')).toBeInTheDocument();
        expect(within(canvas).getByText('Push + PR')).toBeInTheDocument();
        expect(screen.queryByTestId('graph-errors')).not.toBeInTheDocument();
        // Nothing selected: the inspector shows workflow settings.
        expect(screen.getByRole('heading', { name: 'Workflow settings' })).toBeInTheDocument();
    });

    it('lists validation errors, outlines the offending node and blocks Save', async () => {
        const wf = makeWorkflow();
        // Drop the reviewer's pass connection: it needs exactly one.
        wf.graph.edges = wf.graph.edges.filter((e) => e.id !== 'e3');
        mount(wf);
        const errors = await screen.findByTestId('graph-errors');
        expect(within(errors).getByText('Needs exactly one pass connection')).toBeInTheDocument();
        await waitFor(() =>
            expect(screen.getByTestId('wf-node-review')).toHaveAttribute('data-invalid', 'true'),
        );
        expect(screen.getByTestId('wf-node-coder')).toHaveAttribute('data-invalid', 'false');
        expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('saves the whole workflow, graph included, with PATCH', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow();
        let body: UpdateWorkflowInput | null = null;
        mount(wf);
        server.use(
            http.patch(`${BASE}/workflows/${wf.id}`, async ({ request }) => {
                body = (await request.json()) as UpdateWorkflowInput;
                return HttpResponse.json({ ...wf, ...body, updated_at: '2026-09-14T11:00:00.000Z' });
            }),
        );

        const name = await screen.findByLabelText('Name');
        expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
        await user.clear(name);
        await user.type(name, 'Dev flow');
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => expect(body).not.toBeNull());
        const sent = body as unknown as UpdateWorkflowInput;
        expect(sent.name).toBe('Dev flow');
        expect(sent.graph?.nodes.map((n) => n.id)).toEqual(['start', 'coder', 'review', 'end']);
        expect(sent.graph?.edges).toContainEqual({ id: 'e4', source: 'review', target: 'coder', kind: 'fail' });
        await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    });

    it('steps palette-added nodes apart instead of stacking them on one spot', async () => {
        const user = userEvent.setup();
        mount(makeWorkflow());
        await screen.findByTestId('workflow-canvas');
        await user.click(await screen.findByRole('button', { name: 'Add Owner' }));
        await user.click(screen.getByRole('button', { name: 'Add Owner' }));
        await waitFor(() => {
            const owners = [...document.querySelectorAll<HTMLElement>('.react-flow__node[data-id^="owner"]')];
            expect(owners).toHaveLength(2);
            expect(owners[0]?.style.transform).not.toBe(owners[1]?.style.transform);
        });
    });

    it('surfaces graph errors the server rejects the save with', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(
            http.patch(`${BASE}/workflows/${wf.id}`, () =>
                HttpResponse.json(
                    {
                        error: 'Agent agent-reviewer does not exist',
                        kind: 'validation_error',
                        details: { graph_errors: [{ node_id: 'review', message: 'Agent agent-reviewer does not exist' }] },
                    },
                    { status: 400 },
                ),
            ),
        );
        const name = await screen.findByLabelText('Name');
        await user.type(name, '!');
        await user.click(screen.getByRole('button', { name: /save/i }));
        const errors = await screen.findByTestId('graph-errors');
        expect(within(errors).getByText('Agent agent-reviewer does not exist')).toBeInTheDocument();
        expect(screen.getByTestId('wf-node-review')).toHaveAttribute('data-invalid', 'true');
    });
});
