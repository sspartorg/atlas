import Popover from '@mui/material/Popover';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { ATLAS_PALETTE, ELEVATION } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    /** Live counter shown to the Owner so they know exactly what the
     *  reset will wipe. */
    roundCount: number;
    /** Effective cap (`agents.max_rounds`) for the current assignee — drives
     *  the "X / Y" line and the explainer copy. */
    maxRounds: number;
    /** Current assignee's display name. Falls back to "this agent" when
     *  null so the popover still reads grammatically. */
    assigneeName: string | null;
    /** Fires when Owner confirms. Parent owns the mutation + close. */
    onConfirm: () => void;
    /** When the parent's mutation is in-flight, the confirm button shows
     *  "Resetting…" and is disabled. */
    pending?: boolean | undefined;
}

/**
 * A04 — Owner-only "give this agent a fresh round budget" affordance
 * anchored on the Rounds row of `DetailsRailCard`. Wipes the
 * `(item, *)` rows from `agent_round_counts` (so the current assignee's
 * counter goes back to 0); `agents.max_rounds` itself is unchanged.
 *
 * Repeatable — Owner can reset as many times as needed. Each reset
 * writes a `rounds_reset` activity-log event server-side.
 */
export function ResetRoundsPopover({
    anchorEl,
    open,
    onClose,
    roundCount,
    maxRounds,
    assigneeName,
    onConfirm,
    pending,
}: Props) {
    const agentLabel = assigneeName ?? 'this agent';
    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            disableRestoreFocus
            slotProps={{
                paper: {
                    sx: {
                        mt: 1,
                        bgcolor: 'background.paper',
                        borderRadius: '8px',
                        boxShadow: ELEVATION.overlay,
                        minWidth: 280,
                        maxWidth: 320,
                        p: 5,
                    },
                },
            }}
        >
            <Typography
                sx={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate,
                    fontFamily: '"Inter", system-ui, sans-serif',
                    mb: 2,
                }}
            >
                Reset rounds?
            </Typography>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 3 }}>
                Currently{' '}
                <Box component="span" sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}>
                    {roundCount} / {maxRounds}
                </Box>
                . Wipes the counter to 0 so {agentLabel} gets a fresh{' '}
                <Box component="span" sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}>
                    {maxRounds}
                </Box>
                -CLI budget. The cap stays the same; you can reset again later.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 3 }}>
                <Button
                    onClick={onClose}
                    size="small"
                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    disabled={pending ?? false}
                >
                    Cancel
                </Button>
                <Button
                    onClick={onConfirm}
                    variant="contained"
                    size="small"
                    sx={{ textTransform: 'none' }}
                    disabled={pending ?? false}
                >
                    {pending ? 'Resetting…' : 'Reset rounds'}
                </Button>
            </Box>
        </Popover>
    );
}
