import Box from '@mui/material/Box';
import type { CloneStatus } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../theme/tokens.js';

// A repo's clone state is its OWN status domain — deliberately not routed
// through `StatusChip`/`STATUS_PALETTE`, whose `ready` means "a Task is ready
// to be worked". Same word, unrelated machine: a cloned repo would inherit the
// Task-ready label and styling, and `cloning` / `pending` would fall through to
// `DEFAULT_STATUS_PALETTE_ENTRY`.
//
// Uses the functional status tokens rather than the brand slots the old inline
// map reached for: in Mercury every brand hue collapses to the same accent, so
// `green` and `brandBlue` are both #4F46E5 and `ready` was indistinguishable
// from `cloning`.
const CLONE_STATUS_CONFIG: Record<CloneStatus, { label: string; bg: string; color: string }> = {
    ready: { label: 'Ready', bg: 'rgba(70,165,106,.16)', color: ATLAS_PALETTE.success },
    cloning: { label: 'Cloning', bg: 'rgba(79,70,229,.12)', color: ATLAS_PALETTE.info },
    pending: { label: 'Pending', bg: ATLAS_PALETTE.slate06, color: ATLAS_PALETTE.slate60 },
    error: { label: 'Error', bg: 'rgba(179,58,48,.16)', color: ATLAS_PALETTE.error },
};

interface Props {
    status: CloneStatus;
    size?: 'sm' | 'md';
}

export function CloneStatusChip({ status, size = 'sm' }: Props) {
    const cfg = CLONE_STATUS_CONFIG[status] ?? CLONE_STATUS_CONFIG.pending;
    return (
        <Box
            component="span"
            aria-label={cfg.label}
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
                fontFamily: TYPOGRAPHY.fontFamily,
                letterSpacing: '0.01em',
                whiteSpace: 'nowrap',
                flexShrink: 0,
            }}
        >
            {cfg.label}
        </Box>
    );
}
