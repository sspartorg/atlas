import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import UpgradeRounded from '@mui/icons-material/UpgradeRounded';
import { useQueryClient } from '@tanstack/react-query';
import type { IMarketplaceAgentSummary } from '@atlas/shared';
import { api } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { AddFromMarketplaceModal } from './AddFromMarketplaceModal.js';

interface Props {
    agent: IMarketplaceAgentSummary;
    onOpen: () => void;
    onAfterInstall: (installedAgentId: string) => void;
    /** When true, render a selection checkbox (parent passes this only for
     *  not-installed agents). Selection state + toggling are owned by the
     *  parent so the bulk action bar can read across all cards. */
    selectable?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
}

interface SlugTaken {
    conflictingId: string;
    suggestedId: string;
}

interface ApiErrorWithDetails {
    details?: { conflicting_id?: string; suggested_id?: string };
}

export function MarketplaceAgentCard({
    agent,
    onOpen,
    onAfterInstall,
    selectable = false,
    selected = false,
    onToggleSelect,
}: Props) {
    const queryClient = useQueryClient();
    const [installing, setInstalling] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [slugTaken, setSlugTaken] = useState<SlugTaken | null>(null);

    const isInstalled = agent.is_installed;
    const hasUpgrade = agent.upgrade_available;

    const handleInstall = async (slug: string) => {
        setInstalling(true);
        try {
            const installed = await api.marketplace.install(agent.id, { agent_id: slug });
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
            setAddOpen(false);
            setSlugTaken(null);
            onAfterInstall(installed.id);
        } catch (err) {
            // Recognise the 409 SLUG_TAKEN envelope and flip the modal into
            // "rename" state. The API client throws a typed error; we look
            // for the structured details on it.
            const details = (err as ApiErrorWithDetails)?.details;
            if (details?.conflicting_id && details?.suggested_id) {
                setSlugTaken({
                    conflictingId: details.conflicting_id,
                    suggestedId: details.suggested_id,
                });
            } else {
                throw err;
            }
        } finally {
            setInstalling(false);
        }
    };

    const openAdd = () => {
        setSlugTaken(null);
        setAddOpen(true);
    };

    const closeAdd = () => {
        if (installing) return;
        setAddOpen(false);
        setSlugTaken(null);
    };

    // MUI Dialog renders into a Portal at document.body, so the DOM tree
    // looks detached — but React's synthetic events bubble through the
    // virtual DOM, so a click on any button inside the modal still reaches
    // the card's onClick. Mirror the guard from AgentCard.tsx: ignore the
    // event when its target is inside a modal/popover/backdrop layer.
    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement | null;
        if (
            target?.closest(
                '.MuiMenu-root, .MuiPopover-root, .MuiModal-root, .MuiBackdrop-root, .MuiDialog-root',
            )
        ) {
            return;
        }
        onOpen();
    };

    return (
        <Box
            onClick={handleCardClick}
            sx={{
                position: 'relative',
                p: 4,
                borderRadius: 2,
                // Selected = whole-card treatment: accent border, a soft
                // accent ring, and a faint accent wash. Reads as "picked"
                // far more clearly than a lone corner checkbox did.
                bgcolor: selected ? `${agent.accent_color}0A` : ATLAS_PALETTE.white,
                border: `1px solid ${selected ? agent.accent_color : ATLAS_PALETTE.slate06}`,
                boxShadow: selected ? `0 0 0 3px ${agent.accent_color}1F` : 'none',
                cursor: 'pointer',
                transition: 'all 150ms ease',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minHeight: 180,
                '&:hover': {
                    borderColor: agent.accent_color,
                    boxShadow: selected
                        ? `0 0 0 3px ${agent.accent_color}1F`
                        : `0 4px 16px rgba(0,0,0,0.06)`,
                },
            }}
        >
            {selectable && (
                <Box
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`Select ${agent.name}`}
                    tabIndex={0}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect?.();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleSelect?.();
                        }
                    }}
                    sx={{
                        position: 'absolute',
                        top: 14,
                        right: 14,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 140ms ease',
                        border: `1.5px solid ${selected ? agent.accent_color : ATLAS_PALETTE.slate30}`,
                        bgcolor: selected ? agent.accent_color : 'transparent',
                        // Fixed white tick: the fill is the per-agent catalog
                        // hue (does not flip with theme), so white reads
                        // correctly in both light and dark mode.
                        color: '#fff',
                        '&:hover': {
                            borderColor: agent.accent_color,
                            bgcolor: selected ? agent.accent_color : `${agent.accent_color}14`,
                        },
                    }}
                >
                    {selected && <CheckRounded sx={{ fontSize: 15 }} />}
                </Box>
            )}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, pr: selectable ? 3.5 : 0 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '8px',
                        bgcolor: `${agent.accent_color}1A`,
                        color: agent.accent_color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 22, fontVariationSettings: "'FILL' 1" }}
                    >
                        {agent.glyph || 'smart_toy'}
                    </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 15, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        {agent.name}
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                            fontFamily: '"JetBrains Mono", monospace',
                            mt: 0.5,
                        }}
                    >
                        v{agent.version} · {agent.kind_slug}
                    </Typography>
                </Box>
            </Box>

            <Typography
                sx={{
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate60,
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                }}
            >
                {agent.summary || 'No summary available.'}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 'auto', pt: 2 }}>
                {hasUpgrade ? (
                    <Chip
                        icon={<UpgradeRounded sx={{ fontSize: 14 }} />}
                        label={`Upgrade v${agent.installed_version} → v${agent.version}`}
                        size="small"
                        color="warning"
                        variant="filled"
                        sx={{ fontWeight: 500 }}
                    />
                ) : isInstalled ? (
                    <Chip
                        icon={<CheckCircleRounded sx={{ fontSize: 14 }} />}
                        label="Installed"
                        size="small"
                        variant="outlined"
                        sx={{ fontWeight: 500, color: ATLAS_PALETTE.slate60 }}
                    />
                ) : (
                    <Button
                        size="small"
                        variant="contained"
                        disabled={installing}
                        onClick={(e) => {
                            e.stopPropagation();
                            openAdd();
                        }}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            bgcolor: ATLAS_PALETTE.green,
                            boxShadow: 'none',
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                        }}
                    >
                        Add
                    </Button>
                )}
            </Box>

            <AddFromMarketplaceModal
                open={addOpen}
                onClose={closeAdd}
                agent={agent}
                installing={installing}
                onConfirm={handleInstall}
                slugTaken={slugTaken}
            />
        </Box>
    );
}
