import type { DragEvent, ReactNode } from 'react';
import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    ReactFlow,
    type Connection,
    type OnEdgesChange,
    type OnNodesChange,
    type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import Box from '@mui/material/Box';
import { ATLAS_PALETTE, ELEVATION } from '../../theme/tokens.js';
import { CanvasContext, NODE_TYPES, type ICanvasContext } from './WorkflowNodes.js';
import type { WfEdge, WfNode } from './graph.js';

interface Props {
    nodes: WfNode[];
    edges: WfEdge[];
    context: ICanvasContext;
    readOnly?: boolean;
    onNodesChange?: OnNodesChange<WfNode>;
    onEdgesChange?: OnEdgesChange<WfEdge>;
    onConnect?: (c: Connection) => void;
    onSelectionChange?: OnSelectionChangeFunc<WfNode, WfEdge>;
    onDrop?: (e: DragEvent<HTMLDivElement>) => void;
    height?: number | string;
    children?: ReactNode;
}

export function WorkflowCanvas({
    nodes,
    edges,
    context,
    readOnly = false,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onSelectionChange,
    onDrop,
    height = '100%',
    children,
}: Props) {
    return (
        <CanvasContext.Provider value={context}>
            <Box
                data-testid="workflow-canvas"
                onDragOver={(e) => {
                    if (readOnly) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={readOnly ? undefined : onDrop}
                sx={{
                    position: 'relative',
                    height,
                    minHeight: 320,
                    borderRadius: '12px',
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    background: ATLAS_PALETTE.pageBg,
                    overflow: 'hidden',
                    '& .react-flow__edge-path': { strokeWidth: 2 },
                    '& .wf-edge-pass .react-flow__edge-path': { stroke: ATLAS_PALETTE.success },
                    '& .wf-edge-fail .react-flow__edge-path': {
                        stroke: ATLAS_PALETTE.error,
                        strokeDasharray: '6 4',
                    },
                    '& .react-flow__edge.selected .react-flow__edge-path': { strokeWidth: 3.5 },
                    '& .react-flow__controls': {
                        boxShadow: ELEVATION.low,
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    },
                    '& .react-flow__controls-button': {
                        background: ATLAS_PALETTE.white,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                        color: ATLAS_PALETTE.slate,
                        width: 28,
                        height: 28,
                        '&:hover': { background: ATLAS_PALETTE.cloud },
                        '& svg': { fill: 'currentColor', maxWidth: 12, maxHeight: 12 },
                    },
                    '& .react-flow__minimap': {
                        '& svg': { width: 144, height: 96, display: 'block' },
                        background: ATLAS_PALETTE.white,
                        borderRadius: '8px',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        overflow: 'hidden',
                    },
                    '& .react-flow__attribution': {
                        background: 'transparent',
                        color: ATLAS_PALETTE.slate40,
                        fontSize: 9,
                        '& a': { color: 'inherit' },
                    },
                    '& .react-flow__connectionline path': {
                        stroke: ATLAS_PALETTE.slate40,
                        strokeWidth: 2,
                    },
                }}
            >
                <ReactFlow<WfNode, WfEdge>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
                    minZoom={0.2}
                    nodesDraggable={!readOnly}
                    nodesConnectable={!readOnly}
                    elementsSelectable={!readOnly}
                    deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
                    {...(onNodesChange ? { onNodesChange } : {})}
                    {...(onEdgesChange ? { onEdgesChange } : {})}
                    {...(onConnect ? { onConnect } : {})}
                    {...(onSelectionChange ? { onSelectionChange } : {})}
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={18}
                        size={1.2}
                        color={ATLAS_PALETTE.slate30}
                    />
                    <MiniMap
                        pannable
                        zoomable
                        nodeColor={ATLAS_PALETTE.slate12}
                        maskColor={ATLAS_PALETTE.slate06}
                    />
                    <Controls showInteractive={false} />
                    {children}
                </ReactFlow>
            </Box>
        </CanvasContext.Provider>
    );
}
