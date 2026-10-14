import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import { useSettings } from '../../hooks/useSettings.js';
import { useAgentSummaries } from '../../hooks/useAgents.js';
import type { DashboardResponse } from '../../api/types.js';
import { GreetingBlock } from './GreetingBlock.js';
import { FleetStrip } from './FleetStrip.js';
import { LivePipelines } from './LivePipelines.js';
import { AwaitingYouPanel } from './AwaitingYouPanel.js';
import { InMotionPanel } from './InMotionPanel.js';
import { AgentRoster } from './AgentRoster.js';
import { costTotals } from './costTotals.js';

interface IDashboardPopulatedProps {
    data: DashboardResponse;
}

export function DashboardPopulated({ data }: IDashboardPopulatedProps) {
    const { data: settings } = useSettings();
    const { data: agents = [] } = useAgentSummaries();

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

    // Beside the worklists the roster fills their height; "Show all" moves it
    // to a full-width row of its own and brings it into view.
    // noSsr: read the real value on the first render instead of rendering the
    // whole dashboard twice (client-only app, nothing to hydrate).
    const sideBySide = useMediaQuery((t: Theme) => t.breakpoints.up('lg'), { noSsr: true });
    const [rosterExpanded, setRosterExpanded] = useState(false);
    const rosterRef = useRef<HTMLDivElement>(null);
    // Scroll from the click, never from an effect: an effect also runs on
    // mount (twice under StrictMode), which jumped a fresh load to the roster.
    const toggleRoster = () => {
        setRosterExpanded((v) => !v);
        // After the click's render has committed the new layout.
        requestAnimationFrame(() =>
            rosterRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        );
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <GreetingBlock ownerFirstName={ownerFirstName} awaitingCount={awaitingCount} />
            <FleetStrip
                agents={agents.filter((a) => a.status === 'active')}
                liveCount={liveCount}
                spend={costTotals(data.kpis?.costSummary30d, data.kpis?.terminalCostSummary30d)}
            />
            <LivePipelines pipelines={data.pipelines} agents={agents} />
            <Grid container spacing={6} sx={{ width: '100%', m: 0 }}>
                <Grid
                    size={{ xs: 12, lg: rosterExpanded ? 12 : 8 }}
                    sx={{
                        display: 'flex',
                        // Full width while the roster is expanded: side by side.
                        flexDirection: { xs: 'column', lg: rosterExpanded ? 'row' : 'column' },
                        alignItems: 'stretch',
                        gap: 6,
                    }}
                >
                    <AwaitingYouPanel rows={awaiting} isLoading={false} total={awaitingCount} />
                    <InMotionPanel rows={queue} agents={agents} isLoading={false} />
                </Grid>
                <Grid
                    ref={rosterRef}
                    size={{ xs: 12, lg: rosterExpanded ? 12 : 4 }}
                    sx={{
                        display: 'flex',
                        position: 'relative',
                        // Room for a header and a few agents even when the
                        // worklists beside it are short.
                        minHeight: { lg: rosterExpanded ? 0 : 320 },
                        scrollMarginTop: 16,
                    }}
                >
                    <AgentRoster
                        agents={agents}
                        fill={sideBySide && !rosterExpanded}
                        expanded={rosterExpanded}
                        onToggleExpanded={toggleRoster}
                    />
                </Grid>
            </Grid>
        </Box>
    );
}
