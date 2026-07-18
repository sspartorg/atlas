import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { ATLAS_PALETTE } from '../theme/tokens.js';

type SemanticColor = 'success' | 'warning' | 'error' | 'info';

interface Props {
    size?: number | undefined;
    label?: string | undefined;
    /** Semantic color slot; resolved against `ATLAS_PALETTE`. Default success. */
    color?: SemanticColor | undefined;
    /** Override with a literal hex when the semantic slots don't fit. */
    hex?: string | undefined;
    /** Set false to render a static dot (no ripple). Default true. */
    animate?: boolean | undefined;
}

const SEMANTIC_COLORS: Record<SemanticColor, string> = {
    success: ATLAS_PALETTE.success,
    warning: ATLAS_PALETTE.warning,
    error: ATLAS_PALETTE.error,
    info: ATLAS_PALETTE.slate,
};

// 2026-06-10 — Live indicator with an expanding ring ripple.
//
// Replaces the prior pattern of `animation: opacity 1 → 0.45 → 1` on a flat
// dot (which dims rather than pulses) and the even earlier no-animation
// version (which read as a static decoration). Two rings expand outward
// staggered by half a cycle so the heartbeat is continuous.
//
// API is backwards-compatible: existing `<LiveDot size={N} label="…" />`
// callsites pick up the ripple automatically. New consumers can opt out
// (`animate={false}`) or pick a semantic colour.
export function LiveDot({
    size = 8,
    label = 'In progress',
    color = 'success',
    hex,
    animate = true,
}: Props) {
    const fill = hex ?? SEMANTIC_COLORS[color];
    return (
        <Tooltip title={label} placement="top" arrow>
            <Box
                aria-label={label}
                sx={{
                    position: 'relative',
                    width: size,
                    height: size,
                    flexShrink: 0,
                    display: 'inline-block',
                }}
            >
                {/* Core dot */}
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: '50%',
                        bgcolor: fill,
                        zIndex: 1,
                    }}
                />
                {animate && (
                    <>
                        <Box
                            aria-hidden
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: '50%',
                                border: `1.5px solid ${fill}`,
                                transformOrigin: 'center',
                                animation: 'atlas-live-ripple 1.8s ease-out infinite',
                                '@keyframes atlas-live-ripple': {
                                    '0%': { transform: 'scale(1)', opacity: 0.7 },
                                    '80%': { transform: 'scale(2.6)', opacity: 0 },
                                    '100%': { transform: 'scale(2.6)', opacity: 0 },
                                },
                            }}
                        />
                        <Box
                            aria-hidden
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: '50%',
                                border: `1.5px solid ${fill}`,
                                transformOrigin: 'center',
                                animation: 'atlas-live-ripple 1.8s ease-out 0.9s infinite',
                            }}
                        />
                    </>
                )}
            </Box>
        </Tooltip>
    );
}
