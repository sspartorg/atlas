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
            'start: Only agent steps reference an agent',
            'coder: Choose an agent for this node',
            'coder: Only Sub-tasks steps take a sub-workflow',
            'review: Only Sub-tasks and Script steps take a label',
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
            'test: Only agent and script steps can have a fail connection',
        ]);
    });

    describe('script steps', () => {
        // Start -> script -> End, with the script failing to a fixer that loops back.
        // The Owner types the command; Atlas runs it. No AI picks it.
        function scriptGraph(): IWorkflowGraph {
            return {
                nodes: [
                    node('start', 'start'),
                    node('build', 'script', { command: 'npm run build' }),
                    node('fixer', 'agent', { agent_id: 'agent-coder' }),
                    node('end', 'end'),
                ],
                edges: [
                    edge('start', 'build'),
                    edge('build', 'end'),
                    edge('build', 'fixer', 'fail'),
                    edge('fixer', 'build'),
                ],
            };
        }

        it('accepts a script that fails to a fixer which loops back to it', () => {
            // The cycle runs through a fail edge, so `loop_count` advances on
            // every traversal and `max_loops` bounds it.
            expect(errorsOf(scriptGraph())).toEqual([]);
        });

        it('accepts a script saved with an empty command (it parks at run time, not here)', () => {
            const graph = scriptGraph();
            graph.nodes[1] = node('build', 'script', { command: '' });
            expect(errorsOf(graph)).toEqual([]);
        });

        it('rejects an agent on a script step and a command on any other step', () => {
            const graph = scriptGraph();
            graph.nodes[1] = node('build', 'script', { agent_id: 'agent-coder', command: 'npm run build' });
            expect(errorsOf(graph)).toContain('build: Only agent steps reference an agent');
            const agent = scriptGraph();
            agent.nodes[2] = node('fixer', 'agent', { agent_id: 'agent-coder', command: 'npm test' });
            expect(errorsOf(agent)).toContain('fixer: Only Script steps take a command');
        });

        it('allows a script at most one fail connection', () => {
            const graph = scriptGraph();
            graph.nodes.push(node('other', 'agent', { agent_id: 'agent-hygiene-fixer' }));
            graph.edges.push(edge('build', 'other', 'fail'), edge('other', 'end'));
            expect(errorsOf(graph)).toEqual(['build: At most one fail connection']);
        });

        it('still requires exactly one pass connection from a script', () => {
            const graph = scriptGraph();
            graph.edges = graph.edges.filter((e) => !(e.source === 'build' && e.kind === 'pass'));
            expect(errorsOf(graph)).toContain('build: Needs exactly one pass connection');
        });

        it('parses a script node through the graph schema, keeping its command', () => {
            const parsed = WorkflowGraphSchema.safeParse(scriptGraph());
            expect(parsed.success).toBe(true);
            expect(parsed.success && parsed.data.nodes[1]?.command).toBe('npm run build');
        });

        // ADR 0024 deleted the field. A saved graph that still carries one is
        // rewritten by migration 020; anything else is a graph Atlas never
        // wrote, and the schema drops the key rather than honouring it.
        it('does not carry a script_id through the schema any more', () => {
            const graph = scriptGraph() as IWorkflowGraph & { nodes: Array<Record<string, unknown>> };
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
            'start: Only agent and script steps can have a fail connection',
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
