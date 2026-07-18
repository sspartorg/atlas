import { LABEL_COLORS, type LabelColorKey, type LabelColorPair } from '../theme/tokens.js';
import { useThemeModeContext } from './useThemeModeContext.js';

// 2026-06-10 — Per-category color resolver.
//
// Mercury collapsed every brand-hue token to a single accent, so KPI tiles,
// status badges and chart series that picked from `ATLAS_PALETTE.brandBlue`
// / `.fuchsia` / etc. lost all visual differentiation. `LABEL_COLORS` is the
// retained polychrome scale (10 designed light/dark pairs) — this hook
// returns the current-mode pair for a category key so consumers don't have
// to thread `mode` through their JSX.
//
// Usage:
//   const { border, bg, fg } = useLabelColor('emerald');
//   <Tile dotColor={border} />
export function useLabelColor(key: LabelColorKey): LabelColorPair {
    const { mode } = useThemeModeContext();
    return LABEL_COLORS[key][mode];
}
