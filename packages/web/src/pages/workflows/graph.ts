import { MarkerType, type Connection, type Edge, type Node } from '@xyflow/react';
import type {
    IWorkflowEdge,
    IWorkflowGraph,
    IWorkflowRunDetail,
    RunStatus,
    WorkflowEdgeKind,
    WorkflowNodeType,
} from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// Conversions between the persisted workflow graph (`@atlas/shared`) and the
// ReactFlow node/edge shapes the canvas renders. Every source handle is named
// after its edge kind — agents have `pass` + `fail`, Start/Owner only `pass`
// — so an edge's `sourceHandle` and its `kind` are always the same string.

export interface IWfNodeData extends Record<string, unknown> {
    agent_id?: string | undefined;
    child_workflow_id?: string | undefined;
    test_child_workflow_id?: string | undefined;
}
export type WfNode = Node<IWfNodeData, WorkflowNodeType>;
export type WfEdge = Edge<{ kind: WorkflowEdgeKind }>;

function flowEdge(e: IWorkflowEdge): WfEdge {
    return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.kind,
        data: { kind: e.kind },
        className: `wf-edge-${e.kind}`,
        markerEnd: {
            type: MarkerType.ArrowClosed,
            color: e.kind === 'pass' ? ATLAS_PALETTE.success : ATLAS_PALETTE.error,
        },
    };
}

export function toFlow(graph: IWorkflowGraph): { nodes: WfNode[]; edges: WfEdge[] } {
    return {
        nodes: graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: {
                ...(n.agent_id ? { agent_id: n.agent_id } : {}),
                ...(n.child_workflow_id ? { child_workflow_id: n.child_workflow_id } : {}),
                ...(n.test_child_workflow_id ? { test_child_workflow_id: n.test_child_workflow_id } : {}),
            },
            deletable: n.type !== 'start',
        })),
        edges: graph.edges.map(flowEdge),
    };
}

export function toGraph(nodes: WfNode[], edges: WfEdge[]): IWorkflowGraph {
    return {
        nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type ?? 'agent',
            position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
            ...(n.data.agent_id ? { agent_id: n.data.agent_id } : {}),
            ...(n.data.child_workflow_id ? { child_workflow_id: n.data.child_workflow_id } : {}),
            ...(n.data.test_child_workflow_id ? { test_child_workflow_id: n.data.test_child_workflow_id } : {}),
        })),
        edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            kind: e.data?.kind ?? 'pass',
        })),
    };
}

/** Same graph, stable key order — lets a draft be compared with the saved copy by JSON. */
export function normalizeGraph(graph: IWorkflowGraph): IWorkflowGraph {
    const flow = toFlow(graph);
    return toGraph(flow.nodes, flow.edges);
}

/**
 * A node owns one pass and at most one fail connection, so drawing a new one
 * from a handle replaces whatever that handle pointed at before.
 */
export function connectEdges(edges: WfEdge[], c: Connection): WfEdge[] {
    const kind: WorkflowEdgeKind = c.sourceHandle === 'fail' ? 'fail' : 'pass';
    const kept = edges.filter((e) => !(e.source === c.source && (e.data?.kind ?? 'pass') === kind));
    const id = `e-${c.source}-${kind}-${Date.now().toString(36)}`;
    return [...kept, flowEdge({ id, source: c.source, target: c.target, kind })];
}

export function newNodeId(type: WorkflowNodeType): string {
    return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

type NodeRunState = 'done' | 'current' | 'failed' | 'parked' | 'cancelled';
export interface INodeRunInfo {
    state: NodeRunState;
    visits: number;
}

const STEP_STATE: Record<RunStatus, NodeRunState> = {
    queued: 'current',
    in_progress: 'current',
    completed: 'done',
    error: 'failed',
    setup_failed: 'failed',
    cancelled: 'cancelled',
};

/** Per-node highlight for the run view; steps arrive oldest first, so the latest visit wins. */
export function nodeRunStates(run: IWorkflowRunDetail): Map<string, INodeRunInfo> {
    const out = new Map<string, INodeRunInfo>();
    for (const n of run.graph_snapshot.nodes) {
        if (n.type === 'start') out.set(n.id, { state: 'done', visits: 1 });
    }
    for (const step of run.steps) {
        if (!step.node_id) continue;
        const visits = (out.get(step.node_id)?.visits ?? 0) + 1;
        out.set(step.node_id, { state: STEP_STATE[step.status], visits });
    }
    const mark = (id: string | null, state: NodeRunState) => {
        if (id) out.set(id, { state, visits: out.get(id)?.visits ?? 1 });
    };
    if (run.status === 'waiting_for_owner') mark(run.parked_node_id, 'parked');
    if (run.status === 'running') mark(run.current_node_id, 'current');
    if (run.status === 'completed') mark(run.current_node_id, 'done');
    return out;
}
