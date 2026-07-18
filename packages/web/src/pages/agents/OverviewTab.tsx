import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { OverviewTabContent } from './OverviewTabContent.js';
import type { AgentView } from './agentViewModel.js';

interface Props {
    agent: IAgent;
    view: AgentView;
}

function OverviewTabSkeleton() {
    return (
        <Box>
            <Skeleton variant="rectangular" height={120} sx={{ borderRadius: '8px', mb: 4 }} />
            <Skeleton variant="rectangular" height={280} sx={{ borderRadius: '8px' }} />
        </Box>
    );
}

export function OverviewTab(props: Props) {
    const ready = useDeferredMount();
    if (!ready) return <OverviewTabSkeleton />;
    return <OverviewTabContent {...props} />;
}
