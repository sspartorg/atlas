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
            node('end', 'end'),
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

    it('rejects an agent node with no agent and a misplaced agent_id / sub_workflow_id / label', () => {
        const graph = devGraph();
        graph.nodes[0] = node('start', 'start', { agent_id: 'agent-coder' });
        graph.nodes[1] = node('coder', 'agent', { sub_workflow_id: 'wf-x' });
        graph.nodes[2] = node('review', 'agent', { agent_id: 'agent-reviewer', label: 'qa' });
        expect(errorsOf(graph)).toEqual([
            'start: Only agent and gate steps reference an agent',
            'coder: Choose an agent for this node',
            'coder: Only Sub-tasks steps take a sub-workflow or label',
            'review: Only Sub-tasks steps take a sub-workflow or label',
        ]);
    });

    // Start → PO → Sub-tasks(dev) → Sub-tasks(qa) → End.
    function taskGraph(): IWorkflowGraph {
        return {
            nodes: [
                node('start', 'start'),
                node('po', 'agent', { agent_id: 'agent-po-writer' }),
                node('build', 'subtasks', { sub_workflow_id: 'wf-build' }),
                node('test', 'subtasks', { sub_workflow_id: 'wf-test', label: 'qa' }),
                node('end', 'end'),
            ],
            edges: [edge('start', 'po'), edge('po', 'build'), edge('build', 'test'), edge('test', 'end')],
        };
    }

    it('accepts Sub-tasks steps in a Task workflow', () => {
        expect(validateWorkflowGraph(taskGraph(), 'item')).toEqual([]);
    });

    it('requires a sub-workflow on a Sub-tasks step and forbids its fail connection', () => {
        const graph = taskGraph();
        graph.nodes[2] = node('build', 'subtasks');
        graph.edges.push(edge('test', 'po', 'fail'));
        expect(errorsOf(graph)).toEqual([
            'build: Choose the sub-workflow for these sub-tasks',
            'test: Only agent and gate steps can have a fail connection',
        ]);
    });

    describe('gate steps', () => {
        // Start -> gate -> End, with the gate failing to a fixer that loops back.
        // This shape is the entire point of the node type: the checker names the
        // command, Atlas runs it, and the fixer is dispatched only when it says no.
        function gateGraph(): IWorkflowGraph {
            return {
                nodes: [
                    node('start', 'start'),
                    node('cov', 'gate', { agent_id: 'agent-tests-check' }),
                    node('fixer', 'agent', { agent_id: 'agent-coverage-fixer' }),
                    node('end', 'end'),
                ],
                edges: [
                    edge('start', 'cov'),
                    edge('cov', 'end'),
                    edge('cov', 'fixer', 'fail'),
                    edge('fixer', 'cov'),
                ],
            };
        }

        it('accepts a gate that fails to a fixer which loops back to it', () => {
            // The cycle runs through a fail edge, so `loop_count` advances on
            // every traversal and `max_loops` bounds it. `findPassLoop` walks
            // pass edges only, which is why this is not rejected as a loop.
            expect(errorsOf(gateGraph())).toEqual([]);
        });

        it('requires a checker agent on a gate step', () => {
            const graph = gateGraph();
            graph.nodes[1] = node('cov', 'gate');
            expect(errorsOf(graph)).toEqual(['cov: Choose the checker agent for this gate']);
        });

        it('still rejects an agent_id on a step that can carry neither', () => {
            const graph = gateGraph();
            graph.nodes.push(node('ask', 'owner', { agent_id: 'agent-coder' }));
            graph.edges.push(edge('ask', 'end'));
            expect(errorsOf(graph)).toContain('ask: Only agent and gate steps reference an agent');
        });

        it('allows a gate at most one fail connection', () => {
            const graph = gateGraph();
            graph.nodes.push(node('other', 'agent', { agent_id: 'agent-hygiene-fixer' }));
            graph.edges.push(edge('cov', 'other', 'fail'), edge('other', 'end'));
            expect(errorsOf(graph)).toEqual(['cov: At most one fail connection']);
        });

        it('still requires exactly one pass connection from a gate', () => {
            const graph = gateGraph();
            graph.edges = graph.edges.filter((e) => !(e.source === 'cov' && e.kind === 'pass'));
            expect(errorsOf(graph)).toContain('cov: Needs exactly one pass connection');
        });

        it('parses a gate node through the graph schema', () => {
            const parsed = WorkflowGraphSchema.safeParse(gateGraph());
            expect(parsed.success).toBe(true);
        });

        // ADR 0024 deleted the field. A saved graph that still carries one is
        // rewritten by migration 020; anything else is a graph Atlas never
        // wrote, and the schema drops the key rather than honouring it.
        it('does not carry a script_id through the schema any more', () => {
            const graph = gateGraph() as IWorkflowGraph & { nodes: Array<Record<string, unknown>> };
            graph.nodes[1] = { ...graph.nodes[1], script_id: 'gate-coverage' } as never;
            const parsed = WorkflowGraphSchema.safeParse(graph);
            expect(parsed.success).toBe(true);
            expect(parsed.success && 'script_id' in parsed.data.nodes[1]!).toBe(false);
        });
    });

    it('allows Sub-tasks steps only in workflows that run on a Task', () => {
        for (const kind of ['none', 'sub_task'] as const) {
            expect(validateWorkflowGraph(taskGraph(), kind).map((e) => e.node_id)).toEqual(['build', 'test']);
        }
    });

    it('rejects a Sub-tasks label longer than 40 characters', () => {
        const graph = taskGraph();
        graph.nodes[3] = node('test', 'subtasks', { sub_workflow_id: 'wf-test', label: 'x'.repeat(41) });
        expect(WorkflowGraphSchema.safeParse(graph).success).toBe(false);
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
            'start: Only agent and gate steps can have a fail connection',
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
