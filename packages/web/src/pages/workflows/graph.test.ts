import { describe, expect, it } from 'vitest';
import { makeRunDetail, makeRunStep, makeWorkflow } from '../../test-utils/workflowFixtures.js';
import { connectEdges, nodeRunStates, normalizeGraph, toFlow, toGraph } from './graph.js';

describe('workflow graph helpers', () => {
    it('round-trips a saved graph through the canvas shapes', () => {
        const { graph } = makeWorkflow();
        graph.nodes = graph.nodes.map((n) => (n.type === 'end' ? { ...n, child_workflow_id: 'wf-dev', test_child_workflow_id: 'wf-qa' } : n));
        const flow = toFlow(graph);
        expect(flow.nodes.find((n) => n.id === 'start')?.deletable).toBe(false);
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
});
