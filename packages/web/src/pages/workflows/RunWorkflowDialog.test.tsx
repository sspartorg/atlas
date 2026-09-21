import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeTask } from '../../test-utils/factories.js';
import { makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { RunWorkflowDialog } from './RunWorkflowDialog.js';

const BASE = 'http://localhost:3000/api';

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
});
