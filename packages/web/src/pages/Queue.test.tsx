import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { IWorkflowQueue, IWorkflowQueueEntry, IWorkflowRunSummary } from '@atlas/shared';
import { server } from '../test-setup.js';
import { renderWithProviders } from '../test-utils/renderWithProviders.js';
import { defaultHandlers, handlers } from '../test-utils/mock-handlers.js';
import { makeAgent, makeProject, makeTask } from '../test-utils/factories.js';
import { makeRunDetail, makeWorkflow } from '../test-utils/workflowFixtures.js';
import { Queue } from './Queue.js';

const BASE = 'http://localhost:3000/api';

function run(overrides: Partial<IWorkflowRunSummary>): IWorkflowRunSummary {
    return { ...makeRunDetail(), ...overrides };
}

function entry(overrides: Partial<IWorkflowQueueEntry> = {}): IWorkflowQueueEntry {
    return {
        workflow: makeWorkflow({ max_parallel_runs: 2 }),
        running: [],
        waiting: [],
        queued: [],
        ...overrides,
    };
}

const subtasksGraph = {
    nodes: [
        { id: 'start', type: 'start' as const, position: { x: 0, y: 0 } },
        {
            id: 'subs',
            type: 'subtasks' as const,
            sub_workflow_id: 'wf-build',
            position: { x: 1, y: 0 },
        },
        { id: 'end', type: 'end' as const, position: { x: 2, y: 0 } },
    ],
    edges: [],
};

const busy: IWorkflowQueue = {
    workflows: [
        entry({
            running: [
                run({
                    id: 'wfr-1',
                    item_id: 'ATL-7',
                    item_title: 'Add login',
                    current_node_id: 'coder',
                }),
                run({
                    id: 'wfr-3',
                    item_id: 'ATL-8',
                    item_title: 'Fix bugs',
                    current_node_id: 'subs',
                    graph_snapshot: subtasksGraph,
                }),
            ],
            waiting: [
                run({
                    id: 'wfr-2',
                    item_id: 'ATL-5',
                    item_title: 'Pick a DB',
                    status: 'waiting_for_owner',
                    park_reason: 'Postgres or SQLite?',
                }),
            ],
            queued: [
                makeTask({ id: 'ATL-3', title: 'Oldest', status: 'ready', workflow_id: 'wf-1' }),
                makeTask({ id: 'ATL-4', title: 'Next', status: 'ready', workflow_id: 'wf-1' }),
            ],
        }),
    ],
    unassigned: [],
};

function setup(queue: IWorkflowQueue, ...extra: Parameters<typeof server.use>) {
    // Earlier handlers win, so per-test overrides go first.
    server.use(
        ...extra,
        handlers.listProjects([
            makeProject({ id: 'p1', name: 'Atlas' }),
            makeProject({ id: 'p2', name: 'Blog' }),
        ]),
        handlers.listAgents([makeAgent({ id: 'agent-coder', name: 'Coder' })]),
        handlers.workflowQueue(queue),
        ...defaultHandlers
    );
    return { user: userEvent.setup(), ...renderWithProviders(<Queue />) };
}

describe('Queue page', () => {
    it('shows the counter strip and points me at workflows when there are none', async () => {
        setup({ workflows: [], unassigned: [] });
        expect(screen.getByRole('heading', { name: 'Queue' })).toBeInTheDocument();
        expect(await screen.findByText('No workflows yet')).toBeInTheDocument();
        expect(
            screen.getByText('0 running · 0 queued · 0 waiting on you · 0 need a workflow')
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go to workflows' })).toHaveAttribute(
            'href',
            '/workflows'
        );
    });

    it('renders a card per workflow with its slots, running, waiting and queued Tasks', async () => {
        setup(busy);
        const card = await screen.findByRole('region', { name: 'Development' });
        const c = within(card);
        expect(c.getByRole('link', { name: 'Development' })).toHaveAttribute(
            'href',
            '/workflows/wf-1'
        );
        expect(c.getByText('Atlas · On item ready')).toBeInTheDocument();
        expect(c.getByText('2 / 2')).toBeInTheDocument();
        expect(c.getByRole('progressbar', { name: 'Development running slots' })).toHaveAttribute(
            'aria-valuenow',
            '100'
        );

        // Running: the step's agent name from the graph snapshot, or Sub-tasks.
        expect(c.getByRole('link', { name: /ATL-7\s*Add login/ })).toHaveAttribute(
            'href',
            '/tasks/ATL-7'
        );
        expect(c.getByText('Coder')).toBeInTheDocument();
        expect(c.getByText('Sub-tasks')).toBeInTheDocument();
        const runLinks = c
            .getAllByRole('link', { name: 'Open run' })
            .map((a) => a.getAttribute('href'));
        expect(runLinks).toEqual([
            '/workflows/wf-1/runs/wfr-1',
            '/workflows/wf-1/runs/wfr-3',
            '/workflows/wf-1/runs/wfr-2',
        ]);

        // Waiting on the Owner, with the reason.
        expect(c.getByText('Waiting for you')).toBeInTheDocument();
        expect(c.getByText('Postgres or SQLite?')).toBeInTheDocument();

        // Queued in dispatch order; no free slot → no Start now.
        const queued = c.getAllByRole('link', { name: /ATL-[34]/ }).map((a) => a.textContent);
        expect(queued).toEqual(['ATL-3Oldest', 'ATL-4Next']);
        expect(c.queryByRole('button', { name: 'Start now' })).not.toBeInTheDocument();
        expect(
            screen.getByText('2 running · 2 queued · 1 waiting on you · 0 need a workflow')
        ).toBeInTheDocument();
    });

    it('starts a queued Task when a slot is free', async () => {
        let body: unknown;
        const { user } = setup(
            {
                workflows: [
                    entry({
                        queued: [makeTask({ id: 'ATL-3', status: 'ready', workflow_id: 'wf-1' })],
                    }),
                ],
                unassigned: [],
            },
            http.post(`${BASE}/workflows/wf-1/runs`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json({ run_id: 'wfr-9' }, { status: 202 });
            })
        );
        await user.click(await screen.findByRole('button', { name: 'Start now' }));
        await waitFor(() => expect(body).toEqual({ item_id: 'ATL-3' }));
    });

    it('explains why queued Tasks wait on a paused workflow, and resumes it from the switch', async () => {
        let body: unknown;
        const paused = makeWorkflow({ status: 'inactive' });
        const { user } = setup(
            {
                workflows: [
                    entry({
                        workflow: paused,
                        queued: [makeTask({ id: 'ATL-3', status: 'ready', workflow_id: 'wf-1' })],
                    }),
                ],
                unassigned: [],
            },
            http.patch(`${BASE}/workflows/wf-1`, async ({ request }) => {
                body = await request.json();
                return HttpResponse.json(makeWorkflow());
            })
        );
        expect(
            await screen.findByText('Paused: these wait until you turn it back on.')
        ).toBeInTheDocument();
        expect(screen.getByText('Paused')).toBeInTheDocument();
        await user.click(screen.getByLabelText('Development active'));
        await waitFor(() => expect(body).toEqual({ status: 'active' }));
    });

    it('shows an empty card for an idle workflow', async () => {
        setup({ workflows: [entry()], unassigned: [] });
        expect(
            await screen.findByText(
                'Nothing running or queued. Set a ready Task’s workflow to this one to queue it.'
            )
        ).toBeInTheDocument();
    });

    it('queues a ready Task that no workflow will pick up', async () => {
        let body: unknown;
        const { user } = setup(
            {
                workflows: [entry()],
                unassigned: [
                    makeTask({ id: 'ATL-9', title: 'Loose', status: 'ready' }),
                    makeTask({ id: 'BLG-1', project_id: 'p2', title: 'Other', status: 'ready' }),
                ],
            },
            http.put(`${BASE}/items/ATL-9/workflow`, async ({ request }) => {
                body = await request.json();
                return new HttpResponse(null, { status: 204 });
            })
        );
        const section = await screen.findByRole('region', { name: 'Needs a workflow' });
        // Blog has no workflow that takes Tasks.
        expect(within(section).getByRole('link', { name: 'Create a workflow' })).toHaveAttribute(
            'href',
            '/workflows'
        );
        await user.click(within(section).getByRole('combobox', { name: 'Workflow for ATL-9' }));
        await user.click(await screen.findByRole('option', { name: 'Development' }));
        await waitFor(() => expect(body).toEqual({ workflow_id: 'wf-1' }));
    });

    it('filters by project', async () => {
        const urls: string[] = [];
        const { user } = setup(
            { workflows: [], unassigned: [] },
            http.get(`${BASE}/workflow-queue`, ({ request }) => {
                urls.push(new URL(request.url).search);
                return HttpResponse.json({ workflows: [], unassigned: [] });
            })
        );
        await user.click(await screen.findByRole('combobox', { name: 'Project' }));
        await user.click(await screen.findByRole('option', { name: 'Blog' }));
        await waitFor(() => expect(urls).toContain('?project_id=p2'));
    });

    it('shows an error when the queue fails to load', async () => {
        setup(
            { workflows: [], unassigned: [] },
            http.get(`${BASE}/workflow-queue`, () =>
                HttpResponse.json({ error: 'boom' }, { status: 500 })
            )
        );
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the queue");
    });
});
