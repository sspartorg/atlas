import type {
    IAgent,
    IIssueTreeResponse,
    IWorkflow,
    IWorkflowGraph,
    IWorkflowTemplate,
    SchedulePreset,
    WorkflowInputKind,
    WorkflowTrigger,
} from '@atlas/shared';
import { flattenIssueTree } from '../../hooks/useIssues.js';
import { itemPath } from '../../utils/itemPath.js';
import { formatAbsolute } from '../../utils/time.js';

// Plain-text presentation shared by the list, builder and item panel. Kept
// free of @xyflow imports so non-canvas surfaces don't pull the canvas chunk.

export const TRIGGER_LABEL: Record<WorkflowTrigger, string> = {
    manual: 'Manual',
    item_ready: 'On item ready',
    schedule: 'Scheduled',
};

const SCHEDULE_PRESET_LABEL: Record<SchedulePreset, string> = {
    hourly: 'every hour',
    every_4h: 'every 4 hours',
    daily: 'daily',
    weekly: 'weekly',
    custom: 'custom cron',
};

/**
 * The trigger as the Owner needs to read it: a bare "Scheduled" says nothing
 * about the cadence, and the cadence only ever lived on the Start node inside
 * the canvas. Renders "Manual", "On item ready", or
 * "Scheduled · every hour · next 14:00".
 */
export function triggerLabel(
    wf: Pick<IWorkflow, 'trigger' | 'schedule_preset' | 'next_run_at'>,
): string {
    if (wf.trigger !== 'schedule') return TRIGGER_LABEL[wf.trigger];
    const parts = [TRIGGER_LABEL.schedule];
    if (wf.schedule_preset) parts.push(SCHEDULE_PRESET_LABEL[wf.schedule_preset]);
    if (wf.next_run_at) parts.push(`next ${formatAbsolute(wf.next_run_at)}`);
    return parts.join(' · ');
}

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
    // G-016 — `raises_pr` without `push_code` used to read "Pull request",
    // which is a promise the engine does not keep: `deliver()` opens one only
    // when `raises_pr && push_code && !push_to_default` (workflow-engine.ts),
    // so this combination delivers nothing at all. The inspector's own
    // `deliveryMode()` has always called it "Keep local"; the two disagreed
    // and this one was wrong. Unreachable through the delivery cards, which
    // write all three flags together — but import, PATCH and MCP can all set
    // it, and a list that says "Pull request" for a workflow that never opens
    // one is worse than one that says nothing.
    return 'No delivery';
}

// Word-initial capitalisation mangles the acronyms the catalog uses as names:
// `agent-po-writer` rendered "Po Writer" next to a detail page saying "PO
// Writer". Only these three appear in catalog ids; anything else title-cases.
const ACRONYMS = new Set(['po', 'qa', 'ai']);

/** Catalog ids (`agent-code-reviewer`) read as names when the agent isn't installed yet. */
export function agentLabel(agentId: string, agentsById: Map<string, Pick<IAgent, 'name'>>): string {
    const agent = agentsById.get(agentId);
    if (agent) return agent.name;
    const words = agentId.replace(/^agent-/, '').split('-');
    return words
        .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
}

/** A Sub-tasks step with no label takes whatever the graph's labelled steps don't. */
export function subtasksLabel(label: string | undefined): string {
    return label ? `Labelled “${label}”` : 'All other sub-tasks';
}

/**
 * A gate step's display name. The script id is the honest label — it is what
 * the Owner would grep for in Settings > Guardrail scripts, and what the run's
 * comment thread names when the gate goes red — so it is prettified rather
 * than replaced with a title that would have to be kept in sync.
 */
export function gateTitle(scriptId: string | undefined): string {
    if (!scriptId) return 'Choose a script';
    const bare = scriptId.startsWith('gate-') ? scriptId.slice('gate-'.length) : scriptId;
    return bare.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
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
