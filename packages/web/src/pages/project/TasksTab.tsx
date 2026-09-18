import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { ITaskListItem, IProject, IAgent } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { TasksTabContent } from './TasksTabContent.js';

interface Props {
    projectId: string;
    tasks: ITaskListItem[] | undefined;
    projects: IProject[];
    agents: IAgent[];
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

export function TasksTab({ tasks, ...rest }: Props) {
    const ready = useDeferredMount();
    if (!ready || tasks === undefined) return <TasksTabSkeleton />;
    return <TasksTabContent tasks={tasks} {...rest} />;
}
