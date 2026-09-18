import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import type { ISubTask } from '@atlas/shared';
import { useReorderSubTasks } from '../../hooks/useTasks.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';

interface Props {
    taskId: string;
    subTasks: ISubTask[];
    onClose: () => void;
}

function Arrow({ name }: { name: string }) {
    return (
        <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 18 }}>
            {name}
        </Box>
    );
}

/** Sets the order a Task's Sub-tasks steps run its open sub-tasks in. */
export function ReorderSubTasksDialog({ taskId, subTasks, onClose }: Props) {
    const [order, setOrder] = useState(subTasks);
    const reorder = useReorderSubTasks();
    const move = (i: number, by: -1 | 1) =>
        setOrder((o) => {
            const next = [...o];
            const [row] = next.splice(i, 1);
            if (row) next.splice(i + by, 0, row);
            return next;
        });

    return (
        <Dialog open onClose={reorder.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pb: 1 }}>Sub-task order</DialogTitle>
            <DialogContent sx={{ pt: '8px !important' }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                    The Task&apos;s workflow runs its open sub-tasks top to bottom, one at a time.
                </Typography>
                <Box component="ol" aria-label="Sub-task order" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                    {order.map((s, i) => (
                        <Box
                            component="li"
                            key={s.id}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 2,
                                py: 1.5,
                                borderTop: i === 0 ? 0 : `1px solid ${ATLAS_PALETTE.slate06}`,
                            }}
                        >
                            <Typography sx={{ fontSize: 11.5, fontFamily: TYPOGRAPHY.fontFamilyMono, color: ATLAS_PALETTE.slate60, minWidth: 64 }}>
                                {s.id}
                            </Typography>
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, flex: 1, minWidth: 0 }} noWrap>
                                {s.title}
                            </Typography>
                            <IconButton size="small" aria-label={`Move ${s.id} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                                <Arrow name="arrow_upward" />
                            </IconButton>
                            <IconButton
                                size="small"
                                aria-label={`Move ${s.id} down`}
                                disabled={i === order.length - 1}
                                onClick={() => move(i, 1)}
                            >
                                <Arrow name="arrow_downward" />
                            </IconButton>
                        </Box>
                    ))}
                </Box>
                {reorder.error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                        {reorder.error.message}
                    </Alert>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                <Button variant="outlined" onClick={onClose} disabled={reorder.isPending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    disabled={reorder.isPending}
                    onClick={() =>
                        reorder.mutate({ taskId, ids: order.map((s) => s.id) }, { onSuccess: onClose })
                    }
                    sx={{
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {reorder.isPending ? 'Saving…' : 'Save order'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
