import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import { useProjects } from '../../hooks/useProjects.js';
import { useEpics } from '../../hooks/useEpics.js';
import { useStories } from '../../hooks/useStories.js';
import { useAgents } from '../../hooks/useAgents.js';
import { useBugs } from '../../hooks/useBugs.js';
import { useToast } from '../../hooks/useToast.js';
import { api } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { FormHeading } from '../../components/FormHeading.js';

const MONO = '"JetBrains Mono", monospace';
const CONFIRM_PHRASE = 'RESET';

interface Props {
    open: boolean;
    onClose: () => void;
}

export function ResetWorkspaceModal({ open, onClose }: Props) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: projects = [] } = useProjects();
    const { data: epics = [] } = useEpics();
    const { data: stories = [] } = useStories();
    const { data: agents = [] } = useAgents();
    const { data: bugs = [] } = useBugs();
    const toast = useToast();
    const [confirmInput, setConfirmInput] = useState('');
    const [resetting, setResetting] = useState(false);

    useEffect(() => {
        if (!open) {
            setConfirmInput('');
            setResetting(false);
        }
    }, [open]);

    const canSubmit = confirmInput.trim() === CONFIRM_PHRASE && !resetting;

    async function handleReset() {
        setResetting(true);
        try {
            await api.settings.reset();
            queryClient.clear();
            navigate('/', { replace: true });
        } catch (err) {
            setResetting(false);
            toast.show({
                message: 'Reset failed',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    function handleClose() {
        if (resetting) return;
        onClose();
    }

    const stats: Array<{ label: string; count: number }> = [
        { label: 'agents', count: agents.length },
        { label: 'projects', count: projects.length },
        { label: 'epics', count: epics.length },
        { label: 'stories', count: stories.length },
        { label: 'bugs', count: bugs.length },
    ];

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            disableEscapeKeyDown={resetting}
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.white,
                    boxShadow: '0 24px 48px rgba(0,0,0,.18)',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, p: 5, pb: 0 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        bgcolor: 'rgba(220,38,38,.10)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <WarningAmberRounded sx={{ color: ATLAS_PALETTE.error, fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>Reset all workspace data?</FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        This wipes Atlas and returns to onboarding. It cannot be undone.
                    </Typography>
                </Box>
                <IconButton onClick={handleClose} size="small" disabled={resetting}>
                    <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                </IconButton>
            </Box>

            <Box sx={{ p: 5, pt: 4 }}>
                <Alert
                    icon={<WarningAmberRounded sx={{ color: ATLAS_PALETTE.error }} />}
                    sx={{
                        bgcolor: 'rgba(220,38,38,.06)',
                        border: `1px solid rgba(220,38,38,.18)`,
                        color: ATLAS_PALETTE.slate,
                        mb: 3,
                        '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.6 },
                    }}
                >
                    <strong>You will lose all content.</strong> Every project, epic, story, bug,
                    sub-task, comment, agent run, notification, and saved schedule will be
                    permanently removed from the local database. Git repositories on disk are not
                    touched. The external notification channel and saved credentials will also be cleared.
                </Alert>

                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 2,
                    }}
                >
                    What you'll lose
                </Typography>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: 2,
                        mb: 4,
                    }}
                >
                    {stats.map((s) => (
                        <Box
                            key={s.label}
                            sx={{
                                p: 2,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '8px',
                                textAlign: 'center',
                                bgcolor: ATLAS_PALETTE.white,
                            }}
                        >
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 18,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                {s.count}
                            </Typography>
                            <Typography
                                sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 0.5 }}
                            >
                                {s.label}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                <Alert
                    severity="error"
                    icon={<WarningAmberRounded sx={{ color: ATLAS_PALETTE.error }} />}
                    sx={{
                        bgcolor: 'rgba(220,38,38,.06)',
                        border: `1px solid rgba(220,38,38,.18)`,
                        color: ATLAS_PALETTE.slate,
                        mb: 2,
                        '& .MuiAlert-message': { fontSize: 12 },
                    }}
                >
                    Type{' '}
                    <Box component="span" sx={{ fontFamily: MONO, fontWeight: 700 }}>
                        {CONFIRM_PHRASE}
                    </Box>{' '}
                    to confirm.
                </Alert>
                <TextField
                    fullWidth
                    size="small"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={CONFIRM_PHRASE}
                    autoFocus
                    disabled={resetting}
                    sx={{
                        '& .MuiOutlinedInput-root': {
                            fontFamily: MONO,
                            fontSize: 13,
                        },
                    }}
                />

                <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                    <Button
                        onClick={handleClose}
                        disabled={resetting}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => void handleReset()}
                        disabled={!canSubmit}
                        startIcon={
                            resetting ? <CircularProgress size={14} color="inherit" /> : undefined
                        }
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        {resetting ? 'Resetting…' : 'Reset Everything'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}
