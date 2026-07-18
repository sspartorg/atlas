import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    /** Visual tone of the confirm button. 'destructive' uses the error color
     *  (Detach), 'warning' uses an amber (Dismiss / irreversible-but-not-
     *  destructive), 'primary' is the default green (Accept / install). */
    tone?: 'primary' | 'warning' | 'destructive';
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmActionModal({
    open,
    title,
    body,
    confirmLabel,
    tone = 'primary',
    busy = false,
    onConfirm,
    onCancel,
}: Props) {
    const confirmSx =
        tone === 'destructive'
            ? {
                  bgcolor: ATLAS_PALETTE.error,
                  '&:hover': { bgcolor: ATLAS_PALETTE.error, opacity: 0.9, boxShadow: 'none' },
              }
            : tone === 'warning'
              ? {
                    bgcolor: '#D97706',
                    '&:hover': { bgcolor: '#B45309', boxShadow: 'none' },
                }
              : {
                    bgcolor: ATLAS_PALETTE.green,
                    '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                };

    return (
        <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>{title}</DialogTitle>
            <DialogContent>
                <Typography sx={{ fontSize: 13.5, color: ATLAS_PALETTE.slate70, whiteSpace: 'pre-line' }}>
                    {body}
                </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button onClick={onCancel} sx={{ textTransform: 'none' }} disabled={busy}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={onConfirm}
                    disabled={busy}
                    sx={{ textTransform: 'none', fontWeight: 600, boxShadow: 'none', ...confirmSx }}
                >
                    {busy ? 'Working…' : confirmLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
