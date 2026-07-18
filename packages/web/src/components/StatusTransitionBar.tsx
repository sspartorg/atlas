import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { getValidNextStatuses } from '@atlas/shared';
import type { IssueType, IssueStatus } from '@atlas/shared';
import { StatusChip } from './StatusChip.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    issueType: Exclude<IssueType, 'sub_task'>;
    currentStatus: IssueStatus;
    onTransition: (status: string) => void;
    loading?: boolean;
}

export function StatusTransitionBar({ issueType, currentStatus, onTransition, loading }: Props) {
    const nextStatuses = getValidNextStatuses(issueType, currentStatus);

    if (nextStatuses.length === 0) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40 }}>
                    Status
                </Typography>
                <StatusChip status={currentStatus} />
                <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.success, fontWeight: 500 }}>
                    · Terminal
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40, flexShrink: 0 }}>
                Transition to
            </Typography>
            {nextStatuses.map((status) => (
                <Button
                    key={status}
                    variant="outlined"
                    size="small"
                    onClick={() => onTransition(status)}
                    disabled={Boolean(loading)}
                    sx={{
                        height: 28,
                        fontSize: 12,
                        textTransform: 'none',
                        fontFamily: '"Inter", system-ui, sans-serif',
                        borderColor: ATLAS_PALETTE.slate12,
                        color: ATLAS_PALETTE.slate60,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.brandBlue,
                            color: ATLAS_PALETTE.slate,
                            background: ATLAS_PALETTE.slate08,
                        },
                    }}
                >
                    {status.replace(/_/g, ' ')}
                </Button>
            ))}
        </Box>
    );
}
