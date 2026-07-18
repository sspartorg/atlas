import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useThemeModeContext } from '../hooks/useThemeModeContext.js';

// 2026-06-10 — Theme-aware Atlas logo.
//
//   - Light theme  → `/atlas_dark.png` (dark mark, visible on light bg)
//   - Dark theme   → `/atlas.png`      (light mark, visible on dark bg)
//
// Centralised so every consumer (Sidenav, Onboarding, BrandedFallback, etc.)
// picks the right asset without each site duplicating the mode switch.

interface AtlasLogoProps {
    /** Pixel size — applied to both width and height. Use this for square renders. */
    size?: number;
    /** Optional sx overrides — merged on top of `width`/`height`/`objectFit`. */
    sx?: SxProps<Theme>;
    /** Alt text override; defaults to "Atlas". */
    alt?: string;
}

export function AtlasLogo({ size = 32, sx, alt = 'Atlas' }: AtlasLogoProps) {
    const { mode } = useThemeModeContext();
    const src = mode === 'dark' ? '/atlas.png' : '/atlas_dark.png';

    return (
        <Box
            component="img"
            src={src}
            alt={alt}
            sx={{ width: size, height: size, objectFit: 'contain', ...sx }}
        />
    );
}
