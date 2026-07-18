import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface IconMeta {
    icon: string;
    label: string;
    color: string;
    bg: string;
}

const DEFAULT: IconMeta = {
    icon: 'notifications',
    label: 'Notification',
    color: ATLAS_PALETTE.slate60,
    bg: ATLAS_PALETTE.slate08,
};

const MAP: Record<string, IconMeta> = {
    agent_completed: {
        icon: 'task_alt',
        label: 'Agent Completed',
        color: ATLAS_PALETTE.success,
        bg: 'rgba(49,171,70,.12)',
    },
    agent_error: {
        icon: 'error',
        label: 'Agent Failed',
        color: ATLAS_PALETTE.error,
        bg: 'rgba(220,38,38,.10)',
    },
    autofetch_success: {
        icon: 'sync',
        label: 'Auto-fetch Success',
        color: ATLAS_PALETTE.success,
        bg: 'rgba(49,171,70,.12)',
    },
    autofetch_skipped: {
        icon: 'sync_disabled',
        label: 'Auto-fetch Skipped',
        color: ATLAS_PALETTE.slate60,
        bg: ATLAS_PALETTE.slate08,
    },
    autofetch_failed: {
        icon: 'cloud_off',
        label: 'Auto-fetch Failed',
        color: ATLAS_PALETTE.error,
        bg: 'rgba(220,38,38,.10)',
    },
    autofetch_conflict: {
        icon: 'merge_type',
        label: 'Auto-fetch Conflict',
        color: ATLAS_PALETTE.warning,
        bg: 'rgba(199,83,47,.10)',
    },
    autofetch_disabled: {
        icon: 'block',
        label: 'Auto-fetch Disabled',
        color: ATLAS_PALETTE.error,
        bg: 'rgba(220,38,38,.10)',
    },
    pr_opened: {
        icon: 'merge',
        label: 'PR Ready for Review',
        color: ATLAS_PALETTE.purple,
        bg: 'rgba(70,33,124,.12)',
    },
    pr_merged: {
        icon: 'call_merge',
        label: 'PR Merged',
        color: ATLAS_PALETTE.success,
        bg: 'rgba(49,171,70,.12)',
    },
    story_complete: {
        icon: 'check_circle',
        label: 'Story Complete',
        color: ATLAS_PALETTE.success,
        bg: 'rgba(49,171,70,.12)',
    },
    waiting_for_info: {
        icon: 'help_outline',
        label: 'Waiting for Info',
        color: ATLAS_PALETTE.gold,
        bg: 'rgba(223,172,45,.16)',
    },
    subtask_blocked: {
        icon: 'block',
        label: 'Sub-task Blocked',
        color: ATLAS_PALETTE.error,
        bg: 'rgba(220,38,38,.10)',
    },
    guardrails_updated: {
        icon: 'shield',
        label: 'Guard-rails Updated',
        color: ATLAS_PALETTE.brandBlue,
        bg: ATLAS_PALETTE.cloud,
    },
};

export function getEventMeta(eventType: string): IconMeta {
    return (
        MAP[eventType] ?? {
            ...DEFAULT,
            label: eventType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        }
    );
}

interface Props {
    eventType: string;
    size?: number;
}

export function EventTypeIcon({ eventType, size = 28 }: Props) {
    const meta = getEventMeta(eventType);
    return (
        <Box
            sx={{
                width: size,
                height: size,
                borderRadius: '8px',
                bgcolor: meta.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            <Box
                component="span"
                className="material-symbols-rounded"
                sx={{ fontSize: size * 0.6, color: meta.color }}
            >
                {meta.icon}
            </Box>
        </Box>
    );
}
