import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import CircularProgress from '@mui/material/CircularProgress';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import DnsRounded from '@mui/icons-material/DnsRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import HubOutlined from '@mui/icons-material/HubOutlined';
import NotificationsRounded from '@mui/icons-material/NotificationsRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import { useSettings } from '../hooks/useSettings.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { ProfileTab } from './settings/ProfileTab.js';
import { EnvironmentTab } from './settings/EnvironmentTab.js';
import { SharedSecretsTab } from './settings/SharedSecretsTab.js';
import { ModelRegistryTab } from './settings/ModelRegistryTab.js';
import { NotificationsTab } from './settings/NotificationsTab.js';
import { HelpAboutTab } from './settings/HelpAboutTab.js';
import { useSetPageTitle } from '../components/shell/index.js';

const TAB_KEYS = ['profile', 'environment', 'secrets', 'models', 'notifications', 'help'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function isTabKey(value: string | null): value is TabKey {
    return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

// Legacy `?tab=telegram` URLs from before the settings-tab rename still
// redirect to the current Notifications tab so any old bookmarks keep working.
function coerceTab(raw: string | null): TabKey {
    if (raw === 'telegram') return 'notifications';
    return isTabKey(raw) ? raw : 'profile';
}

export function Settings() {
    useSetPageTitle('Settings');
    const { data: settings, isLoading } = useSettings();
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const tab: TabKey = coerceTab(rawTab);

    function setTab(next: TabKey) {
        const params = new URLSearchParams(searchParams);
        if (next === 'profile') {
            params.delete('tab');
        } else {
            params.set('tab', next);
        }
        setSearchParams(params, { replace: true });
    }

    if (isLoading) {
        return (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.green }} />
            </Box>
        );
    }

    const ownerName = settings?.owner_name || 'Owner';

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Header */}
            <Box sx={{ mb: 5 }}>
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
                    Settings
                </Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                    {ownerName} · local app · no auth · settings live in the Atlas server directory
                </Typography>
            </Box>

            {/* Tab bar */}
            <Box sx={{ borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`, mb: 5 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v: TabKey) => setTab(v)}
                    variant="scrollable"
                    scrollButtons={false}
                    sx={{
                        minHeight: 44,
                        '& .MuiTabs-indicator': {
                            backgroundColor: ATLAS_PALETTE.brandBlue,
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
                        value="profile"
                        label="Profile"
                        iconPosition="start"
                        icon={<PersonOutlineRounded sx={{ fontSize: 18 }} />}
                    />
                    <Tab
                        value="environment"
                        label="Environment"
                        iconPosition="start"
                        icon={<DnsRounded sx={{ fontSize: 18 }} />}
                    />
                    <Tab
                        value="secrets"
                        label="Shared Secrets"
                        iconPosition="start"
                        icon={<KeyRounded sx={{ fontSize: 18 }} />}
                    />
                    <Tab
                        value="models"
                        label="Model Registry"
                        iconPosition="start"
                        icon={<HubOutlined sx={{ fontSize: 18 }} />}
                    />
                    <Tab
                        value="notifications"
                        label="Notifications"
                        iconPosition="start"
                        icon={<NotificationsRounded sx={{ fontSize: 18 }} />}
                    />
                    <Tab
                        value="help"
                        label="Help & About"
                        iconPosition="start"
                        icon={<HelpOutlineRounded sx={{ fontSize: 18 }} />}
                    />
                </Tabs>
            </Box>

            {/* Tab body */}
            {tab === 'profile' && <ProfileTab />}
            {tab === 'environment' && <EnvironmentTab />}
            {tab === 'secrets' && <SharedSecretsTab />}
            {tab === 'models' && <ModelRegistryTab />}
            {tab === 'notifications' && <NotificationsTab />}
            {tab === 'help' && <HelpAboutTab />}
        </Box>
    );
}
