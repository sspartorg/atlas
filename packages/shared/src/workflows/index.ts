import { z } from 'zod';
import type { SchedulePreset } from '../types/index.js';

export const WORKFLOW_NODE_TYPES = ['start', 'agent', 'owner', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_EDGE_KINDS = ['pass', 'fail'] as const;
export type WorkflowEdgeKind = (typeof WORKFLOW_EDGE_KINDS)[number];

export const WORKFLOW_INPUT_KINDS = ['item', 'none'] as const;
export type WorkflowInputKind = (typeof WORKFLOW_INPUT_KINDS)[number];

export const WORKFLOW_TRIGGERS = ['manual', 'schedule', 'item_ready'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_RUN_STATUSES = ['running', 'waiting_for_owner', 'completed', 'cancelled', 'error'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export interface IWorkflowNode {
    id: string;
    type: WorkflowNodeType;
    agent_id?: string | undefined;
    child_workflow_id?: string | undefined;
    position: { x: number; y: number };
}

export interface IWorkflowEdge {
    id: string;
    source: string;
    target: string;
    kind: WorkflowEdgeKind;
}

export interface IWorkflowGraph {
    nodes: IWorkflowNode[];
    edges: IWorkflowEdge[];
}

export interface IWorkflow {
    id: string;
    project_id: string | null;
    name: string;
    description: string | null;
    status: 'active' | 'inactive';
    graph: IWorkflowGraph;
    input_kind: WorkflowInputKind;
    trigger: WorkflowTrigger;
    use_worktree: boolean;
    push_code: boolean;
    raises_pr: boolean;
    max_loops: number;
    schedule_preset: SchedulePreset | null;
    schedule_time_of_day: string | null;
    schedule_weekday: number | null;
    cron_expr: string | null;
    next_run_at: string | null;
    last_run_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface IWorkflowRun {
    id: string;
    workflow_id: string;
    item_id: string | null;
    project_id: string | null;
    status: WorkflowRunStatus;
    graph_snapshot: IWorkflowGraph;
    current_node_id: string | null;
    parked_node_id: string | null;
    loop_count: number;
    branch: string | null;
    worktree_path: string | null;
    setup_done: boolean;
    pr_url: string | null;
    started_at: string;
    updated_at: string;
    finished_at: string | null;
}

export interface IWorkflowGraphError {
    node_id: string | null;
    message: string;
}

const ID = z.string().min(1).max(200);

export const WorkflowGraphSchema: z.ZodType<IWorkflowGraph> = z.object({
    nodes: z
        .array(
            z.object({
                id: ID,
                type: z.enum(WORKFLOW_NODE_TYPES),
                agent_id: ID.optional(),
                child_workflow_id: ID.optional(),
                position: z.object({ x: z.number(), y: z.number() }),
            }),
        )
        .max(100),
    edges: z
        .array(z.object({ id: ID, source: ID, target: ID, kind: z.enum(WORKFLOW_EDGE_KINDS) }))
        .max(300),
});

export function validateWorkflowGraph(graph: IWorkflowGraph): IWorkflowGraphError[] {
    const errors: IWorkflowGraphError[] = [];
    const ids = new Set(graph.nodes.map((n) => n.id));
    if (ids.size !== graph.nodes.length) errors.push({ node_id: null, message: 'Node ids must be unique' });

    const starts = graph.nodes.filter((n) => n.type === 'start');
    if (starts.length !== 1) errors.push({ node_id: null, message: 'A workflow needs exactly one Start node' });
    if (!graph.nodes.some((n) => n.type === 'end')) {
        errors.push({ node_id: null, message: 'A workflow needs at least one End node' });
    }

    for (const e of graph.edges) {
        if (!ids.has(e.source) || !ids.has(e.target)) {
            errors.push({ node_id: null, message: `Connection ${e.id} points at a node that does not exist` });
        }
    }

    for (const n of graph.nodes) {
        const out = graph.edges.filter((e) => e.source === n.id);
        const passCount = out.filter((e) => e.kind === 'pass').length;
        const failCount = out.length - passCount;
        if (n.type !== 'agent' && n.agent_id) errors.push({ node_id: n.id, message: 'Only agent nodes reference an agent' });
        if (n.type === 'agent' && !n.agent_id) errors.push({ node_id: n.id, message: 'Choose an agent for this node' });
        if (n.type !== 'end' && n.child_workflow_id) {
            errors.push({ node_id: n.id, message: 'Only End nodes route children to a workflow' });
        }
        if (n.type === 'start' && graph.edges.some((e) => e.target === n.id)) {
            errors.push({ node_id: n.id, message: 'Nothing can connect into Start' });
        }
        if (n.type === 'end') {
            if (out.length > 0) errors.push({ node_id: n.id, message: 'End cannot have outgoing connections' });
            continue;
        }
        if (n.type !== 'agent' && failCount > 0) {
            errors.push({ node_id: n.id, message: 'Only agent nodes can have a fail connection' });
        }
        if (passCount !== 1) errors.push({ node_id: n.id, message: 'Needs exactly one pass connection' });
        if (n.type === 'agent' && failCount > 1) errors.push({ node_id: n.id, message: 'At most one fail connection' });
    }

    if (starts.length === 1) {
        const reached = new Set(starts.map((s) => s.id));
        const stack = [...reached];
        for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
            for (const e of graph.edges) {
                if (e.source === id && !reached.has(e.target)) {
                    reached.add(e.target);
                    stack.push(e.target);
                }
            }
        }
        for (const n of graph.nodes) {
            if (!reached.has(n.id)) errors.push({ node_id: n.id, message: 'Not reachable from Start' });
        }
    }

    // The engine caps loops by counting fail-edge traversals; a cycle of
    // pass edges would never touch that counter and could spin forever.
    const loopAt = findPassLoop(graph);
    if (loopAt !== null) {
        errors.push({ node_id: loopAt, message: 'Pass connections form a loop; loop back with a fail connection instead' });
    }

    return errors;
}

function findPassLoop(graph: IWorkflowGraph): string | null {
    const next = new Map<string, string[]>();
    for (const e of graph.edges) {
        if (e.kind === 'pass') next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
    }
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (id: string): string | null => {
        const seen = state.get(id);
        if (seen === 'done') return null;
        if (seen === 'visiting') return id;
        state.set(id, 'visiting');
        for (const target of next.get(id) ?? []) {
            const hit = visit(target);
            if (hit !== null) return hit;
        }
        state.set(id, 'done');
        return null;
    };
    for (const n of graph.nodes) {
        const hit = visit(n.id);
        if (hit !== null) return hit;
    }
    return null;
}
