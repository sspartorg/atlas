import { useState, useEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { MarkdownPreview } from './MarkdownPreview.js';

interface Props {
    title: string;
    value: string | null | undefined;
    placeholder?: string | undefined;
    emptyHint?: string | undefined;
    minRows?: number | undefined;
    saving?: boolean | undefined;
    onSave: (next: string) => Promise<unknown> | unknown;
    /** Optional metadata rendered between the title bar and the body
     *  (e.g. "Written by · author · timestamp"). */
    meta?: ReactNode | undefined;
    /** Optional custom read-mode renderer (e.g. render as ul/ol for
     *  line-separated fields). Receives the trimmed value. If omitted,
     *  the value renders as pre-wrap typography. */
    renderBody?: ((value: string) => ReactNode) | undefined;
}

export function EditableMarkdownCard({
    title,
    value,
    placeholder,
    emptyHint,
    minRows = 4,
    saving = false,
    onSave,
    meta,
    renderBody,
}: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value ?? '');

    useEffect(() => {
        if (!editing) setDraft(value ?? '');
    }, [value, editing]);

    const startEdit = () => {
        setDraft(value ?? '');
        setEditing(true);
    };
    const cancelEdit = () => {
        setDraft(value ?? '');
        setEditing(false);
    };
    const save = async () => {
        await onSave(draft);
        setEditing(false);
    };

    const body = value?.trim();

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 5,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: meta ? 1 : 2,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate60,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                    }}
                >
                    {title}
                </Typography>
                {!editing && (
                    <Button
                        variant="text"
                        onClick={startEdit}
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
                            fontFamily: '"Inter", system-ui, sans-serif',
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate60,
                            '&:hover': {
                                color: ATLAS_PALETTE.slate,
                                background: ATLAS_PALETTE.slate06,
                            },
                        }}
                    >
                        Edit
                    </Button>
                )}
            </Box>

            {meta && !editing ? <Box sx={{ mb: 2 }}>{meta}</Box> : null}

            {editing ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        multiline
                        minRows={minRows}
                        autoFocus
                        fullWidth
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={placeholder ?? ''}
                        slotProps={{
                            input: {
                                sx: {
                                    fontSize: 14,
                                    lineHeight: 1.7,
                                    color: ATLAS_PALETTE.slate80,
                                    fontFamily: '"Inter", system-ui, sans-serif',
                                },
                            },
                        }}
                    />
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                        <Button
                            variant="outlined"
                            onClick={cancelEdit}
                            disabled={saving}
                            sx={{
                                height: 32,
                                textTransform: 'none',
                                fontFamily: '"Inter", system-ui, sans-serif',
                                fontSize: 12.5,
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => void save()}
                            disabled={saving}
                            sx={{
                                height: 32,
                                textTransform: 'none',
                                fontFamily: '"Inter", system-ui, sans-serif',
                                fontSize: 12.5,
                            }}
                        >
                            Save
                        </Button>
                    </Box>
                </Box>
            ) : body ? (
                renderBody ? (
                    renderBody(body)
                ) : (
                    <MarkdownPreview source={body} />
                )
            ) : (
                <Typography
                    onClick={startEdit}
                    sx={{
                        fontSize: 13,
                        color: ATLAS_PALETTE.slate40,
                        fontStyle: 'italic',
                        cursor: 'pointer',
                        '&:hover': { color: ATLAS_PALETTE.slate60 },
                    }}
                >
                    {emptyHint ?? 'Click to add…'}
                </Typography>
            )}
        </Box>
    );
}
