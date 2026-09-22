import { z } from 'zod';
import type { AgentCli, AgentEffort, ITask, RunOutcomeKind, RunStatus, SchedulePreset } from '../types/index.js';
import { SchedulePresetSchema } from '../schemas/index.js';

export const WORKFLOW_NODE_TYPES = ['start', 'agent', 'owner', 'subtasks', 'end'] as const;
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number];

export const WORKFLOW_EDGE_KINDS = ['pass', 'fail'] as const;
export type WorkflowEdgeKind = (typeof WORKFLOW_EDGE_KINDS)[number];

// `sub_task` marks a sub-workflow: it only runs inside a Task's workflow, on
// one sub-task at a time, from a Sub-tasks step (ADR 0015).
export const WORKFLOW_INPUT_KINDS = ['item', 'none', 'sub_task'] as const;
export type WorkflowInputKind = (typeof WORKFLOW_INPUT_KINDS)[number];

export const WORKFLOW_TRIGGERS = ['manual', 'schedule', 'item_ready'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_RUN_STATUSES = ['running', 'waiting_for_owner', 'completed', 'cancelled', 'error'] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export interface IWorkflowNode {
    id: string;
    type: WorkflowNodeType;
    agent_id?: string | undefined;
    /** Sub-tasks only: the sub-workflow each matching sub-task runs through. */
    sub_workflow_id?: string | undefined;
    /**
     * Sub-tasks only: run the Task's open sub-tasks carrying this label.
     * Unset → the sub-tasks no other Sub-tasks step in the graph claims.
     */
    label?: string | undefined;
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
    /** End pushes HEAD straight to the default branch and opens no PR. */
    push_to_default: boolean;
    max_loops: number;
    /** How many Task runs of this workflow may run at once. */
    max_parallel_runs: number;
    schedule_preset: SchedulePreset | null;
    schedule_time_of_day: string | null;
    schedule_weekday: number | null;
    cron_expr: string | null;
    next_run_at: string | null;
    last_run_at: string | null;
    /**
     * The marketplace template id (`"delivery"`) or published-entry id this
     * workflow came from, and the version that was pulled. Mirrors the pair on
     * `IAgent`, and works the same way: NULL means "not from a marketplace
     * source" — a hand-built workflow, which is never stale.
     *
     * `marketplace_source_id` is also the lookup key when resolving a
     * template's sub-workflows. It used to be the workflow's NAME, so renaming
     * a sub-workflow forked it and an unrelated workflow that happened to share
     * the name got adopted as a build step.
     */
    marketplace_source_id: string | null;
    marketplace_pulled_version: number | null;
    /**
     * When the upstream was last taken. `updated_at <= marketplace_pulled_at`
     * means nothing has been edited since, which is what makes an automatic
     * upgrade safe — `updated_at` alone cannot say, because the upgrade
     * itself moves it.
     */
    marketplace_pulled_at: string | null;
    /**
     * The source has a newer version than `marketplace_pulled_version`.
     * Computed per read, mirroring the agent marketplace gate; null when
     * the workflow has no upstream.
     */
    upgrade_available: boolean;
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
    /** Set on a sub-task's run: the Task run whose Sub-tasks step started it. */
    parent_workflow_run_id: string | null;
    parent_node_id: string | null;
    current_node_id: string | null;
    parked_node_id: string | null;
    /** Why the run is waiting for the Owner; null unless `waiting_for_owner`. */
    park_reason: string | null;
    loop_count: number;
    branch: string | null;
    worktree_path: string | null;
    setup_done: boolean;
    /** The FIRST pull request this run opened. Agents read this one. */
    pr_url: string | null;
    /**
     * ADR 0017/0018 — every PR the run opened, in repo order, `pr_url` first.
     * A multi-repo Task opens one per repo it changed; this is the complete
     * set. Empty when the run opened none.
     */
    pr_urls: string[];
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
                sub_workflow_id: ID.optional(),
                label: z.string().trim().min(1).max(40).optional(),
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
    effort: AgentEffort | null;
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
    /** The sub-task runs a Task run's Sub-tasks steps started, oldest first. */
    children: IWorkflowRunSummary[];
    /** What the run's own steps and its sub-task runs' steps cost together. */
    total_cost_usd: number;
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
    push_to_default: z.boolean(),
    max_loops: z.number().int().min(1).max(20),
    max_parallel_runs: z.number().int().min(1).max(10),
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

export const StartWorkflowRunSchema = z.object({
    item_id: ID.optional(),
    /**
     * Continue a Task after review: start at the first Sub-tasks step instead
     * of Start, on the Task's existing branch, so only its open sub-tasks run
     * and End updates the same pull request (ADR 0015).
     */
    from_subtasks: z.boolean().optional(),
});

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
    /**
     * Bumped by hand when the template's graph or copy changes, so a workflow
     * created from it can tell it has fallen behind. The whole catalog was
     * reset to 1 on 2026-09-22; before that templates carried no version at
     * all, which is why a workflow made from one could never be upgraded.
     */
    version: number;
    input_kind: WorkflowInputKind;
    trigger: WorkflowTrigger;
    use_worktree: boolean;
    push_code: boolean;
    raises_pr: boolean;
    push_to_default?: boolean;
    graph: IWorkflowGraph;
}

/** What one workflow is doing and has lined up (GET /api/workflow-queue). */
export interface IWorkflowQueueEntry {
    workflow: IWorkflow;
    /** Task runs working now; a Task's sub-task runs live inside its run. */
    running: IWorkflowRunSummary[];
    /** Task runs parked on the Owner. They don't hold a parallel slot. */
    waiting: IWorkflowRunSummary[];
    /** Ready Tasks assigned to this workflow, in the order dispatch picks them. */
    queued: ITask[];
}

export interface IWorkflowQueue {
    workflows: IWorkflowQueueEntry[];
    /** Ready Tasks no workflow will pick up. */
    unassigned: ITask[];
}

/** POST /api/workflows/import — a bundle unpacked into one project. */
/**
 * What resolving a workflow's agent dependencies actually did.
 *
 * Import used to be silent about this: an agent that already existed was
 * skipped whatever version it was, so a workflow could import "successfully"
 * onto agents that no longer matched the graph it shipped with, and the Owner
 * had no way to tell. Every agent an import touches now lands in exactly one
 * of these buckets.
 */
export interface IAgentDependencyReport {
    /** Not present before; installed from the catalog. */
    installed: string[];
    /** Back-linked, behind the catalog, and unedited — brought up to date. */
    upgraded: string[];
    /**
     * Behind the catalog but carrying Owner edits, so left exactly as they are.
     * The upgrade is still offered in the marketplace UI; nothing was lost.
     */
    skipped_edited: string[];
    /** Already current, or not back-linked to a catalog entry. */
    unchanged: string[];
    /**
     * Already here and NOT active. Resolution leaves their status alone — a
     * pause is a decision the Owner made — so the run would park on them. They
     * are reported rather than silently re-activated, which is what used to
     * happen. Agents installed by this same resolution are not here: they are
     * activated on the way in, because nobody paused them.
     */
    paused: string[];
}

/**
 * What an import did to the workflows themselves, as distinct from the agents.
 *
 * Importing the same marketplace entry twice used to fork the whole tree and
 * leave every copy with a NULL source id — unwanted duplicates that were also
 * unupgradable. Reuse is keyed on provenance now, and this says which happened.
 */
export interface IWorkflowDependencyReport {
    /** Not present before; created from the bundle. */
    created: string[];
    /** Already here, behind the entry, and unedited — brought up to date. */
    upgraded: string[];
    /** Already here and current. */
    reused: string[];
    /** Behind the entry but edited since it was pulled, so left untouched. */
    skipped_edited: string[];
}

export interface IWorkflowImportResult {
    workflow: IWorkflow;
    /** The sub-workflows its Sub-tasks steps use, created with it. */
    sub_workflows: IWorkflow[];
    /** Agent ids created from the bundle. */
    installed_agents: string[];
    /** Agent ids already installed here, used as they are. */
    reused_agents: string[];
    /** Per-agent detail behind the two lists above. */
    agents: IAgentDependencyReport;
    /** What happened to the workflow and its sub-workflows. */
    workflows: IWorkflowDependencyReport;
}

/**
 * A workflow the Owner published to the Marketplace. The row stores the
 * bundle `GET /api/workflows/:id/export` produces; everything past the
 * name is read from that bundle.
 */
export interface IPublishedWorkflow {
    id: string;
    name: string;
    description: string | null;
    /** The workflow it was published from; null once that workflow is deleted. */
    source_workflow_id: string | null;
    input_kind: WorkflowInputKind;
    trigger: WorkflowTrigger;
    push_code: boolean;
    raises_pr: boolean;
    push_to_default: boolean;
    /** Every agent it uses, its sub-workflows' included. */
    agent_ids: string[];
    /**
     * Bumped on every republish. Republishing overwrites the stored bundle in
     * place, so without this a consumer who used the entry yesterday had no way
     * to tell it changed today.
     */
    version: number;
    published_at: string;
    /** Equals `published_at` until it is published again. */
    updated_at: string;
}

/** GET /api/marketplace/workflows/:id — the entry plus what its preview draws. */
export interface IPublishedWorkflowDetail extends IPublishedWorkflow {
    graph: IWorkflowGraph;
    /** Its Sub-tasks steps' sub-workflows; `ref` is the step's `sub_workflow_id` in `graph`. */
    sub_workflows: Array<{ ref: string; name: string }>;
}

/** POST /api/marketplace/workflows/:id/use */
export const UsePublishedWorkflowSchema = z.object({ project_id: ID });

/**
 * Structural rules. Pass `inputKind` to also check the rules that depend on
 * what the workflow runs on (Sub-tasks steps belong to Task workflows only).
 */
export function validateWorkflowGraph(graph: IWorkflowGraph, inputKind?: WorkflowInputKind): IWorkflowGraphError[] {
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
        if (n.type !== 'subtasks' && (n.sub_workflow_id || n.label)) {
            errors.push({ node_id: n.id, message: 'Only Sub-tasks steps take a sub-workflow or label' });
        }
        if (n.type === 'subtasks') {
            if (!n.sub_workflow_id) errors.push({ node_id: n.id, message: 'Choose the sub-workflow for these sub-tasks' });
            if (inputKind !== undefined && inputKind !== 'item') {
                errors.push({ node_id: n.id, message: 'Only workflows that run on a Task can have a Sub-tasks step' });
            }
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
