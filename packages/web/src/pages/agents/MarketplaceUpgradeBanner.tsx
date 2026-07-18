import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import UpgradeRounded from '@mui/icons-material/UpgradeRounded';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import type { IAgent } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useToast } from '../../hooks/useToast.js';
import { AcceptUpgradeModal } from '../marketplace/AcceptUpgradeModal.js';
import { ConfirmActionModal } from '../../components/ConfirmActionModal.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    agent: IAgent;
}

// Shows "Upgrade available" when the local agent is back-linked to a
// marketplace entry whose version is greater than agents.marketplace_pulled_version.
// Owner can Review (diff modal), Dismiss (bump pulled_version with no content change),
// or Detach (drop the back-link permanently).
export function MarketplaceUpgradeBanner({ agent }: Props) {
    const queryClient = useQueryClient();
    const toast = useToast();
    const sourceId = agent.marketplace_source_id;
    const pulled = agent.marketplace_pulled_version;
    const [reviewing, setReviewing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmDetach, setConfirmDetach] = useState(false);

    const catalog = useQuery({
        queryKey: ['marketplace', 'one', sourceId],
        queryFn: () => api.marketplace.get(sourceId!),
        enabled: !!sourceId,
        staleTime: 30_000,
    });

    if (!sourceId || pulled == null || !catalog.data) return null;
    const catalogVersion = catalog.data.agent.version;
    if (catalogVersion <= pulled) return null;

    const handleDetach = async () => {
        setBusy(true);
        try {
            await api.agents.detachMarketplace(agent.id);
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            // The marketplace card / detail-page CTA both read is_linked
            // from the marketplace summary; without this invalidation the
            // listing keeps showing "Installed" even though the back-link
            // is gone.
            await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
            toast.show({ message: `${agent.name} detached from marketplace` });
            setConfirmDetach(false);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                p: 3,
                mb: 4,
                borderRadius: 1.5,
                bgcolor: ATLAS_PALETTE.warnSoft,
                border: `1px solid ${ATLAS_PALETTE.warnFg}`,
            }}
        >
            <UpgradeRounded sx={{ color: ATLAS_PALETTE.warnFg }} />
            <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.warnFg }}>
                    Marketplace upgrade available
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.warnFg, mt: 0.5 }}>
                    v{pulled} → v{catalogVersion}. Review the diff and apply only the fields you
                    want — your local edits stay intact for anything you skip.
                </Typography>
            </Box>
            <Button
                variant="contained"
                color="warning"
                onClick={() => setReviewing(true)}
                disabled={busy}
                sx={{ textTransform: 'none', fontWeight: 600 }}
            >
                Review upgrade
            </Button>
            <Button
                startIcon={<LinkOffRounded sx={{ fontSize: 16 }} />}
                onClick={() => setConfirmDetach(true)}
                disabled={busy}
                sx={{ textTransform: 'none', color: ATLAS_PALETTE.warnFg }}
            >
                Detach
            </Button>
            <ConfirmActionModal
                open={confirmDetach}
                title={`Detach ${agent.name}?`}
                body={
                    `This permanently breaks the back-link to the marketplace catalog. ` +
                    `You'll stop seeing upgrade banners for this agent.\n\n` +
                    `Your local agent — including any prompt edits, settings, and memory — is untouched. ` +
                    `If you want a fresh catalog copy later, click Add on the marketplace card; you'll be ` +
                    `asked to pick a new slug since this one will still be taken.`
                }
                confirmLabel="Detach"
                tone="destructive"
                busy={busy}
                onConfirm={handleDetach}
                onCancel={() => setConfirmDetach(false)}
            />
            <AcceptUpgradeModal
                open={reviewing}
                onClose={() => setReviewing(false)}
                agentId={agent.id}
                marketplaceId={sourceId}
                onAccepted={() => {
                    setReviewing(false);
                    toast.show({ message: `Upgraded ${agent.name}` });
                }}
                onDismissed={() => {
                    setReviewing(false);
                    toast.show({ message: 'Upgrade dismissed' });
                }}
            />
        </Box>
    );
}
