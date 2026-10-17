import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { RetryAlert } from '../../components/ApiErrorAlert.js';
import type { ITaskListItem, IProject } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { TasksTabContent } from './TasksTabContent.js';
import type { AgentSummary } from '../../api/types.js';

interface Props {
    projectId: string;
    tasks: ITaskListItem[] | undefined;
    /** The issue tree failed to load — shown instead of an endless skeleton. */
    error?: unknown;
    onRetry?: () => void;
    projects: IProject[];
    agents: AgentSummary[];
    ownerName: string;
    ownerAccent: string;
}

function TasksTabSkeleton() {
    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                <Skeleton variant="text" width={160} height={20} />
                <Skeleton variant="text" width={100} height={20} />
            </Box>
            <Skeleton variant="rectangular" height={240} sx={{ borderRadius: '10px' }} />
        </Box>
    );
}

export function TasksTab({ tasks, error, onRetry, ...rest }: Props) {
    const ready = useDeferredMount();
    if (tasks === undefined && error) return <RetryAlert error={error} label="Could not load tasks" onRetry={onRetry} />;
    if (!ready || tasks === undefined) return <TasksTabSkeleton />;
    return <TasksTabContent tasks={tasks} {...rest} />;
}
