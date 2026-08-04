import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';

// No icons on the toggle buttons, deliberately. `@mui/icons-material` lands
// in the shared `mui-icons` chunk, which the bundle gate counts as INITIAL —
// and that budget has ~0.3 KB of slack. Three new icon modules pushed it over.
// The buttons carry text labels, so the icons were decorative anyway.
import type { DiffViewMode } from './diffViewPrefs.js';

interface Props {
    viewMode: DiffViewMode;
    onViewModeChange: (next: DiffViewMode) => void;
    wrap: boolean;
    onWrapChange: (next: boolean) => void;
    /** Split needs horizontal room — disabled on narrow viewports. */
    splitDisabled: boolean;
    stats: { files: number; additions: number; deletions: number };
}

export function DiffToolbar({
    viewMode,
    onViewModeChange,
    wrap,
    onWrapChange,
    splitDisabled,
    stats,
}: Props) {
    return (
        <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography
                variant="caption"
                sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono, color: ATLAS_PALETTE.slate60 }}
            >
                {stats.files} file{stats.files === 1 ? '' : 's'} ·{' '}
                <Box component="span" sx={{ color: ATLAS_PALETTE.successFg }}>
                    +{stats.additions}
                </Box>{' '}
                <Box component="span" sx={{ color: ATLAS_PALETTE.dangerFg }}>
                    −{stats.deletions}
                </Box>
            </Typography>

            <FormControlLabel
                control={
                    <Switch
                        size="small"
                        checked={wrap}
                        onChange={(e) => onWrapChange(e.target.checked)}
                        // `slotProps.input`, not the v6 `inputProps` — MUI v7
                        // drops the latter, and the control silently loses its
                        // accessible name.
                        slotProps={{ input: { 'aria-label': 'Wrap long lines' } }}
                    />
                }
                label={<Typography variant="caption">Wrap</Typography>}
                sx={{ mr: 0 }}
            />

            <ToggleButtonGroup
                size="small"
                exclusive
                value={viewMode}
                onChange={(_e, next: DiffViewMode | null) => {
                    // MUI emits null when the active button is clicked again;
                    // ignore so the group can never end up with no selection.
                    if (next) onViewModeChange(next);
                }}
            >
                {/* aria-label on the BUTTON, not on the tooltip's child. MUI
                    puts the tooltip title onto its child as `aria-label`, and
                    the button's accessible name is computed from its contents
                    — so a tooltip inside would silently rename the button to
                    its own title text. */}
                <ToggleButton
                    value="split"
                    aria-label="Split"
                    disabled={splitDisabled}
                    title={splitDisabled ? 'Split view needs a wider window' : 'Side by side'}
                    sx={{ textTransform: 'none', px: 1.25 }}
                >
                    <Typography variant="caption">Split</Typography>
                </ToggleButton>
                <ToggleButton
                    value="unified"
                    aria-label="Unified"
                    title="Unified"
                    sx={{ textTransform: 'none', px: 1.25 }}
                >
                    <Typography variant="caption">Unified</Typography>
                </ToggleButton>
            </ToggleButtonGroup>
        </Stack>
    );
}
