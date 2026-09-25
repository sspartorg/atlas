import { useMemo } from 'react';
import type { DragEvent, ReactNode } from 'react';
import {
    Background,
    BackgroundVariant,
    ConnectionLineType,
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
import { ATLAS_PALETTE, ELEVATION, MOTION, MOTION_EASING } from '../../theme/tokens.js';
import { CanvasContext, NODE_TYPES, type ICanvasContext } from './WorkflowNodes.js';
import { routeEdges, type WfEdge, type WfNode } from './graph.js';

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

const NODE_ORIGIN: [number, number] = [0.5, 0];

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
    // Target handles and lane offsets are derived from where the nodes are
    // right now, not from where they were when the graph was loaded — so a
    // dragged node redraws its edges immediately instead of at next reload.
    const routed = useMemo(() => routeEdges(nodes, edges), [nodes, edges]);

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
                    // Qualified with `.react-flow__edge` to outrank base.css's
                    // `.selected` rule, which otherwise greys out whichever
                    // edge you click — the one you are trying to follow.
                    '& .react-flow__edge.wf-edge-pass .react-flow__edge-path': {
                        stroke: ATLAS_PALETTE.success,
                    },
                    '& .react-flow__edge.wf-edge-fail .react-flow__edge-path': {
                        stroke: ATLAS_PALETTE.error,
                        strokeDasharray: '6 4',
                    },
                    '& .react-flow__edge.selected .react-flow__edge-path': { strokeWidth: 3.5 },
                    // Follow one line at a time. Lanes stop edges from being
                    // drawn on top of each other; this is what lets you tell
                    // which of two lines running side by side is which.
                    // base.css already gives an edge a 20px transparent
                    // interaction stroke, so the hit target is forgiving.
                    '& .react-flow__edge': {
                        transition: `opacity ${MOTION.hover}ms ${MOTION_EASING.standard}`,
                    },
                    '&:has(.react-flow__edge:hover) .react-flow__edge:not(:hover)': {
                        opacity: 0.12,
                    },
                    '&:has(.react-flow__edge.selected) .react-flow__edge:not(.selected)': {
                        opacity: 0.12,
                    },
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
                    edges={routed}
                    nodeTypes={NODE_TYPES}
                    connectionLineType={ConnectionLineType.SmoothStep}
                    // Positions anchor a node's top centre, so a column of
                    // cards and pills lines up whatever each node's width.
                    nodeOrigin={NODE_ORIGIN}
                    fitView
                    fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
                    minZoom={0.2}
                    // Off by default, which draws a selected edge under its neighbours.
                    elevateEdgesOnSelect
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
