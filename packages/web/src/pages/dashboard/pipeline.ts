import type { IAgent, IWorkflowGraph, IWorkflowNode } from '@atlas/shared';
import { agentLabel } from '../workflows/labels.js';

interface IStation {
    id: string;
    label: string;
}

export interface IPipelineView {
    stations: IStation[];
    /** Index of the station the run is at; -1 when it can't be placed. */
    at: number;
    /** Set when the run is on a fix-up detour hanging off station `at`. */
    detour: string | null;
}

function words(id: string): string {
    const s = id.replace(/[-_]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function stepLabel(node: IWorkflowNode, agentsById: Map<string, Pick<IAgent, 'name'>>): string {
    switch (node.type) {
        case 'agent':
            return node.agent_id ? agentLabel(node.agent_id, agentsById) : words(node.id);
        case 'owner':
            return 'You';
        case 'subtasks':
            return node.label ? `Sub-tasks: ${node.label}` : 'Sub-tasks';
        default:
            return node.label || words(node.id);
    }
}

// The run's main line: Start → End along pass edges (first pass edge wins).
// Fail edges either loop back onto the line or lead into a fix-up detour that
// rejoins it; a run inside a detour is placed at the station it branched from.
export function pipelineView(
    graph: IWorkflowGraph,
    currentNodeId: string | null,
    agentsById: Map<string, Pick<IAgent, 'name'>>
): IPipelineView {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const next = (id: string, kind: 'pass' | 'fail') =>
        graph.edges.filter((e) => e.source === id && e.kind === kind).map((e) => e.target);

    const line: IWorkflowNode[] = [];
    const seen = new Set<string>();
    let cur = graph.nodes.find((n) => n.type === 'start');
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.type !== 'start' && cur.type !== 'end') line.push(cur);
        const to = next(cur.id, 'pass')[0];
        cur = to ? byId.get(to) : undefined;
    }

    const stations = line.map((n) => ({ id: n.id, label: stepLabel(n, agentsById) }));
    const onLine = new Map(line.map((n, i) => [n.id, i]));
    if (!currentNodeId) return { stations, at: -1, detour: null };
    const direct = onLine.get(currentNodeId);
    if (direct !== undefined) return { stations, at: direct, detour: null };

    // Walk each station's fail branch until it rejoins the line.
    for (const [i, n] of line.entries()) {
        for (const start of next(n.id, 'fail')) {
            const stack = [start];
            const walked = new Set<string>();
            while (stack.length) {
                const id = stack.pop() as string;
                if (onLine.has(id) || walked.has(id)) continue;
                walked.add(id);
                if (id === currentNodeId) {
                    const node = byId.get(id);
                    return {
                        stations,
                        at: i,
                        detour: node ? stepLabel(node, agentsById) : words(id),
                    };
                }
                stack.push(...next(id, 'pass'), ...next(id, 'fail'));
            }
        }
    }
    return { stations, at: -1, detour: null };
}
