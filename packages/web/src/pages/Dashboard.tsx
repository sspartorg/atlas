import Box from '@mui/material/Box';
import { useSettings } from '../hooks/useSettings.js';
import { useDashboard } from '../hooks/useDashboard.js';
import { DashboardEmptyState } from './dashboard/DashboardEmptyState.js';
import { DashboardPopulated } from './dashboard/DashboardPopulated.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { BrandedFallback } from '../components/BrandedFallback.js';

export function Dashboard() {
    useSetPageTitle('Atlas', 'AI Agent Orchestration');
    const { data: settings } = useSettings();
    const { data, isPending } = useDashboard();

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
        return <DashboardEmptyState ownerFirstName={ownerFirstName} />;
    }

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: { xs: 6, md: 12 } }}>
            <DashboardPopulated data={data} />
        </Box>
    );
}
