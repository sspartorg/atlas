import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeProject } from '../../test-utils/factories.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { DefaultWorkflowCard } from './DefaultWorkflowCard.js';

const BASE = 'http://localhost:3000/api';

const QUICK = makeWorkflow({ id: 'wf-quick', name: 'Quick change', project_id: 'p1' });
const GLOBAL = makeWorkflow({ id: 'wf-global', name: 'Delivery', project_id: null });
const OTHER = makeWorkflow({ id: 'wf-other', name: 'Elsewhere', project_id: 'p2' });
const SUB = makeWorkflow({ id: 'wf-sub', name: 'Build sub-task', input_kind: 'sub_task' });

function useWorkflowList() {
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json([QUICK, GLOBAL, OTHER, SUB])));
}

describe('DefaultWorkflowCard', () => {
    it('shows the current default and offers only workflows that take this project’s Tasks', async () => {
        useWorkflowList();
        renderWithProviders(
            <DefaultWorkflowCard project={makeProject({ default_workflow_id: 'wf-quick' })} />
        );
        const select = await screen.findByRole('combobox', { name: 'Default workflow' });
        await waitFor(() => expect(select).toHaveTextContent('Quick change'));
        // Honest about scope: Jira imports do not inherit it (ADR 0016).
        expect(screen.getByText(/Jira imports use their source/)).toBeInTheDocument();

        fireEvent.mouseDown(select);
        expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
            'None — Tasks wait until you pick one',
            'Quick change',
            'Delivery',
        ]);
    });

    it('saves a pick with PATCH and clears it with null', async () => {
        useWorkflowList();
        const bodies: unknown[] = [];
        server.use(
            http.patch(`${BASE}/projects/p1`, async ({ request }) => {
                const body = (await request.json()) as { default_workflow_id: string | null };
                bodies.push(body);
                return HttpResponse.json(makeProject({ default_workflow_id: body.default_workflow_id }));
            })
        );
        // The prop stays put (no parent refetch here), so the select keeps
        // showing Quick change and both picks below are real changes.
        renderWithProviders(
            <DefaultWorkflowCard project={makeProject({ default_workflow_id: 'wf-quick' })} />
        );
        const select = await screen.findByRole('combobox', { name: 'Default workflow' });
        await waitFor(() => expect(select).toHaveTextContent('Quick change'));

        fireEvent.mouseDown(select);
        fireEvent.click(await screen.findByRole('option', { name: 'Delivery' }));
        await waitFor(() => expect(bodies).toEqual([{ default_workflow_id: 'wf-global' }]));

        await waitFor(() => expect(select).not.toHaveAttribute('aria-disabled'));
        fireEvent.mouseDown(select);
        fireEvent.click(await screen.findByRole('option', { name: /None/ }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[1]).toEqual({ default_workflow_id: null });
    });

    it('surfaces the API refusal instead of pretending it saved', async () => {
        useWorkflowList();
        server.use(
            http.patch(`${BASE}/projects/p1`, () =>
                HttpResponse.json({ error: 'That workflow does not take Tasks' }, { status: 400 })
            )
        );
        renderWithProviders(<DefaultWorkflowCard project={makeProject()} />);
        const select = await screen.findByRole('combobox', { name: 'Default workflow' });
        fireEvent.mouseDown(select);
        fireEvent.click(await screen.findByRole('option', { name: 'Quick change' }));
        expect(await screen.findByText(/does not take Tasks/)).toBeInTheDocument();
    });
});
