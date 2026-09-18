import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IAgent } from '@atlas/shared';
import { SearchTextInput } from '../../components/SearchTextInput.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export const PALETTE_MIME = 'application/x-atlas-workflow-node';

export interface IPaletteItem {
    type: 'agent' | 'owner' | 'subtasks' | 'end';
    agent_id?: string;
}

interface ChipProps {
    item: IPaletteItem;
    label: string;
    icon: string;
    color: string;
    onAdd: (item: IPaletteItem) => void;
}

function PaletteChip({ item, label, icon, color, onAdd }: ChipProps) {
    return (
        <Box
            role="button"
            tabIndex={0}
            draggable
            aria-label={`Add ${label}`}
            onDragStart={(e) => {
                e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(item));
                e.dataTransfer.effectAllowed = 'move';
            }}
            // Click adds at the canvas centre — the only way in on touch
            // screens, where HTML5 drag-and-drop doesn't fire.
            onClick={() => onAdd(item)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onAdd(item);
            }}
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                px: 2.5,
                py: 2,
                borderRadius: '8px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: ATLAS_PALETTE.white,
                cursor: 'grab',
                minWidth: 0,
                flexShrink: 0,
                transition: 'border-color 120ms ease, background 120ms ease',
                '&:hover': { borderColor: ATLAS_PALETTE.slate30, background: ATLAS_PALETTE.cloud },
                '&:active': { cursor: 'grabbing' },
            }}
        >
            <Box
                component="span"
                sx={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }}
            />
            <Typography
                sx={{
                    flex: 1,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: ATLAS_PALETTE.slate,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }}
            >
                {label}
            </Typography>
            <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 16, color: ATLAS_PALETTE.slate40 }}>
                {icon}
            </Box>
        </Box>
    );
}

function Heading({ children }: { children: string }) {
    return (
        <Typography variant="overline" sx={{ color: ATLAS_PALETTE.slate60, display: 'block', mt: 1 }}>
            {children}
        </Typography>
    );
}

interface PaletteProps {
    agents: IAgent[];
    /** Sub-tasks steps belong to workflows that run on a Task. */
    showSubtasks: boolean;
    onAdd: (item: IPaletteItem) => void;
}

export function NodePalette({ agents, showSubtasks, onAdd }: PaletteProps) {
    const [q, setQ] = useState('');
    const needle = q.trim().toLowerCase();
    const shown = agents.filter((a) => !needle || a.name.toLowerCase().includes(needle));
    return (
        <Box
            aria-label="Node palette"
            sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                p: 3,
                borderRadius: '12px',
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                background: ATLAS_PALETTE.white,
                minHeight: 0,
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
            }}
        >
            <Heading>Flow</Heading>
            <PaletteChip item={{ type: 'owner' }} label="Owner" icon="person" color={ATLAS_PALETTE.warning} onAdd={onAdd} />
            {showSubtasks && (
                <PaletteChip item={{ type: 'subtasks' }} label="Sub-tasks" icon="checklist" color={ATLAS_PALETTE.brandBlue} onAdd={onAdd} />
            )}
            <PaletteChip item={{ type: 'end' }} label="End" icon="flag" color={ATLAS_PALETTE.success} onAdd={onAdd} />
            <Heading>Agents</Heading>
            <SearchTextInput value={q} onChange={setQ} label="Search agents" minWidth={0} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, overflowY: 'auto', minHeight: 0 }}>
                {shown.map((a) => (
                    <PaletteChip
                        key={a.id}
                        item={{ type: 'agent', agent_id: a.id }}
                        label={a.name}
                        icon="drag_indicator"
                        color={a.accent_color}
                        onAdd={onAdd}
                    />
                ))}
                {shown.length === 0 && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, py: 2 }}>
                        {agents.length === 0 ? 'No agents installed.' : 'No agents match.'}
                    </Typography>
                )}
            </Box>
        </Box>
    );
}
