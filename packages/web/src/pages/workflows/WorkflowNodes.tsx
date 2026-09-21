import { createContext, useContext, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent, IWorkflow } from '@atlas/shared';
import { ATLAS_PALETTE, ELEVATION, TYPOGRAPHY } from '../../theme/tokens.js';
import { getAgentView } from '../agents/agentViewModel.js';
import { LiveDot } from '../../components/LiveDot.js';
import type { INodeRunInfo, WfNode } from './graph.js';
import { INPUT_KIND_LABEL, TRIGGER_LABEL, deliveryLabel, subtasksLabel } from './labels.js';

export interface ICanvasContext {
    agentsById: Map<string, IAgent>;
    workflowsById: Map<string, IWorkflow>;
    errorNodeIds: Set<string>;
    runStates: Map<string, INodeRunInfo> | null;
    delivery: Pick<
        IWorkflow,
        'push_code' | 'raises_pr' | 'push_to_default' | 'input_kind' | 'trigger'
    > | null;
}

export const CanvasContext = createContext<ICanvasContext>({
    agentsById: new Map(),
    workflowsById: new Map(),
    errorNodeIds: new Set(),
    runStates: null,
    delivery: null,
});

const STATE_BORDER: Record<INodeRunInfo['state'], string> = {
    done: ATLAS_PALETTE.success,
    current: ATLAS_PALETTE.brandBlue,
    failed: ATLAS_PALETTE.error,
    parked: ATLAS_PALETTE.warning,
    cancelled: ATLAS_PALETTE.slate30,
};

function Glyph({ name, color, bg }: { name: string; color: string; bg: string }) {
    return (
        <Box
            sx={{
                width: 30,
                height: 30,
                borderRadius: '8px',
                background: bg,
                color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            <Box
                component="span"
                className="material-symbols-rounded"
                aria-hidden="true"
                sx={{ fontSize: 18 }}
            >
                {name}
            </Box>
        </Box>
    );
}

function RunBadge({ info }: { info: INodeRunInfo }) {
    const icon =
        info.state === 'done'
            ? 'check_circle'
            : info.state === 'failed'
              ? 'error'
              : info.state === 'parked'
                ? 'front_hand'
                : info.state === 'cancelled'
                  ? 'block'
                  : null;
    return (
        <Box
            sx={{
                position: 'absolute',
                top: -9,
                right: -9,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
            }}
        >
            {info.visits > 1 && (
                <Box
                    data-testid="node-visits"
                    sx={{
                        px: 1.5,
                        height: 18,
                        borderRadius: '9px',
                        background: ATLAS_PALETTE.slate,
                        color: ATLAS_PALETTE.white,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 10,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                    }}
                >
                    ×{info.visits}
                </Box>
            )}
            {icon ? (
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    aria-hidden="true"
                    sx={{
                        fontSize: 20,
                        color: STATE_BORDER[info.state],
                        background: ATLAS_PALETTE.white,
                        borderRadius: '50%',
                        fontVariationSettings: "'FILL' 1",
                    }}
                >
                    {icon}
                </Box>
            ) : (
                <Box
                    sx={{
                        p: 1.5,
                        background: ATLAS_PALETTE.white,
                        borderRadius: '50%',
                        display: 'flex',
                    }}
                >
                    <LiveDot size={8} label="Running" color="info" />
                </Box>
            )}
        </Box>
    );
}

interface ShellProps {
    id: string;
    selected: boolean;
    accent?: string;
    children: ReactNode;
    handles: ReactNode;
    pill?: boolean;
}

function NodeShell({ id, selected, accent, children, handles, pill }: ShellProps) {
    const { errorNodeIds, runStates } = useContext(CanvasContext);
    const info = runStates?.get(id);
    const hasError = errorNodeIds.has(id);
    const borderColor = hasError
        ? ATLAS_PALETTE.error
        : info
          ? STATE_BORDER[info.state]
          : ATLAS_PALETTE.slate12;
    return (
        <Box
            data-testid={`wf-node-${id}`}
            data-run-state={info?.state ?? ''}
            data-invalid={hasError ? 'true' : 'false'}
            sx={{
                position: 'relative',
                width: pill ? 168 : 216,
                minHeight: 64,
                px: 3,
                py: 2.5,
                display: 'flex',
                alignItems: 'center',
                gap: 2.5,
                borderRadius: pill ? '32px' : '12px',
                background: ATLAS_PALETTE.white,
                border: `1.5px ${hasError ? 'dashed' : 'solid'} ${borderColor}`,
                boxShadow: selected
                    ? `0 0 0 3px ${ATLAS_PALETTE.accentSoft}, ${ELEVATION.mid}`
                    : ELEVATION.low,
                opacity: runStates && !info ? 0.55 : 1,
                transition: 'box-shadow 150ms ease, border-color 150ms ease, opacity 150ms ease',
                ...(accent && {
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        left: -1.5,
                        top: 10,
                        bottom: 10,
                        width: 3,
                        borderRadius: '0 3px 3px 0',
                        background: accent,
                    },
                }),
                ...(info?.state === 'current' && {
                    animation: 'wf-node-pulse 1.8s ease-in-out infinite',
                    '@keyframes wf-node-pulse': {
                        '0%, 100%': { boxShadow: `0 0 0 0 ${ATLAS_PALETTE.accentSoft}` },
                        '50%': { boxShadow: `0 0 0 8px ${ATLAS_PALETTE.accentSoft}` },
                    },
                }),
                '& .react-flow__handle': {
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    border: `2px solid ${ATLAS_PALETTE.white}`,
                    background: ATLAS_PALETTE.slate60,
                },
                '& .wf-handle-pass': { background: ATLAS_PALETTE.success },
                '& .wf-handle-fail': { background: ATLAS_PALETTE.error, top: '66%' },
                // The side entry only matters for loops; keep it faint until hovered.
                '& .wf-handle-loop': {
                    background: ATLAS_PALETTE.slate40,
                    top: '30%',
                    opacity: 0.25,
                },
                '&:hover .wf-handle-loop': { opacity: 1 },
            }}
        >
            {children}
            {handles}
            {info && <RunBadge info={info} />}
        </Box>
    );
}

function Title({ children }: { children: ReactNode }) {
    return (
        <Typography
            sx={{
                fontSize: 13,
                fontWeight: 600,
                color: ATLAS_PALETTE.slate,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}
        >
            {children}
        </Typography>
    );
}

function Caption({ children, mono }: { children: ReactNode; mono?: boolean }) {
    return (
        <Typography
            sx={{
                fontSize: 10.5,
                color: ATLAS_PALETTE.slate60,
                fontFamily: mono ? TYPOGRAPHY.fontFamilyMono : undefined,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}
        >
            {children}
        </Typography>
    );
}

function FailLabel() {
    return (
        <Typography
            sx={{
                position: 'absolute',
                right: 10,
                top: '66%',
                transform: 'translateY(-50%)',
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: ATLAS_PALETTE.dangerFg,
                pointerEvents: 'none',
            }}
        >
            fail
        </Typography>
    );
}

/** Input on top, and a side entry for connections looping back up the graph. */
function TargetHandles() {
    return (
        <>
            <Handle type="target" position={Position.Top} id="in" />
            <Handle type="target" position={Position.Right} id="loop" className="wf-handle-loop" />
        </>
    );
}

function StartNode({ id, selected }: NodeProps<WfNode>) {
    const { delivery } = useContext(CanvasContext);
    return (
        <NodeShell
            id={id}
            selected={selected}
            pill
            handles={
                <Handle
                    type="source"
                    position={Position.Bottom}
                    id="pass"
                    className="wf-handle-pass"
                />
            }
        >
            <Glyph name="play_arrow" color={ATLAS_PALETTE.onAccent} bg={ATLAS_PALETTE.slate} />
            <Box sx={{ minWidth: 0 }}>
                <Title>Start</Title>
                {delivery && (
                    <Caption>
                        {INPUT_KIND_LABEL[delivery.input_kind]} · {TRIGGER_LABEL[delivery.trigger]}
                    </Caption>
                )}
            </Box>
        </NodeShell>
    );
}

function AgentNode({ id, data, selected }: NodeProps<WfNode>) {
    const { agentsById } = useContext(CanvasContext);
    const agent = data.agent_id ? agentsById.get(data.agent_id) : undefined;
    const accent = agent?.accent_color ?? ATLAS_PALETTE.slate30;
    return (
        <NodeShell
            id={id}
            selected={selected}
            accent={accent}
            handles={
                <>
                    <TargetHandles />
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="pass"
                        className="wf-handle-pass"
                    />
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="fail"
                        className="wf-handle-fail"
                    />
                    <FailLabel />
                </>
            }
        >
            <Glyph
                name={agent ? getAgentView(agent).glyph : 'smart_toy'}
                color={accent}
                bg={`color-mix(in srgb, ${accent} 14%, transparent)`}
            />
            <Box sx={{ minWidth: 0, pr: 8 }}>
                <Title>{agent?.name ?? data.agent_id ?? 'Choose an agent'}</Title>
                <Caption mono>
                    {agent ? `${agent.cli} · ${agent.model} · ${agent.effort}` : 'not installed'}
                </Caption>
            </Box>
        </NodeShell>
    );
}

function OwnerNode({ id, selected }: NodeProps<WfNode>) {
    return (
        <NodeShell
            id={id}
            selected={selected}
            handles={
                <>
                    <TargetHandles />
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="pass"
                        className="wf-handle-pass"
                    />
                </>
            }
        >
            <Glyph name="person" color={ATLAS_PALETTE.warnFg} bg={ATLAS_PALETTE.warnSoft} />
            <Box sx={{ minWidth: 0 }}>
                <Title>Owner</Title>
                <Caption>Sent back to you</Caption>
            </Box>
        </NodeShell>
    );
}

function SubtasksNode({ id, data, selected }: NodeProps<WfNode>) {
    const { workflowsById, runStates } = useContext(CanvasContext);
    const sub = data.sub_workflow_id ? workflowsById.get(data.sub_workflow_id) : undefined;
    const progress = runStates?.get(id)?.subtasks;
    return (
        <NodeShell
            id={id}
            selected={selected}
            accent={ATLAS_PALETTE.brandBlue}
            handles={
                <>
                    <TargetHandles />
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="pass"
                        className="wf-handle-pass"
                    />
                </>
            }
        >
            <Glyph name="checklist" color={ATLAS_PALETTE.accentFg} bg={ATLAS_PALETTE.accentSoft} />
            <Box sx={{ minWidth: 0 }}>
                <Title>{sub?.name ?? 'Sub-tasks'}</Title>
                <Caption>
                    {progress
                        ? `${progress.done} of ${progress.started} sub-tasks done`
                        : subtasksLabel(data.label)}
                </Caption>
            </Box>
        </NodeShell>
    );
}

function EndNode({ id, selected }: NodeProps<WfNode>) {
    const { delivery } = useContext(CanvasContext);
    return (
        <NodeShell id={id} selected={selected} pill handles={<TargetHandles />}>
            <Glyph name="flag" color={ATLAS_PALETTE.successFg} bg={ATLAS_PALETTE.successSoft} />
            <Box sx={{ minWidth: 0 }}>
                <Title>End</Title>
                <Caption>{deliveryLabel(delivery)}</Caption>
            </Box>
        </NodeShell>
    );
}

export const NODE_TYPES = {
    start: StartNode,
    agent: AgentNode,
    owner: OwnerNode,
    subtasks: SubtasksNode,
    end: EndNode,
};
