import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { useAgents } from '../hooks/useAgents.js';
import { useProjects } from '../hooks/useProjects.js';
import { useToast } from '../hooks/useToast.js';
import { useWorkflowQueue } from '../hooks/useWorkflowQueue.js';
import {
    useSetItemWorkflow,
    useStartWorkflowRun,
    useUpdateWorkflow,
} from '../hooks/useWorkflows.js';
import { EmptyState } from '../components/EmptyState.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';
import { WorkflowQueueCard } from './queue/WorkflowQueueCard.js';
import { UnassignedTasks } from './queue/UnassignedTasks.js';

const GRID_SX = {
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
    gap: 3,
} as const;

export function Queue() {
    useSetPageTitle('Queue');
    const toast = useToast();
    const queryClient = useQueryClient();
    const [projectId, setProjectId] = useState('');
    const { data, isLoading, error } = useWorkflowQueue(projectId || null);
    const { data: projects = [] } = useProjects();
    const { data: agents = [] } = useAgents();
    const updateWorkflow = useUpdateWorkflow();
    const startRun = useStartWorkflowRun();
    const setItemWorkflow = useSetItemWorkflow();

    const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
    const projectName = useMemo(() => {
        const byId = new Map(projects.map((p) => [p.id, p.name]));
        return (id: string | null) => (id ? (byId.get(id) ?? 'Unknown project') : 'No project');
    }, [projects]);

    const entries = data?.workflows ?? [];
    const unassigned = data?.unassigned ?? [];
    const total = (k: 'running' | 'queued' | 'waiting') =>
        entries.reduce((n, e) => n + e[k].length, 0);
    const stats = [
        ['running', total('running')],
        ['queued', total('queued')],
        ['waiting on you', total('waiting')],
        ['need a workflow', unassigned.length],
    ] as const;

    // SSE refreshes the queue as well; this keeps the page right without it.
    const mutateOpts = (failure: string) => ({
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['workflow-queue'] }),
        onError: (err: Error) => toast.show({ message: failure, detail: err.message }),
    });

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: 4,
                    mb: 5,
                    flexWrap: 'wrap',
                }}
            >
                <Box>
                    <Typography variant="h2" sx={{ color: ATLAS_PALETTE.slate }}>
                        Queue
                    </Typography>
                    <Typography
                        sx={{
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate60,
                            mt: 1.5,
                        }}
                    >
                        {stats.map(([label, n]) => `${n} ${label}`).join(' · ')}
                    </Typography>
                </Box>
                <Select
                    size="small"
                    value={projectId}
                    displayEmpty
                    onChange={(e) => setProjectId(e.target.value)}
                    inputProps={{ 'aria-label': 'Project' }}
                    sx={{ fontSize: 13, minWidth: 180 }}
                >
                    <MenuItem value="">All projects</MenuItem>
                    {projects.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                            {p.name}
                        </MenuItem>
                    ))}
                </Select>
            </Box>

            {error ? (
                <Alert severity="error">Couldn&apos;t load the queue: {error.message}</Alert>
            ) : isLoading ? (
                <Box sx={GRID_SX}>
                    {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton
                            key={i}
                            variant="rounded"
                            height={220}
                            sx={{ borderRadius: '12px' }}
                        />
                    ))}
                </Box>
            ) : entries.length === 0 ? (
                <EmptyState
                    variant="dashed"
                    icon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 32 }}
                        >
                            account_tree
                        </Box>
                    }
                    title="No workflows yet"
                    description="A workflow runs the ready Tasks you queue for it, a few at a time. Create one and your queue shows up here."
                    actions={
                        <Button variant="outlined" component={RouterLink} to="/workflows">
                            Go to workflows
                        </Button>
                    }
                />
            ) : (
                <Box sx={GRID_SX}>
                    {entries.map((entry) => (
                        <WorkflowQueueCard
                            key={entry.workflow.id}
                            entry={entry}
                            projectName={projectName(entry.workflow.project_id)}
                            agentsById={agentsById}
                            starting={startRun.isPending}
                            onToggleActive={(active) =>
                                updateWorkflow.mutate(
                                    {
                                        id: entry.workflow.id,
                                        input: { status: active ? 'active' : 'inactive' },
                                    },
                                    mutateOpts('Could not change the workflow')
                                )
                            }
                            onStart={(taskId) =>
                                startRun.mutate(
                                    { workflowId: entry.workflow.id, itemId: taskId },
                                    mutateOpts('Could not start the workflow')
                                )
                            }
                        />
                    ))}
                </Box>
            )}

            <UnassignedTasks
                tasks={unassigned}
                workflows={entries.map((e) => e.workflow).filter((w) => w.input_kind === 'item')}
                projectName={projectName}
                onPick={(itemId, workflowId) =>
                    setItemWorkflow.mutate(
                        { itemId, workflowId },
                        mutateOpts('Could not queue the Task')
                    )
                }
            />
        </Box>
    );
}
