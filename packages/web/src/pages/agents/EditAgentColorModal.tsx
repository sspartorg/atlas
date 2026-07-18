import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { IAgent } from '@atlas/shared';
import { useUpdateAgent } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { AccentColorPicker } from '../settings/AccentColorPicker.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    open: boolean;
    agent: IAgent;
    onClose: () => void;
}

export function EditAgentColorModal({ open, agent, onClose }: Props) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const [color, setColor] = useState(agent.accent_color);

    useEffect(() => {
        if (open) setColor(agent.accent_color);
    }, [open, agent.accent_color]);

    function handleSave() {
        if (color === agent.accent_color) {
            onClose();
            return;
        }
        updateAgent.mutate(
            { id: agent.id, data: { accent_color: color } },
            {
                onSuccess: () => {
                    toast.show({ message: 'Accent color updated' });
                    onClose();
                },
                onError: (e) =>
                    toast.show({
                        message: 'Could not update color',
                        detail: (e as Error).message,
                    }),
            }
        );
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle
                sx={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    pb: 1,
                }}
            >
                Edit accent color
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mb: 3 }}>
                    The accent appears on this agent&apos;s avatar, card border, and chip across
                    the app.
                </Typography>
                <AccentColorPicker value={color} onChange={setColor} />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
                <Button onClick={onClose} sx={{ textTransform: 'none' }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={updateAgent.isPending}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.green,
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                    }}
                >
                    {updateAgent.isPending ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
