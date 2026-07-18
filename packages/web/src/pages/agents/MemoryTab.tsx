import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import type { IAgent, IAgentMemory } from '@atlas/shared';
import { useDeferredMount } from '../../hooks/useDeferredMount.js';
import { MemoryTabContent } from './MemoryTabContent.js';

interface Props {
    agent: IAgent;
    memory: IAgentMemory | undefined;
}

function MemoryTabSkeleton() {
    return (
        <Box>
            <Skeleton variant="rounded" height={64} sx={{ mb: 2 }} />
            <Skeleton variant="rounded" height={320} />
        </Box>
    );
}

export function MemoryTab({ agent, memory }: Props) {
    const ready = useDeferredMount();
    if (!ready || memory === undefined) return <MemoryTabSkeleton />;
    return <MemoryTabContent agent={agent} memory={memory} />;
}
