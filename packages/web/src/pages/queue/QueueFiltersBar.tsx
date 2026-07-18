import { useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FilterPill } from '../../components/filterPrimitives.js';

export type QueueFilterKey = 'running' | 'queued' | 'waiting' | 'idle' | 'failed';

interface FilterDef {
    key: QueueFilterKey;
    label: string;
    count: number;
    color?: string;
}

interface Props {
    filters: FilterDef[];
    active: Set<QueueFilterKey>;
    onToggle: (key: QueueFilterKey) => void;
    onRefresh?: () => void | Promise<unknown>;
}

const ICON_BY_KEY: Record<QueueFilterKey, string> = {
    running: 'play_arrow',
    queued: 'list_alt',
    waiting: 'hourglass_top',
    idle: 'motion_blur',
    failed: 'error',
};

export function QueueFiltersBar({ filters, active, onToggle, onRefresh }: Props) {
    const [refreshing, setRefreshing] = useState(false);

    async function handleRefresh() {
        if (!onRefresh || refreshing) return;
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    }

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                rowGap: 1.5,
                flexWrap: 'wrap',
                mb: 5,
                '@keyframes qfb-spin': {
                    from: { transform: 'rotate(0deg)' },
                    to: { transform: 'rotate(360deg)' },
                },
            }}
        >
            {filters.map((f) => {
                const isOn = active.has(f.key);
                const isNeutral = f.key === 'idle';
                const accentBg = isNeutral
                    ? ATLAS_PALETTE.slate12
                    : (f.color ?? ATLAS_PALETTE.slate);
                const accentFg = isNeutral ? ATLAS_PALETTE.slate : ATLAS_PALETTE.white;
                const iconColor = isOn
                    ? accentFg
                    : isNeutral
                      ? ATLAS_PALETTE.slate60
                      : accentBg;
                return (
                    <FilterPill
                        key={f.key}
                        label={f.label}
                        count={f.count}
                        selected={isOn}
                        onClick={() => onToggle(f.key)}
                        accentColor={{ bg: accentBg, fg: accentFg }}
                        icon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16, color: iconColor }}
                            >
                                {ICON_BY_KEY[f.key]}
                            </Box>
                        }
                    />
                );
            })}
            {onRefresh ? (
                <Box
                    role="button"
                    tabIndex={0}
                    aria-busy={refreshing}
                    aria-label="Refresh queue"
                    onClick={() => void handleRefresh()}
                    onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void handleRefresh();
                        }
                    }}
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                        ml: 'auto',
                        px: 1.5,
                        py: 0.5,
                        borderRadius: '9999px',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        bgcolor: ATLAS_PALETTE.white,
                        color: ATLAS_PALETTE.slate,
                        cursor: refreshing ? 'progress' : 'pointer',
                        userSelect: 'none',
                        transition: 'all 150ms ease',
                        opacity: refreshing ? 0.7 : 1,
                        '&:hover': {
                            bgcolor: refreshing ? ATLAS_PALETTE.white : ATLAS_PALETTE.cloud,
                            borderColor: refreshing
                                ? ATLAS_PALETTE.slate10
                                : ATLAS_PALETTE.slate30,
                        },
                        '&:focus-visible': {
                            outline: `2px solid ${ATLAS_PALETTE.brandBlue}`,
                            outlineOffset: 2,
                        },
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{
                            fontSize: 16,
                            color: ATLAS_PALETTE.slate60,
                            animation: refreshing
                                ? 'qfb-spin 0.9s linear infinite'
                                : 'none',
                        }}
                    >
                        autorenew
                    </Box>
                    <Typography
                        component="span"
                        sx={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate,
                        }}
                    >
                        {refreshing ? 'Refreshing…' : 'Refresh'}
                    </Typography>
                </Box>
            ) : null}
        </Box>
    );
}
