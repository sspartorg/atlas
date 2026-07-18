import Box from '@mui/material/Box';
import type { IssuePriority } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const PRIORITY_CONFIG: Record<IssuePriority, { label: string; bg: string; color: string }> = {
    low: { label: 'Low', bg: 'rgba(46,46,46,.06)', color: ATLAS_PALETTE.slate60 },
    normal: { label: 'Normal', bg: 'rgba(0,122,201,.10)', color: ATLAS_PALETTE.brandBlue },
    high: { label: 'High', bg: 'rgba(223,172,45,.16)', color: '#8a6310' },
    urgent: { label: 'Urgent', bg: 'rgba(199,83,47,.16)', color: ATLAS_PALETTE.orange },
};

interface Props {
    priority: IssuePriority;
    size?: 'sm' | 'md';
}

export function PriorityChip({ priority, size = 'sm' }: Props) {
    const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.normal;
    return (
        <Box
            component="span"
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                height: size === 'sm' ? 20 : 22,
                px: size === 'sm' ? '7px' : '9px',
                borderRadius: '9999px',
                background: cfg.bg,
                color: cfg.color,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: '"Inter", system-ui, sans-serif',
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                flexShrink: 0,
            }}
        >
            {cfg.label}
        </Box>
    );
}
