import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import type { IAgent } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    agent: IAgent | null;
    busy?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

export function DeleteAgentModal({ open, agent, busy = false, onConfirm, onClose }: Props) {
    if (!agent) return null;

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    fontSize: 17,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    pb: 1,
                }}
            >
                <Box
                    sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '8px',
                        bgcolor: 'rgba(220,38,38,.10)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <WarningAmberRounded sx={{ color: ATLAS_PALETTE.error, fontSize: 18 }} />
                </Box>
                Delete {agent.name}?
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, mb: 2 }}>
                    Removes this agent from Atlas. Its prompt, handoff rules, allowed tools,
                    memory, and run history are wiped. This cannot be undone.
                </Typography>
                <Alert
                    severity="warning"
                    sx={{
                        bgcolor: 'rgba(199,83,47,.08)',
                        border: `1px solid rgba(199,83,47,.22)`,
                        color: ATLAS_PALETTE.slate,
                        '& .MuiAlert-message': { fontSize: 12, lineHeight: 1.5 },
                    }}
                >
                    Queued runs assigned to <strong>{agent.name}</strong> are dropped — they
                    will not re-route to another agent automatically.
                </Alert>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
                <Button
                    onClick={onClose}
                    disabled={busy}
                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                >
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={onConfirm}
                    disabled={busy}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                    {busy ? 'Deleting…' : 'Delete agent'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
