import type { KeyboardEvent, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

/**
 * The filter pills on both tabs: one row that scrolls sideways instead of
 * wrapping, so four pills with counts never push the layout around at 390px.
 */
export function PillRow({ children, label }: { children: ReactNode; label: string }) {
    return (
        <Box
            role="group"
            aria-label={label}
            sx={{
                display: 'flex',
                flexWrap: 'nowrap',
                gap: 1,
                minWidth: 0,
                overflowX: 'auto',
                scrollSnapType: 'x proximity',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
                // Room for the pills' focus ring inside the scroll clip.
                py: 0.5,
                '& > *': { flexShrink: 0, whiteSpace: 'nowrap', scrollSnapAlign: 'start' },
            }}
        >
            {children}
        </Box>
    );
}

interface CardProps {
    icon: ReactNode;
    title: string;
    chip?: ReactNode;
    message: string;
    /** Item id · relative time — set in mono. */
    meta: ReactNode;
    /** Shown under the meta line in the error colour (failed deliveries), or
     *  muted for a note that is not an error (a skipped send). */
    alert?: string | null;
    alertMuted?: boolean;
    /** Fixed 40px zone on the right: a button, or a chevron for a link card. */
    action?: ReactNode;
    tone?: 'default' | 'held' | 'unread';
    onOpen?: () => void;
    'aria-label'?: string;
}

/**
 * One notification on a phone: a fixed 32px icon, a middle that is always
 * title line → message (2 lines max) → mono meta line, and a fixed 40px action
 * zone. Every card has the same three tracks, so a long message or a missing
 * item id never shifts the columns of the next card.
 */
export function NotificationCard({
    icon,
    title,
    chip,
    message,
    meta,
    alert,
    alertMuted = false,
    action,
    tone = 'default',
    onOpen,
    'aria-label': ariaLabel,
}: CardProps) {
    const clickable = onOpen !== undefined;
    return (
        <Box
            data-testid="notification-card"
            {...(clickable
                ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': ariaLabel ?? title,
                      onClick: onOpen,
                      onKeyDown: (e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onOpen();
                          }
                      },
                  }
                : {})}
            sx={{
                display: 'grid',
                gridTemplateColumns: '32px minmax(0, 1fr) 40px',
                columnGap: 3,
                alignItems: 'start',
                px: 3,
                py: 3,
                bgcolor: ATLAS_PALETTE.white,
                // State is an edge bar, not a fill: a tinted card swallowed
                // icon tiles of the same tint. Gold = held, blue = unread.
                boxShadow:
                    tone === 'held'
                        ? `inset 3px 0 0 ${ATLAS_PALETTE.gold}`
                        : tone === 'unread'
                          ? `inset 3px 0 0 ${ATLAS_PALETTE.brandBlue}`
                          : 'none',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: 1.5,
                cursor: clickable ? 'pointer' : 'default',
                '&:focus-visible': {
                    outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                    outlineOffset: 2,
                },
            }}
        >
            <Box sx={{ width: 32, height: 32 }}>{icon}</Box>
            <Box sx={{ minWidth: 0 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        minWidth: 0,
                        minHeight: 22,
                    }}
                >
                    <Typography
                        component="span"
                        sx={{
                            minWidth: 0,
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: 1.4,
                            color: ATLAS_PALETTE.slate,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {title}
                    </Typography>
                    {chip && <Box sx={{ flexShrink: 0, display: 'flex' }}>{chip}</Box>}
                </Box>
                <Typography
                    sx={{
                        mt: 0.5,
                        fontSize: 13,
                        lineHeight: 1.45,
                        color: ATLAS_PALETTE.slate70,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        overflowWrap: 'anywhere',
                    }}
                >
                    {message}
                </Typography>
                <Typography
                    component="div"
                    sx={{
                        mt: 1,
                        fontFamily: MONO,
                        fontSize: 11,
                        lineHeight: 1.4,
                        color: ATLAS_PALETTE.slate60,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {meta}
                </Typography>
                {alert && (
                    <Typography
                        sx={{
                            mt: 0.5,
                            fontFamily: MONO,
                            fontSize: 11,
                            color: alertMuted ? ATLAS_PALETTE.slate60 : ATLAS_PALETTE.error,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {alert}
                    </Typography>
                )}
            </Box>
            <Box sx={{ width: 40, display: 'flex', justifyContent: 'center', mt: -1 }}>
                {action}
            </Box>
        </Box>
    );
}
