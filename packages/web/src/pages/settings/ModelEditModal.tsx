import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ICliModel, AgentCli } from '@atlas/shared';
import { useCreateCliModel, useUpdateCliModel } from '../../hooks/useCliModels.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

// Example of each CLI's naming convention — Claude uses hyphens, Copilot dots,
// Ollama `name:tag`. The placeholder is the only hint the Owner gets about the
// shape the CLI expects, so keep one per CLI.
const MODEL_NAME_PLACEHOLDER: Record<AgentCli, string> = {
    claude: 'claude-opus-4-8…',
    copilot: 'gpt-5.5…',
    ollama: 'qwen3.5 or gpt-oss:120b-cloud…',
};

interface Props {
    open: boolean;
    onClose: () => void;
    cli: AgentCli;
    cliLabel: string;
    /** When set: edit mode (prefilled); when null: add mode. */
    model: ICliModel | null;
}

export function ModelEditModal({ open, onClose, cli, cliLabel, model }: Props) {
    const create = useCreateCliModel();
    const update = useUpdateCliModel();
    const toast = useToast();
    const [name, setName] = useState('');
    const [note, setNote] = useState('');

    useEffect(() => {
        if (!open) return;
        setName(model?.model_name ?? '');
        setNote(model?.note ?? '');
    }, [open, model]);

    const isEdit = model !== null;
    const pending = create.isPending || update.isPending;

    function submit() {
        const trimmedName = name.trim();
        if (!trimmedName) return;
        const trimmedNote = note.trim() || null;
        if (isEdit && model) {
            // Update note only — model_name is not editable; remove + add to rename.
            update.mutate(
                { id: model.id, note: trimmedNote },
                {
                    onSuccess: () => {
                        toast.show({ message: 'Note updated', detail: model.model_name });
                        onClose();
                    },
                    onError: (err) => {
                        toast.show({
                            message: 'Could not save note',
                            detail: err instanceof Error ? err.message : String(err),
                        });
                    },
                }
            );
        } else {
            create.mutate(
                { cli, model_name: trimmedName, note: trimmedNote },
                {
                    onSuccess: () => {
                        toast.show({ message: 'Model added to registry', detail: trimmedName });
                        onClose();
                    },
                    onError: (err) => {
                        toast.show({
                            message: 'Could not add model',
                            detail: err instanceof Error ? err.message : String(err),
                        });
                    },
                }
            );
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{ sx: { borderRadius: '14px', m: 2 } }}
        >
            <Box sx={{ p: 5 }}>
                <Typography
                    sx={{
                        fontSize: 18,
                        fontWeight: 700,
                        color: ATLAS_PALETTE.slate,
                        mb: 1,
                    }}
                >
                    {isEdit ? 'Edit model' : 'Add model'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 4 }}>
                    {cliLabel}
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                mb: 1,
                            }}
                        >
                            Model name
                        </Typography>
                        <TextField
                            fullWidth
                            size="small"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={isEdit}
                            placeholder={MODEL_NAME_PLACEHOLDER[cli]}
                            inputProps={{ style: { fontFamily: MONO } }}
                            helperText={
                                isEdit
                                    ? 'Model name is locked. Remove and add again to rename.'
                                    : undefined
                            }
                        />
                    </Box>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                mb: 1,
                            }}
                        >
                            Note
                        </Typography>
                        <TextField
                            fullWidth
                            size="small"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional — e.g. 'Best for plans'"
                            multiline
                            minRows={2}
                            maxRows={4}
                        />
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 5 }}>
                    <Button
                        onClick={onClose}
                        disabled={pending}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="success"
                        onClick={submit}
                        disabled={pending || (!isEdit && !name.trim())}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {pending ? 'Saving…' : isEdit ? 'Save' : 'Add model'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}
