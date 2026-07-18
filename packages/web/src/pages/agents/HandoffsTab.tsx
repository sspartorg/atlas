import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { HandoffsTabContent } from './HandoffsTabContent.js';

interface Props {
    agent: IAgent;
}

function HandoffsTabSkeleton() {
    return (
        <Box>
            <Skeleton variant="rectangular" height={64} sx={{ borderRadius: '8px', mb: 2 }} />
            <Skeleton variant="rectangular" height={64} sx={{ borderRadius: '8px', mb: 2 }} />
            <Skeleton variant="rectangular" height={64} sx={{ borderRadius: '8px' }} />
        </Box>
    );
}

export function HandoffsTab(props: Props) {
    const ready = useDeferredMount();
    if (!ready) return <HandoffsTabSkeleton />;
    return <HandoffsTabContent {...props} />;
}
