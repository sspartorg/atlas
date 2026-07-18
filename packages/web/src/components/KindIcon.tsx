import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import FlagRounded from '@mui/icons-material/FlagRounded';
import LayersRounded from '@mui/icons-material/LayersRounded';
import BugReportRounded from '@mui/icons-material/BugReportRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import PestControlRounded from '@mui/icons-material/PestControlRounded';
import type { IssueType } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const CONFIG = {
    epic: {
        label: 'Epic',
        Icon: FlagRounded,
        color: ATLAS_PALETTE.cerulean,
        bg: 'rgba(0,185,255,.12)',
    },
    story: {
        label: 'Story',
        Icon: LayersRounded,
        color: ATLAS_PALETTE.brandBlue,
        bg: 'rgba(0,122,201,.10)',
    },
    bug: {
        label: 'Bug',
        Icon: BugReportRounded,
        color: ATLAS_PALETTE.error,
        bg: 'rgba(220,38,38,.10)',
    },
    sub_task: {
        label: 'Sub-task',
        Icon: CheckCircleOutlineRounded,
        color: ATLAS_PALETTE.green,
        bg: 'rgba(49,171,70,.12)',
    },
    sub_bug: {
        label: 'Sub-bug',
        Icon: PestControlRounded,
        color: ATLAS_PALETTE.orange,
        bg: 'rgba(199,83,47,.14)',
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
