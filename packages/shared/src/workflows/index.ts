import { z } from 'zod';
import type { AgentCli, RunOutcomeKind, RunStatus, SchedulePreset } from '../types/index.js';
import { SchedulePresetSchema } from '../schemas/index.js';

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
    /** Why the run is waiting for the Owner; null unless `waiting_for_owner`. */
    park_reason: string | null;
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

/** A list row: the run plus the title of the item it worked on. */
export interface IWorkflowRunSummary extends IWorkflowRun {
    item_title: string | null;
}

/** One agent step inside a workflow run — an `agent_runs` row projected for the run view. */
export interface IWorkflowRunStep {
    id: string;
    node_id: string | null;
    agent_id: string;
    agent_name: string | null;
    status: RunStatus;
    cli: AgentCli | null;
    model: string | null;
    outcome_kind: RunOutcomeKind | null;
    outcome_summary: string | null;
    outcome_reason: string | null;
    total_cost_usd: number | null;
    started_at: string | null;
    completed_at: string | null;
}

export interface IWorkflowRunDetail extends IWorkflowRunSummary {
    workflow_name: string;
    steps: IWorkflowRunStep[];
}

const WorkflowFieldsSchema = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(4000).nullable(),
    project_id: ID.nullable(),
    status: z.enum(['active', 'inactive']),
    graph: WorkflowGraphSchema,
    input_kind: z.enum(WORKFLOW_INPUT_KINDS),
    trigger: z.enum(WORKFLOW_TRIGGERS),
    use_worktree: z.boolean(),
    push_code: z.boolean(),
    raises_pr: z.boolean(),
    max_loops: z.number().int().min(1).max(20),
    schedule_preset: SchedulePresetSchema.nullable(),
    schedule_time_of_day: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .nullable(),
    schedule_weekday: z.number().int().min(0).max(6).nullable(),
    cron_expr: z.string().max(200).nullable(),
});

export const CreateWorkflowSchema = WorkflowFieldsSchema.partial().extend({
    name: WorkflowFieldsSchema.shape.name,
});
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;

export const UpdateWorkflowSchema = WorkflowFieldsSchema.partial();
export type UpdateWorkflowInput = z.infer<typeof UpdateWorkflowSchema>;

export const StartWorkflowRunSchema = z.object({ item_id: ID.optional() });

/** Queue an item for a workflow, or take it off every workflow with null. */
export const SetItemWorkflowSchema = z.object({ workflow_id: ID.nullable() });

export const CreateWorkflowFromTemplateSchema = z.object({
    template_id: ID,
    project_id: ID,
});

/** A shipped starter workflow. Agent nodes reference catalog agent ids. */
export interface IWorkflowTemplate {
    id: string;
    name: string;
    description: string;
    input_kind: WorkflowInputKind;
    trigger: WorkflowTrigger;
    use_worktree: boolean;
    push_code: boolean;
    raises_pr: boolean;
    graph: IWorkflowGraph;
}

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
