import type {
    IAgent,
    IIssueTreeResponse,
    IWorkflow,
    IWorkflowGraph,
    IWorkflowTemplate,
    WorkflowInputKind,
    WorkflowTrigger,
} from '@atlas/shared';
import { flattenIssueTree } from '../../hooks/useIssues.js';
import { itemPath } from '../../utils/itemPath.js';

// Plain-text presentation shared by the list, builder and item panel. Kept
// free of @xyflow imports so non-canvas surfaces don't pull the canvas chunk.

export const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
    manual: 'Manual',
    item_ready: 'On item ready',
    schedule: 'Scheduled',
};

export const INPUT_KIND_LABEL: Record<WorkflowInputKind, string> = {
    item: 'Per Task',
    none: 'Project run',
    sub_task: 'Sub-task workflow',
};

export const INPUT_KIND_HINT: Record<WorkflowInputKind, string> = {
    item: 'Each ready Task assigned to this workflow, on its own branch',
    none: 'Runs on the project',
    sub_task: 'Runs inside a Task workflow’s Sub-tasks step, one sub-task at a time',
};

export function deliveryLabel(
    d: (Pick<IWorkflow, 'push_code' | 'raises_pr' | 'input_kind'> & { push_to_default?: boolean | undefined }) | null,
): string {
    if (!d) return '';
    if (d.input_kind === 'sub_task') return 'Back to the Task';
    if (d.push_code && d.push_to_default) return 'Push to default branch';
    if (d.push_code && d.raises_pr) return 'Push + PR';
    if (d.push_code) return 'Push branch';
    if (d.raises_pr) return 'Pull request';
    return 'No delivery';
}

/** Catalog ids (`agent-code-reviewer`) read as names when the agent isn't installed yet. */
export function agentLabel(agentId: string, agentsById: Map<string, Pick<IAgent, 'name'>>): string {
    const agent = agentsById.get(agentId);
    if (agent) return agent.name;
    const words = agentId.replace(/^agent-/, '').split('-');
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** A Sub-tasks step with no label takes whatever the graph's labelled steps don't. */
export function subtasksLabel(label: string | undefined): string {
    return label ? `Labelled “${label}”` : 'All other sub-tasks';
}

export function graphAgentIds(graph: IWorkflowGraph): string[] {
    return graph.nodes.flatMap((n) => (n.type === 'agent' && n.agent_id ? [n.agent_id] : []));
}

/** The templates a template's Sub-tasks steps run (`sub_workflow_id: 'template:<id>'`). */
export function subTemplates(t: IWorkflowTemplate, all: IWorkflowTemplate[]): IWorkflowTemplate[] {
    return all.filter((s) => t.graph.nodes.some((n) => n.sub_workflow_id === `template:${s.id}`));
}

/** Every agent using the template installs, its sub-workflows' included. */
export function templateAgentIds(t: IWorkflowTemplate, all: IWorkflowTemplate[]): string[] {
    return [...new Set([t, ...subTemplates(t, all)].flatMap((x) => graphAgentIds(x.graph)))];
}

export function durationLabel(start: string | null, end: string | null): string {
    if (!start) return '—';
    const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    const sec = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

// ponytail: workflow runs carry item_id but not its kind, so the kind is
// looked up in the project's issue tree; drop this once the run summary
// exposes item_type.
export function itemPathIn(tree: IIssueTreeResponse | undefined, itemId: string): string | null {
    if (!tree) return null;
    if (tree.tasks.some((t) => t.id === itemId)) return itemPath('task', itemId);
    const node = flattenIssueTree(tree.tree).find((n) => n.id === itemId);
    return node ? itemPath(node.kind, itemId) : null;
}
