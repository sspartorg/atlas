import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent, IAgentRun } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { RunsTabContent } from './RunsTabContent.js';

interface Props {
    agent: IAgent;
    runs: IAgentRun[];
}

function RunsTabSkeleton() {
    return (
        <Box>
            {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton
                    key={i}
                    variant="rectangular"
                    height={56}
                    sx={{ borderRadius: '8px', mb: 1 }}
                />
            ))}
        </Box>
    );
}

export function RunsTab(props: Props) {
    const ready = useDeferredMount();
    if (!ready) return <RunsTabSkeleton />;
    return <RunsTabContent {...props} />;
}
