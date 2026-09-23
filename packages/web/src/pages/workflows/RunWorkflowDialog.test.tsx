import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type * as ReactRouter from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeTask } from '../../test-utils/factories.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { RunWorkflowDialog } from './RunWorkflowDialog.js';

const BASE = 'http://localhost:3000/api';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof ReactRouter>()),
    useNavigate: () => navigate,
}));

/** Tree with one ready task, which is all the Start-run path needs. */
function seedOneReadyTask(workflowId: string) {
    server.use(
        http.get(`${BASE}/issues/tree`, () =>
            HttpResponse.json({
                projects: [],
                agents: [],
                tree: [],
                tasks: [
                    makeTask({
                        id: 'ATL-3',
                        title: 'Queued here',
                        status: 'ready',
                        workflow_id: workflowId,
                    }),
                ],
            })
        )
    );
}

describe('RunWorkflowDialog', () => {
    it('offers only ready tasks, with ones queued for this workflow first', async () => {
        const workflow = makeWorkflow();
        server.use(
            http.get(`${BASE}/issues/tree`, () =>
                HttpResponse.json({
                    projects: [],
                    agents: [],
                    tree: [],
                    tasks: [
                        makeTask({ id: 'ATL-1', title: 'Ready elsewhere', status: 'ready' }),
                        makeTask({ id: 'ATL-2', title: 'Still draft', status: 'draft' }),
                        makeTask({
                            id: 'ATL-3',
                            title: 'Queued here',
                            status: 'ready',
                            workflow_id: workflow.id,
                        }),
                    ],
                })
            )
        );
        renderWithProviders(<RunWorkflowDialog workflow={workflow} onClose={vi.fn()} />);

        await userEvent.click(await screen.findByRole('combobox', { name: 'Ready task' }));
        const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
        expect(options).toEqual(['ATL-3 — Queued here (queued here)', 'ATL-1 — Ready elsewhere']);
    });

    // The Start button is the whole point of the dialog and was untested: it
    // closes, then routes to the run it just created. A wrong id here strands
    // the Owner on a 404 for a run that IS executing.
    it('starts the run, closes, and navigates to the new run', async () => {
        const workflow = makeWorkflow();
        const onClose = vi.fn();
        navigate.mockClear();
        let sent: unknown = null;
        seedOneReadyTask(workflow.id);
        server.use(
            http.post(`${BASE}/workflows/${workflow.id}/runs`, async ({ request }) => {
                sent = await request.json();
                return HttpResponse.json({ run_id: 'wfr-9' }, { status: 202 });
            })
        );
        renderWithProviders(<RunWorkflowDialog workflow={workflow} onClose={onClose} />);

        await userEvent.click(await screen.findByRole('combobox', { name: 'Ready task' }));
        await userEvent.click(await screen.findByRole('option', { name: /ATL-3/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
        expect(sent).toEqual({ item_id: 'ATL-3' });
        expect(navigate).toHaveBeenCalledWith(`/workflows/${workflow.id}/runs/wfr-9`);
    });

    it('keeps the dialog open and shows the error when the start fails', async () => {
        const workflow = makeWorkflow();
        const onClose = vi.fn();
        navigate.mockClear();
        seedOneReadyTask(workflow.id);
        server.use(
            http.post(`${BASE}/workflows/${workflow.id}/runs`, () =>
                HttpResponse.json({ error: 'Item is already done' }, { status: 409 })
            )
        );
        renderWithProviders(<RunWorkflowDialog workflow={workflow} onClose={onClose} />);

        await userEvent.click(await screen.findByRole('combobox', { name: 'Ready task' }));
        await userEvent.click(await screen.findByRole('option', { name: /ATL-3/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

        expect(await screen.findByText(/Item is already done/)).toBeInTheDocument();
        // handleStart's rejection is swallowed at the call site; the dialog has
        // to survive it rather than close on a run that never started.
        expect(onClose).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
});
