import { Suspense } from 'react';
import Box from '@mui/material/Box';
import { useSettings } from '../hooks/useSettings.js';
import { useDashboard } from '../hooks/useDashboard.js';
import { DashboardPopulated } from './dashboard/DashboardPopulated.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { BrandedFallback } from '../components/BrandedFallback.js';
import { useAgents } from '../hooks/useAgents.js';
import { lazyNamed } from '../utils/lazyNamed.js';

// Only a workspace with no projects sees the empty state; everyone else
// shouldn't download it (or the five small modules behind it).
const DashboardEmptyState = lazyNamed(
    () => import('./dashboard/DashboardEmptyState.js'),
    'DashboardEmptyState'
);

export function Dashboard() {
    useSetPageTitle('Atlas', 'AI Agent Orchestration');
    const { data: settings } = useSettings();
    const { data, isPending } = useDashboard();
    // Started here, alongside the dashboard query, rather than by the panels
    // that render once it lands: one round trip instead of two in a row.
    useAgents();

    if (isPending || data === undefined) {
        return (
            <Box sx={{ minHeight: '60vh', display: 'flex' }}>
                <BrandedFallback />
            </Box>
        );
    }

    if ((data.kpis?.projectCount ?? 0) === 0) {
        const fullName = settings?.owner_name?.trim() ?? '';
        const ownerFirstName = fullName.split(/\s+/)[0] || 'there';
        return (
            <Suspense fallback={<BrandedFallback />}>
                <DashboardEmptyState ownerFirstName={ownerFirstName} />
            </Suspense>
        );
    }

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
            <DashboardPopulated data={data} />
        </Box>
    );
}
