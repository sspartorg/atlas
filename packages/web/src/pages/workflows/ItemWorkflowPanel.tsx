import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { api } from '../../api/api.js';
import { InfoRow } from '../../components/InfoPanel.js';
import {
    useItemWorkflowRuns,
    useSetItemWorkflow,
    useStartWorkflowRun,
    useWorkflows,
} from '../../hooks/useWorkflows.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { LIVE_WORKFLOW_RUN_STATUSES } from '../../theme/workflowRunStatusPalette.js';
import { relativeTime } from '../../utils/time.js';
import { WorkflowRunStatusChip } from './WorkflowRunStatusChip.js';

interface Props {
    itemId: string;
    projectId: string;
}

// Only Tasks are assigned to workflows; a sub-task runs inside its Task's
// workflow run (ADR 0015).
export function ItemWorkflowPanel({ itemId, projectId }: Props) {
    const toast = useToast();
    // Key AND fetcher must match useTaskFull exactly — whichever observer
    // refetches writes the cache the other one reads.
    const { data: task } = useQuery({
        queryKey: ['tasks', itemId, 'full'],
        queryFn: () => api.tasks.full(itemId),
        select: (full) => ({
            workflowId: full.task.workflow_id,
            // Same rule as the engine: open = not yet in review or done.
            openSubtasks: full.sub_tasks.filter((s) => s.status !== 'in_review' && s.status !== 'done').length,
        }),
    });
    const workflowId = task?.workflowId ?? null;
    const openSubtasks = task?.openSubtasks ?? 0;
    const { data: workflows = [] } = useWorkflows(projectId);
    const { data: runs = [] } = useItemWorkflowRuns(itemId);
    const setWorkflow = useSetItemWorkflow();
    const start = useStartWorkflowRun();

    const options = workflows.filter((w) => w.input_kind === 'item');
    const latest = runs[0];
    const live = latest && LIVE_WORKFLOW_RUN_STATUSES.includes(latest.status);
    const assigned = workflows.find((w) => w.id === workflowId);
    // After a finished run, new or reopened sub-tasks go through the Sub-tasks
    // steps on the same branch and into the same PR — no re-planning.
    const canContinue =
        !live && latest?.status === 'completed' && openSubtasks > 0 && Boolean(assigned?.graph.nodes.some((n) => n.type === 'subtasks'));
    const onError = (message: string) => (err: Error) => toast.show({ message, detail: err.message });

    return (
        <>
            <InfoRow label="Workflow">
                {options.length === 0 && !workflowId ? (
                    <Link component={RouterLink} to="/workflows" sx={{ fontSize: 12.5 }}>
                        Create a workflow
                    </Link>
                ) : (
                    <Select
                        size="small"
                        variant="standard"
                        disableUnderline
                        value={workflowId ?? ''}
                        displayEmpty
                        inputProps={{ 'aria-label': 'Workflow' }}
                        onChange={(e) =>
                            setWorkflow.mutate(
                                { itemId, workflowId: e.target.value || null },
                                { onError: onError('Could not change workflow') },
                            )
                        }
                        sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate, maxWidth: 180 }}
                    >
                        <MenuItem value="">None</MenuItem>
                        {workflowId && !options.some((w) => w.id === workflowId) && (
                            <MenuItem value={workflowId}>Current workflow</MenuItem>
                        )}
                        {options.map((w) => (
                            <MenuItem key={w.id} value={w.id}>
                                {w.name}
                            </MenuItem>
                        ))}
                    </Select>
                )}
            </InfoRow>
            {(latest || workflowId) && (
                <InfoRow label="Workflow run">
                    {latest && (
                        <Link
                            component={RouterLink}
                            to={`/workflows/${latest.workflow_id}/runs/${latest.id}`}
                            underline="none"
                            sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 }}
                        >
                            <WorkflowRunStatusChip status={latest.status} />
                            <Typography component="span" sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}>
                                {relativeTime(latest.started_at)}
                            </Typography>
                        </Link>
                    )}
                    {workflowId && !live && (
                        <Button
                            size="small"
                            variant="outlined"
                            disabled={start.isPending}
                            onClick={() =>
                                start.mutate(
                                    { workflowId, itemId },
                                    { onError: onError('Could not start workflow') },
                                )
                            }
                            sx={{ textTransform: 'none', fontSize: 12, py: 0, minWidth: 0 }}
                        >
                            Start now
                        </Button>
                    )}
                    {workflowId && canContinue && (
                        <Tooltip describeChild title="Runs the open sub-tasks on the same branch and updates the pull request">
                            <Button
                                size="small"
                                variant="contained"
                                disabled={start.isPending}
                                onClick={() =>
                                    start.mutate(
                                        { workflowId, itemId, fromSubtasks: true },
                                        { onError: onError('Could not continue the workflow') },
                                    )
                                }
                                sx={{ textTransform: 'none', fontSize: 12, py: 0, minWidth: 0, boxShadow: 'none' }}
                            >
                                Continue · {openSubtasks} open
                            </Button>
                        </Tooltip>
                    )}
                </InfoRow>
            )}
        </>
    );
}
