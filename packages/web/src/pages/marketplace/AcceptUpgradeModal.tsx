import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Box from '@mui/material/Box';
import { useQueryClient } from '@tanstack/react-query';
import type {
    IMarketplaceUpgradeDiff,
    MarketplaceUpgradeField,
} from '@atlas/shared';
import { api } from '../../api/api.js';
import { DiffViewer, JsonDiff } from '../../components/DiffViewer.js';
import { ConfirmActionModal } from '../../components/ConfirmActionModal.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    onClose: () => void;
    agentId: string;
    marketplaceId: string;
    onAccepted: () => void;
    onDismissed: () => void;
}

const FIELDS: Array<{ key: MarketplaceUpgradeField; label: string }> = [
    { key: 'prompt_md', label: 'Prompt' },
    { key: 'handoff_prompt_md', label: 'Handoff prompt' },
    { key: 'settings_json', label: 'Settings' },
    { key: 'handoff_rules', label: 'Handoff rules' },
    { key: 'checklists', label: 'Checklists' },
];

export function AcceptUpgradeModal({
    open,
    onClose,
    agentId,
    marketplaceId,
    onAccepted,
    onDismissed,
}: Props) {
    const queryClient = useQueryClient();
    const [diff, setDiff] = useState<IMarketplaceUpgradeDiff | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<MarketplaceUpgradeField>>(new Set());
    const [submitting, setSubmitting] = useState(false);
    const [confirmAccept, setConfirmAccept] = useState(false);
    const [confirmDismiss, setConfirmDismiss] = useState(false);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setError(null);
        api.marketplace
            .diff(marketplaceId, agentId)
            .then((d) => {
                setDiff(d);
                const changed = new Set<MarketplaceUpgradeField>();
                for (const k of FIELDS.map((f) => f.key)) {
                    if (d.fields[k].changed) changed.add(k);
                }
                setSelected(changed);
            })
            .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load diff'))
            .finally(() => setLoading(false));
    }, [open, marketplaceId, agentId]);

    const toggle = (field: MarketplaceUpgradeField) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(field)) next.delete(field);
            else next.add(field);
            return next;
        });
    };

    const handleAcceptConfirmed = async () => {
        if (selected.size === 0 || submitting) return;
        setSubmitting(true);
        try {
            await api.agents.acceptUpgrade(agentId, Array.from(selected));
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
            setConfirmAccept(false);
            onAccepted();
        } finally {
            setSubmitting(false);
        }
    };

    const handleDismissConfirmed = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await api.agents.dismissUpgrade(agentId);
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
            setConfirmDismiss(false);
            onDismissed();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>Review marketplace upgrade</DialogTitle>
            <DialogContent>
                {loading && (
                    <Typography sx={{ color: ATLAS_PALETTE.slate60 }}>Loading diff…</Typography>
                )}
                {error && <Typography sx={{ color: ATLAS_PALETTE.error }}>{error}</Typography>}
                {diff && (
                    <Box>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, mb: 3 }}>
                            Marketplace v{diff.marketplace_version} · your version v
                            {diff.local_pulled_version ?? '?'}. Pick which fields to apply; your
                            current values are kept for any field you leave unchecked.
                        </Typography>
                        {FIELDS.map(({ key, label }) => {
                            const field = diff.fields[key];
                            if (!field.changed) return null;
                            const isJson =
                                key === 'settings_json' ||
                                key === 'handoff_rules' ||
                                key === 'checklists';
                            return (
                                <Box key={key} sx={{ mb: 4 }}>
                                    <FormControlLabel
                                        control={
                                            <Checkbox
                                                size="small"
                                                checked={selected.has(key)}
                                                onChange={() => toggle(key)}
                                            />
                                        }
                                        label={
                                            <Typography sx={{ fontSize: 14, fontWeight: 500 }}>
                                                Apply {label}
                                            </Typography>
                                        }
                                        sx={{ mb: 1 }}
                                    />
                                    {isJson ? (
                                        <JsonDiff
                                            from={field.from}
                                            to={field.to}
                                            maxHeight={240}
                                        />
                                    ) : (
                                        <DiffViewer
                                            from={String(field.from)}
                                            to={String(field.to)}
                                            maxHeight={280}
                                        />
                                    )}
                                </Box>
                            );
                        })}
                        {FIELDS.every((f) => !diff.fields[f.key].changed) && (
                            <Typography sx={{ color: ATLAS_PALETTE.slate60, fontSize: 13 }}>
                                The catalog version is identical to your local agent. You can dismiss
                                to clear the upgrade indicator.
                            </Typography>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
                <Button onClick={onClose} sx={{ textTransform: 'none' }} disabled={submitting}>
                    Cancel
                </Button>
                <Button
                    onClick={() => setConfirmDismiss(true)}
                    sx={{ textTransform: 'none' }}
                    disabled={submitting}
                >
                    Dismiss upgrade
                </Button>
                <Button
                    variant="contained"
                    onClick={() => setConfirmAccept(true)}
                    disabled={submitting || selected.size === 0}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {submitting ? 'Applying…' : `Accept selected (${selected.size})`}
                </Button>
            </DialogActions>
            <ConfirmActionModal
                open={confirmAccept}
                title={`Apply ${selected.size} field${selected.size === 1 ? '' : 's'} from the catalog?`}
                body={
                    `The marketplace's v${diff?.marketplace_version ?? '?'} content for the selected ` +
                    `field${selected.size === 1 ? '' : 's'} (${Array.from(selected).join(', ')}) ` +
                    `will overwrite your local agent's values. Fields you left unchecked stay as you have them now.\n\n` +
                    `This can't be undone automatically, but the prior prompt version is kept in the agent's ` +
                    `prompt-version history if you need to revert.`
                }
                confirmLabel="Apply selected"
                tone="primary"
                busy={submitting}
                onConfirm={handleAcceptConfirmed}
                onCancel={() => setConfirmAccept(false)}
            />
            <ConfirmActionModal
                open={confirmDismiss}
                title="Dismiss this upgrade?"
                body={
                    `Your local agent stays exactly as it is now. The upgrade indicator will go away, ` +
                    `and you'll only see the banner again if the marketplace catalog moves to a newer version.\n\n` +
                    `If you change your mind later, you can review this upgrade only after another bump — ` +
                    `this dismiss is sticky for the current version.`
                }
                confirmLabel="Dismiss"
                tone="warning"
                busy={submitting}
                onConfirm={handleDismissConfirmed}
                onCancel={() => setConfirmDismiss(false)}
            />
        </Dialog>
    );
}
