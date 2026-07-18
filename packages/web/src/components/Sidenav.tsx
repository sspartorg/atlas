import { useNavigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useSidenavCounts } from '../hooks/useSidenavCounts.js';
import { useSettings } from '../hooks/useSettings.js';
import { prefetchRoute } from '../utils/prefetchRoute.js';
import type { SidenavCounts } from '../api/types.js';
import { InitialAvatar } from './InitialAvatar.js';
import { AtlasLogo } from './AtlasLogo.js';

interface NavItem {
    key: string;
    icon: string;
    label: string;
    path: string;
    countKey?: keyof SidenavCounts;
    unreadKey?: keyof SidenavCounts;
}

interface NavGroup {
    group: string;
    items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        group: 'Workspace',
        items: [
            { key: 'dashboard', icon: 'dashboard', label: 'Dashboard', path: '/' },
            {
                key: 'scratch-pad',
                icon: 'sticky_note_2',
                label: 'Scratch Pad',
                path: '/scratch-pad',
            },
            {
                key: 'projects',
                icon: 'folder_open',
                label: 'Projects',
                path: '/projects',
                countKey: 'projects',
            },
            { key: 'epics', icon: 'flag', label: 'Epics', path: '/epics', countKey: 'epics' },
            { key: 'issues', icon: 'layers', label: 'Issues', path: '/issues', countKey: 'issues' },
            { key: 'queue', icon: 'schedule', label: 'Queue', path: '/queue', countKey: 'queue' },
            { key: 'terminal', icon: 'terminal', label: 'Terminal', path: '/terminal' },
            { key: 'search', icon: 'search', label: 'Search', path: '/search' },
            { key: 'analytics', icon: 'analytics', label: 'Analytics', path: '/analytics' },
        ],
    },
    {
        group: 'Agents',
        items: [
            {
                key: 'agents',
                icon: 'smart_toy',
                label: 'Agents',
                path: '/agents',
                countKey: 'agents',
            },
            {
                key: 'marketplace',
                icon: 'storefront',
                label: 'Marketplace',
                path: '/agents/marketplace',
            },
            {
                key: 'mcp-tools',
                icon: 'build',
                label: 'MCP Tools',
                path: '/agents/mcp-tools',
            },
        ],
    },
    {
        group: 'Alerts & Admin',
        items: [
            {
                key: 'notifications',
                icon: 'notifications',
                label: 'Notifications',
                path: '/notifications',
                countKey: 'notifications',
                unreadKey: 'notifications',
            },
            { key: 'reminders', icon: 'alarm', label: 'Reminders', path: '/reminders' },
            { key: 'guardrails', icon: 'shield', label: 'Guard-rails', path: '/guardrails' },
            { key: 'settings', icon: 'settings', label: 'Settings', path: '/settings' },
        ],
    },
];

interface SidenavProps {
    onNavigate?: () => void;
}

export function Sidenav({ onNavigate }: SidenavProps = {}) {
    const navigate = useNavigate();
    const location = useLocation();
    const counts = useSidenavCounts();
    const { data: settings } = useSettings();

    const ownerName = settings?.owner_name ?? 'Owner';

    const go = (path: string) => {
        navigate(path);
        onNavigate?.();
    };

    const activeKey = (() => {
        const path = location.pathname;
        if (path === '/') return 'dashboard';
        let bestKey: string | null = null;
        let bestLen = -1;
        for (const group of NAV_GROUPS) {
            for (const item of group.items) {
                if (item.path === '/') continue;
                const matches = path === item.path || path.startsWith(item.path + '/');
                if (matches && item.path.length > bestLen) {
                    bestKey = item.key;
                    bestLen = item.path.length;
                }
            }
        }
        return bestKey ?? 'dashboard';
    })();

    return (
        <Box
            component="aside"
            sx={{
                width: 240,
                minWidth: 240,
                height: '100vh',
                background: ATLAS_PALETTE.sideBg,
                display: 'flex',
                flexDirection: 'column',
                borderRight: `1px solid ${ATLAS_PALETTE.sideBorder}`,
                overflow: 'hidden',
                flexShrink: 0,
            }}
        >
            {/* Brand */}
            <Box
                sx={{
                    height: 56,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    px: 4,
                    borderBottom: `1px solid ${ATLAS_PALETTE.sideBorder}`,
                    flexShrink: 0,
                }}
            >
                <Box
                    sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        overflow: 'hidden',
                    }}
                >
                    <AtlasLogo size={22} />
                </Box>
                <Typography
                    sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.sideTextStrong, letterSpacing: '-0.01em' }}
                >
                    Atlas
                </Typography>
            </Box>

            {/* Nav Groups */}
            <Box sx={{ flex: 1, overflow: 'auto', py: 2 }}>
                {NAV_GROUPS.map((group) => (
                    <Box key={group.group} sx={{ px: 3, mb: 1 }}>
                        <Typography
                            sx={{
                                fontSize: 11,
                                fontWeight: 500,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.sideMuted,
                                py: 3,
                                px: 2,
                                display: 'block',
                            }}
                        >
                            {group.group}
                        </Typography>

                        {group.items.map((item) => {
                            const isActive = activeKey === item.key;
                            return (
                                <Box
                                    key={item.key}
                                    data-testid={`nav-item-${item.key}`}
                                    onClick={() => go(item.path)}
                                    onPointerEnter={() => prefetchRoute(item.key)}
                                    sx={{
                                        height: 36,
                                        display: 'flex',
                                        alignItems: 'center',
                                        px: 2,
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                        position: 'relative',
                                        color: isActive
                                            ? ATLAS_PALETTE.sideTextStrong
                                            : ATLAS_PALETTE.sideText,
                                        fontWeight: isActive ? 500 : 400,
                                        background: isActive
                                            ? ATLAS_PALETTE.sideActiveBg
                                            : 'transparent',
                                        // Mercury active-row recipe: subtle card lift on the
                                        // recessed sidebar surface instead of a colour fill.
                                        boxShadow: isActive
                                            ? `0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px ${ATLAS_PALETTE.sideBorder}`
                                            : 'none',
                                        transition: 'all 150ms ease',
                                        '&:hover': {
                                            background: isActive
                                                ? ATLAS_PALETTE.sideActiveBg
                                                : ATLAS_PALETTE.slate08,
                                            color: ATLAS_PALETTE.sideTextStrong,
                                        },
                                        mb: 0.5,
                                        overflow: 'hidden',
                                    }}
                                >
                                    {/* Active left accent bar */}
                                    {isActive && (
                                        <Box
                                            sx={{
                                                position: 'absolute',
                                                left: 0,
                                                top: 6,
                                                bottom: 6,
                                                width: 3,
                                                background: ATLAS_PALETTE.sideTextStrong,
                                                borderRadius: '0 3px 3px 0',
                                            }}
                                        />
                                    )}

                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{
                                            fontSize: 20,
                                            width: 20,
                                            lineHeight: 1,
                                            fontVariationSettings: isActive
                                                ? "'FILL' 1"
                                                : "'FILL' 0",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {item.icon}
                                    </Box>
                                    <Typography
                                        sx={{
                                            ml: 3,
                                            flex: 1,
                                            fontSize: 13,
                                            fontWeight: 'inherit',
                                            color: 'inherit',
                                        }}
                                    >
                                        {item.label}
                                    </Typography>

                                    {item.countKey !== undefined &&
                                        (() => {
                                            const count = counts[item.countKey];
                                            // Notifications: red pill when > 0, hidden when 0.
                                            if (item.unreadKey !== undefined) {
                                                if (count === 0) return null;
                                                return (
                                                    <Box
                                                        sx={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            minWidth: 18,
                                                            fontFamily:
                                                                '"JetBrains Mono", monospace',
                                                            fontSize: '0.6875rem',
                                                            fontWeight: 600,
                                                            letterSpacing: '0.02em',
                                                            color: ATLAS_PALETTE.onAccent,
                                                            background: ATLAS_PALETTE.error,
                                                            padding: '2px 8px',
                                                            borderRadius: '9999px',
                                                            fontVariantNumeric: 'tabular-nums',
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        {count}
                                                    </Box>
                                                );
                                            }
                                            // Every other row: generic mono caption, always rendered (including 0).
                                            return (
                                                <Box
                                                    sx={{
                                                        fontFamily: '"JetBrains Mono", monospace',
                                                        fontSize: '0.6875rem',
                                                        fontWeight: 400,
                                                        color: ATLAS_PALETTE.sideMuted,
                                                        textAlign: 'right',
                                                        flexShrink: 0,
                                                        ml: 2,
                                                    }}
                                                >
                                                    {count}
                                                </Box>
                                            );
                                        })()}
                                </Box>
                            );
                        })}
                    </Box>
                ))}
            </Box>

            <Typography
                sx={{
                    fontSize: 11,
                    color: ATLAS_PALETTE.sideMuted,
                    textAlign: 'center',
                    px: 4,
                    pb: 2,
                }}
            >
                Developed by{' '}
                <Box
                    component="button"
                    type="button"
                    onClick={() => go('/settings?tab=help')}
                    sx={{
                        color: ATLAS_PALETTE.sideText,
                        fontWeight: 500,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        font: 'inherit',
                        cursor: 'pointer',
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                    }}
                >
                    sspart
                </Box>
            </Typography>

            <Divider sx={{ borderColor: ATLAS_PALETTE.sideBorder }} />

            {/* Footer: Owner */}
            <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* Owner row */}
                <Box
                    onClick={() => go('/settings')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        px: 2,
                        py: 1.5,
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        '&:hover': { background: ATLAS_PALETTE.slate08 },
                    }}
                >
                    <InitialAvatar
                        name={ownerName}
                        color={settings?.accent_color || ATLAS_PALETTE.sideTextStrong}
                        size={28}
                        fontSize={13}
                        fontWeight={600}
                    />
                    <Box sx={{ flex: 1, lineHeight: 1.2, minWidth: 0 }}>
                        <Typography
                            sx={{
                                fontSize: 13,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.sideTextStrong,
                                display: 'block',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {ownerName}
                        </Typography>
                        <Typography
                            sx={{ fontSize: 11, color: ATLAS_PALETTE.sideMuted, display: 'block' }}
                        >
                            Owner
                        </Typography>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
