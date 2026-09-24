import {
    MarkerType,
    type Connection,
    type Edge,
    type Node,
    type SmoothStepPathOptions,
} from '@xyflow/react';
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
//
// That side is one corridor and every loop wants it, so `routeEdges` also
// hands each edge its own lane within it — see the comment there.

export interface IWfNodeData extends Record<string, unknown> {
    agent_id?: string | undefined;
    sub_workflow_id?: string | undefined;
    label?: string | undefined;
    /** Gate steps (ADR 0021): the guardrail script the step executes. */
    script_id?: string | undefined;
}
export type WfNode = Node<IWfNodeData, WorkflowNodeType>;
/** `pathOptions` is a render-time lane assignment (see `routeEdges`); `toGraph` drops it. */
export type WfEdge = Edge<{ kind: WorkflowEdgeKind }> & { pathOptions?: SmoothStepPathOptions };

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

/** A node card's height. The clearance an edge needs to drop cleanly into a top handle. */
const NODE_H = 64;

// Lane geometry for the right-hand corridor. `smoothstep`'s `offset` is the
// distance its first and last turn sit from the handle, so a per-edge offset
// gives each edge its own vertical lane instead of stacking every one of them
// at the default 20px. A card is 216 wide on a 320 column pitch, so the
// corridor beside a node spans 108..212 — five lanes fit with room to spare.
const LANE_OFFSET = 20;
const LANE_GAP = 18;
const LANE_COUNT = 5;
/** Corridors further apart than this do not compete for lanes. */
const LANE_SPREAD = 120;

/**
 * Which handle an edge enters its target by.
 *
 * A target that is not a clear node-height below the source cannot be entered
 * from the top: `smoothstep` would exit the source's right flank, double back
 * over the source card and drop in from above, crossing everything converging
 * on that same top handle. The old rule compared y with a bare `<`, so an equal
 * row (a fixer and its reviewer) and a near miss (a fixer only 60px under its
 * gate) both took the top handle and both drew that S.
 */
export function targetHandleOf(sourceY: number, targetY: number): TargetHandle {
    return targetY - sourceY >= NODE_H ? 'in' : 'loop';
}

/** Two spans overlap if neither ends before the other begins. */
function overlaps(a: Corridor, b: Corridor): boolean {
    return a.top <= b.bottom && b.top <= a.bottom && Math.abs(a.x - b.x) < LANE_SPREAD;
}

interface Corridor {
    top: number;
    bottom: number;
    x: number;
}

/**
 * Assign every edge its target handle and its lane, from live node positions.
 *
 * Both are derived, never persisted — which is the point. `toFlow` picks a
 * handle once from the saved graph, so dragging a node above its source left
 * the edge entering from the top until the page was reloaded. Running this on
 * render instead keeps the drawing honest about where the nodes actually are.
 *
 * Only edges that use a node's right flank compete for space: a `fail` edge
 * leaves by it, and any edge going back up the graph enters by it. Those are
 * coloured greedily by interval, which is optimal for intervals and needs no
 * search. Everything else keeps the default offset.
 */
export function routeEdges(nodes: WfNode[], edges: WfEdge[]): WfEdge[] {
    const at = new Map(nodes.map((n) => [n.id, n.position]));
    const y = (id: string) => at.get(id)?.y ?? 0;
    const x = (id: string) => at.get(id)?.x ?? 0;

    const handles = new Map<string, TargetHandle>();
    for (const e of edges) handles.set(e.id, targetHandleOf(y(e.source), y(e.target)));

    // Sorted by where each span starts, then by id so the result never depends
    // on edge order — an unstable lane would flicker on every re-render.
    const queued = edges
        .filter((e) => (e.data?.kind ?? 'pass') === 'fail' || handles.get(e.id) === 'loop')
        .map((e) => ({
            id: e.id,
            top: Math.min(y(e.source), y(e.target)),
            bottom: Math.max(y(e.source), y(e.target)) + NODE_H,
            // A fail edge leaves its source's flank; a loop-back enters its target's.
            x: (e.data?.kind ?? 'pass') === 'fail' ? x(e.source) : x(e.target),
        }))
        .sort((a, b) => a.top - b.top || (a.id < b.id ? -1 : 1));

    const lanes = new Map<string, number>();
    const placed: Array<Corridor & { lane: number }> = [];
    for (const span of queued) {
        const taken = new Set(placed.filter((p) => overlaps(p, span)).map((p) => p.lane));
        let lane = 0;
        while (taken.has(lane)) lane++;
        lanes.set(span.id, lane);
        placed.push({ ...span, lane });
    }

    return edges.map((e) => ({
        ...e,
        targetHandle: handles.get(e.id) ?? 'in',
        pathOptions: { offset: LANE_OFFSET + ((lanes.get(e.id) ?? 0) % LANE_COUNT) * LANE_GAP },
    }));
}

function yOf(graph: IWorkflowGraph, id: string): number {
    return graph.nodes.find((n) => n.id === id)?.position.y ?? 0;
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
        edges: graph.edges.map((e) => flowEdge(e, targetHandleOf(yOf(graph, e.source), yOf(graph, e.target)))),
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
