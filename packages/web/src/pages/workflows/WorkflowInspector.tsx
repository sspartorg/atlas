import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Link from '@mui/material/Link';
import type { IAgent, IProject, IWorkflow } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { SectionLabel, StartInspector } from './StartInspector.js';
import type { IWfNodeData, WfNode } from './graph.js';

interface Props {
    workflow: IWorkflow;
    node: WfNode | null;
    agents: IAgent[];
    projects: IProject[];
    workflows: IWorkflow[];
    onChange: (patch: Partial<IWorkflow>) => void;
    onNodeData: (patch: IWfNodeData) => void;
}

const TITLES = { start: 'Workflow settings', agent: 'Agent step', owner: 'Owner', end: 'End' } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{label}</Typography>
            <Typography
                sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate, fontFamily: TYPOGRAPHY.fontFamilyMono, textAlign: 'right' }}
            >
                {children}
            </Typography>
        </Box>
    );
}

function ToggleRow({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5, borderBottom: `1px solid ${ATLAS_PALETTE.slate06}` }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>{label}</Typography>
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>{sub}</Typography>
            </Box>
            <Switch checked={checked} onChange={(_, v) => onChange(v)} inputProps={{ 'aria-label': label }} />
        </Box>
    );
}

function Explain({ children }: { children: React.ReactNode }) {
    return <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, lineHeight: 1.6 }}>{children}</Typography>;
}

function AgentPanel({ node, agents, onNodeData }: Pick<Props, 'agents' | 'onNodeData'> & { node: WfNode }) {
    const agent = agents.find((a) => a.id === node.data.agent_id);
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
                select
                label="Agent"
                size="small"
                value={agent ? agent.id : ''}
                onChange={(e) => onNodeData({ agent_id: e.target.value })}
                fullWidth
            >
                {agents.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                        {a.name}
                    </MenuItem>
                ))}
            </TextField>
            {agent ? (
                <Box>
                    <Row label="CLI">{agent.cli}</Row>
                    <Row label="Model">{agent.model}</Row>
                    <Row label="Effort">{agent.effort}</Row>
                    <Link component={RouterLink} to={`/agents/${agent.id}`} sx={{ fontSize: 13 }}>
                        Open agent — prompt, memory, checklists
                    </Link>
                </Box>
            ) : (
                <Explain>
                    {node.data.agent_id
                        ? `${node.data.agent_id} isn't installed. Pick an installed agent.`
                        : 'Pick the agent this step runs.'}
                </Explain>
            )}
            <Explain>
                The step follows its green <Box component="strong">pass</Box> connection when the agent reports done, and its red{' '}
                <Box component="strong">fail</Box> connection when a reviewer rejects the work. With no fail connection, a failure sends
                the item back to you.
            </Explain>
        </Box>
    );
}

function EndPanel({ workflow, node, workflows, onChange, onNodeData }: Omit<Props, 'agents' | 'projects'> & { node: WfNode }) {
    const children = workflows.filter(
        (w) => w.id !== workflow.id && w.input_kind === 'item' && w.project_id === workflow.project_id,
    );
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Box>
                <SectionLabel>Delivery</SectionLabel>
                <ToggleRow
                    label="Use a worktree"
                    sub="All steps share one checkout and branch"
                    checked={workflow.use_worktree}
                    onChange={(v) => onChange({ use_worktree: v })}
                />
                <ToggleRow
                    label="Push branch"
                    sub="Push the run's branch when it ends"
                    checked={workflow.push_code}
                    onChange={(v) => onChange({ push_code: v })}
                />
                <ToggleRow
                    label="Open pull request"
                    sub="One PR per run"
                    checked={workflow.raises_pr}
                    onChange={(v) => onChange({ raises_pr: v })}
                />
            </Box>
            <TextField
                select
                label="Child workflow"
                size="small"
                value={node.data.child_workflow_id ?? ''}
                onChange={(e) => onNodeData({ child_workflow_id: e.target.value || undefined })}
                helperText="Items created during the run are queued here"
                fullWidth
            >
                <MenuItem value="">None</MenuItem>
                {children.map((w) => (
                    <MenuItem key={w.id} value={w.id}>
                        {w.name}
                    </MenuItem>
                ))}
            </TextField>
        </Box>
    );
}

export function WorkflowInspector(props: Props) {
    const type = props.node?.type ?? 'start';
    return (
        <Box
            component="aside"
            aria-label="Inspector"
            sx={{
                p: 4,
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: ATLAS_PALETTE.white,
                overflowY: 'auto',
                minWidth: 0,
                minHeight: 0,
                flex: 1,
            }}
        >
            <Typography variant="h4" sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 3 }}>
                {TITLES[type]}
            </Typography>
            {type === 'start' && (
                <StartInspector workflow={props.workflow} projects={props.projects} onChange={props.onChange} />
            )}
            {type === 'agent' && props.node && (
                <AgentPanel node={props.node} agents={props.agents} onNodeData={props.onNodeData} />
            )}
            {type === 'owner' && (
                <Explain>
                    When a step connects here, the run pauses and the item comes back to you as Waiting for info.
                    Reply on the item and the run continues along this node&apos;s pass connection.
                </Explain>
            )}
            {type === 'end' && props.node && <EndPanel {...props} node={props.node} />}
        </Box>
    );
}
