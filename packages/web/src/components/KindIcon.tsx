import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import FlagRounded from '@mui/icons-material/FlagRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import type { IssueType } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const CONFIG = {
    task: {
        label: 'Task',
        Icon: FlagRounded,
        color: ATLAS_PALETTE.cerulean,
        bg: 'rgba(0,185,255,.12)',
    },
    sub_task: {
        label: 'Sub-task',
        Icon: CheckCircleOutlineRounded,
        color: ATLAS_PALETTE.green,
        bg: 'rgba(49,171,70,.12)',
    },
} as const;

interface Props {
    kind: IssueType;
    size?: number | undefined;
}

export function KindIcon({ kind, size = 16 }: Props) {
    const cfg = CONFIG[kind];
    const { Icon } = cfg;
    return (
        <Tooltip title={cfg.label} placement="top">
            <Box
                component="span"
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: size + 8,
                    height: size + 8,
                    borderRadius: '6px',
                    background: cfg.bg,
                    color: cfg.color,
                    flexShrink: 0,
                    cursor: 'help',
                }}
                aria-label={cfg.label}
            >
                <Icon sx={{ fontSize: size }} />
            </Box>
        </Tooltip>
    );
}
