import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { IMissingHandoffTarget } from '../../hooks/useMarketplacePairing.js';

interface Props {
    /** Number of currently-selected catalog agents. */
    count: number;
    /** True while a bulk install is in flight (disables the actions). */
    busy: boolean;
    onClear: () => void;
    onSelectAll: () => void;
    onAdd: () => void;
    /** Handoff targets of the selection that are neither installed nor selected. */
    missingTargets?: IMissingHandoffTarget[];
    onSelectTarget?: (id: string) => void;
}

/**
 * Sticky action bar for bulk-installing marketplace agents. Renders nothing
 * until at least one agent is selected, then floats at the bottom of the
 * marketplace with the count + Select all / Clear / Add selected actions.
 */
export function BulkInstallBar({
    count,
    busy,
    onClear,
    onSelectAll,
    onAdd,
    missingTargets = [],
    onSelectTarget,
}: Props) {
    if (count === 0) return null;

    const ghostButton = {
        textTransform: 'none' as const,
        fontWeight: 500,
        color: ATLAS_PALETTE.white,
        '&:hover': { bgcolor: 'rgba(255,255,255,0.12)' },
    };

    return (
        <Box
            sx={{
                position: 'sticky',
                bottom: 16,
                zIndex: 10,
                mt: 4,
                mx: 'auto',
                maxWidth: 640,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1.5,
                px: 3,
                py: 1.5,
                borderRadius: 2,
                bgcolor: ATLAS_PALETTE.slate,
                color: ATLAS_PALETTE.white,
                boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
            }}
        >
            <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                {count} selected
            </Typography>
            <Button size="small" onClick={onSelectAll} disabled={busy} sx={ghostButton}>
                Select all
            </Button>
            <Button size="small" onClick={onClear} disabled={busy} sx={ghostButton}>
                Clear
            </Button>
            <Button
                size="small"
                variant="contained"
                onClick={onAdd}
                disabled={busy}
                startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
                sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    bgcolor: ATLAS_PALETTE.green,
                    boxShadow: 'none',
                    '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                }}
            >
                {busy ? 'Adding…' : 'Add selected'}
            </Button>
            {missingTargets.map((t) => (
                <Box
                    key={t.id}
                    sx={{ flexBasis: '100%', display: 'flex', alignItems: 'center', gap: 1.5 }}
                >
                    <Typography sx={{ fontSize: 12, flex: 1, color: ATLAS_PALETTE.white }}>
                        {t.sourceNames.join(', ')} hands off to {t.name}, which isn&apos;t installed.
                    </Typography>
                    <Button
                        size="small"
                        onClick={() => onSelectTarget?.(t.id)}
                        disabled={busy}
                        sx={ghostButton}
                    >
                        Add {t.name} too
                    </Button>
                </Box>
            ))}
        </Box>
    );
}
