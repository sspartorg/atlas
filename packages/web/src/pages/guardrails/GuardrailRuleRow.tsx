import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IGuardrailRule } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { GuardrailSeverityChip } from './GuardrailSeverityChip.js';
import { InlineRuleText } from './InlineRuleText.js';

interface Props {
    rule: IGuardrailRule;
    onEdit: () => void;
}

// Phase 1.5b perf — wrap in React.memo so re-renders of the parent
// Guardrails page (state churn on tab switch, etc.) skip re-rendering
// every rule row when the rule prop is referentially stable.
export const GuardrailRuleRow = memo(function GuardrailRuleRow({ rule, onEdit }: Props) {
    return (
        <Box
            role="button"
            onClick={onEdit}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                py: 2.5,
                px: 1.5,
                borderRadius: '6px',
                cursor: 'pointer',
                '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                transition: 'background 120ms ease',
            }}
        >
            {/* Row 1: title (1 line, ellipsis) + severity chip pinned right */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                <Typography
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        fontWeight: 500,
                        lineHeight: 1.4,
                        color: ATLAS_PALETTE.slate,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <InlineRuleText text={rule.rule_text} />
                </Typography>
                <Box sx={{ flexShrink: 0 }}>
                    <GuardrailSeverityChip severity={rule.severity} />
                </Box>
            </Box>
            {/* Row 2: detail — unlimited lines, wraps naturally */}
            {rule.detail && (
                <Typography
                    sx={{
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate60,
                        lineHeight: 1.55,
                    }}
                >
                    <InlineRuleText text={rule.detail} />
                </Typography>
            )}
        </Box>
    );
});
