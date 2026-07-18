import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IEpicListItem, IProject, IAgent } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { EpicsTabContent } from './EpicsTabContent.js';

interface Props {
    projectId: string;
    epics: IEpicListItem[] | undefined;
    projects: IProject[];
    agents: IAgent[];
    ownerName: string;
    ownerAccent: string;
}

function EpicsTabSkeleton() {
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

export function EpicsTab({ epics, ...rest }: Props) {
    const ready = useDeferredMount();
    if (!ready || epics === undefined) return <EpicsTabSkeleton />;
    return <EpicsTabContent epics={epics} {...rest} />;
}
