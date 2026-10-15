import Box from '@mui/material/Box';
import { useSettings } from '../../hooks/useSettings.js';
import { useAgents } from '../../hooks/useAgents.js';
import type { DashboardResponse } from '../../api/types.js';
import { GreetingBlock } from './GreetingBlock.js';
import { FleetStrip } from './FleetStrip.js';
import { LivePipelines } from './LivePipelines.js';
import { AwaitingYouPanel } from './AwaitingYouPanel.js';
import { InMotionPanel } from './InMotionPanel.js';
import { AgentRoom } from './AgentRoom.js';
import { costTotals } from './costTotals.js';

interface IDashboardPopulatedProps {
    data: DashboardResponse;
}

export function DashboardPopulated({ data }: IDashboardPopulatedProps) {
    const { data: settings } = useSettings();
    const { data: agents = [] } = useAgents();

    const ownerFullName = settings?.owner_name ?? '';
    const ownerFirstName = ownerFullName.trim().split(/\s+/)[0] || 'there';
    const awaiting = data.awaiting ?? [];
    const queue = data.queue ?? [];
    // `awaiting` is capped at 20 rows by the API for rendering; the greeting
    // states a global figure, so it reads the true total. Falls back to the
    // array length for an older API that doesn't send one.
    const awaitingCount = data.kpis?.awaitingTotal ?? awaiting.length;
    const stats = data.kpis?.agentStatsByCategory;
    const liveCount = Object.values(stats ?? {}).reduce((n, s) => n + (s?.running ?? 0), 0);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <GreetingBlock ownerFirstName={ownerFirstName} awaitingCount={awaitingCount} />
            <FleetStrip
                agents={agents.filter((a) => a.status === 'active')}
                liveCount={liveCount}
                spend={costTotals(data.kpis?.costSummary30d, data.kpis?.terminalCostSummary30d)}
            />
            <LivePipelines pipelines={data.pipelines} agents={agents} />
            {(awaiting.length > 0 || queue.length > 0) && (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                        alignItems: 'start',
                        gap: 6,
                    }}
                >
                    <AwaitingYouPanel rows={awaiting} isLoading={false} total={awaitingCount} />
                    <InMotionPanel rows={queue} agents={agents} isLoading={false} />
                </Box>
            )}
            <AgentRoom agents={agents} />
        </Box>
    );
}
