import Box from '@mui/material/Box';
import { GUARDRAIL_SEVERITY_META, type GuardrailSeverity } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    severity: GuardrailSeverity;
    size?: 'sm' | 'md';
}

// Severity → colors. Drawn from the mockup: BLOCK reads red, ASK OWNER blue,
// WARN gold. Not a theme palette change — uses tokens.ts colors directly.
const STYLE: Record<GuardrailSeverity, { bg: string; fg: string }> = {
    block: { bg: 'rgba(220,38,38,.10)', fg: ATLAS_PALETTE.error },
    ask_owner: { bg: 'rgba(0,122,201,.10)', fg: ATLAS_PALETTE.brandBlue },
    warn: { bg: 'rgba(223,172,45,.16)', fg: ATLAS_PALETTE.gold },
};

export function GuardrailSeverityChip({ severity, size = 'sm' }: Props) {
    const style = STYLE[severity];
    const label = GUARDRAIL_SEVERITY_META[severity].label;
    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                bgcolor: style.bg,
                color: style.fg,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: size === 'md' ? 11 : 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                px: size === 'md' ? 1.5 : 1,
                py: size === 'md' ? 0.5 : 0.25,
                borderRadius: '4px',
                flexShrink: 0,
            }}
        >
            {label}
        </Box>
    );
}
