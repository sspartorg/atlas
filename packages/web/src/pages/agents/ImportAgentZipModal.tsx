import { useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import FileUploadRounded from '@mui/icons-material/FileUploadRounded';
import { useQueryClient } from '@tanstack/react-query';
import type { IAgent } from '@atlas/shared';
import { api } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    onClose: () => void;
    onImported: (agent: IAgent) => void;
}

export function ImportAgentZipModal({ open, onClose, onImported }: Props) {
    const fileRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [agentId, setAgentId] = useState('');
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** When the manifest's id (or the override) is already taken locally,
     *  the server returns 409 with a suggested alternate; the input flips
     *  into "rename" mode and the user picks a new slug. */
    const [slugTaken, setSlugTaken] = useState<
        | { conflictingId: string; suggestedId: string }
        | null
    >(null);

    const reset = () => {
        setFile(null);
        setAgentId('');
        setError(null);
        setUploading(false);
        setSlugTaken(null);
        if (fileRef.current) fileRef.current.value = '';
    };

    const handleClose = () => {
        if (uploading) return;
        reset();
        onClose();
    };

    const handleSubmit = async () => {
        /* v8 ignore next */
        // Defensive guard only — the Import button's disabled={!file || uploading}
        // means handleSubmit can never fire while file is null.
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const opts: { agent_id?: string } = {};
            if (agentId.trim()) opts.agent_id = agentId.trim();
            const agent = await api.agents.importZip(file, opts);
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
            onImported(agent);
            reset();
        } catch (err) {
            const details = (err as { details?: { conflicting_id?: string; suggested_id?: string } })
                ?.details;
            if (details?.conflicting_id && details?.suggested_id) {
                setSlugTaken({
                    conflictingId: details.conflicting_id,
                    suggestedId: details.suggested_id,
                });
                setAgentId(details.suggested_id);
            } else {
                setError(err instanceof Error ? err.message : 'Import failed');
            }
        } finally {
            setUploading(false);
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>Import agent from zip</DialogTitle>
            <DialogContent>
                <Typography sx={{ fontSize: 13.5, color: ATLAS_PALETTE.slate70, mb: 3 }}>
                    Upload an agent bundle (manifest.json + prompt.md + memory.md +
                    handoff_rules.json + checklists.json). The imported agent is fully owned
                    locally — no link to the marketplace, no upgrade tracking.
                </Typography>
                <Box
                    onClick={() => fileRef.current?.click()}
                    sx={{
                        border: `2px dashed ${ATLAS_PALETTE.slate06}`,
                        borderRadius: 2,
                        p: 4,
                        textAlign: 'center',
                        cursor: 'pointer',
                        mb: 3,
                        '&:hover': { borderColor: ATLAS_PALETTE.slate60 },
                    }}
                >
                    <FileUploadRounded sx={{ fontSize: 36, color: ATLAS_PALETTE.slate60, mb: 1 }} />
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70 }}>
                        {file ? file.name : 'Click to choose a .zip file'}
                    </Typography>
                </Box>
                <input
                    ref={fileRef}
                    type="file"
                    accept=".zip,application/zip"
                    style={{ display: 'none' }}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {slugTaken ? (
                    <Box
                        sx={{
                            p: 2.5,
                            borderRadius: 1.5,
                            bgcolor: ATLAS_PALETTE.warnSoft,
                            border: `1px solid ${ATLAS_PALETTE.warnFg}`,
                            mb: 2,
                        }}
                    >
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.warnFg, fontWeight: 500, mb: 2 }}>
                            <code>{slugTaken.conflictingId}</code> is already in use locally. Pick a
                            different slug — your existing agent stays untouched.
                        </Typography>
                        <TextField
                            fullWidth
                            size="small"
                            label="New slug"
                            value={agentId}
                            onChange={(e) => setAgentId(e.target.value)}
                            autoFocus
                        />
                    </Box>
                ) : (
                    <TextField
                        fullWidth
                        size="small"
                        label="Override slug (optional)"
                        placeholder="leave blank to use manifest.id"
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                        sx={{ mb: 2 }}
                    />
                )}
                {error && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.error, mt: 2 }}>
                        {error}
                    </Typography>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button onClick={handleClose} sx={{ textTransform: 'none' }} disabled={uploading}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={!file || uploading}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {uploading ? 'Importing…' : slugTaken ? 'Import at new slug' : 'Import'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
