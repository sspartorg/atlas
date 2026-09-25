import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Link from '@mui/material/Link';
import type { IAgent, IProject, IWorkflow } from '@atlas/shared';
import { SelectableCard } from '../../components/SchedulePresetFields.js';
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

const TITLES = {
    start: 'Workflow settings',
    agent: 'Agent step',
    owner: 'Owner',
    subtasks: 'Sub-tasks step',
    gate: 'Gate step',
    end: 'End',
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1.5 }}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{label}</Typography>
            <Typography
                sx={{
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.slate,
                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                    textAlign: 'right',
                }}
            >
                {children}
            </Typography>
        </Box>
    );
}

function ToggleRow({
    label,
    sub,
    checked,
    onChange,
}: {
    label: string;
    sub: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <Box
            component="label"
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                py: 1.5,
                cursor: 'pointer',
                borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
            }}
        >
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {label}
                </Typography>
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>{sub}</Typography>
            </Box>
            {/* G-010 — MUI 7 dropped `inputProps` on Switch; it is silently
                ignored and the aria-label never reaches the input. Without
                `slotProps.input` the accessible name falls through to the
                wrapping label, so a screen reader reads the heading AND the
                sub-text as one string. TextField still honours `inputProps`
                in v7, which is why this was the only Switch affected. */}
            <Switch
                checked={checked}
                onChange={(_, v) => onChange(v)}
                slotProps={{ input: { 'aria-label': label } }}
            />
        </Box>
    );
}

function Explain({ children }: { children: React.ReactNode }) {
    return (
        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, lineHeight: 1.6 }}>
            {children}
        </Typography>
    );
}

function AgentPanel({
    node,
    agents,
    onNodeData,
}: Pick<Props, 'agents' | 'onNodeData'> & { node: WfNode }) {
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
            {/* A paused agent is not a broken step — it is a step that will
                park the run with no explanation. Creating a workflow no longer
                silently re-activates the agents it names (that overrode a
                decision the Owner made on purpose), so this is where they find
                out, on every path: template, import, or hand-built. */}
            {agent && agent.status !== 'active' && (
                <Explain>
                    {agent.name} is paused, so a run will wait here until you enable it.
                </Explain>
            )}
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
                The step follows its green <Box component="strong">pass</Box> connection when the
                agent reports done, and its red <Box component="strong">fail</Box> connection when a
                reviewer rejects the work. With no fail connection, a failure sends the item back to
                you.
            </Explain>
        </Box>
    );
}

function GatePanel({
    node,
    agents,
    onNodeData,
}: Pick<Props, 'agents' | 'onNodeData'> & { node: WfNode }) {
    const agent = agents.find((a) => a.id === node.data.agent_id);
    // Same reasoning as the Sub-tasks panel: an agent id that is not installed
    // is not the same as no id. At run time the step parks rather than failing,
    // so it looks like a stuck workflow instead of a typo. Say so here, where
    // it can be fixed.
    const dangling = node.data.agent_id != null && !agent;
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
                select
                label="Checker agent"
                size="small"
                error={dangling}
                value={agent ? agent.id : ''}
                onChange={(e) => onNodeData({ agent_id: e.target.value || undefined })}
                helperText={
                    dangling
                        ? "This gate points at an agent that isn't installed — pick one."
                        : 'Reads the repo and names the command this project already trusts'
                }
                fullWidth
            >
                {agents.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                        {a.name}
                    </MenuItem>
                ))}
            </TextField>
            {agent && agent.status !== 'active' && (
                <Explain>
                    {agent.name} is paused, so a run will wait here until you enable it.
                </Explain>
            )}
            <Explain>
                The checker looks at this project and answers two things: does this check apply
                here, and what one command proves it. Atlas then runs that command itself, once per
                repo, and believes the exit code — an agent cannot report green. Exit 0 takes the
                pass connection; anything else takes the fail connection, with the command&apos;s own
                output handed to whatever is on the other end as its brief. A check that cannot run,
                or a checker that names no command, pauses the run and comes back to you rather than
                counting as a failure. A project with no such tooling is recorded as skipped, not as
                a pass.
            </Explain>
        </Box>
    );
}

function SubtasksPanel({
    workflow,
    node,
    workflows,
    onNodeData,
}: Pick<Props, 'workflow' | 'workflows' | 'onNodeData'> & { node: WfNode }) {
    const subs = workflows.filter(
        (w) => w.input_kind === 'sub_task' && w.project_id === workflow.project_id
    );
    const picked = subs.find((w) => w.id === node.data.sub_workflow_id);
    // A ref that names a workflow this project no longer has is NOT the same as
    // no ref: rendering it as "nothing selected" hides a broken step and the
    // next save silently drops the id. Say so, and keep the run-time error
    // ("Workflow <id> does not exist") in sight of whoever can fix it.
    const dangling = node.data.sub_workflow_id != null && !picked;
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
                select
                label="Sub-workflow"
                size="small"
                error={dangling}
                value={picked ? picked.id : ''}
                onChange={(e) => onNodeData({ sub_workflow_id: e.target.value || undefined })}
                helperText={
                    dangling
                        ? 'This step points at a workflow that is no longer in this project — pick one.'
                        : subs.length === 0
                          ? 'Create a workflow with the Sub-task workflow input first'
                          : 'Runs once per sub-task'
                }
                fullWidth
            >
                {subs.map((w) => (
                    <MenuItem key={w.id} value={w.id}>
                        {w.name}
                    </MenuItem>
                ))}
            </TextField>
            <TextField
                label="Label"
                size="small"
                value={node.data.label ?? ''}
                onChange={(e) => onNodeData({ label: e.target.value || undefined })}
                helperText="Only sub-tasks with this label. Empty: every sub-task no other Sub-tasks step claims"
                slotProps={{ htmlInput: { maxLength: 40 } }}
                fullWidth
            />
            {picked && (
                <Link component={RouterLink} to={`/workflows/${picked.id}`} sx={{ fontSize: 13 }}>
                    Open {picked.name}
                </Link>
            )}
            <Explain>
                The run works this Task&apos;s open sub-tasks one at a time, oldest first, on the
                Task&apos;s own branch — each through the sub-workflow — then follows the pass
                connection. A sub-task that needs you pauses the whole Task until you reply on
                either one.
            </Explain>
        </Box>
    );
}

type DeliveryMode = 'none' | 'push' | 'pr' | 'default';

const DELIVERY_MODES: Array<{ mode: DeliveryMode; title: string; sub: string }> = [
    {
        mode: 'pr',
        title: 'Push + pull request',
        sub: 'One branch and one PR per run for you to review',
    },
    { mode: 'push', title: 'Push branch', sub: 'Push the run’s branch, no PR' },
    {
        mode: 'default',
        title: 'Push to the default branch',
        sub: 'Publish straight to the default branch, no review',
    },
    { mode: 'none', title: 'Keep local', sub: 'Leave the work in the worktree' },
];

function deliveryMode(w: IWorkflow): DeliveryMode {
    if (!w.push_code) return 'none';
    if (w.push_to_default) return 'default';
    return w.raises_pr ? 'pr' : 'push';
}

const DELIVERY_PATCH: Record<
    DeliveryMode,
    Pick<IWorkflow, 'push_code' | 'raises_pr' | 'push_to_default'>
> = {
    none: { push_code: false, raises_pr: false, push_to_default: false },
    push: { push_code: true, raises_pr: false, push_to_default: false },
    pr: { push_code: true, raises_pr: true, push_to_default: false },
    default: { push_code: true, raises_pr: false, push_to_default: true },
};

function EndPanel({ workflow, onChange }: Pick<Props, 'workflow' | 'onChange'>) {
    if (workflow.input_kind === 'sub_task') {
        return (
            <Explain>
                The sub-task is done: its work stays on the Task&apos;s branch and it goes to
                review. The Task workflow pushes and opens the pull request once every sub-task is
                done.
            </Explain>
        );
    }
    const mode = deliveryMode(workflow);
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <ToggleRow
                label="Use a worktree"
                sub="All steps share one checkout and branch"
                checked={workflow.use_worktree}
                onChange={(v) => onChange({ use_worktree: v })}
            />
            <Box>
                <SectionLabel>Delivery</SectionLabel>
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                    {DELIVERY_MODES.map((d) => (
                        <SelectableCard
                            key={d.mode}
                            title={d.title}
                            sub={d.sub}
                            selected={mode === d.mode}
                            onClick={() => onChange(DELIVERY_PATCH[d.mode])}
                        />
                    ))}
                </Box>
            </Box>
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
            <Typography
                variant="h4"
                sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 3 }}
            >
                {TITLES[type]}
            </Typography>
            {type === 'start' && (
                <StartInspector
                    workflow={props.workflow}
                    projects={props.projects}
                    onChange={props.onChange}
                />
            )}
            {type === 'agent' && props.node && (
                <AgentPanel node={props.node} agents={props.agents} onNodeData={props.onNodeData} />
            )}
            {type === 'owner' && (
                <Explain>
                    When a step connects here, the run pauses and the item comes back to you as
                    Waiting for info. Reply on the item and the run continues along this node&apos;s
                    pass connection.
                </Explain>
            )}
            {type === 'subtasks' && props.node && (
                <SubtasksPanel
                    workflow={props.workflow}
                    workflows={props.workflows}
                    node={props.node}
                    onNodeData={props.onNodeData}
                />
            )}
            {type === 'gate' && props.node && (
                <GatePanel node={props.node} agents={props.agents} onNodeData={props.onNodeData} />
            )}
            {type === 'end' && <EndPanel workflow={props.workflow} onChange={props.onChange} />}
        </Box>
    );
}
