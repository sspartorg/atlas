import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import { useSettings } from '../../hooks/useSettings.js';
import { useAgents } from '../../hooks/useAgents.js';
import type { DashboardResponse } from '../../api/types.js';
import { GreetingBlock } from './GreetingBlock.js';
import { KpiStrip } from './KpiStrip.js';
import { AwaitingYouPanel } from './AwaitingYouPanel.js';
import { InMotionPanel } from './InMotionPanel.js';
import { TodaysPassSection } from './TodaysPassSection.js';

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
    const awaitingCount = awaiting.length;
    const projectCount = data.kpis?.projectCount ?? 0;
    const stats = data.kpis?.agentStatsByCategory;
    const todaysPass = data.kpis?.todaysPass;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <GreetingBlock ownerFirstName={ownerFirstName} awaitingCount={awaitingCount} />
            <KpiStrip
                awaitingCount={awaitingCount}
                projectCount={projectCount}
                stats={stats}
                costSummary30d={data.kpis?.costSummary30d}
                terminalCostSummary30d={data.kpis?.terminalCostSummary30d}
            />
            <Grid container spacing={6} sx={{ width: '100%', m: 0 }}>
                <Grid size={{ xs: 12, md: 6 }} sx={{ display: 'flex' }}>
                    <AwaitingYouPanel rows={awaiting} isLoading={false} />
                </Grid>
                <Grid size={{ xs: 12, md: 6 }} sx={{ display: 'flex' }}>
                    <InMotionPanel rows={queue} agents={agents} isLoading={false} />
                </Grid>
            </Grid>
            <TodaysPassSection todaysPass={todaysPass} />
        </Box>
    );
}
