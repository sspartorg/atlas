import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, useIsFetching } from '@tanstack/react-query';
import { useTabParam } from '../hooks/useTabParam.js';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import TuneRounded from '@mui/icons-material/TuneRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import { useSettings } from '../hooks/useSettings.js';
import { useNotifications, useMarkAllRead } from '../hooks/useNotifications.js';
import { useAgents } from '../hooks/useAgents.js';
import { useToast } from '../hooks/useToast.js';
import { useNow } from '../hooks/useNow.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { NotificationLogTab } from './notifications/NotificationLogTab.js';
import { InAppFeedTab } from './notifications/InAppFeedTab.js';
import { relativeShort } from './notifications/timeFormat.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { RefreshButton } from '../components/index.js';

const MONO = '"JetBrains Mono", monospace';
const TAB_KEYS = ['external', 'in-app'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function Notifications() {
    useSetPageTitle('Notifications');
    const navigate = useNavigate();
    const [tab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'external');

    const { data: settings } = useSettings();
    const markAllRead = useMarkAllRead();
    const toast = useToast();

    // For the "last delivery" stamp at the top — peek at the most-recent sent row.
    const { data: recentSent = [] } = useNotifications({ external_status: 'sent', limit: 1 });
    // Lifted from per-tab containers — both tabs read from the same 200-row set.
    const { data: allRows = [] } = useNotifications({ limit: 200 });
    // InAppFeedTab needs the agent dictionary to resolve avatars; lift it too.
    const { data: agents = [] } = useAgents();
    const lastDeliveryAt = recentSent[0]?.created_at ?? null;

    const queryClient = useQueryClient();
    const notifFetching = useIsFetching({
        predicate: (q) => {
            const k = q.queryKey;
            if (!Array.isArray(k)) return false;
            return k[0] === 'notifications' || k[0] === 'agents' || k[0] === 'settings';
        },
    });
    const handleRefresh = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
        void queryClient.invalidateQueries({ queryKey: ['agents'] });
        void queryClient.invalidateQueries({ queryKey: ['settings'] });
    }, [queryClient]);
    // useNow ticks every 60s so the relative label ages forward even when no new
    // delivery arrives (otherwise "5h ago" would stay "5h ago" until the next send).
    useNow();
    const lastDeliveryLabel = lastDeliveryAt ? `${relativeShort(lastDeliveryAt)} ago` : 'never';

    function handleMarkAllRead() {
        markAllRead.mutate(undefined, {
            onSuccess: (r) =>
                toast.show({
                    message: `Marked ${r.changed} notification${r.changed === 1 ? '' : 's'} read`,
                }),
        });
    }

    const externalConnected = Boolean(
        settings?.external_notification_token && settings?.external_notification_chat_id,
    );
    const endpointLabel = settings?.external_notification_endpoint_label ?? null;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Header */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    mb: 5,
                    gap: 4,
                    flexWrap: 'wrap',
                }}
            >
                <Typography
                    variant="h1"
                    sx={{
                        fontSize: '2.25rem',
                        fontWeight: 700,
                        lineHeight: 1.2,
                        letterSpacing: '-0.01em',
                        color: ATLAS_PALETTE.slate,
                    }}
                >
                    Notifications
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <RefreshButton
                        onRefresh={handleRefresh}
                        isFetching={notifFetching > 0}
                        tooltipLabel="Refresh notifications"
                    />
                    <Button
                        variant="outlined"
                        startIcon={<TuneRounded sx={{ fontSize: 16 }} />}
                        onClick={() => navigate('/settings?tab=notifications')}
                        sx={{ textTransform: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                        Notification Settings
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<DoneAllRounded sx={{ fontSize: 16 }} />}
                        onClick={handleMarkAllRead}
                        disabled={markAllRead.isPending}
                        sx={{ textTransform: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}
                    >
                        Mark All Read
                    </Button>
                </Box>
            </Box>

            {/* Subtitle: metadata line (status + connection info) */}
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 4, lineHeight: 1.6 }}>
                External notifications are the outbound channel
                {externalConnected && endpointLabel ? (
                    <>
                        {' · connected to '}
                        <Box
                            component="span"
                            sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}
                        >
                            {endpointLabel}
                        </Box>
                        {' · last delivery '}
                        <Box component="span" sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600 }}>
                            {lastDeliveryLabel}
                        </Box>
                    </>
                ) : (
                    <>
                        {' · '}
                        <Box
                            component="span"
                            sx={{ color: ATLAS_PALETTE.error, fontWeight: 700 }}
                        >
                            not connected
                        </Box>
                        {' — visit '}
                        <Box
                            component="a"
                            onClick={(e) => {
                                e.preventDefault();
                                navigate('/settings?tab=notifications');
                            }}
                            sx={{
                                color: ATLAS_PALETTE.brandBlue,
                                cursor: 'pointer',
                                fontWeight: 600,
                                textDecoration: 'none',
                                '&:hover': { textDecoration: 'underline' },
                            }}
                        >
                            Settings → Notifications
                        </Box>
                        {' to wire your channel.'}
                    </>
                )}
            </Typography>

            {/* Tab bar */}
            <Box sx={{ borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`, mb: 4 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v: TabKey) => setTab(v)}
                    variant="scrollable"
                    scrollButtons={false}
                    sx={{
                        minHeight: 44,
                        '& .MuiTabs-indicator': {
                            backgroundColor: ATLAS_PALETTE.slate,
                            height: 2,
                        },
                        '& .MuiTab-root': {
                            minHeight: 44,
                            fontSize: 13,
                            textTransform: 'none',
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate60,
                            gap: 1.5,
                            '&.Mui-selected': { color: ATLAS_PALETTE.slate, fontWeight: 600 },
                        },
                        '& .MuiTab-iconWrapper': { mb: '0 !important', mr: 1 },
                    }}
                >
                    <Tab
                        value="external"
                        iconPosition="start"
                        icon={<SendRounded sx={{ fontSize: 16 }} />}
                        label="Notification Log"
                    />
                    <Tab
                        value="in-app"
                        iconPosition="start"
                        icon={<InboxOutlined sx={{ fontSize: 16 }} />}
                        label="In-App Feed"
                    />
                </Tabs>
            </Box>

            {tab === 'external' && (
                <NotificationLogTab settings={settings} allRows={allRows} />
            )}
            {tab === 'in-app' && <InAppFeedTab allRows={allRows} agents={agents} />}
        </Box>
    );
}
