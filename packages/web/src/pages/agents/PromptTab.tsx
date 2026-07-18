import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { PromptTabContent } from './PromptTabContent.js';

interface Props {
    agent: IAgent;
}

function PromptTabSkeleton() {
    return (
        <Box>
            <Skeleton variant="rectangular" height={56} sx={{ borderRadius: '8px', mb: 3 }} />
            <Skeleton variant="rectangular" height={480} sx={{ borderRadius: '8px' }} />
        </Box>
    );
}

export function PromptTab(props: Props) {
    const ready = useDeferredMount();
    if (!ready) return <PromptTabSkeleton />;
    return <PromptTabContent {...props} />;
}
