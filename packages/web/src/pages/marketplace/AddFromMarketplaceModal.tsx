import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { IMarketplaceAgentSummary } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    onClose: () => void;
    agent: IMarketplaceAgentSummary;
    installing: boolean;
    onConfirm: (slug: string) => void;
    /** Set by the parent after a 409 SLUG_TAKEN — pre-fills the rename input
     *  with the server's suggested alternate slug. When null, the modal is in
     *  "default slug" state (no rename needed yet). */
    slugTaken?:
        | { conflictingId: string; suggestedId: string }
        | null;
}

export function AddFromMarketplaceModal({
    open,
    onClose,
    agent,
    installing,
    onConfirm,
    slugTaken,
}: Props) {
    const [slug, setSlug] = useState(agent.id);

    // Reset slug to default whenever the modal opens fresh, or pre-fill the
    // suggested slug when the parent flips into the slug-taken state.
    useEffect(() => {
        if (!open) return;
        setSlug(slugTaken?.suggestedId ?? agent.id);
    }, [open, agent.id, slugTaken?.suggestedId]);

    const isRename = slugTaken != null;
    const trimmed = slug.trim();
    const canSubmit = trimmed.length > 0 && !installing;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>Add {agent.name} to your agents</DialogTitle>
            <DialogContent>
                <Typography sx={{ fontSize: 13.5, color: ATLAS_PALETTE.slate70, mb: 3 }}>
                    A fresh copy of the catalog entry will be created in your local agents. You can
                    edit prompts, settings, and handoffs after install — your changes never go back
                    to the marketplace.
                </Typography>
                {isRename ? (
                    <Box
                        sx={{
                            p: 2.5,
                            borderRadius: 1.5,
                            bgcolor: ATLAS_PALETTE.warnSoft,
                            border: `1px solid ${ATLAS_PALETTE.warnFg}`,
                            mb: 3,
                        }}
                    >
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.warnFg, fontWeight: 500, mb: 2 }}>
                            <code>{slugTaken!.conflictingId}</code> is already in use locally
                            (likely a previously-installed or detached copy). Pick a different slug
                            for this fresh copy — the existing local agent stays untouched.
                        </Typography>
                        <TextField
                            fullWidth
                            size="small"
                            label="New slug"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            autoFocus
                            helperText="Kebab-case, unique across your local agents."
                        />
                    </Box>
                ) : (
                    <Box
                        sx={{
                            p: 2.5,
                            borderRadius: 1.5,
                            // Use the theme `cloud` token so the surface flips
                            // correctly between light (#F0F0F0) and dark
                            // (#1F1F1F). The previous hardcoded `#F8F9FB`
                            // stayed light in dark mode and rendered as a
                            // bright rectangle inside the modal chrome.
                            bgcolor: ATLAS_PALETTE.cloud,
                            border: `1px solid ${ATLAS_PALETTE.slate06}`,
                            fontSize: 13,
                            mb: 3,
                        }}
                    >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                local slug
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
                                {agent.id}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                catalog version
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
                                v{agent.version}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                kind
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
                                {agent.kind_slug}
                            </Typography>
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button onClick={onClose} sx={{ textTransform: 'none' }} disabled={installing}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={() => onConfirm(trimmed)}
                    disabled={!canSubmit}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {installing ? 'Adding…' : isRename ? 'Install at new slug' : 'Add to my agents'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
