import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { useSettings } from '../hooks/useSettings.js';
import { useAiEnabled } from '../hooks/useAiEnabled.js';
import { useSSEStatus } from '../hooks/useSSE.js';
import { NotificationStatusPopover } from './NotificationStatusPopover.js';
import { SimulatedBadge } from './SimulatedBadge.js';
import { HeaderMascot } from './HeaderMascot.js';

interface Props {
    onShortcutsOpen?: () => void;
    onMenuClick?: () => void;
}

export function Topbar({ onShortcutsOpen, onMenuClick }: Props) {
    const { data: settings } = useSettings();
    const { aiEnabled } = useAiEnabled();
    const sseState = useSSEStatus();
    const notificationsConnected =
        !!settings?.external_notification_token_set ||
        !!settings?.external_notification_webhook_url_set;
    const [notificationsAnchor, setNotificationsAnchor] = useState<HTMLElement | null>(null);

    // Use semantic tokens (which Mercury preserves) rather than the brand-hue
    // aliases (which collapse to the accent). The Live pill is a status
    // indicator — green when connected, amber while reconnecting, muted while
    // initialising, red when known-disconnected.
    const sseDotColor =
        sseState === 'open'
            ? ATLAS_PALETTE.success
            : sseState === 'reconnecting'
              ? ATLAS_PALETTE.warning
              : ATLAS_PALETTE.slate30;
    const sseLabel =
        sseState === 'open'
            ? 'Live'
            : sseState === 'reconnecting'
              ? 'Reconnecting'
              : 'Connecting';
    const sseTooltip =
        sseState === 'open'
            ? 'Live updates connected'
            : sseState === 'reconnecting'
              ? 'Connection dropped — retrying. Data on this page may be stale.'
              : 'Establishing live updates…';

    return (
        <Box
            component="header"
            sx={{
                height: 56,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                px: { xs: 3, md: 6 },
                gap: { xs: 2, md: 3 },
                background: ATLAS_PALETTE.white,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
            }}
        >
            {/* Hamburger — opens drawer on mobile, hidden on desktop */}
            <IconButton
                onClick={() => onMenuClick?.()}
                size="small"
                aria-label="Open navigation"
                sx={{
                    display: { xs: 'inline-flex', md: 'none' },
                    color: ATLAS_PALETTE.slate,
                    ml: -1,
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 24 }}
                >
                    menu
                </Box>
            </IconButton>

            {/* Atlas brand lives in the sidebar — topbar leaves the
                breadcrumb area open for future per-page context. */}

            <Box sx={{ flex: 1 }} />

            {/* Mascot — live "is anything running" indicator. Idle bot bobs,
                working bot pumps weights. Driven by useActiveRuns() which the
                existing SSE plumbing keeps in sync. */}
            <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>
                <HeaderMascot size={36} />
            </Box>

            {/* Simulator chip — only render once settings has resolved and
                ai_enabled is explicitly false. While the settings query is
                in flight, `aiEnabled` is `undefined` and we render nothing,
                so the chip never flashes "Simulator" on first paint when AI
                is actually enabled. */}
            {aiEnabled === false && (
                <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>
                    <SimulatedBadge size="sm" />
                </Box>
            )}

            {/* Live (SSE) status pill — flips amber on reconnect so the owner
                knows queries may be stale until the stream comes back. */}
            <Tooltip title={sseTooltip} arrow>
                <Box
                    aria-label={`Live updates: ${sseLabel.toLowerCase()}`}
                    sx={{
                        height: 28,
                        px: 3,
                        borderRadius: '9999px',
                        border: `1px solid ${ATLAS_PALETTE.slate08}`,
                        background: ATLAS_PALETTE.white,
                        display: { xs: 'none', sm: 'flex' },
                        alignItems: 'center',
                        gap: 2,
                    }}
                >
                    <Box
                        sx={{
                            width: 6,
                            height: 6,
                            borderRadius: '9999px',
                            background: sseDotColor,
                            flexShrink: 0,
                        }}
                    />
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: '"Inter", system-ui, sans-serif',
                        }}
                    >
                        {sseLabel}
                    </Typography>
                </Box>
            </Tooltip>

            {/* Notifications status pill */}
            <Box
                tabIndex={0}
                role="button"
                aria-haspopup="dialog"
                aria-expanded={Boolean(notificationsAnchor)}
                onClick={(e) => setNotificationsAnchor(e.currentTarget)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setNotificationsAnchor(e.currentTarget);
                    }
                }}
                sx={{
                    height: 28,
                    px: 3,
                    borderRadius: '9999px',
                    border: `1px solid ${ATLAS_PALETTE.slate08}`,
                    background: ATLAS_PALETTE.white,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                    outline: 'none',
                    '&:hover': {
                        borderColor: ATLAS_PALETTE.slate12,
                        background: ATLAS_PALETTE.slate06,
                    },
                    '&:focus-visible': {
                        borderColor: ATLAS_PALETTE.brandBlue,
                        boxShadow: '0 0 0 3px rgba(0,122,201,.25)',
                    },
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}
                >
                    send
                </Box>
                <Box
                    sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '9999px',
                        background: notificationsConnected
                            ? ATLAS_PALETTE.success
                            : ATLAS_PALETTE.error,
                        flexShrink: 0,
                    }}
                />
                <Typography
                    sx={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        fontFamily: '"Inter", system-ui, sans-serif',
                    }}
                >
                    Notifications
                </Typography>
            </Box>
            <NotificationStatusPopover
                anchorEl={notificationsAnchor}
                open={Boolean(notificationsAnchor)}
                onClose={() => setNotificationsAnchor(null)}
                connected={notificationsConnected}
            />

            {/* Shortcuts pill — opens Keyboard Shortcuts dialog (Cmd+K spotlight removed) */}
            <Tooltip title="Ctrl + K" arrow>
                <Box
                    tabIndex={0}
                    role="button"
                    aria-haspopup="dialog"
                    onClick={() => onShortcutsOpen?.()}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onShortcutsOpen?.();
                        }
                    }}
                    sx={{
                        height: 28,
                        px: 3,
                        borderRadius: '9999px',
                        border: `1px solid ${ATLAS_PALETTE.slate08}`,
                        background: ATLAS_PALETTE.white,
                        display: { xs: 'none', md: 'flex' },
                        alignItems: 'center',
                        gap: 1.5,
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        outline: 'none',
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.slate12,
                            background: ATLAS_PALETTE.slate06,
                        },
                        '&:focus-visible': {
                            borderColor: ATLAS_PALETTE.brandBlue,
                            boxShadow: '0 0 0 3px rgba(0,122,201,.25)',
                        },
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate,
                            fontFamily: '"Inter", system-ui, sans-serif',
                        }}
                    >
                        Shortcuts
                    </Typography>
                </Box>
            </Tooltip>
        </Box>
    );
}
