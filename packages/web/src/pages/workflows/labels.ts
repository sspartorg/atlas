import type {
    IAgent,
    IIssueTreeResponse,
    IssueType,
    IWorkflow,
    IWorkflowGraph,
    WorkflowInputKind,
    WorkflowTrigger,
} from '@atlas/shared';
import { flattenIssueTree } from '../../hooks/useIssues.js';

// Plain-text presentation shared by the list, builder and item panel. Kept
// free of @xyflow imports so non-canvas surfaces don't pull the canvas chunk.

export const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
    manual: 'Manual',
    item_ready: 'On item ready',
    schedule: 'Scheduled',
};

export const INPUT_KIND_LABEL: Record<WorkflowInputKind, string> = {
    item: 'Per item',
    none: 'Project run',
};

export const INPUT_KIND_HINT: Record<WorkflowInputKind, string> = {
    item: 'Each ready item assigned to this workflow, one at a time',
    none: 'Runs on the project',
};

export function deliveryLabel(d: Pick<IWorkflow, 'push_code' | 'raises_pr'> | null): string {
    if (!d) return '';
    if (d.push_code && d.raises_pr) return 'Push + PR';
    if (d.push_code) return 'Push branch';
    if (d.raises_pr) return 'Pull request';
    return 'No delivery';
}

/** Catalog ids (`agent-code-reviewer`) read as names when the agent isn't installed yet. */
export function agentLabel(agentId: string, agentsById: Map<string, IAgent>): string {
    const agent = agentsById.get(agentId);
    if (agent) return agent.name;
    const words = agentId.replace(/^agent-/, '').split('-');
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function graphAgentIds(graph: IWorkflowGraph): string[] {
    return graph.nodes.flatMap((n) => (n.type === 'agent' && n.agent_id ? [n.agent_id] : []));
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

const ITEM_ROUTE: Record<IssueType, string> = {
    epic: '/epics',
    story: '/issues/stories',
    bug: '/issues/bugs',
    sub_task: '/issues/sub-tasks',
    sub_bug: '/issues/sub-bugs',
};

// ponytail: workflow runs carry item_id but not its kind, so the kind is
// looked up in the project's issue tree; drop this once the run summary
// exposes item_type.
export function itemPathIn(tree: IIssueTreeResponse | undefined, itemId: string): string | null {
    if (!tree) return null;
    if (tree.epics.some((e) => e.id === itemId)) return `${ITEM_ROUTE.epic}/${itemId}`;
    const node = flattenIssueTree(tree.tree).find((n) => n.id === itemId);
    return node ? `${ITEM_ROUTE[node.kind]}/${itemId}` : null;
}
