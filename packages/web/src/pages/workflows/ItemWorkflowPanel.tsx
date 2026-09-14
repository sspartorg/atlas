import { Link as RouterLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import type { IssueType } from '@atlas/shared';
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

// The rail knows the item's kind and id but not its row, so read
// `workflow_id` from the composite query the detail page already fetched.
// Key AND fetcher must match the page's hook exactly — whichever observer
// refetches writes the cache the other one reads.
const FULL_QUERY: Record<IssueType, [string, (id: string) => Promise<unknown>]> = {
    epic: ['epics', (id) => api.epics.full(id)],
    story: ['stories', (id) => api.stories.full(id)],
    bug: ['bugs', (id) => api.bugs.full(id)],
    sub_task: ['sub-tasks', (id) => api.subTasks.full(id)],
    sub_bug: ['sub-bugs', (id) => api.subBugs.full(id)],
};

interface Props {
    issueType: IssueType;
    itemId: string;
    projectId: string;
}

export function ItemWorkflowPanel({ issueType, itemId, projectId }: Props) {
    const toast = useToast();
    const [kindKey, fetchFull] = FULL_QUERY[issueType];
    const { data: workflowId = null } = useQuery({
        queryKey: [kindKey, itemId, 'full'],
        queryFn: () => fetchFull(itemId),
        // Every composite nests the item under its kind (`story`, `sub_task`, …).
        select: (full) =>
            (full as Record<string, { workflow_id?: string | null } | undefined>)[issueType]?.workflow_id ?? null,
    });
    const { data: workflows = [] } = useWorkflows(projectId);
    const { data: runs = [] } = useItemWorkflowRuns(itemId);
    const setWorkflow = useSetItemWorkflow();
    const start = useStartWorkflowRun();

    const options = workflows.filter((w) => w.input_kind === 'item');
    const latest = runs[0];
    const live = latest && LIVE_WORKFLOW_RUN_STATUSES.includes(latest.status);
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
                </InfoRow>
            )}
        </>
    );
}
