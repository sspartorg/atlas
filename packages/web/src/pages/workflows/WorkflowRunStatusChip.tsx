import Box from '@mui/material/Box';
import type { WorkflowRunStatus } from '@atlas/shared';
import { WORKFLOW_RUN_STATUS_PALETTE } from '../../theme/workflowRunStatusPalette.js';

export function WorkflowRunStatusChip({ status }: { status: WorkflowRunStatus }) {
    const cfg = WORKFLOW_RUN_STATUS_PALETTE[status];
    return (
        <Box
            component="span"
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1.5,
                height: 22,
                px: 2.25,
                borderRadius: '9999px',
                background: cfg.bg,
                color: cfg.fg,
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                flexShrink: 0,
            }}
        >
            <Box
                component="span"
                sx={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot }}
            />
            {cfg.label}
        </Box>
    );
}
