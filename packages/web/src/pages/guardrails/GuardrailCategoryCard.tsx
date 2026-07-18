import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import AddRounded from '@mui/icons-material/AddRounded';
import {
    GUARDRAIL_CATEGORY_META,
    type GuardrailCategory,
    type IGuardrailRule,
} from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { GuardrailRuleRow } from './GuardrailRuleRow.js';

interface Props {
    category: GuardrailCategory;
    rules: IGuardrailRule[];
    onAdd: () => void;
    onEdit: (rule: IGuardrailRule) => void;
}

export function GuardrailCategoryCard({ category, rules, onAdd, onEdit }: Props) {
    const meta = GUARDRAIL_CATEGORY_META[category];
    return (
        <Box
            sx={{
                bgcolor: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 5,
                mb: 4,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                <Box
                    sx={{
                        width: 28,
                        height: 28,
                        borderRadius: '8px',
                        bgcolor: ATLAS_PALETTE.cloud,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }}
                    >
                        {meta.icon}
                    </Box>
                </Box>
                <Typography
                    sx={{ fontSize: 15, fontWeight: 600, color: ATLAS_PALETTE.slate, flex: 1 }}
                >
                    {meta.label}
                </Typography>
                <Typography
                    sx={{
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {rules.length} rule{rules.length === 1 ? '' : 's'}
                </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 3, ml: 5 }}>
                {meta.sub}
            </Typography>

            <Box sx={{ borderTop: `1px solid ${ATLAS_PALETTE.slate06}`, pt: 1 }}>
                {rules.length === 0 ? (
                    <Box sx={{ py: 4, textAlign: 'center', color: ATLAS_PALETTE.slate40 }}>
                        <Typography sx={{ fontSize: 12 }}>
                            No rules in this category yet.
                        </Typography>
                    </Box>
                ) : (
                    rules.map((rule) => (
                        <GuardrailRuleRow
                            key={rule.id}
                            rule={rule}
                            onEdit={() => onEdit(rule)}
                        />
                    ))
                )}
            </Box>

            <Box sx={{ pt: 2, borderTop: `1px solid ${ATLAS_PALETTE.slate06}`, mt: 2 }}>
                <Button
                    size="small"
                    onClick={onAdd}
                    startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                    sx={{
                        textTransform: 'none',
                        fontSize: 12,
                        color: ATLAS_PALETTE.brandBlue,
                        fontWeight: 500,
                    }}
                >
                    Add rule to {meta.label}
                </Button>
            </Box>
        </Box>
    );
}
