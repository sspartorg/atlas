import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type * as ReactRouter from 'react-router-dom';
import type { IWorkflow, UpdateWorkflowInput } from '@atlas/shared';
import { server } from '../../test-setup.js';
import { renderWithProviders } from '../../test-utils/renderWithProviders.js';
import { makeAgent, makeProject } from '../../test-utils/factories.js';
import { makeWorkflow, stubReactFlowDom } from '../../test-utils/workflowFixtures.js';
import { WorkflowBuilder } from './WorkflowBuilder.js';

const BASE = 'http://localhost:3000/api';

beforeAll(stubReactFlowDom);

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof ReactRouter>()),
    useNavigate: () => navigate,
}));

interface MountOpts {
    queryClient?: QueryClient;
    /** Fail the detail fetch instead of returning the workflow. */
    detailError?: { status: number; body?: Record<string, string> };
}

function mount(wf: IWorkflow, opts: MountOpts = {}) {
    server.use(
        http.get(`${BASE}/workflows/${wf.id}`, () =>
            opts.detailError
                ? HttpResponse.json(opts.detailError.body ?? null, {
                      status: opts.detailError.status,
                  })
                : HttpResponse.json(wf)
        ),
        http.get(`${BASE}/workflows`, () => HttpResponse.json([wf])),
        http.get(`${BASE}/agents`, () =>
            HttpResponse.json([
                makeAgent({ id: 'agent-coder', name: 'Coder' }),
                makeAgent({ id: 'agent-reviewer', name: 'Reviewer', accent_color: '#B33A30' }),
            ])
        ),
        http.get(`${BASE}/projects`, () => HttpResponse.json([makeProject()]))
    );
    navigate.mockClear();
    return renderWithProviders(
        <Routes>
            <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        </Routes>,
        {
            initialEntries: [`/workflows/${wf.id}`],
            ...(opts.queryClient ? { queryClient: opts.queryClient } : {}),
        }
    );
}

/** A DataTransfer stand-in: jsdom ships no constructor for one. */
function dataTransfer(payload = '') {
    return {
        dropEffect: 'none',
        effectAllowed: 'none',
        getData: () => payload,
        setData: () => undefined,
    } as unknown as DataTransfer;
}

/** Make every `max-width` media query match, i.e. render as a phone. */
function stubPhone(): () => void {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    return () => {
        window.matchMedia = real;
    };
}

function sharedClient(): QueryClient {
    return new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
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
            expect(screen.getByTestId('wf-node-review')).toHaveAttribute('data-invalid', 'true')
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
                return HttpResponse.json({
                    ...wf,
                    ...body,
                    updated_at: '2026-09-14T11:00:00.000Z',
                });
            })
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
        expect(sent.graph?.edges).toContainEqual({
            id: 'e4',
            source: 'review',
            target: 'coder',
            kind: 'fail',
        });
        await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    });

    it('steps palette-added nodes apart instead of stacking them on one spot', async () => {
        const user = userEvent.setup();
        mount(makeWorkflow());
        await screen.findByTestId('workflow-canvas');
        await user.click(await screen.findByRole('button', { name: 'Add Owner' }));
        await user.click(screen.getByRole('button', { name: 'Add Owner' }));
        await waitFor(() => {
            const owners = [
                ...document.querySelectorAll<HTMLElement>('.react-flow__node[data-id^="owner"]'),
            ];
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
                        details: {
                            graph_errors: [
                                {
                                    node_id: 'review',
                                    message: 'Agent agent-reviewer does not exist',
                                },
                            ],
                        },
                    },
                    { status: 400 }
                )
            )
        );
        const name = await screen.findByLabelText('Name');
        await user.type(name, '!');
        await user.click(screen.getByRole('button', { name: /save/i }));
        const errors = await screen.findByTestId('graph-errors');
        expect(within(errors).getByText('Agent agent-reviewer does not exist')).toBeInTheDocument();
        expect(screen.getByTestId('wf-node-review')).toHaveAttribute('data-invalid', 'true');
    });

    it('offers a Sub-tasks step on Task workflows and points it at a sub-workflow', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow();
        const build = makeWorkflow({
            id: 'wf-build',
            name: 'Build sub-task',
            input_kind: 'sub_task',
            trigger: 'manual',
        });
        mount(wf);
        server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json([wf, build])));
        await screen.findByTestId('workflow-canvas');
        await user.click(await screen.findByRole('button', { name: 'Add Sub-tasks' }));

        expect(await screen.findByRole('heading', { name: 'Sub-tasks step' })).toBeInTheDocument();
        await user.click(screen.getByLabelText('Sub-workflow'));
        await user.click(await screen.findByRole('option', { name: 'Build sub-task' }));
        const canvas = screen.getByTestId('workflow-canvas');
        expect(await within(canvas).findByText('Build sub-task')).toBeInTheDocument();
        expect(within(canvas).getByText('All other sub-tasks')).toBeInTheDocument();
    });

    it('hides the Sub-tasks step and the trigger on a sub-task workflow', async () => {
        mount(makeWorkflow({ input_kind: 'sub_task', trigger: 'manual' }));
        await screen.findByTestId('workflow-canvas');
        expect(await screen.findByRole('button', { name: 'Add Owner' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add Sub-tasks' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Trigger')).not.toBeInTheDocument();
        expect(
            within(screen.getByTestId('workflow-canvas')).getByText('Back to the Task')
        ).toBeInTheDocument();
    });

    // ─── Load failures ──────────────────────────────────────────────────────

    it('says the workflow is gone on a 404', async () => {
        mount(makeWorkflow(), { detailError: { status: 404 } });
        expect(await screen.findByText('Workflow not found.')).toBeInTheDocument();
        expect(screen.queryByTestId('workflow-canvas')).not.toBeInTheDocument();
    });

    // A server fault is not a missing workflow — telling the Owner "not found"
    // would send them looking for a workflow that is still there.
    it('shows the server’s reason when the load fails for anything but a 404', async () => {
        mount(makeWorkflow(), {
            detailError: { status: 500, body: { error: 'Database is locked' } },
        });
        expect(await screen.findByText('Database is locked')).toBeInTheDocument();
    });

    // ─── Validation errors that belong to no node ───────────────────────────

    it('lists a graph-level error that no node can be blamed for', async () => {
        const wf = makeWorkflow();
        wf.graph.nodes = wf.graph.nodes.filter((n) => n.id !== 'end');
        wf.graph.edges = wf.graph.edges.filter((e) => e.target !== 'end');
        mount(wf);
        const errors = await screen.findByTestId('graph-errors');
        expect(
            within(errors).getByText('A workflow needs at least one End node')
        ).toBeInTheDocument();
        // No node is outlined for it, but Save is still blocked.
        expect(screen.getByTestId('wf-node-coder')).toHaveAttribute('data-invalid', 'false');
        expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('keeps the draft editable when the save fails without graph errors', async () => {
        // A dropped connection (not a rejection) must leave the Owner's edits
        // in place and offer Save again rather than clearing the form.
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(http.patch(`${BASE}/workflows/${wf.id}`, () => HttpResponse.error()));
        await user.type(await screen.findByLabelText('Name'), '!');
        await user.click(screen.getByRole('button', { name: /save/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeEnabled());
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
        expect(screen.queryByTestId('graph-errors')).not.toBeInTheDocument();
    });

    it('shows no error box when the rejection says nothing about the graph', async () => {
        // `details.graph_errors` is what the box lists; a rejection without it
        // must not open an empty "Fix before saving" alert.
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(
            http.patch(`${BASE}/workflows/${wf.id}`, () =>
                HttpResponse.json(
                    { error: 'Name already taken', kind: 'validation_error' },
                    { status: 400 }
                )
            )
        );
        await user.type(await screen.findByLabelText('Name'), '!');
        await user.click(screen.getByRole('button', { name: /save/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeEnabled());
        expect(screen.queryByTestId('graph-errors')).not.toBeInTheDocument();
    });

    it('drops the server’s graph errors as soon as the graph is edited', async () => {
        // They describe a graph that no longer exists; leaving them up points
        // the Owner at a node they may have just fixed.
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(
            http.patch(`${BASE}/workflows/${wf.id}`, () =>
                HttpResponse.json(
                    {
                        error: 'Agent agent-reviewer does not exist',
                        kind: 'validation_error',
                        details: {
                            graph_errors: [
                                {
                                    node_id: 'review',
                                    message: 'Agent agent-reviewer does not exist',
                                },
                            ],
                        },
                    },
                    { status: 400 }
                )
            )
        );
        await user.type(await screen.findByLabelText('Name'), '!');
        await user.click(screen.getByRole('button', { name: /save/i }));
        await screen.findByTestId('graph-errors');

        await user.click(screen.getByRole('button', { name: 'Add Owner' }));
        await waitFor(() =>
            expect(
                screen.queryByText('Agent agent-reviewer does not exist')
            ).not.toBeInTheDocument()
        );
        // The freshly-added Owner has no pass connection, so the box now
        // carries the client's own complaint instead.
        expect(
            within(screen.getByTestId('graph-errors')).getByText(
                'Needs exactly one pass connection'
            )
        ).toBeInTheDocument();
    });

    it('selects the node that was clicked and offers it to the inspector', async () => {
        // Selection is the builder's own state, driven by ReactFlow's node
        // change stream; without it the inspector never leaves workflow
        // settings and no node can be edited.
        mount(makeWorkflow());
        await screen.findByTestId('workflow-canvas');
        expect(screen.getByRole('heading', { name: 'Workflow settings' })).toBeInTheDocument();
        // A plain click, not userEvent: the full pointer sequence reaches
        // d3-drag, which needs a real window on the event and throws in jsdom.
        fireEvent.click(screen.getByTestId('rf__node-coder'));
        await waitFor(() => expect(screen.getByTestId('rf__node-coder')).toHaveClass('selected'));
        expect(
            screen.queryByRole('heading', { name: 'Workflow settings' })
        ).not.toBeInTheDocument();
    });

    // ─── Run now ────────────────────────────────────────────────────────────

    it('asks which Task to run when the workflow runs on a Task', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(
            http.get(`${BASE}/issues/tree`, () =>
                HttpResponse.json({ projects: [], agents: [], tree: [], tasks: [] })
            )
        );
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('button', { name: /run now/i }));

        expect(await screen.findByRole('dialog')).toHaveTextContent('Run Development');
        // Picking the item is the dialog's job — the builder must not have
        // started anything yet.
        expect(navigate).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('starts a project-level run straight away and opens it', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow({ input_kind: 'none', trigger: 'manual' });
        mount(wf);
        server.use(
            http.post(`${BASE}/workflows/${wf.id}/runs`, async () => {
                await delay(100);
                return HttpResponse.json({ run_id: 'wfr-9' });
            })
        );
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('button', { name: /run now/i }));
        // Locked while the POST is in flight, so a second click cannot start
        // a duplicate run.
        expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled();
        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith(`/workflows/${wf.id}/runs/wfr-9`)
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('stays on the builder when the run cannot be started', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow({ input_kind: 'none', trigger: 'manual' });
        let asked = false;
        mount(wf);
        server.use(
            http.post(`${BASE}/workflows/${wf.id}/runs`, () => {
                asked = true;
                return HttpResponse.json({ error: 'No repo cloned' }, { status: 409 });
            })
        );
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('button', { name: /run now/i }));
        await waitFor(() => expect(asked).toBe(true));
        await waitFor(() => expect(screen.getByRole('button', { name: /run now/i })).toBeEnabled());
        expect(navigate).not.toHaveBeenCalled();
    });

    it('will not run a sub-task workflow on its own', async () => {
        // It only runs from a Task workflow's Sub-tasks step; offering Run
        // here would start something the engine has no item to feed.
        mount(makeWorkflow({ input_kind: 'sub_task', trigger: 'manual' }));
        await screen.findByTestId('workflow-canvas');
        expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled();
    });

    // ─── Delete ─────────────────────────────────────────────────────────────

    it('deletes the workflow after the confirmation and leaves the page', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow();
        let deleted = false;
        mount(wf);
        server.use(
            http.delete(`${BASE}/workflows/${wf.id}`, () => {
                deleted = true;
                return new HttpResponse(null, { status: 204 });
            })
        );
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('button', { name: 'Delete workflow' }));
        const modal = await screen.findByRole('dialog');
        expect(modal).toHaveTextContent('Development and its run history will be removed.');
        await user.click(within(modal).getByRole('button', { name: 'Delete' }));

        await waitFor(() => expect(deleted).toBe(true));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('/workflows'));
    });

    it('closes the confirmation and stays put when the delete fails', async () => {
        // Leaving the modal open over a workflow that still exists would
        // invite a second delete of something that was never removed.
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(
            http.delete(`${BASE}/workflows/${wf.id}`, () =>
                HttpResponse.json({ error: 'Run in flight' }, { status: 409 })
            )
        );
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('button', { name: 'Delete workflow' }));
        await user.click(
            within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' })
        );

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(navigate).not.toHaveBeenCalled();
        expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument();
    });

    it('drops the confirmation on Cancel without deleting anything', async () => {
        const user = userEvent.setup();
        mount(makeWorkflow());
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('button', { name: 'Delete workflow' }));
        await user.click(
            within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
        );
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        // No DELETE handler is registered — msw would fail the test on one.
        expect(navigate).not.toHaveBeenCalled();
    });

    // ─── Tabs ───────────────────────────────────────────────────────────────

    it('swaps the canvas for the run history on the Runs tab', async () => {
        const user = userEvent.setup();
        const wf = makeWorkflow();
        mount(wf);
        server.use(http.get(`${BASE}/workflows/${wf.id}/runs`, () => HttpResponse.json([])));
        await screen.findByTestId('workflow-canvas');
        await user.click(screen.getByRole('tab', { name: 'Runs' }));

        expect(await screen.findByText(/No runs yet/i)).toBeInTheDocument();
        expect(screen.queryByTestId('workflow-canvas')).not.toBeInTheDocument();
        // The header stays — it belongs to the workflow, not to the tab.
        expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    // ─── Dropping a palette chip on the canvas ──────────────────────────────

    it('adds the dropped palette node where it landed', async () => {
        mount(makeWorkflow());
        const canvas = await screen.findByTestId('workflow-canvas');
        fireEvent.drop(canvas, {
            dataTransfer: dataTransfer(JSON.stringify({ type: 'owner' })),
            clientX: 120,
            clientY: 90,
        });
        await waitFor(() =>
            expect(document.querySelectorAll('.react-flow__node[data-id^="owner"]')).toHaveLength(1)
        );
    });

    // Dragging anything else (a file, selected text) over the canvas must not
    // conjure a node out of an unreadable payload.
    it('ignores a drop that carries no palette payload', async () => {
        mount(makeWorkflow());
        const canvas = await screen.findByTestId('workflow-canvas');
        fireEvent.drop(canvas, { dataTransfer: dataTransfer(''), clientX: 120, clientY: 90 });
        await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(4));
    });

    it('carries the agent through when an agent chip is added', async () => {
        const user = userEvent.setup();
        mount(makeWorkflow());
        const canvas = await screen.findByTestId('workflow-canvas');
        expect(await within(canvas).findAllByText('Coder')).toHaveLength(1);
        await user.click(await screen.findByRole('button', { name: 'Add Coder' }));
        // A second Coder card means the new node kept agent_id — an agent node
        // without one renders as "Choose an agent" instead.
        await waitFor(() => expect(within(canvas).getAllByText('Coder')).toHaveLength(2));
    });

    // ─── A save made somewhere else ─────────────────────────────────────────

    it('adopts a workflow saved in another tab while this one is clean', async () => {
        const qc = sharedClient();
        const wf = makeWorkflow();
        mount(wf, { queryClient: qc });
        await screen.findByTestId('workflow-canvas');

        qc.setQueryData(['workflows', 'detail', wf.id], {
            ...wf,
            name: 'Renamed elsewhere',
            updated_at: '2026-09-15T10:00:00.000Z',
        });

        expect(await screen.findByDisplayValue('Renamed elsewhere')).toBeInTheDocument();
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });

    it('does not overwrite edits in flight with a workflow saved elsewhere', async () => {
        // Losing the Owner's unsaved work to a background refetch is the
        // failure this guard exists to prevent.
        const user = userEvent.setup();
        const qc = sharedClient();
        const wf = makeWorkflow();
        mount(wf, { queryClient: qc });
        const name = await screen.findByLabelText('Name');
        await user.clear(name);
        await user.type(name, 'My draft');
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

        qc.setQueryData(['workflows', 'detail', wf.id], {
            ...wf,
            name: 'Renamed elsewhere',
            updated_at: '2026-09-15T10:00:00.000Z',
        });

        await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('My draft'));
        expect(screen.queryByDisplayValue('Renamed elsewhere')).not.toBeInTheDocument();
    });

    // ─── Phone ──────────────────────────────────────────────────────────────

    it('shows the workflow read-only on a phone', async () => {
        const restore = stubPhone();
        try {
            mount(makeWorkflow());
            const canvas = await screen.findByTestId('workflow-canvas');
            expect(screen.getByText(/canvas is read-only on a phone/i)).toBeInTheDocument();
            // Nothing that edits the graph is offered.
            expect(screen.queryByRole('button', { name: 'Add Owner' })).not.toBeInTheDocument();
            expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
            // The graph is still shown, just not draggable.
            expect(within(canvas).getByTestId('wf-node-coder')).toBeInTheDocument();
            expect(canvas.querySelector('.react-flow__node')).not.toHaveClass('draggable');
        } finally {
            restore();
        }
    });
});

// Tidy up (ATL-175). The fix for a graph nobody can follow is a layout that
// leaves edges room — but rearranging an Owner's own positions behind their
// back would be worse than the mess it fixes, so it is one press and one undo.
describe('Tidy up', () => {
    /** The fixture is a straight Start → Coder ⇄ Reviewer → End chain. */
    function messyWorkflow(): IWorkflow {
        const wf = makeWorkflow();
        // All four on top of each other: the worst case a drag can produce.
        for (const n of wf.graph.nodes) n.position = { x: 0, y: 0 };
        return wf;
    }

    it('lays the graph out, and puts it back', async () => {
        const wf = messyWorkflow();
        mount(wf);
        const tidy = await screen.findByRole('button', { name: 'Tidy up' });

        await userEvent.click(tidy);
        // The button becomes its own undo, and the draft is now dirty.
        expect(await screen.findByRole('button', { name: 'Undo tidy' })).toBeInTheDocument();
        expect(await screen.findByText('Unsaved changes')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Undo tidy' }));
        expect(await screen.findByRole('button', { name: 'Tidy up' })).toBeInTheDocument();
        // Back to the saved positions, so nothing is left to save.
        await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    });

    // It must never run on load: a workflow the Owner has not touched is not
    // dirty, and would otherwise be nagging them to save a layout they never
    // asked for.
    it('does nothing until it is pressed', async () => {
        mount(messyWorkflow());
        await screen.findByRole('button', { name: 'Tidy up' });
        expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });
});
