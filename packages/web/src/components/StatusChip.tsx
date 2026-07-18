import Box from '@mui/material/Box';
import type { IssueStatus, SubTaskStatus } from '@atlas/shared';
import { STATUS_PALETTE, DEFAULT_STATUS_PALETTE_ENTRY } from '../theme/tokens.js';

interface Props {
    status: IssueStatus | SubTaskStatus | string;
    size?: 'xs' | 'sm' | 'md';
}

export function StatusChip({ status, size = 'md' }: Props) {
    const cfg = STATUS_PALETTE[status] ?? { ...DEFAULT_STATUS_PALETTE_ENTRY, label: status };
    const height = size === 'xs' ? 16 : size === 'sm' ? 20 : 22;
    const px = size === 'xs' ? '6px' : size === 'sm' ? '7px' : '9px';
    const fontSize = size === 'xs' ? 10 : 11;
    return (
        <Box
            component="span"
            aria-label={cfg.label}
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                height,
                px,
                borderRadius: '9999px',
                background: cfg.bg,
                color: cfg.fg,
                fontSize,
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
