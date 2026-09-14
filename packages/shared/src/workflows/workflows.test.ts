import { describe, expect, it } from 'vitest';
import {
    WorkflowGraphSchema,
    validateWorkflowGraph,
    type IWorkflowEdge,
    type IWorkflowGraph,
    type IWorkflowNode,
    type WorkflowEdgeKind,
    type WorkflowNodeType,
} from './index.js';

const node = (id: string, type: WorkflowNodeType, extra: Partial<IWorkflowNode> = {}): IWorkflowNode => ({
    id,
    type,
    position: { x: 0, y: 0 },
    ...extra,
});

const edge = (source: string, target: string, kind: WorkflowEdgeKind = 'pass'): IWorkflowEdge => ({
    id: `${source}-${kind}-${target}`,
    source,
    target,
    kind,
});

// Start → Coder → Reviewer → End, with Reviewer failing back to Coder.
function devGraph(): IWorkflowGraph {
    return {
        nodes: [
            node('start', 'start'),
            node('coder', 'agent', { agent_id: 'agent-coder' }),
            node('review', 'agent', { agent_id: 'agent-code-reviewer' }),
            node('end', 'end', { child_workflow_id: 'wf-dev' }),
        ],
        edges: [edge('start', 'coder'), edge('coder', 'review'), edge('review', 'end'), edge('review', 'coder', 'fail')],
    };
}

const errorsOf = (graph: IWorkflowGraph): string[] =>
    validateWorkflowGraph(graph).map((e) => `${e.node_id ?? '*'}: ${e.message}`);

describe('WorkflowGraphSchema', () => {
    it('accepts a well-formed graph', () => {
        expect(WorkflowGraphSchema.safeParse(devGraph()).success).toBe(true);
    });

    it('rejects an unknown node type', () => {
        const graph = { nodes: [{ id: 'x', type: 'parallel', position: { x: 0, y: 0 } }], edges: [] };
        expect(WorkflowGraphSchema.safeParse(graph).success).toBe(false);
    });
});

describe('validateWorkflowGraph', () => {
    it('accepts a fail edge that loops back', () => {
        expect(errorsOf(devGraph())).toEqual([]);
    });

    it('rejects an empty graph', () => {
        expect(errorsOf({ nodes: [], edges: [] })).toEqual([
            '*: A workflow needs exactly one Start node',
            '*: A workflow needs at least one End node',
        ]);
    });

    it('rejects duplicate node ids and a second Start', () => {
        const graph = devGraph();
        graph.nodes.push(node('start', 'start'));
        expect(errorsOf(graph)).toEqual([
            '*: Node ids must be unique',
            '*: A workflow needs exactly one Start node',
        ]);
    });

    it('rejects edges from or to a missing node', () => {
        const graph = devGraph();
        graph.edges.push(edge('coder', 'ghost', 'fail'), edge('ghost', 'end', 'fail'));
        expect(errorsOf(graph)).toEqual([
            '*: Connection coder-fail-ghost points at a node that does not exist',
            '*: Connection ghost-fail-end points at a node that does not exist',
        ]);
    });

    it('rejects an agent node with no agent and a misplaced agent_id / child_workflow_id', () => {
        const graph = devGraph();
        graph.nodes[0] = node('start', 'start', { agent_id: 'agent-coder' });
        graph.nodes[1] = node('coder', 'agent', { child_workflow_id: 'wf-x' });
        graph.nodes[2] = node('review', 'agent', { agent_id: 'agent-reviewer', test_child_workflow_id: 'wf-qa' });
        expect(errorsOf(graph)).toEqual([
            'start: Only agent nodes reference an agent',
            'coder: Choose an agent for this node',
            'coder: Only End nodes route children to a workflow',
            'review: Only End nodes route children to a workflow',
        ]);
    });

    it('rejects connections into Start and out of End', () => {
        const graph = devGraph();
        graph.nodes.push(node('owner', 'owner'));
        graph.edges.push(edge('end', 'owner'), edge('owner', 'start'));
        // start → coder → review → end → owner → start is also an all-pass loop.
        expect(errorsOf(graph)).toEqual([
            'start: Nothing can connect into Start',
            'end: End cannot have outgoing connections',
            'start: Pass connections form a loop; loop back with a fail connection instead',
        ]);
    });

    it('requires exactly one pass connection and limits fail connections', () => {
        const graph = devGraph();
        graph.nodes.push(node('owner', 'owner'), node('end2', 'end'));
        graph.edges.push(
            edge('start', 'end2', 'fail'),
            edge('coder', 'end2'),
            edge('coder', 'owner', 'fail'),
            edge('coder', 'end', 'fail'),
        );
        expect(errorsOf(graph)).toEqual([
            'start: Only agent nodes can have a fail connection',
            'coder: Needs exactly one pass connection',
            'coder: At most one fail connection',
            'owner: Needs exactly one pass connection',
        ]);
    });

    it('rejects nodes that Start cannot reach', () => {
        const graph = devGraph();
        graph.nodes.push(node('orphan', 'agent', { agent_id: 'agent-coder' }));
        graph.edges.push(edge('orphan', 'end'));
        expect(errorsOf(graph)).toEqual(['orphan: Not reachable from Start']);
    });

    it('rejects a loop made only of pass connections', () => {
        const graph = devGraph();
        // Every node still has exactly one pass edge; only the loop is wrong.
        // DFS from start reaches coder again while it is still `visiting`.
        graph.edges = [edge('start', 'coder'), edge('coder', 'review'), edge('review', 'coder'), edge('review', 'end', 'fail')];
        expect(errorsOf(graph)).toEqual([
            'coder: Pass connections form a loop; loop back with a fail connection instead',
        ]);
    });
});
