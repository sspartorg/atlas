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

// Soft fills from the theme so the chips flip with dark mode.
const ok = { color: ATLAS_PALETTE.success, bg: ATLAS_PALETTE.successSoft };
const bad = { color: ATLAS_PALETTE.error, bg: ATLAS_PALETTE.dangerSoft };
const warn = { color: ATLAS_PALETTE.gold, bg: ATLAS_PALETTE.warnSoft };
const info = { color: ATLAS_PALETTE.brandBlue, bg: ATLAS_PALETTE.accentSoft };
const quiet = { color: ATLAS_PALETTE.slate60, bg: ATLAS_PALETTE.slate08 };

// One entry per event_type the API produces (grep `event_type:` / `eventType:`
// in packages/api/src/services). `agent_completed` is no longer produced but
// older rows still carry it.
const EVENT_META: Record<string, IconMeta> = {
    workflow_run: { icon: 'workflow', label: 'Workflow', ...info },
    agent_completed: { icon: 'task_alt', label: 'Agent Completed', ...ok },
    agent_completed_no_item: { icon: 'task_alt', label: 'Agent Run Finished', ...ok },
    agent_error: { icon: 'error', label: 'Agent Failed', ...bad },
    agent_error_no_item: { icon: 'error', label: 'Agent Run Failed', ...bad },
    ci_failed: { icon: 'bug_report', label: 'CI Failed', ...bad },
    reminder: { icon: 'alarm', label: 'Reminder', ...warn },
    jira_sync: { icon: 'sync_alt', label: 'Jira', ...info },
    'terminal.waiting_for_input': { icon: 'terminal', label: 'Terminal Waiting', ...warn },
    autofetch_success: { icon: 'sync', label: 'Auto-fetch Success', ...ok },
    autofetch_skipped: { icon: 'sync_disabled', label: 'Auto-fetch Skipped', ...quiet },
    autofetch_failed: { icon: 'cloud_off', label: 'Auto-fetch Failed', ...bad },
    autofetch_conflict: { icon: 'merge_type', label: 'Auto-fetch Conflict', ...warn },
    autofetch_disabled: { icon: 'block', label: 'Auto-fetch Disabled', ...bad },
};

export function getEventMeta(eventType: string): IconMeta {
    return (
        EVENT_META[eventType] ?? {
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
                aria-hidden="true"
                sx={{ fontSize: size * 0.6, color: meta.color }}
            >
                {meta.icon}
            </Box>
        </Box>
    );
}
