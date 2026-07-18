import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { EditableMarkdownCard } from '../../components/EditableMarkdownCard.js';
import {
    BUG_FREQUENCIES,
    BUG_FAILURE_SCOPES,
    type BugFrequency,
    type BugFailureScope,
} from '@atlas/shared';

export interface BugFieldsPatch {
    acceptance_criteria?: string;
    steps_to_reproduce?: string;
    expected?: string;
    actual?: string;
    frequency?: BugFrequency;
    failure_scope?: BugFailureScope;
}

interface Props {
    acceptance_criteria: string;
    steps_to_reproduce: string;
    expected: string;
    actual: string;
    frequency: BugFrequency;
    failure_scope: BugFailureScope;
    onUpdate: (patch: BugFieldsPatch) => Promise<unknown> | unknown;
    saving?: boolean | undefined;
}

function EnumChip({
    label,
    value,
    options,
    tone,
    onChange,
}: {
    label: string;
    value: string;
    options: readonly string[];
    tone: 'warning' | 'error' | 'info' | 'neutral';
    onChange: (next: string) => void;
}) {
    const toneColor =
        tone === 'warning'
            ? ATLAS_PALETTE.orange
            : tone === 'error'
              ? ATLAS_PALETTE.error
              : tone === 'info'
                ? ATLAS_PALETTE.brandBlue
                : ATLAS_PALETTE.slate60;
    return (
        <Box
            sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                px: '20px',
                py: 2,
            }}
        >
            <Typography
                sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                }}
            >
                {label}
            </Typography>
            <Select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                variant="standard"
                disableUnderline
                sx={{
                    height: 22,
                    px: '9px',
                    borderRadius: '4px',
                    background: `${toneColor}1A`,
                    color: toneColor,
                    fontSize: 11,
                    fontWeight: 600,
                    '& .MuiSelect-select': {
                        py: 0,
                        pr: '18px !important',
                    },
                    '& .MuiSvgIcon-root': { color: toneColor, fontSize: 16 },
                }}
            >
                {options.map((opt) => (
                    <MenuItem key={opt} value={opt} sx={{ fontSize: 12 }}>
                        {opt}
                    </MenuItem>
                ))}
            </Select>
        </Box>
    );
}

interface ExpectedActualCardProps {
    expected: string;
    actual: string;
    saving?: boolean | undefined;
    onSave: (next: { expected: string; actual: string }) => Promise<unknown> | unknown;
}

function ExpectedActualCard({ expected, actual, saving = false, onSave }: ExpectedActualCardProps) {
    const [editing, setEditing] = useState(false);
    const [expDraft, setExpDraft] = useState(expected);
    const [actDraft, setActDraft] = useState(actual);

    useEffect(() => {
        if (!editing) {
            setExpDraft(expected);
            setActDraft(actual);
        }
    }, [expected, actual, editing]);

    const save = async () => {
        await onSave({ expected: expDraft, actual: actDraft });
        setEditing(false);
    };

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: '20px 22px',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 2,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    Expected vs Actual
                </Typography>
                {!editing && (
                    <Button
                        variant="text"
                        onClick={() => setEditing(true)}
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16 }}
                            >
                                edit
                            </Box>
                        }
                        sx={{
                            height: 26,
                            minWidth: 0,
                            px: 1.5,
                            textTransform: 'none',
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        Edit
                    </Button>
                )}
            </Box>

            {editing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label="Expected"
                        multiline
                        minRows={2}
                        value={expDraft}
                        onChange={(e) => setExpDraft(e.target.value)}
                        fullWidth
                    />
                    <TextField
                        label="Actual"
                        multiline
                        minRows={2}
                        value={actDraft}
                        onChange={(e) => setActDraft(e.target.value)}
                        fullWidth
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                        <Button
                            variant="outlined"
                            onClick={() => {
                                setExpDraft(expected);
                                setActDraft(actual);
                                setEditing(false);
                            }}
                            disabled={saving}
                            sx={{ height: 32, textTransform: 'none', fontSize: 12.5 }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => void save()}
                            disabled={saving}
                            sx={{ height: 32, textTransform: 'none', fontSize: 12.5 }}
                        >
                            Save
                        </Button>
                    </Box>
                </Box>
            ) : expected || actual ? (
                <>
                    {expected && (
                        <Box sx={{ mb: 1.5 }}>
                            <Box
                                component="span"
                                sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate, fontSize: 13 }}
                            >
                                Expected:{' '}
                            </Box>
                            <Box
                                component="span"
                                sx={{ color: ATLAS_PALETTE.slate80, fontSize: 13, lineHeight: 1.7 }}
                            >
                                {expected}
                            </Box>
                        </Box>
                    )}
                    {actual && (
                        <Box>
                            <Box
                                component="span"
                                sx={{ fontWeight: 600, color: ATLAS_PALETTE.slate, fontSize: 13 }}
                            >
                                Actual:{' '}
                            </Box>
                            <Box
                                component="span"
                                sx={{ color: ATLAS_PALETTE.slate80, fontSize: 13, lineHeight: 1.7 }}
                            >
                                {actual}
                            </Box>
                        </Box>
                    )}
                </>
            ) : (
                <Typography
                    onClick={() => setEditing(true)}
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                        cursor: 'pointer',
                        '&:hover': { color: ATLAS_PALETTE.slate60 },
                    }}
                >
                    Click to describe expected vs actual behaviour…
                </Typography>
            )}
        </Box>
    );
}

export function BugBodyCards({
    acceptance_criteria,
    steps_to_reproduce,
    expected,
    actual,
    frequency,
    failure_scope,
    onUpdate,
    saving,
}: Props) {
    return (
        <>
            <Box sx={{ display: 'flex', gap: 3 }}>
                <EnumChip
                    label="Frequency"
                    value={frequency}
                    options={BUG_FREQUENCIES}
                    tone={
                        frequency === 'always'
                            ? 'error'
                            : frequency === 'sometimes'
                              ? 'warning'
                              : 'info'
                    }
                    onChange={(v) => void onUpdate({ frequency: v as BugFrequency })}
                />
                <EnumChip
                    label="Failure scope"
                    value={failure_scope}
                    options={BUG_FAILURE_SCOPES}
                    tone={
                        failure_scope === 'data-loss'
                            ? 'error'
                            : failure_scope === 'functional'
                              ? 'warning'
                              : failure_scope === 'performance'
                                ? 'info'
                                : 'neutral'
                    }
                    onChange={(v) =>
                        void onUpdate({ failure_scope: v as BugFailureScope })
                    }
                />
            </Box>

            <EditableMarkdownCard
                title="Acceptance criteria"
                value={acceptance_criteria}
                emptyHint="Click to add acceptance criteria, one per line…"
                placeholder={'- User can…\n- System ensures…'}
                saving={saving}
                onSave={(next) => onUpdate({ acceptance_criteria: next })}
                renderBody={(body) => {
                    const lines = body.split('\n').filter((l) => l.trim().length > 0);
                    return (
                        <Box
                            component="ul"
                            sx={{
                                pl: 3,
                                m: 0,
                                color: ATLAS_PALETTE.slate80,
                                fontSize: 13.5,
                                lineHeight: 1.8,
                            }}
                        >
                            {lines.map((line, i) => (
                                <li key={i}>{line.replace(/^[-*]\s*/, '')}</li>
                            ))}
                        </Box>
                    );
                }}
            />

            <EditableMarkdownCard
                title="Steps to reproduce"
                value={steps_to_reproduce}
                emptyHint="Click to add reproduction steps, one per line…"
                placeholder={'1. Open page X\n2. Click Y\n3. Observe Z'}
                saving={saving}
                onSave={(next) => onUpdate({ steps_to_reproduce: next })}
                renderBody={(body) => {
                    const lines = body.split('\n').filter((l) => l.trim().length > 0);
                    return (
                        <Box
                            component="ol"
                            sx={{
                                pl: 3,
                                m: 0,
                                color: ATLAS_PALETTE.slate80,
                                fontSize: 13.5,
                                lineHeight: 1.8,
                            }}
                        >
                            {lines.map((line, i) => (
                                <li key={i}>{line.replace(/^\d+\.\s*/, '')}</li>
                            ))}
                        </Box>
                    );
                }}
            />

            <ExpectedActualCard
                expected={expected}
                actual={actual}
                saving={saving}
                onSave={(patch) => onUpdate(patch)}
            />
        </>
    );
}
