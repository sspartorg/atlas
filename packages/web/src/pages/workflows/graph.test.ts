import { describe, expect, it } from 'vitest';
import { makeRunDetail, makeRunStep, makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { connectEdges, nodeRunStates, normalizeGraph, toFlow, toGraph } from './graph.js';

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
});
