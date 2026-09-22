import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { IWorkflow } from '@atlas/shared';
import { WorkflowTriggerFields } from './WorkflowTriggerFields.js';

interface Props {
    open: boolean;
    workflow: IWorkflow;
    onChange: (patch: Partial<IWorkflow>) => void;
    onClose: () => void;
}

/**
 * Reaching the schedule used to mean opening the canvas and selecting the Start
 * node, so workflows sat on `manual` and the orchestrator read as a button.
 *
 * Edits the builder's DRAFT through the same `onChange` the inspector uses,
 * rather than PATCHing on its own — one save path, so this can't fight the
 * unsaved-changes guard.
 */
export function WorkflowScheduleDialog({ open, workflow, onChange, onClose }: Props) {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600 }}>Schedule</DialogTitle>
            <DialogContent sx={{ pt: '8px !important' }}>
                <DialogContentText sx={{ fontSize: 13, mb: 3 }}>
                    A scheduled run takes the Tasks that were ready at its last fire, up to
                    its Tasks-in-parallel limit; later ones wait for the next fire. On item
                    ready starts a Task within a minute of it becoming ready.
                </DialogContentText>
                <WorkflowTriggerFields workflow={workflow} onChange={onChange} />
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4 }}>
                <Button variant="contained" onClick={onClose}>
                    Done
                </Button>
            </DialogActions>
        </Dialog>
    );
}
