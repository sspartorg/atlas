import { useMemo } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { IAgent, IWorkflow, IWorkflowGraph } from '@atlas/shared';
import { WorkflowCanvas } from '../workflows/WorkflowCanvas.js';
import type { ICanvasContext } from '../workflows/WorkflowNodes.js';
import { toFlow } from '../workflows/graph.js';

// Loaded lazily by the marketplace workflow detail page so `@xyflow/react`
// stays in the workflow chunk.

interface Props {
    graph: IWorkflowGraph;
    /** A Sub-tasks step's `sub_workflow_id` → that sub-workflow's name. */
    subNames: Map<string, string>;
    delivery: ICanvasContext['delivery'];
    agentsById: Map<string, IAgent>;
}

export function WorkflowGraphPreview({ graph, subNames, delivery, agentsById }: Props) {
    const flow = useMemo(() => toFlow(graph), [graph]);
    const context = useMemo(
        () => ({
            agentsById,
            // Sub-tasks nodes only read the sub-workflow's name.
            workflowsById: new Map([...subNames].map(([ref, name]) => [ref, { name } as IWorkflow])),
            errorNodeIds: new Set<string>(),
            runStates: null,
            delivery,
        }),
        [agentsById, subNames, delivery],
    );
    return (
        <ReactFlowProvider>
            <WorkflowCanvas nodes={flow.nodes} edges={flow.edges} context={context} readOnly />
        </ReactFlowProvider>
    );
}
