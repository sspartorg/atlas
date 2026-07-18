import { useState, useEffect, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    value: string;
    onSave: (next: string) => Promise<unknown> | unknown;
    saving?: boolean | undefined;
}

export function EditableTitle({ value, onSave, saving = false }: Props) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    const startEdit = () => {
        setDraft(value);
        setEditing(true);
    };
    const cancel = () => {
        setDraft(value);
        setEditing(false);
    };
    const save = async () => {
        const next = draft.trim();
        if (!next || next === value) {
            cancel();
            return;
        }
        await onSave(next);
        setEditing(false);
    };
    const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
        }
    };

    if (editing) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
                <TextField
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKey}
                    autoFocus
                    fullWidth
                    variant="standard"
                    slotProps={{
                        input: {
                            sx: {
                                fontSize: '2rem',
                                fontWeight: 700,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: 1.2,
                                fontFamily: '"Inter", system-ui, sans-serif',
                            },
                        },
                    }}
                />
                <IconButton
                    size="small"
                    onClick={() => void save()}
                    disabled={saving || !draft.trim()}
                    sx={{ color: ATLAS_PALETTE.brandBlue }}
                >
                    <CheckRounded sx={{ fontSize: 22 }} />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={cancel}
                    disabled={saving}
                    sx={{ color: ATLAS_PALETTE.slate60 }}
                >
                    <CloseRounded sx={{ fontSize: 22 }} />
                </IconButton>
            </Box>
        );
    }

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                minWidth: 0,
                flex: 1,
                '&:hover .edit-affordance': { opacity: 1 },
            }}
        >
            <Typography
                onClick={startEdit}
                sx={{
                    fontSize: '2rem',
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    lineHeight: 1.2,
                    cursor: 'text',
                    minWidth: 0,
                    overflowWrap: 'anywhere',
                }}
            >
                {value}
            </Typography>
            <IconButton
                className="edit-affordance"
                size="small"
                onClick={startEdit}
                sx={{
                    opacity: 0,
                    transition: 'opacity 120ms ease',
                    color: ATLAS_PALETTE.slate40,
                    '&:hover': { color: ATLAS_PALETTE.slate },
                }}
                aria-label="Edit title"
            >
                <EditOutlined sx={{ fontSize: 18 }} />
            </IconButton>
        </Box>
    );
}
