import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutline from '@mui/icons-material/DeleteOutline';

// Phase 1.5b — shared add/edit modal for guardrail SCRIPTS.
// Used by both Atlas-level and project-level Scripts tabs.
// Fields: name, description, body_sh, body_ps1. Both bodies are
// MANDATORY on save — the server enforces the same invariant.

export interface ScriptModalValues {
    id?: string;
    name: string;
    description: string;
    body_sh: string;
    body_ps1: string;
}

export interface ScriptModalProps {
    open: boolean;
    editing: ScriptModalValues | null; // null = add mode
    onClose: () => void;
    onSubmit: (data: {
        id: string;
        name: string;
        description: string;
        body_sh: string;
        body_ps1: string;
    }) => Promise<void> | void;
    onDelete?: (id: string) => Promise<void> | void;
}

// Mirrors CreateGuardrailScriptSchema's slug regex. Kept here as a
// local copy (rather than imported from @atlas/shared) so the modal
// can preview the validation error inline before the round-trip.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function ScriptModal({ open, editing, onClose, onSubmit, onDelete }: ScriptModalProps) {
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [bodySh, setBodySh] = useState('');
    const [bodyPs1, setBodyPs1] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        if (editing) {
            setId(editing.id ?? '');
            setName(editing.name);
            setDescription(editing.description);
            setBodySh(editing.body_sh);
            setBodyPs1(editing.body_ps1);
        } else {
            setId('');
            setName('');
            setDescription('');
            setBodySh('');
            setBodyPs1('');
        }
        setError(null);
    }, [open, editing]);

    async function handleSubmit() {
        if (!editing && !SLUG_RE.test(id)) {
            setError(
                'Slug must be lowercase kebab-case (a-z, 0-9, hyphens); must start and end with a letter or digit.',
            );
            return;
        }
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        if (!bodySh.trim() || !bodyPs1.trim()) {
            setError('Both .sh and .ps1 bodies are required.');
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await onSubmit({
                id,
                name: name.trim(),
                description: description.trim(),
                body_sh: bodySh,
                body_ps1: bodyPs1,
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete() {
        if (!editing?.id || !onDelete) return;
        setSubmitting(true);
        setError(null);
        try {
            await onDelete(editing.id);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    }

    const isEdit = !!editing?.id;

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {isEdit ? 'Edit script' : 'Add script'}
                </Typography>
                <IconButton size="small" onClick={onClose} aria-label="Close">
                    <CloseRounded />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {error ? (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                ) : null}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                    <TextField
                        label="Slug (id)"
                        value={id}
                        onChange={(e) => setId(e.target.value)}
                        fullWidth
                        required
                        autoFocus={!isEdit}
                        disabled={submitting || isEdit}
                        helperText={
                            isEdit
                                ? 'Slug is immutable. Agent prompts reference this exact id (e.g. `check-<slug>.sh <itemId>`).'
                                : 'Lowercase kebab-case (a-z, 0-9, hyphens). Agent prompts reference this exact id (e.g. `check-<slug>.sh <itemId>`).'
                        }
                        InputProps={{
                            sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
                        }}
                    />
                    <TextField
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        fullWidth
                        autoFocus={isEdit}
                        required
                        disabled={submitting}
                    />
                    <TextField
                        label="Description (optional)"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        fullWidth
                        multiline
                        minRows={2}
                        maxRows={5}
                        disabled={submitting}
                    />
                    <TextField
                        label=".sh body (POSIX)"
                        value={bodySh}
                        onChange={(e) => setBodySh(e.target.value)}
                        fullWidth
                        required
                        multiline
                        minRows={10}
                        maxRows={24}
                        placeholder={
                            '#!/usr/bin/env bash\nset -eu\n# exit 0 on pass, exit 1 on violation\n'
                        }
                        InputProps={{
                            sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
                        }}
                        disabled={submitting}
                    />
                    <TextField
                        label=".ps1 body (Windows PowerShell)"
                        value={bodyPs1}
                        onChange={(e) => setBodyPs1(e.target.value)}
                        fullWidth
                        required
                        multiline
                        minRows={10}
                        maxRows={24}
                        placeholder={
                            "$ErrorActionPreference = 'Stop'\n# exit 0 on pass, exit 1 on violation\n"
                        }
                        InputProps={{
                            sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
                        }}
                        disabled={submitting}
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
                {isEdit && onDelete ? (
                    <Button
                        color="error"
                        variant="outlined"
                        startIcon={<DeleteOutline />}
                        onClick={handleDelete}
                        disabled={submitting}
                    >
                        Delete
                    </Button>
                ) : (
                    <Box />
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleSubmit}
                        disabled={
                            submitting ||
                            (!isEdit && !id.trim()) ||
                            !name.trim() ||
                            !bodySh.trim() ||
                            !bodyPs1.trim()
                        }
                    >
                        {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add script'}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
}
