import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useNavigate } from 'react-router-dom';
import type { IAgent, IAgentRun, RunStatus } from '@atlas/shared';
import { useToast } from '../../hooks/useToast.js';
import { useAiEnabled } from '../../hooks/useAiEnabled.js';
import { useDeleteRun } from '../../hooks/useDeleteRun.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { SimulatedBadge } from '../../components/index.js';
import { isSimulatedRun } from '../../utils/isSimulatedRun.js';
import { ATLAS_PALETTE, TYPOGRAPHY, TOUCH } from '../../theme/tokens.js';
import { runStatusPaletteEntry } from '../../theme/runStatusPalette.js';
import { relativeTime } from './agentViewModel.js';
import { formatCostUsd } from '../../utils/formatCost.js';

interface Props {
    agent: IAgent;
    runs: IAgentRun[];
}

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
    queued: 'Queued',
    in_progress: 'In progress',
    completed: 'Completed',
    error: 'Error',
    cancelled: 'Cancelled',
    setup_failed: 'Setup failed',
};

// A05 — agent_runs.item_id is nullable; the API projector turns nulls
// into empty strings so the typed shape stays string-only, then we
// distinguish freedom-mode (`requires_item=false` scheduled run with
// no project either) from project-scope (Theme 09b ai-readiness) from
// item-attached on the way to the row renderer.
type RunScope =
    | { kind: 'item'; text: string }
    | { kind: 'freedom' }
    | { kind: 'project' };

function runScope(run: IAgentRun): RunScope {
    if (run.issue_id && run.issue_id !== '') {
        return { kind: 'item', text: `${run.issue_type}/${run.issue_id}` };
    }
    if (run.project_id) return { kind: 'project' };
    return { kind: 'freedom' };
}

export function RunsTabContent({ agent, runs }: Props) {
    const toast = useToast();
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const { aiEnabled } = useAiEnabled();
    // P9 — pendingDelete drives the confirm dialog. Holding the whole
    // run object (not just the id) keeps the dialog copy specific —
    // showing the item ref the user is about to unstick rather than a
    // generic "Delete this run?" prompt.
    const [pendingDelete, setPendingDelete] = useState<IAgentRun | null>(null);
    const deleteRun = useDeleteRun(agent.id);

    if (runs.length === 0) {
        return (
            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 3,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 3,
                    }}
                >
                    Recent runs
                </Typography>
                <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Box
                        sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '12px',
                            background: ATLAS_PALETTE.slate08,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mb: 2.5,
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 28, color: ATLAS_PALETTE.slate40 }}
                        >
                            history
                        </Box>
                    </Box>
                    <Typography
                        sx={{ fontSize: 16, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 1 }}
                    >
                        No runs yet
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 13,
                            color: ATLAS_PALETTE.slate60,
                            maxWidth: 460,
                            mx: 'auto',
                            lineHeight: 1.6,
                            mb: 3,
                        }}
                    >
                        This agent is installed and configured, but hasn&apos;t been triggered. The
                        next scheduled pass will pick up any Epics in &quot;Ready for{' '}
                        {agent.name.split(' ')[0]}
                        &quot;.
                    </Typography>
                    <Button
                        variant="contained"
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18 }}
                            >
                                play_arrow
                            </Box>
                        }
                        onClick={() =>
                            toast.show({ message: 'Run now: pick an Epic or Story from the Queue' })
                        }
                        sx={{
                            textTransform: 'none',
                            bgcolor: ATLAS_PALETTE.green,
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                        }}
                    >
                        Run now
                    </Button>
                </Box>
            </Box>
        );
    }

    const sorted = [...runs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Shared row affordances + interaction, kept identical between the mobile
    // card and the desktop table so behaviour (open-on-tap, delete, keyboard)
    // doesn't drift between layouts.
    const rowInteraction = {
        cursor: 'pointer',
        borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
        transition: 'background 120ms ease',
        '&:last-of-type': { borderBottom: 'none' },
        '&:hover': { background: ATLAS_PALETTE.slate06 },
        '&:focus-visible': {
            outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
            outlineOffset: '-2px',
        },
    } as const;

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 3,
            }}
        >
            <Typography
                sx={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                    mb: 2,
                }}
            >
                Recent runs ({sorted.length})
            </Typography>
            {sorted.slice(0, 50).map((run) => {
                const cfg = runStatusPaletteEntry(run.status);
                const scope = runScope(run);
                const open = () => navigate(`/agents/${agent.id}/runs/${run.id}`);
                const onKeyDown = (e: { key: string; preventDefault: () => void }) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open();
                    }
                };
                const costColor =
                    run.total_cost_usd != null ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate30;

                const statusNode = (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                        {/* Single mid-tone dot — recognisable on both light and
                            dark row surfaces without leaning either side. */}
                        <Box
                            sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '9999px',
                                background: cfg.dot,
                                flexShrink: 0,
                            }}
                        />
                        <Typography
                            sx={{
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {RUN_STATUS_LABEL[run.status]}
                        </Typography>
                    </Box>
                );

                const itemNode = (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                        {scope.kind === 'item' ? (
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    color: ATLAS_PALETTE.slate70,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    minWidth: 0,
                                }}
                            >
                                {scope.text}
                            </Typography>
                        ) : (
                            // A05 — schedule-driven runs with no item attached
                            // (freedom mode) or project scope (Theme 09b) get a
                            // small chip so they're visually distinct from
                            // item-attached runs when scanning the list.
                            <Box
                                sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: '999px',
                                    background: ATLAS_PALETTE.slate08,
                                    color: ATLAS_PALETTE.slate70,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    letterSpacing: '0.02em',
                                    flexShrink: 0,
                                }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 12 }}
                                >
                                    schedule
                                </Box>
                                {scope.kind === 'freedom' ? 'Freedom run' : 'Project scope'}
                            </Box>
                        )}
                        {isSimulatedRun(run, aiEnabled) && <SimulatedBadge size="sm" />}
                    </Box>
                );

                const deleteButton = (
                    <Tooltip title="Delete run">
                        <IconButton
                            size="small"
                            aria-label="Delete run"
                            // Stop the row-level navigate on click; the delete
                            // affordance is meant to *replace* open-the-run for
                            // this one tap.
                            onClick={(e) => {
                                e.stopPropagation();
                                setPendingDelete(run);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            sx={{
                                p: 0.5,
                                color: ATLAS_PALETTE.slate40,
                                // Comfortable 40px touch target on mobile
                                // (TOUCH.iconButton) with a faint chip fill so
                                // the destructive action reads as a distinct
                                // button rather than a near-twin of the
                                // open-row chevron beside it. Reverts to a
                                // compact transparent icon in the desktop grid.
                                minWidth: { xs: TOUCH.iconButton, md: 0 },
                                minHeight: { xs: TOUCH.iconButton, md: 0 },
                                bgcolor: { xs: ATLAS_PALETTE.slate06, md: 'transparent' },
                                '&:hover': { color: ATLAS_PALETTE.error },
                            }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18 }}
                            >
                                delete
                            </Box>
                        </IconButton>
                    </Tooltip>
                );

                const chevron = (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.slate40, flexShrink: 0 }}
                    >
                        chevron_right
                    </Box>
                );

                // Mobile: a stacked list-item card. Status + actions on the top
                // line, the item ref on its own line, then a single muted meta
                // line (time · cost · id) so the values read as one group rather
                // than three columns stranded across the row width.
                if (isMobile) {
                    return (
                        <Box
                            key={run.id}
                            role="button"
                            tabIndex={0}
                            onClick={open}
                            onKeyDown={onKeyDown}
                            sx={{
                                ...rowInteraction,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 0.75,
                                py: 1.75,
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 1,
                                }}
                            >
                                {statusNode}
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        // Clear separation so the destructive
                                        // delete target isn't crowding the
                                        // open-row chevron under a thumb.
                                        gap: 1.5,
                                        flexShrink: 0,
                                    }}
                                >
                                    {deleteButton}
                                    {chevron}
                                </Box>
                            </Box>
                            {itemNode}
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: 0.75,
                                    fontSize: 11.5,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                <Box component="span">{relativeTime(run.created_at)}</Box>
                                <Box component="span" sx={{ color: ATLAS_PALETTE.slate30 }}>
                                    ·
                                </Box>
                                <Box
                                    component="span"
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        color:
                                            run.total_cost_usd != null
                                                ? ATLAS_PALETTE.slate70
                                                : ATLAS_PALETTE.slate30,
                                    }}
                                >
                                    {formatCostUsd(run.total_cost_usd)}
                                </Box>
                                <Box component="span" sx={{ color: ATLAS_PALETTE.slate30 }}>
                                    ·
                                </Box>
                                <Box
                                    component="span"
                                    sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}
                                >
                                    {run.id.slice(0, 8)}
                                </Box>
                            </Box>
                        </Box>
                    );
                }

                // Desktop: dense single-row table.
                return (
                    <Box
                        key={run.id}
                        role="button"
                        tabIndex={0}
                        onClick={open}
                        onKeyDown={onKeyDown}
                        sx={{
                            ...rowInteraction,
                            display: 'grid',
                            gridTemplateColumns: '110px 1fr 120px 80px 120px 32px 24px',
                            alignItems: 'center',
                            columnGap: 2,
                            py: 1.5,
                            borderRadius: '6px',
                        }}
                    >
                        {statusNode}
                        {itemNode}
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            {relativeTime(run.created_at)}
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                color: costColor,
                            }}
                        >
                            {formatCostUsd(run.total_cost_usd)}
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate60,
                                textAlign: 'right',
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                            }}
                        >
                            {run.id.slice(0, 8)}
                        </Typography>
                        {deleteButton}
                        {chevron}
                    </Box>
                );
            })}
            <Dialog
                open={pendingDelete !== null}
                onClose={deleteRun.isPending ? undefined : () => setPendingDelete(null)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle sx={{ fontSize: 16, fontWeight: 700, color: ATLAS_PALETTE.slate }}>
                    Delete run?
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, mb: 1 }}>
                        This will reset the item back to{' '}
                        <Box component="strong" sx={{ color: ATLAS_PALETTE.slate }}>
                            ready
                        </Box>{' '}
                        and clear the assignee so the next dispatcher tick can pick it up
                        again. Any reviewer child run is removed too.
                    </Typography>
                    {pendingDelete?.issue_id ? (
                        <Typography
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate60,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                            }}
                        >
                            {pendingDelete.issue_type}/{pendingDelete.issue_id}
                        </Typography>
                    ) : null}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button
                        onClick={() => setPendingDelete(null)}
                        disabled={deleteRun.isPending}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        disabled={deleteRun.isPending}
                        onClick={() => {
                            if (!pendingDelete) return;
                            const runId = pendingDelete.id;
                            deleteRun.mutate(runId, {
                                onSuccess: () => {
                                    setPendingDelete(null);
                                    toast.show({ message: 'Run deleted. Item reset to ready.' });
                                },
                                onError: (err) => {
                                    toast.show({
                                        message: `Delete failed: ${(err as Error).message}`,
                                    });
                                },
                            });
                        }}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {deleteRun.isPending ? 'Deleting…' : 'Delete run'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
