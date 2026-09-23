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
// after its edge kind — agents have `pass` + `fail`, Start / Owner /
// Sub-tasks only `pass` — so an edge's `sourceHandle` and its `kind` are
// always the same string.
//
// The flow runs top to bottom: a node takes input on its top (`in`) and
// passes out of its bottom. A connection that goes back up the graph (a
// reviewer's fail loop, an Owner answer) enters on the node's right side
// (`loop`), so loops run down the side instead of crossing the main line.

export interface IWfNodeData extends Record<string, unknown> {
    agent_id?: string | undefined;
    sub_workflow_id?: string | undefined;
    label?: string | undefined;
    /** Gate steps (ADR 0021): the guardrail script the step executes. */
    script_id?: string | undefined;
}
export type WfNode = Node<IWfNodeData, WorkflowNodeType>;
export type WfEdge = Edge<{ kind: WorkflowEdgeKind }>;

type TargetHandle = 'in' | 'loop';

function flowEdge(e: IWorkflowEdge, targetHandle: TargetHandle): WfEdge {
    return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.kind,
        targetHandle,
        // Right-angle connectors; ReactFlow's defaults round the corners slightly.
        type: 'smoothstep',
        data: { kind: e.kind },
        className: `wf-edge-${e.kind}`,
        markerEnd: {
            type: MarkerType.ArrowClosed,
            color: e.kind === 'pass' ? ATLAS_PALETTE.success : ATLAS_PALETTE.error,
        },
    };
}

/** An edge into a node above its source is a loop back; it enters on the side. */
function targetHandleOf(graph: IWorkflowGraph, e: IWorkflowEdge): TargetHandle {
    const y = (id: string) => graph.nodes.find((n) => n.id === id)?.position.y ?? 0;
    return y(e.target) < y(e.source) ? 'loop' : 'in';
}

export function toFlow(graph: IWorkflowGraph): { nodes: WfNode[]; edges: WfEdge[] } {
    return {
        nodes: graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: {
                ...(n.agent_id ? { agent_id: n.agent_id } : {}),
                ...(n.sub_workflow_id ? { sub_workflow_id: n.sub_workflow_id } : {}),
                ...(n.label ? { label: n.label } : {}),
                ...(n.script_id ? { script_id: n.script_id } : {}),
            },
            deletable: n.type !== 'start',
        })),
        edges: graph.edges.map((e) => flowEdge(e, targetHandleOf(graph, e))),
    };
}

export function toGraph(nodes: WfNode[], edges: WfEdge[]): IWorkflowGraph {
    return {
        nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type ?? 'agent',
            position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
            ...(n.data.agent_id ? { agent_id: n.data.agent_id } : {}),
            ...(n.data.sub_workflow_id ? { sub_workflow_id: n.data.sub_workflow_id } : {}),
            ...(n.data.label?.trim() ? { label: n.data.label.trim() } : {}),
            ...(n.data.script_id?.trim() ? { script_id: n.data.script_id.trim() } : {}),
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
    return [...kept, flowEdge({ id, source: c.source, target: c.target, kind }, c.targetHandle === 'loop' ? 'loop' : 'in')];
}

export function newNodeId(type: WorkflowNodeType): string {
    return `${type}-${Math.random().toString(36).slice(2, 8)}`;
}

type NodeRunState = 'done' | 'current' | 'failed' | 'parked' | 'cancelled';
export interface INodeRunInfo {
    state: NodeRunState;
    visits: number;
    /** Sub-tasks steps: how many of the sub-task runs they started have finished. */
    subtasks?: { done: number; started: number };
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
    for (const n of run.graph_snapshot.nodes) {
        if (n.type !== 'subtasks') continue;
        const kids = run.children.filter((c) => c.parent_node_id === n.id);
        if (kids.length === 0) continue;
        const done = kids.filter((c) => c.status === 'completed').length;
        // G-011 — a failed child used to fall through to `done`, so a
        // Sub-tasks step whose sub-task errored drew a green check. `error`
        // is checked before `cancelled` because a failure is the more
        // actionable signal when a run has both, and the step branch above
        // already maps error → 'failed' via STEP_STATE; this arm was simply
        // inconsistent with it.
        const state: NodeRunState = kids.some((c) => c.status === 'error')
            ? 'failed'
            : kids.some((c) => c.status === 'cancelled')
              ? 'cancelled'
              : 'done';
        out.set(n.id, {
            state,
            visits: 1,
            subtasks: { done, started: kids.length },
        });
    }
    const mark = (id: string | null, state: NodeRunState) => {
        if (id) out.set(id, { ...out.get(id), state, visits: out.get(id)?.visits ?? 1 });
    };
    if (run.status === 'waiting_for_owner') mark(run.parked_node_id, 'parked');
    if (run.status === 'running') mark(run.current_node_id, 'current');
    if (run.status === 'completed') mark(run.current_node_id, 'done');
    return out;
}
