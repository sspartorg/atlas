import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CloseRounded from '@mui/icons-material/CloseRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import LockOutlined from '@mui/icons-material/LockOutlined';
import {
    GUARDRAIL_CATEGORIES,
    GUARDRAIL_CATEGORY_META,
    GUARDRAIL_SEVERITIES,
    GUARDRAIL_SEVERITY_META,
    type GuardrailCategory,
    type GuardrailSeverity,
    type IGuardrailRule,
} from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { GuardrailSeverityChip } from './GuardrailSeverityChip.js';
import { FormHeading } from '../../components/FormHeading.js';

interface Props {
    open: boolean;
    initialCategory: GuardrailCategory;
    editing: IGuardrailRule | null; // null = add mode
    onClose: () => void;
    onSubmit: (data: {
        category: GuardrailCategory;
        rule_text: string;
        detail: string | null;
        severity: GuardrailSeverity;
    }) => Promise<void> | void;
    onDelete?: (rule: IGuardrailRule) => Promise<void> | void;
}

export function GuardrailModal({
    open,
    initialCategory,
    editing,
    onClose,
    onSubmit,
    onDelete,
}: Props) {
    const [category, setCategory] = useState<GuardrailCategory>(initialCategory);
    const [ruleText, setRuleText] = useState('');
    const [detail, setDetail] = useState('');
    const [severity, setSeverity] = useState<GuardrailSeverity>('block');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        if (editing) {
            setCategory(editing.category);
            setRuleText(editing.rule_text);
            setDetail(editing.detail ?? '');
            setSeverity(editing.severity);
        } else {
            setCategory(initialCategory);
            setRuleText('');
            setDetail('');
            setSeverity('block');
        }
        setError(null);
    }, [open, editing, initialCategory]);

    async function handleSubmit() {
        if (!ruleText.trim()) {
            setError('Rule text is required.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onSubmit({
                category,
                rule_text: ruleText.trim(),
                detail: detail.trim() ? detail.trim() : null,
                severity,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete() {
        if (!editing || !onDelete) return;
        setConfirmDeleteOpen(false);
        setSubmitting(true);
        try {
            await onDelete(editing);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.white,
                    boxShadow: '0 24px 48px rgba(0,0,0,.18)',
                    m: 2,
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, p: 5, pb: 0 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        bgcolor: ATLAS_PALETTE.cloud,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <LockOutlined sx={{ fontSize: 18, color: ATLAS_PALETTE.brandBlue }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>{editing ? 'Edit rule' : 'Add rule'}</FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        Merged into every agent prompt on the next run.
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small" disabled={submitting}>
                    <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                </IconButton>
            </Box>

            <Box sx={{ p: 5, pt: 4 }}>
                <SectionLabel>Category</SectionLabel>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 4 }}>
                    {GUARDRAIL_CATEGORIES.map((cat) => {
                        const meta = GUARDRAIL_CATEGORY_META[cat];
                        const selected = cat === category;
                        return (
                            <Box
                                key={cat}
                                role="button"
                                onClick={() => setCategory(cat)}
                                sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 1.5,
                                    px: 2,
                                    py: 1.25,
                                    borderRadius: '8px',
                                    border: `1px solid ${selected ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate10}`,
                                    bgcolor: selected ? ATLAS_PALETTE.slate : ATLAS_PALETTE.white,
                                    color: selected ? ATLAS_PALETTE.white : ATLAS_PALETTE.slate,
                                    cursor: 'pointer',
                                    transition: 'all 120ms ease',
                                    '&:hover': {
                                        borderColor: selected
                                            ? ATLAS_PALETTE.slate
                                            : ATLAS_PALETTE.slate30,
                                    },
                                }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 14 }}
                                >
                                    {meta.icon}
                                </Box>
                                <Typography
                                    sx={{ fontSize: 12, fontWeight: 500, color: 'inherit' }}
                                >
                                    {meta.label}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>

                <TextField
                    fullWidth
                    size="small"
                    required
                    label="Rule"
                    value={ruleText}
                    onChange={(e) => setRuleText(e.target.value)}
                    placeholder="Never run database migrations on production branches."
                    helperText="Wrap commands or env names in backticks for monospace."
                    sx={{ mb: 4 }}
                />

                <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={4}
                    size="small"
                    label="Detail"
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    placeholder="One-line context, exception, or where the check fires."
                    helperText="Optional"
                    sx={{ mb: 4 }}
                />

                <SectionLabel>Severity</SectionLabel>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                        gap: 2,
                        mb: 2,
                    }}
                >
                    {GUARDRAIL_SEVERITIES.map((sev) => {
                        const selected = severity === sev;
                        return (
                            <Box
                                key={sev}
                                role="button"
                                onClick={() => setSeverity(sev)}
                                sx={{
                                    border: `2px solid ${selected ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate10}`,
                                    borderRadius: '10px',
                                    p: 2.5,
                                    cursor: 'pointer',
                                    bgcolor: selected ? ATLAS_PALETTE.cloud : ATLAS_PALETTE.white,
                                    transition: 'all 120ms ease',
                                }}
                            >
                                <GuardrailSeverityChip severity={sev} />
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                        mt: 1,
                                        lineHeight: 1.4,
                                    }}
                                >
                                    {GUARDRAIL_SEVERITY_META[sev].description}
                                </Typography>
                            </Box>
                        );
                    })}
                </Box>

                {error && (
                    <Alert
                        severity="error"
                        sx={{ mt: 2, fontSize: 12, '& .MuiAlert-message': { fontSize: 12 } }}
                    >
                        {error}
                    </Alert>
                )}
            </Box>

            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                    px: 5,
                    py: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                    bgcolor: ATLAS_PALETTE.white,
                }}
            >
                {editing && onDelete ? (
                    <IconButton
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={submitting}
                        aria-label="Delete rule"
                        sx={{ color: ATLAS_PALETTE.error }}
                    >
                        <DeleteOutline sx={{ fontSize: 18 }} />
                    </IconButton>
                ) : (
                    <Box />
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        onClick={onClose}
                        disabled={submitting}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<AddRounded sx={{ fontSize: 16 }} />}
                        onClick={() => void handleSubmit()}
                        disabled={submitting || !ruleText.trim()}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {editing ? 'Save Changes' : 'Add Rule'}
                    </Button>
                </Box>
            </Box>

            <Dialog
                open={confirmDeleteOpen}
                onClose={() => setConfirmDeleteOpen(false)}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: { borderRadius: '12px', m: 2 } }}
            >
                <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Delete this rule?</DialogTitle>
                <DialogContent>
                    <Typography
                        sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, lineHeight: 1.6 }}
                    >
                        Removes this rule from{' '}
                        <Box component="span" sx={{ fontWeight: 600 }}>
                            {editing?.category.replace('_', ' ')}
                        </Box>
                        . Agents won&apos;t see it on their next run. You can re-add it later.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2.5 }}>
                    <Button
                        onClick={() => setConfirmDeleteOpen(false)}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => void handleDelete()}
                        disabled={submitting}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <Typography
            sx={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: ATLAS_PALETTE.slate60,
                mb: 1.5,
            }}
        >
            {children}
        </Typography>
    );
}
