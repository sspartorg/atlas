import { describe, expect, it } from 'vitest';
import type { IWorkflowGraph } from '@atlas/shared';
import { makeRunDetail, makeRunStep, makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { connectEdges, nodeRunStates, normalizeGraph, newNodeId, toFlow, toGraph, type WfNode } from './graph.js';

describe('workflow graph helpers', () => {
    it('round-trips a saved graph through the canvas shapes', () => {
        const { graph } = makeWorkflow();
        graph.nodes.push({ id: 'qa', type: 'subtasks', sub_workflow_id: 'wf-test', label: 'qa', position: { x: 0, y: 200 } });
        const flow = toFlow(graph);
        expect(flow.nodes.find((n) => n.id === 'start')?.deletable).toBe(false);
        expect(flow.nodes.find((n) => n.id === 'qa')?.data).toEqual({ sub_workflow_id: 'wf-test', label: 'qa' });
        expect(flow.edges.find((e) => e.id === 'e4')?.sourceHandle).toBe('fail');
        expect(toGraph(flow.nodes, flow.edges)).toEqual(normalizeGraph(graph));
    });

    it('a new connection replaces the handle’s previous one of the same kind', () => {
        const { edges } = toFlow(makeWorkflow().graph);
        const next = connectEdges(edges, { source: 'review', sourceHandle: 'fail', target: 'start', targetHandle: null });
        const fromReview = toGraph([], next).edges.filter((e) => e.source === 'review');
        expect(fromReview.filter((e) => e.kind === 'fail').map((e) => e.target)).toEqual(['start']);
        expect(fromReview.filter((e) => e.kind === 'pass').map((e) => e.target)).toEqual(['end']);
    });

    it('derives node run state and visit counts from the steps', () => {
        const run = makeRunDetail({
            status: 'waiting_for_owner',
            current_node_id: null,
            parked_node_id: 'review',
            steps: [
                makeRunStep({ id: 'r1', node_id: 'coder' }),
                makeRunStep({ id: 'r2', node_id: 'review', status: 'completed' }),
                makeRunStep({ id: 'r3', node_id: 'coder', status: 'error' }),
            ],
        });
        const states = nodeRunStates(run);
        expect(states.get('start')).toEqual({ state: 'done', visits: 1 });
        expect(states.get('coder')).toEqual({ state: 'failed', visits: 2 });
        expect(states.get('review')).toEqual({ state: 'parked', visits: 1 });
        expect(states.has('end')).toBe(false);
    });

    it('shows a Sub-tasks step’s progress from the sub-task runs it started', () => {
        const base = makeRunDetail();
        const graph = {
            nodes: [...base.graph_snapshot.nodes, { id: 'build', type: 'subtasks' as const, sub_workflow_id: 'wf-build', position: { x: 0, y: 0 } }],
            edges: base.graph_snapshot.edges,
        };
        const child = (id: string, status: 'completed' | 'running') => ({ ...makeRunDetail({ id, status }), parent_node_id: 'build' });
        const run = makeRunDetail({
            graph_snapshot: graph,
            current_node_id: 'build',
            steps: [],
            children: [child('c1', 'completed'), child('c2', 'running')],
        });
        expect(nodeRunStates(run).get('build')).toEqual({ state: 'current', visits: 1, subtasks: { done: 1, started: 2 } });
    });

    it('draws a connection back up the graph into the node’s side, and forward ones into its top', () => {
        const { edges } = toFlow(makeWorkflow().graph);
        expect(edges.find((e) => e.id === 'e1')).toMatchObject({ targetHandle: 'in', type: 'smoothstep' });
        // e4: the reviewer fails back up to the coder.
        expect(edges.find((e) => e.id === 'e4')).toMatchObject({ targetHandle: 'loop', sourceHandle: 'fail' });
    });

    // An edge whose target was deleted is invalid — the validator says so —
    // but the canvas still has to draw the graph, otherwise the Owner cannot
    // see the broken connection in order to remove it.
    it('still lays out an edge pointing at a node that no longer exists', () => {
        const graph: IWorkflowGraph = {
            nodes: [
                { id: 'start', type: 'start', position: { x: 0, y: 0 } },
                { id: 'coder', type: 'agent', agent_id: 'agent-coder', position: { x: 0, y: 130 } },
            ],
            edges: [{ id: 'e-dangling', source: 'coder', target: 'ghost', kind: 'pass' }],
        };
        const dangling = toFlow(graph).edges[0];
        // The missing node's y reads as 0, i.e. above the source, so the edge
        // takes the loop handle rather than crashing the lookup.
        expect(dangling).toMatchObject({ id: 'e-dangling', target: 'ghost', targetHandle: 'loop' });
    });
});

describe('toGraph', () => {
    function flowNode(overrides: Partial<WfNode> & Pick<WfNode, 'id' | 'position'>): WfNode {
        return { data: {}, ...overrides };
    }

    // Dragging a node leaves fractional coordinates. The builder's dirty check
    // compares JSON of the saved graph with the draft, so un-rounded positions
    // would make a workflow read as edited after a drag of half a pixel.
    it('rounds dragged positions to whole pixels', () => {
        const graph = toGraph([flowNode({ id: 'a', type: 'agent', position: { x: 12.4, y: -7.6 } })], []);
        expect(graph.nodes[0]?.position).toEqual({ x: 12, y: -8 });
    });

    // ReactFlow leaves `type` off a node it did not get one for; agent is the
    // only type a bare node can safely become, and the validator then asks for
    // an agent rather than rejecting an unknown type.
    it('defaults a node with no type to an agent', () => {
        expect(toGraph([flowNode({ id: 'a', position: { x: 0, y: 0 } })], [])).toEqual({
            nodes: [{ id: 'a', type: 'agent', position: { x: 0, y: 0 } }],
            edges: [],
        });
    });

    it('drops a label that is only whitespace instead of saving it', () => {
        const nodes = [flowNode({ id: 'q', type: 'subtasks', position: { x: 0, y: 0 }, data: { label: '  qa  ' } })];
        const blank = [flowNode({ id: 'q', type: 'subtasks', position: { x: 0, y: 0 }, data: { label: '   ' } })];
        expect(toGraph(nodes, []).nodes[0]?.label).toBe('qa');
        expect(toGraph(blank, []).nodes[0]).not.toHaveProperty('label');
    });

    // An edge that never went through `flowEdge` (one ReactFlow synthesised)
    // carries no data; treating it as a pass keeps the graph loadable.
    it('treats an edge with no kind data as a pass connection', () => {
        const graph = toGraph([], [{ id: 'e', source: 'a', target: 'b' }]);
        expect(graph.edges).toEqual([{ id: 'e', source: 'a', target: 'b', kind: 'pass' }]);
    });
});

describe('connectEdges', () => {
    it('makes a connection from any handle but fail a pass connection', () => {
        const { edges } = toFlow(makeWorkflow().graph);
        const next = connectEdges(edges, { source: 'coder', sourceHandle: 'pass', target: 'end', targetHandle: 'in' });
        const fromCoder = toGraph([], next).edges.filter((e) => e.source === 'coder');
        // The coder's old pass edge (to the reviewer) is replaced, not added to.
        expect(fromCoder).toEqual([{ id: expect.any(String), source: 'coder', target: 'end', kind: 'pass' }]);
    });

    // A fail connection drawn into a node's right-hand handle has to keep that
    // handle, otherwise the loop redraws through the top and crosses the main
    // line of the graph.
    it('keeps the side handle a loop connection was dropped on', () => {
        const next = connectEdges([], { source: 'review', sourceHandle: 'fail', target: 'coder', targetHandle: 'loop' });
        expect(next[0]).toMatchObject({ targetHandle: 'loop', sourceHandle: 'fail' });
        expect(next[0]?.markerEnd).toMatchObject({ color: expect.any(String) });
    });

    it('leaves the other handle’s connection alone', () => {
        const { edges } = toFlow(makeWorkflow().graph);
        const next = connectEdges(edges, { source: 'review', sourceHandle: 'pass', target: 'coder', targetHandle: 'loop' });
        expect(toGraph([], next).edges).toContainEqual({ id: 'e4', source: 'review', target: 'coder', kind: 'fail' });
    });
});

describe('newNodeId', () => {
    it('names an id after the node type and does not repeat it', () => {
        const ids = Array.from({ length: 50 }, () => newNodeId('agent'));
        expect(ids.every((id) => id.startsWith('agent-'))).toBe(true);
        expect(new Set(ids).size).toBe(50);
    });
});

describe('nodeRunStates', () => {
    it('ignores a step that never entered the graph', () => {
        // Setup steps (clone, worktree) carry no node_id; counting them would
        // put a visit badge on whichever node happened to be keyed null.
        const run = makeRunDetail({
            current_node_id: null,
            steps: [makeRunStep({ id: 's1', node_id: null }), makeRunStep({ id: 's2', node_id: 'coder' })],
        });
        const states = nodeRunStates(run);
        expect(states.get('coder')).toEqual({ state: 'done', visits: 1 });
        expect([...states.keys()]).toEqual(['start', 'coder']);
    });

    it('maps every run status onto a node state', () => {
        const run = makeRunDetail({
            graph_snapshot: {
                nodes: ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, type: 'agent' as const, agent_id: 'agent-coder', position: { x: 0, y: i } })),
                edges: [],
            },
            status: 'error',
            current_node_id: null,
            steps: [
                makeRunStep({ id: '1', node_id: 'a', status: 'queued' }),
                makeRunStep({ id: '2', node_id: 'b', status: 'in_progress' }),
                makeRunStep({ id: '3', node_id: 'c', status: 'error' }),
                makeRunStep({ id: '4', node_id: 'd', status: 'setup_failed' }),
                makeRunStep({ id: '5', node_id: 'e', status: 'cancelled' }),
            ],
        });
        const states = nodeRunStates(run);
        expect(['a', 'b', 'c', 'd', 'e'].map((id) => states.get(id)?.state)).toEqual([
            'current',
            'current',
            'failed',
            'failed',
            'cancelled',
        ]);
    });

    function subtasksRun(children: Array<{ id: string; status: 'completed' | 'running' | 'cancelled' | 'error' }>) {
        const base = makeRunDetail();
        return makeRunDetail({
            graph_snapshot: {
                nodes: [...base.graph_snapshot.nodes, { id: 'build', type: 'subtasks', sub_workflow_id: 'wf-build', position: { x: 0, y: 500 } }],
                edges: base.graph_snapshot.edges,
            },
            status: 'error',
            current_node_id: null,
            steps: [makeRunStep({ id: 's1', node_id: 'build', status: 'completed' })],
            children: children.map((c) => ({ ...makeRunDetail({ id: c.id, status: c.status }), parent_node_id: 'build' })),
        });
    }

    // A Sub-tasks step that fanned out to nothing (the Task had no sub-tasks)
    // must keep the state its own step produced rather than being reported as
    // a finished fan-out of zero.
    it('leaves a Sub-tasks step with no sub-task runs on its step state', () => {
        expect(nodeRunStates(subtasksRun([])).get('build')).toEqual({ state: 'done', visits: 1 });
    });

    it('cancels the Sub-tasks step when any sub-task run was cancelled', () => {
        expect(nodeRunStates(subtasksRun([{ id: 'c1', status: 'completed' }, { id: 'c2', status: 'cancelled' }])).get('build')).toEqual({
            state: 'cancelled',
            visits: 1,
            subtasks: { done: 1, started: 2 },
        });
    });

    // Only `completed` children count as done, so the badge reads 1/2 while
    // the second is still running.
    it('counts only the finished sub-task runs in the progress badge', () => {
        expect(nodeRunStates(subtasksRun([{ id: 'c1', status: 'completed' }, { id: 'c2', status: 'running' }])).get('build')?.subtasks).toEqual({
            done: 1,
            started: 2,
        });
    });

    // KNOWN DEFECT (reported, not fixed here): a sub-task run that errored is
    // neither counted as done nor reflected in the step's state — only
    // `cancelled` children change it — so the step renders green. Asserting
    // the counter only, so this test does not cement the wrong state.
    it('reports a failed sub-task run as not done in the progress badge', () => {
        expect(nodeRunStates(subtasksRun([{ id: 'c1', status: 'completed' }, { id: 'c2', status: 'error' }])).get('build')?.subtasks).toEqual({
            done: 1,
            started: 2,
        });
    });

    it('marks the node a finished run ended on as done', () => {
        const run = makeRunDetail({ status: 'completed', current_node_id: 'end', steps: [] });
        expect(nodeRunStates(run).get('end')).toEqual({ state: 'done', visits: 1 });
    });

    // A run can be parked without a node to blame (the engine parked the run
    // itself); marking must not invent an entry keyed on null.
    it('marks nothing when the parked node is unknown', () => {
        const run = makeRunDetail({ status: 'waiting_for_owner', parked_node_id: null, current_node_id: null, steps: [] });
        expect([...nodeRunStates(run).keys()]).toEqual(['start']);
    });

    // The run-level mark overrides the step state but must not wipe the
    // sub-task progress already worked out for that node.
    it('keeps sub-task progress when the run marks the same node current', () => {
        const run = { ...subtasksRun([{ id: 'c1', status: 'running' }]), status: 'running' as const, current_node_id: 'build' };
        expect(nodeRunStates(run).get('build')).toEqual({ state: 'current', visits: 1, subtasks: { done: 0, started: 1 } });
    });
});
