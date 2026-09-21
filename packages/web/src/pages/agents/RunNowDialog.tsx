import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useMutation } from '@tanstack/react-query';
import type { IAgent } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { PromptPreviewDialog } from './PromptPreviewDialog.js';
import { ApiErrorAlert } from '../../components/ApiErrorAlert.js';
import { CliUnavailableAlert } from '../../components/CliUnavailableAlert.js';

interface Props {
    open: boolean;
    agent: IAgent;
    onClose: () => void;
}

// Item-attached ad-hoc runs are gone (ADR 0014): work on an item runs through
// its workflow. This dialog only starts a project-level run with no item.
export function RunNowDialog({ open, agent, onClose }: Props) {
    const navigate = useNavigate();
    const toast = useToast();

    const triggerRun = useMutation({
        mutationFn: () => api.run.trigger(agent.id, null, null),
        onSuccess: ({ runId }) => {
            toast.show({ message: `${agent.name} run queued`, detail: runId.slice(0, 8) });
            onClose();
            navigate(`/agents/${agent.id}/runs/${runId}`);
        },
        onError: (e) =>
            toast.show({
                message: 'Could not start run',
                detail: (e as Error).message,
            }),
    });

    const [previewOpen, setPreviewOpen] = useState(false);
    const compilePreview = useMutation({
        mutationFn: () => api.agents.compilePrompt(agent.id, null, null),
        onMutate: () => {
            setPreviewOpen(true);
        },
        onError: (e) => {
            setPreviewOpen(false);
            toast.show({
                message: 'Could not compile prompt',
                detail: (e as Error).message,
            });
        },
    });

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
            PaperProps={{ sx: { borderRadius: '12px' } }}
        >
            <DialogTitle
                sx={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    pb: 1,
                }}
            >
                {`Run ${agent.name}`}
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Typography
                    sx={{
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate60,
                        mb: 3,
                    }}
                >
                    Starts a run with no item. It spawns immediately and streams output into the
                    Runs tab. To run an agent on an item, assign the item to a workflow.
                </Typography>

                {triggerRun.error && (
                    <Box sx={{ mb: 2 }}>
                        <ApiErrorAlert error={triggerRun.error} contextLabel="Couldn't start run" />
                    </Box>
                )}

                <CliUnavailableAlert cli={agent.cli} sx={{ mb: 2 }} />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3, gap: 1, flexWrap: 'wrap' }}>
                <Button
                    onClick={onClose}
                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                >
                    Cancel
                </Button>
                <Box sx={{ flex: 1 }} />
                <Button
                    variant="outlined"
                    onClick={() => compilePreview.mutate()}
                    disabled={compilePreview.isPending || triggerRun.isPending}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 18 }}
                        >
                            visibility
                        </Box>
                    }
                    sx={{
                        textTransform: 'none',
                        color: ATLAS_PALETTE.brandBlue,
                        borderColor: ATLAS_PALETTE.slate12,
                        bgcolor: ATLAS_PALETTE.white,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.brandBlue,
                            bgcolor: ATLAS_PALETTE.cloud,
                        },
                    }}
                >
                    {compilePreview.isPending ? 'Compiling…' : 'Preview prompt'}
                </Button>
                <Button
                    variant="contained"
                    onClick={() => triggerRun.mutate()}
                    disabled={triggerRun.isPending}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 18 }}
                        >
                            play_arrow
                        </Box>
                    }
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {triggerRun.isPending ? 'Starting…' : 'Run now'}
                </Button>
            </DialogActions>

            <PromptPreviewDialog
                open={previewOpen}
                data={compilePreview.data ?? null}
                onClose={() => setPreviewOpen(false)}
            />
        </Dialog>
    );
}
