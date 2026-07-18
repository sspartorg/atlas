import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { ATLAS_PALETTE, TOUCH } from '../../theme/tokens.js';
import { useSidenavCounts } from '../../hooks/useSidenavCounts.js';
import { prefetchRoute } from '../../utils/prefetchRoute.js';

interface Props {
    open: boolean;
    onClose: () => void;
}

interface MoreItem {
    key: string;
    label: string;
    icon: string;
    path: string;
    countKey?: 'notifications';
}

// Mirrors the desktop sidenav (`Sidenav.tsx` NAV_GROUPS) — every entry the
// sidenav offers must also be reachable from the mobile More sheet so phone
// users don't lose access to Analytics, Marketplace, MCP Tools, or Reminders.
// The flat list is grouped in the same Workspace → Agents → Alerts & Admin
// order as the sidenav; icons match the sidenav so the same affordance shows
// in both surfaces.
const ITEMS: MoreItem[] = [
    // Workspace (skipping Dashboard / Epics / Issues / Queue — those are
    // top-level BottomNav tabs).
    { key: 'scratch-pad', label: 'Scratch Pad', icon: 'sticky_note_2', path: '/scratch-pad' },
    { key: 'projects', label: 'Projects', icon: 'folder_open', path: '/projects' },
    { key: 'search', label: 'Search', icon: 'search', path: '/search' },
    { key: 'analytics', label: 'Analytics', icon: 'analytics', path: '/analytics' },
    { key: 'terminal', label: 'Terminal', icon: 'terminal', path: '/terminal' },
    // Agents — smart_toy mirrors the Sidenav Agents icon.
    { key: 'agents', label: 'Agents', icon: 'smart_toy', path: '/agents' },
    { key: 'marketplace', label: 'Marketplace', icon: 'storefront', path: '/agents/marketplace' },
    { key: 'mcp-tools', label: 'MCP Tools', icon: 'build', path: '/agents/mcp-tools' },
    // Alerts & Admin.
    {
        key: 'notifications',
        label: 'Notifications',
        icon: 'notifications',
        path: '/notifications',
        countKey: 'notifications',
    },
    { key: 'reminders', label: 'Reminders', icon: 'alarm', path: '/reminders' },
    { key: 'guardrails', label: 'Guard-rails', icon: 'shield', path: '/guardrails' },
    { key: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
];

export function MoreSheet({ open, onClose }: Props) {
    const navigate = useNavigate();
    const counts = useSidenavCounts();

    const go = (path: string) => {
        onClose();
        navigate(path);
    };

    return (
        <Drawer
            anchor="bottom"
            open={open}
            onClose={onClose}
            PaperProps={{
                sx: {
                    borderTopLeftRadius: 16,
                    borderTopRightRadius: 16,
                    paddingBottom: 'env(safe-area-inset-bottom)',
                    background: ATLAS_PALETTE.white,
                },
            }}
        >
            <Box sx={{ pt: 2, pb: 4 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 4,
                        borderRadius: 2,
                        background: ATLAS_PALETTE.slate12,
                        mx: 'auto',
                        mb: 3,
                    }}
                />
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        pl: 5,
                        pr: 2,
                        pb: 2,
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        More
                    </Typography>
                    <IconButton
                        aria-label="Close"
                        onClick={onClose}
                        sx={{ color: ATLAS_PALETTE.slate60 }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 22 }}
                        >
                            close
                        </Box>
                    </IconButton>
                </Box>
                {ITEMS.map((item) => {
                    const count = item.countKey ? counts[item.countKey] : 0;
                    return (
                        <Box
                            key={item.key}
                            onClick={() => go(item.path)}
                            onPointerEnter={() => prefetchRoute(item.key)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                px: 5,
                                minHeight: TOUCH.rowMin,
                                cursor: 'pointer',
                                transition: 'background 150ms ease',
                                '&:hover': { background: ATLAS_PALETTE.slate06 },
                                '&:active': { background: ATLAS_PALETTE.slate08 },
                            }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{
                                    fontSize: 24,
                                    color: ATLAS_PALETTE.slate60,
                                    width: 24,
                                }}
                            >
                                {item.icon}
                            </Box>
                            <Typography
                                sx={{
                                    flex: 1,
                                    fontSize: 15,
                                    fontWeight: 500,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                {item.label}
                            </Typography>
                            {item.countKey && count > 0 && (
                                <Box
                                    sx={{
                                        minWidth: 20,
                                        height: 20,
                                        px: 1.5,
                                        borderRadius: '9999px',
                                        background: ATLAS_PALETTE.error,
                                        color: ATLAS_PALETTE.white,
                                        fontSize: 11,
                                        fontWeight: 600,
                                        fontFamily: '"JetBrains Mono", monospace',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    {count}
                                </Box>
                            )}
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 20, color: ATLAS_PALETTE.slate40 }}
                            >
                                chevron_right
                            </Box>
                        </Box>
                    );
                })}

                <Box
                    sx={{
                        mt: 3,
                        pt: 3,
                        px: 5,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                            textAlign: 'center',
                        }}
                    >
                        Developed by{' '}
                        <Box
                            component="button"
                            type="button"
                            onClick={() => go('/settings?tab=help')}
                            sx={{
                                color: ATLAS_PALETTE.brandBlue,
                                textDecoration: 'none',
                                fontWeight: 500,
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                font: 'inherit',
                                cursor: 'pointer',
                                '&:hover': { textDecoration: 'underline' },
                            }}
                        >
                            sspart
                        </Box>
                    </Typography>
                </Box>
            </Box>
        </Drawer>
    );
}
