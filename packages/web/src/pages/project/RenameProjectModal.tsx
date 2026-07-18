import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import type { IProject } from '@atlas/shared';
import { useUpdateProject } from '../../hooks/useProjects.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    open: boolean;
    project: IProject | null;
    displayId: string;
    onClose: () => void;
}

export function RenameProjectModal({ open, project, displayId, onClose }: Props) {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const updateProject = useUpdateProject();
    const toast = useToast();

    useEffect(() => {
        if (open && project) {
            setDraft(project.name);
            setError(null);
        }
    }, [open, project]);

    if (!project) return null;

    const trimmed = draft.trim();
    const isUnchanged = trimmed === project.name;
    const isEmpty = trimmed.length === 0;
    const canSave = !isEmpty && !isUnchanged && !updateProject.isPending;

    async function handleSave() {
        if (!project || !canSave) return;
        setError(null);
        try {
            await updateProject.mutateAsync({ id: project.id, data: { name: trimmed } });
            toast.show({ message: `Renamed to ${trimmed}` });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not rename project');
        }
    }

    return (
        <Dialog
            open={open}
            onClose={updateProject.isPending ? undefined : onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    boxShadow: '0 16px 40px rgba(0,0,14,.14)',
                    // Stay a centered dialog on phones (matches NewProjectModal /
                    // ConfirmDeleteModal); fullScreen on mobile produced a
                    // page-like sheet that broke continuity with the parent UI.
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ p: 0 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 2.5,
                        px: 4,
                        pt: 4,
                        pb: 3,
                    }}
                >
                    <Box
                        sx={{
                            width: 36,
                            height: 36,
                            borderRadius: '8px',
                            bgcolor: ATLAS_PALETTE.slate06,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        <DriveFileRenameOutlineRounded sx={{ fontSize: 20 }} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <Typography
                                sx={{
                                    fontSize: 16,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                Rename project
                            </Typography>
                            <Box
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: '4px',
                                    bgcolor: ATLAS_PALETTE.slate06,
                                }}
                            >
                                {displayId}
                            </Box>
                        </Box>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                            Display label only. The workspace folder on disk and all git
                            operations are unaffected.
                        </Typography>
                    </Box>
                    <IconButton onClick={onClose} size="small" disabled={updateProject.isPending}>
                        <CloseRounded />
                    </IconButton>
                </Box>

                <Box sx={{ px: 4, pb: 4 }}>
                    <TextField
                        fullWidth
                        autoFocus
                        size="small"
                        label="Project name"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && canSave) {
                                e.preventDefault();
                                void handleSave();
                            }
                        }}
                        disabled={updateProject.isPending}
                        inputProps={{ maxLength: 120 }}
                    />
                    {error && (
                        <Alert
                            severity="error"
                            sx={{
                                mt: 2,
                                py: 0.5,
                                '& .MuiAlert-message': { fontSize: 12, py: 0.5 },
                            }}
                        >
                            {error}
                        </Alert>
                    )}
                </Box>

                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 1.5,
                        px: 4,
                        py: 3,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                    }}
                >
                    <Button
                        onClick={onClose}
                        disabled={updateProject.isPending}
                        sx={{ textTransform: 'none', fontWeight: 500 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void handleSave()}
                        disabled={!canSave}
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            bgcolor: ATLAS_PALETTE.green,
                            boxShadow: 'none',
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                        }}
                    >
                        {updateProject.isPending ? 'Saving…' : 'Save'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}
