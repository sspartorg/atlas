import Box from '@mui/material/Box';
import {
    STATUS_PALETTE,
    DEFAULT_STATUS_PALETTE_ENTRY,
} from '../../theme/tokens.js';

interface IStatusPillProps {
    status: string;
}

function prettify(status: string): string {
    return status
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export function StatusPill({ status }: IStatusPillProps) {
    // Single source of truth: STATUS_PALETTE. Unknown statuses get the slate
    // fallback with a humanized label so a stray value still renders something.
    const entry = STATUS_PALETTE[status] ?? {
        ...DEFAULT_STATUS_PALETTE_ENTRY,
        label: prettify(status),
    };

    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                bgcolor: entry.bg,
                color: entry.fg,
                borderRadius: '9999px',
                padding: '2px 10px',
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                flexShrink: 0,
            }}
        >
            {entry.label || prettify(status)}
        </Box>
    );
}

