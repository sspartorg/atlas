import { Suspense, useCallback } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useSearchParams } from 'react-router-dom';
import { ANALYTICS_WINDOWS, type AnalyticsWindow } from '@atlas/shared';
import { useSetPageTitle } from '../components/shell/index.js';
import { PageHeader } from '../components/PageHeader.js';
import { useTabParam } from '../hooks/useTabParam.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { lazyNamed } from '../utils/lazyNamed.js';
import { TabSkeleton, WINDOW_LABEL } from './analytics/_chrome.js';

// /analytics — four URL-synced tabs (`?tab=`) over one window (`?window=`).
// Every tab is its own chunk, and each fetches only what it shows, so the
// route stays light and a tab you never open costs nothing.
const OverviewTab = lazyNamed(() => import('./analytics/OverviewTab.js'), 'OverviewTab');
const DeliveryTab = lazyNamed(() => import('./analytics/DeliveryTab.js'), 'DeliveryTab');
const WorkflowsTab = lazyNamed(() => import('./analytics/WorkflowsTab.js'), 'WorkflowsTab');
const SpendTab = lazyNamed(() => import('./analytics/SpendTab.js'), 'SpendTab');

const TABS = [
    { key: 'overview', label: 'Overview', icon: 'monitoring' },
    { key: 'delivery', label: 'Delivery', icon: 'rocket_launch' },
    { key: 'workflows', label: 'Workflows & agents', icon: 'account_tree' },
    { key: 'spend', label: 'Spend', icon: 'token' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
const TAB_KEYS = TABS.map((t) => t.key);


// `month` is the default so the Dashboard's month spend and this page agree
// on first load.
function useWindowParam(): [AnalyticsWindow, (w: AnalyticsWindow) => void] {
    const [params, setParams] = useSearchParams();
    const raw = params.get('window');
    const window = (ANALYTICS_WINDOWS as readonly string[]).includes(raw ?? '') ? (raw as AnalyticsWindow) : 'month';
    const set = useCallback(
        (w: AnalyticsWindow) =>
            setParams(
                (prev) => {
                    const next = new URLSearchParams(prev);
                    if (w === 'month') next.delete('window');
                    else next.set('window', w);
                    return next;
                },
                { replace: true },
            ),
        [setParams],
    );
    return [window, set];
}

function viewerTz(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}

export function Analytics() {
    useSetPageTitle('Analytics');
    const [tab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'overview');
    const [window, setWindow] = useWindowParam();
    const tz = viewerTz();
    const span =
        window === 'month'
            ? new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' })
            : `the last ${WINDOW_LABEL[window]}`;

    return (
        <Box sx={{ px: { xs: 2, sm: 3, md: 8 }, py: { xs: 3, md: 4 }, minWidth: 0 }}>
            <PageHeader
                icon="analytics"
                title="Analytics"
                subtitle={`What shipped, how fast, how the workflows ran and what it cost, for ${span}. Times are in ${tz}.`}
                actions={
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={window}
                        aria-label="Window"
                        // Phones: on its own line under the title, the four windows share it evenly.
                        sx={{ width: { xs: '100%', sm: 'auto' }, '& > *': { flex: { xs: 1, sm: 'none' } } }}
                        onChange={(_e, v: AnalyticsWindow | null) => {
                            if (v !== null) setWindow(v);
                        }}
                    >
                        {ANALYTICS_WINDOWS.map((w) => (
                            <ToggleButton key={w} value={w} sx={{ textTransform: 'none', px: { xs: 1.25, sm: 2 }, whiteSpace: 'nowrap' }}>
                                {WINDOW_LABEL[w]}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                }
            />

            <Box sx={{ borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`, mb: { xs: 3, md: 4 }, mt: -3 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v: TabKey) => setTab(v)}
                    variant="scrollable"
                    scrollButtons={false}
                    aria-label="Analytics sections"
                    sx={{
                        minHeight: 42,
                        '& .MuiTabs-indicator': { backgroundColor: ATLAS_PALETTE.brandBlue, height: 2 },
                        '& .MuiTab-root': {
                            minHeight: 42,
                            textTransform: 'none',
                            fontWeight: 500,
                            fontSize: 13.5,
                            color: ATLAS_PALETTE.slate60,
                            px: { xs: 1.5, md: 2 },
                            '&.Mui-selected': { color: ATLAS_PALETTE.brandBlue, fontWeight: 600 },
                        },
                    }}
                >
                    {TABS.map((t) => (
                        <Tab
                            key={t.key}
                            value={t.key}
                            label={t.label}
                            iconPosition="start"
                            icon={
                                <Box component="span" className="material-symbols-rounded" aria-hidden="true" sx={{ fontSize: 16 }}>
                                    {t.icon}
                                </Box>
                            }
                        />
                    ))}
                </Tabs>
            </Box>

            <Suspense fallback={<TabSkeleton />}>
                {tab === 'overview' && <OverviewTab window={window} />}
                {tab === 'delivery' && <DeliveryTab window={window} />}
                {tab === 'workflows' && <WorkflowsTab window={window} />}
                {tab === 'spend' && <SpendTab window={window} />}
            </Suspense>
        </Box>
    );
}
