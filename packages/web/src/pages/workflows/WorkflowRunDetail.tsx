import { useMemo } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import CircularProgress from '@mui/material/CircularProgress';
import type { IWorkflowRunDetail, IWorkflowRunStep, IWorkflowRunSummary } from '@atlas/shared';
import {
    useResumeWorkflowRun,
    useStopWorkflowRun,
    useWorkflowRun,
    useWorkflows,
} from '../../hooks/useWorkflows.js';
import { useAgents } from '../../hooks/useAgents.js';
import { useIssues } from '../../hooks/useIssues.js';
import { useToast } from '../../hooks/useToast.js';
import { useSetPageTitle } from '../../components/shell/index.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { runStatusPaletteEntry } from '../../theme/runStatusPalette.js';
import { formatCostUsd } from '../../utils/formatCost.js';
import { formatAbsolute, relativeTime } from '../../utils/time.js';
import { WorkflowCanvas } from './WorkflowCanvas.js';
import { WorkflowRunStatusChip } from './WorkflowRunStatusChip.js';
import { nodeRunStates, toFlow } from './graph.js';
import { durationLabel, itemPathIn } from './labels.js';

function StepRow({ step, onOpen }: { step: IWorkflowRunStep; onOpen: () => void }) {
    const tone = runStatusPaletteEntry(step.status);
    const note = [step.outcome_summary, step.outcome_reason].filter(Boolean).join(' — ');
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen();
            }}
            data-testid={`wf-step-${step.id}`}
            sx={{
                display: 'grid',
                gridTemplateColumns: '12px minmax(0, 1fr) auto',
                gap: 3,
                px: 4,
                py: 3,
                cursor: 'pointer',
                borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:first-of-type': { borderTop: 0 },
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            <Box sx={{ width: 10, height: 10, mt: 1, borderRadius: '50%', background: tone.dot }} />
            <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' }}>
                    <Typography
                        sx={{ fontSize: 13.5, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                    >
                        {step.agent_name ?? step.agent_id}
                    </Typography>
                    <Typography sx={{ fontSize: 11, fontWeight: 600, color: tone.fg }}>
                        {step.status.replace('_', ' ')}
                    </Typography>
                    {step.outcome_kind && (
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: ATLAS_PALETTE.slate60,
                            }}
                        >
                            outcome: {step.outcome_kind}
                        </Typography>
                    )}
                </Box>
                {note && (
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate70, mt: 1 }}>
                        {note}
                    </Typography>
                )}
                <Typography
                    sx={{
                        fontSize: 11,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate60,
                        mt: 1,
                    }}
                >
                    {[step.cli, step.model, step.effort && `${step.effort} effort`]
                        .filter(Boolean)
                        .join(' · ')}
                </Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
                <Typography
                    sx={{
                        fontSize: 12,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate,
                    }}
                >
                    {durationLabel(step.started_at, step.completed_at)}
                </Typography>
                <Typography
                    sx={{
                        fontSize: 11,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {formatCostUsd(step.total_cost_usd)}
                </Typography>
            </Box>
        </Box>
    );
}

/** One sub-task's run inside a Task run; opens that run's own view. */
function ChildRow({ child, onOpen }: { child: IWorkflowRunSummary; onOpen: () => void }) {
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen();
            }}
            data-testid={`wf-child-${child.id}`}
            sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gap: 3,
                px: 4,
                py: 2.5,
                cursor: 'pointer',
                borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                '&:hover': { background: ATLAS_PALETTE.cloud },
            }}
        >
            <Box sx={{ minWidth: 0 }}>
                <Typography
                    sx={{
                        fontSize: 11,
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {child.item_id}
                </Typography>
                <Typography
                    sx={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {child.item_title ?? 'Sub-task'}
                </Typography>
            </Box>
            <WorkflowRunStatusChip status={child.status} />
        </Box>
    );
}

function RunBanner({ run, itemPath }: { run: IWorkflowRunDetail; itemPath: string | null }) {
    if (run.status === 'waiting_for_owner') {
        return (
            <Alert severity="warning" sx={{ mb: 3 }}>
                {run.park_reason && (
                    <Box component="span" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>
                        {run.park_reason}
                    </Box>
                )}
                The run is waiting for you.{' '}
                {run.item_id ? (
                    <>
                        Reply on the item to continue
                        {itemPath && (
                            <>
                                {' — '}
                                <Link component={RouterLink} to={itemPath}>
                                    open {run.item_id}
                                </Link>
                            </>
                        )}
                        .
                    </>
                ) : (
                    'Resume it when you are ready.'
                )}
            </Alert>
        );
    }
    if (run.status === 'completed' && run.pr_url) {
        return (
            <Alert severity="success" sx={{ mb: 3 }}>
                Delivered —{' '}
                <Link href={run.pr_url} target="_blank" rel="noreferrer">
                    open the pull request
                </Link>
            </Alert>
        );
    }
    if (run.status === 'error') {
        return (
            <Alert severity="error" sx={{ mb: 3 }}>
                The run stopped on an error. Check the failed step&apos;s log.
            </Alert>
        );
    }
    return null;
}

function RunView({ run }: { run: IWorkflowRunDetail }) {
    const navigate = useNavigate();
    const toast = useToast();
    const stop = useStopWorkflowRun();
    const resume = useResumeWorkflowRun();
    const { data: agents = [] } = useAgents();
    const { data: workflows = [] } = useWorkflows(run.project_id);
    const { data: tree } = useIssues({ projectId: run.project_id ?? undefined });

    const flow = useMemo(() => toFlow(run.graph_snapshot), [run.graph_snapshot]);
    const context = useMemo(
        () => ({
            agentsById: new Map(agents.map((a) => [a.id, a])),
            workflowsById: new Map(workflows.map((w) => [w.id, w])),
            errorNodeIds: new Set<string>(),
            runStates: nodeRunStates(run),
            delivery: workflows.find((w) => w.id === run.workflow_id) ?? null,
        }),
        [agents, run, workflows]
    );
    const itemPath = run.item_id ? itemPathIn(tree, run.item_id) : null;
    const live = run.status === 'running' || run.status === 'waiting_for_owner';

    const act = (m: typeof stop, verb: string) =>
        m.mutate(run.id, {
            onError: (err) => toast.show({ message: `Could not ${verb} run`, detail: err.message }),
        });

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: 3,
                    flexWrap: 'wrap',
                    mb: 3,
                }}
            >
                <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                        <Link
                            component={RouterLink}
                            to="/workflows"
                            underline="hover"
                            color="inherit"
                        >
                            Workflows
                        </Link>
                        {' / '}
                        <Link
                            component={RouterLink}
                            to={`/workflows/${run.workflow_id}?tab=runs`}
                            underline="hover"
                            color="inherit"
                        >
                            {run.workflow_name}
                        </Link>
                        {run.parent_workflow_run_id && (
                            <>
                                {' · '}
                                {/* The run page reads only :runId, so any workflow id in the path resolves. */}
                                <Link
                                    component={RouterLink}
                                    to={`/workflows/${run.workflow_id}/runs/${run.parent_workflow_run_id}`}
                                    underline="hover"
                                >
                                    part of the Task run
                                </Link>
                            </>
                        )}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                        <Typography variant="h2" sx={{ color: ATLAS_PALETTE.slate }}>
                            {run.item_title ?? 'Project run'}
                        </Typography>
                        <WorkflowRunStatusChip status={run.status} />
                    </Box>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                        {run.item_id && itemPath ? (
                            <Link
                                component={RouterLink}
                                to={itemPath}
                                sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}
                            >
                                {run.item_id}
                            </Link>
                        ) : (
                            <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                                {run.item_id ?? run.id.slice(0, 8)}
                            </Box>
                        )}
                        {' · started '}
                        <Box component="span" title={formatAbsolute(run.started_at)}>
                            {relativeTime(run.started_at)}
                        </Box>
                        {' · '}
                        <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                            {durationLabel(run.started_at, run.finished_at)} ·{' '}
                            {formatCostUsd(run.total_cost_usd)}
                            {run.loop_count > 0
                                ? ` · ${run.loop_count} loop${run.loop_count === 1 ? '' : 's'}`
                                : ''}
                        </Box>
                        {run.branch && (
                            <>
                                {' · '}
                                <Box
                                    component="span"
                                    sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}
                                >
                                    {run.branch}
                                </Box>
                            </>
                        )}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    {run.status === 'waiting_for_owner' && (
                        <Button
                            variant="contained"
                            onClick={() => act(resume, 'resume')}
                            disabled={resume.isPending}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                bgcolor: ATLAS_PALETTE.green,
                                boxShadow: 'none',
                                '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                            }}
                        >
                            Resume
                        </Button>
                    )}
                    {live && (
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={() => act(stop, 'stop')}
                            disabled={stop.isPending}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Stop
                        </Button>
                    )}
                    {run.pr_url && (
                        <Button
                            variant="outlined"
                            href={run.pr_url}
                            target="_blank"
                            rel="noreferrer"
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Pull request
                        </Button>
                    )}
                </Box>
            </Box>

            <RunBanner run={run} itemPath={itemPath} />

            <Box
                sx={{
                    display: 'grid',
                    gap: 3,
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 380px' },
                }}
            >
                <Box sx={{ height: { xs: 360, md: 'calc(100vh - 280px)' }, minHeight: 360 }}>
                    <ReactFlowProvider>
                        <WorkflowCanvas
                            nodes={flow.nodes}
                            edges={flow.edges}
                            context={context}
                            readOnly
                        />
                    </ReactFlowProvider>
                </Box>
                <Box
                    component="section"
                    aria-label="Steps"
                    sx={{
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        background: ATLAS_PALETTE.white,
                        overflowY: 'auto',
                        maxHeight: { lg: 'calc(100vh - 280px)' },
                    }}
                >
                    {/* A Task run whose work so far is all in its sub-tasks has no steps of its own to list. */}
                    {(run.steps.length > 0 || run.children.length === 0) && (
                        <Typography
                            variant="overline"
                            sx={{ display: 'block', px: 4, pt: 3, color: ATLAS_PALETTE.slate60 }}
                        >
                            Steps · {run.steps.length}
                        </Typography>
                    )}
                    {run.steps.length === 0
                        ? run.children.length === 0 && (
                              <Typography
                                  sx={{ px: 4, py: 3, fontSize: 13, color: ATLAS_PALETTE.slate60 }}
                              >
                                  No steps have started yet.
                              </Typography>
                          )
                        : run.steps.map((s) => (
                              <StepRow
                                  key={s.id}
                                  step={s}
                                  onOpen={() => navigate(`/agents/${s.agent_id}/runs/${s.id}`)}
                              />
                          ))}
                    {run.children.length > 0 && (
                        <>
                            <Typography
                                variant="overline"
                                sx={{
                                    display: 'block',
                                    px: 4,
                                    pt: 3,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                Sub-tasks ·{' '}
                                {run.children.filter((c) => c.status === 'completed').length} of{' '}
                                {run.children.length} done
                            </Typography>
                            {run.children.map((c) => (
                                <ChildRow
                                    key={c.id}
                                    child={c}
                                    onOpen={() =>
                                        navigate(`/workflows/${c.workflow_id}/runs/${c.id}`)
                                    }
                                />
                            ))}
                        </>
                    )}
                </Box>
            </Box>
        </Box>
    );
}

export function WorkflowRunDetail() {
    const { runId = '' } = useParams<{ id: string; runId: string }>();
    const { data: run, isLoading } = useWorkflowRun(runId);
    useSetPageTitle(run?.workflow_name ?? 'Workflow run', 'Workflow run');

    if (isLoading) {
        return (
            <Box sx={{ p: 8, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }
    if (!run) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Typography sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}>
                    Workflow run not found.
                </Typography>
            </Box>
        );
    }
    return <RunView run={run} />;
}
