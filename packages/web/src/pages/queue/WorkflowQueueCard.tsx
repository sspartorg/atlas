import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { IAgent, IWorkflowQueueEntry, IWorkflowRunSummary } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { itemPath } from '../../utils/itemPath.js';
import { formatAbsolute } from '../../utils/time.js';
import { TRIGGER_LABEL, agentLabel } from '../workflows/labels.js';
import { WorkflowRunStatusChip } from '../workflows/WorkflowRunStatusChip.js';

interface Props {
    entry: IWorkflowQueueEntry;
    projectName: string;
    agentsById: Map<string, IAgent>;
    onToggleActive: (active: boolean) => void;
    onStart: (taskId: string) => void;
    starting: boolean;
}

const NODE_LABEL = { start: 'Starting', owner: 'Owner', subtasks: 'Sub-tasks', end: 'Delivering' } as const;

function stepName(run: IWorkflowRunSummary, agentsById: Map<string, IAgent>): string {
    const node = run.graph_snapshot.nodes.find((n) => n.id === run.current_node_id);
    if (!node) return NODE_LABEL.start;
    if (node.type === 'agent') return node.agent_id ? agentLabel(node.agent_id, agentsById) : 'Agent';
    return NODE_LABEL[node.type];
}

function TaskRef({ id, title }: { id: string | null; title: string | null }) {
    if (!id) {
        return <Typography sx={{ flex: 1, fontSize: 13, color: ATLAS_PALETTE.slate60 }}>Project run</Typography>;
    }
    return (
        <Link
            component={RouterLink}
            to={itemPath('task', id)}
            underline="hover"
            sx={{ display: 'flex', gap: 1.5, minWidth: 0, flex: 1, color: ATLAS_PALETTE.slate }}
        >
            <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12, color: ATLAS_PALETTE.slate60, flexShrink: 0 }}>
                {id}
            </Box>
            <Box component="span" sx={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {title}
            </Box>
        </Link>
    );
}

function RunLink({ run }: { run: IWorkflowRunSummary }) {
    return (
        <Link
            component={RouterLink}
            to={`/workflows/${run.workflow_id}/runs/${run.id}`}
            underline="hover"
            sx={{ fontSize: 12, flexShrink: 0 }}
        >
            Open run
        </Link>
    );
}

function Row({ children }: { children: ReactNode }) {
    return (
        <Box
            component="li"
            sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 2,
                py: 1.5,
                borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
            }}
        >
            {children}
        </Box>
    );
}

function Section({ label, count, children }: { label: string; count: number; children: ReactNode }) {
    if (count === 0) return null;
    return (
        <Box>
            <Typography variant="overline" sx={{ color: ATLAS_PALETTE.slate60 }}>
                {label}{' '}
                <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                    {count}
                </Box>
            </Typography>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {children}
            </Box>
        </Box>
    );
}

export function WorkflowQueueCard({ entry, projectName, agentsById, onToggleActive, onStart, starting }: Props) {
    const { workflow: wf, running, waiting, queued } = entry;
    const active = wf.status === 'active';
    const free = wf.max_parallel_runs - running.length;
    const trigger =
        wf.trigger === 'schedule' && wf.next_run_at
            ? `${TRIGGER_LABEL.schedule} · next ${formatAbsolute(wf.next_run_at)}`
            : TRIGGER_LABEL[wf.trigger];
    // Dispatch only picks up Tasks for active, non-manual workflows.
    const waitsOnYou = !active ? 'Paused: these wait until you turn it back on.' : wf.trigger === 'manual' ? 'Manual: these wait until you start them.' : null;

    return (
        <Box
            component="section"
            aria-label={wf.name}
            sx={{
                p: 4,
                borderRadius: '12px',
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Link
                        component={RouterLink}
                        to={`/workflows/${wf.id}`}
                        underline="hover"
                        sx={{ fontSize: 15, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                    >
                        {wf.name}
                    </Link>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {projectName} · {trigger}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                    <Typography sx={{ fontSize: 12, color: active ? ATLAS_PALETTE.successFg : ATLAS_PALETTE.slate60 }}>
                        {active ? 'Active' : 'Paused'}
                    </Typography>
                    <Switch
                        size="small"
                        checked={active}
                        onChange={(e) => onToggleActive(e.target.checked)}
                        slotProps={{ input: { 'aria-label': `${wf.name} active` } }}
                    />
                </Box>
            </Box>

            <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>Running</Typography>
                    <Typography sx={{ fontSize: 12, fontFamily: TYPOGRAPHY.fontFamilyMono, color: ATLAS_PALETTE.slate }}>
                        {running.length} / {wf.max_parallel_runs}
                    </Typography>
                </Box>
                <LinearProgress
                    variant="determinate"
                    value={Math.min(100, (running.length / wf.max_parallel_runs) * 100)}
                    aria-label={`${wf.name} running slots`}
                    sx={{ height: 6, borderRadius: 3, bgcolor: ATLAS_PALETTE.slate06 }}
                />
            </Box>

            <Section label="Running" count={running.length}>
                {running.map((r) => (
                    <Row key={r.id}>
                        <TaskRef id={r.item_id} title={r.item_title} />
                        <Box
                            component="span"
                            sx={{ fontSize: 11.5, px: 1.5, py: 0.25, borderRadius: '6px', background: ATLAS_PALETTE.accentSoft, color: ATLAS_PALETTE.accentFg, flexShrink: 0 }}
                        >
                            {stepName(r, agentsById)}
                        </Box>
                        <RunLink run={r} />
                    </Row>
                ))}
            </Section>

            <Section label="Waiting on you" count={waiting.length}>
                {waiting.map((r) => (
                    <Row key={r.id}>
                        <TaskRef id={r.item_id} title={r.item_title} />
                        <WorkflowRunStatusChip status={r.status} />
                        <RunLink run={r} />
                        {r.park_reason && (
                            <Typography sx={{ flexBasis: '100%', fontSize: 12, color: ATLAS_PALETTE.slate70 }}>
                                {r.park_reason}
                            </Typography>
                        )}
                    </Row>
                ))}
            </Section>

            <Section label="Queued" count={queued.length}>
                {waitsOnYou && (
                    <Typography component="li" sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, pb: 1 }}>
                        {waitsOnYou}
                    </Typography>
                )}
                {queued.map((t, i) => (
                    <Row key={t.id}>
                        <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12, color: ATLAS_PALETTE.slate30 }}>
                            {i + 1}
                        </Box>
                        <TaskRef id={t.id} title={t.title} />
                        {free > 0 && (
                            <Button
                                size="small"
                                variant="outlined"
                                disabled={starting}
                                onClick={() => onStart(t.id)}
                                sx={{ textTransform: 'none', fontSize: 12, py: 0, minWidth: 0, flexShrink: 0 }}
                            >
                                Start now
                            </Button>
                        )}
                    </Row>
                ))}
            </Section>

            {running.length + waiting.length + queued.length === 0 && (
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    Nothing running or queued. Set a ready Task’s workflow to this one to queue it.
                </Typography>
            )}
        </Box>
    );
}
