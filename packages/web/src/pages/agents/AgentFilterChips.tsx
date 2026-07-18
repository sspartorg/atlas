import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import type { AgentCategory, SdlcRole } from '@atlas/shared';
import { SDLC_ROLES, SDLC_ROLE_LABELS } from '@atlas/shared';
import { FilterPill } from '../../components/filterPrimitives.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export type FilterKey = 'all' | AgentCategory | 'favorites';
export type SortKey = 'category-role' | 'role' | 'last-run' | 'queue-depth';

// A08 — Role filter selector. `'all'` is the no-op default; selecting
// a role narrows the agent list to agents with that role_id. Autonomous
// agents (role_id = null) only appear when this is `'all'`.
export type RoleFilterKey = 'all' | SdlcRole;

interface ChipDef {
    key: FilterKey;
    label: string;
    icon: string;
    activeBg: string;
    activeFg: string;
}

const CHIPS: ChipDef[] = [
    { key: 'all', label: 'All', icon: 'apps', activeBg: ATLAS_PALETTE.slate, activeFg: ATLAS_PALETTE.onAccent },
    {
        key: 'software-dev',
        label: 'Software dev',
        icon: 'developer_board',
        activeBg: ATLAS_PALETTE.brandBlue,
        activeFg: ATLAS_PALETTE.onAccent,
    },
    {
        key: 'marketing',
        label: 'Marketing',
        icon: 'campaign',
        activeBg: ATLAS_PALETTE.fuchsia,
        activeFg: ATLAS_PALETTE.onAccent,
    },
    {
        key: 'content',
        label: 'Content',
        icon: 'edit_note',
        activeBg: ATLAS_PALETTE.eggplant,
        activeFg: ATLAS_PALETTE.onAccent,
    },
    {
        key: 'design',
        label: 'Design',
        icon: 'palette',
        activeBg: ATLAS_PALETTE.orange,
        activeFg: ATLAS_PALETTE.onAccent,
    },
    {
        key: 'favorites',
        label: 'My favorites',
        icon: 'star',
        activeBg: ATLAS_PALETTE.gold,
        activeFg: ATLAS_PALETTE.onAccent,
    },
];

interface Props {
    active: FilterKey;
    counts: Record<FilterKey, number>;
    onChange: (key: FilterKey) => void;
    sort: SortKey;
    onSortChange: (sort: SortKey) => void;
    // A08 — Role filter (separate axis from category). Optional so older
    // callers / fixtures keep compiling; defaults to 'all'.
    role?: RoleFilterKey;
    onRoleChange?: (role: RoleFilterKey) => void;
    roleCounts?: Record<RoleFilterKey, number>;
}

export function AgentFilterChips({
    active,
    counts,
    onChange,
    sort,
    onSortChange,
    role = 'all',
    onRoleChange,
    roleCounts,
}: Props) {
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 4,
                mb: 6,
                flexWrap: 'wrap',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    gap: 1.5,
                    alignItems: 'center',
                    flexWrap: { xs: 'nowrap', md: 'wrap' },
                    overflowX: { xs: 'auto', md: 'visible' },
                    pb: { xs: 1, md: 0 },
                    mx: { xs: -3, md: 0 },
                    px: { xs: 3, md: 0 },
                    '&::-webkit-scrollbar': { display: 'none' },
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                    '& > *': { flexShrink: 0 },
                    width: { xs: '100%', md: 'auto' },
                }}
            >
                {CHIPS.map((chip) => (
                    <FilterPill
                        key={chip.key}
                        label={chip.label}
                        count={counts[chip.key] ?? 0}
                        selected={active === chip.key}
                        onClick={() => onChange(chip.key)}
                        icon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16, opacity: active === chip.key ? 1 : 0.7 }}
                            >
                                {chip.icon}
                            </Box>
                        }
                        accentColor={{ bg: chip.activeBg, fg: chip.activeFg }}
                    />
                ))}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                {onRoleChange ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            Role:
                        </Typography>
                        <Select
                            value={role}
                            onChange={(e) => onRoleChange(e.target.value as RoleFilterKey)}
                            variant="standard"
                            disableUnderline
                            sx={{
                                fontSize: 12.5,
                                fontWeight: 500,
                                color: ATLAS_PALETTE.slate,
                                '& .MuiSelect-select': { py: 0.5, pr: 3 },
                            }}
                        >
                            <MenuItem value="all">
                                All roles{roleCounts ? ` (${roleCounts.all})` : ''}
                            </MenuItem>
                            {SDLC_ROLES.map((r) => {
                                const n = roleCounts?.[r] ?? 0;
                                return (
                                    <MenuItem key={r} value={r}>
                                        {SDLC_ROLE_LABELS[r]}
                                        {roleCounts ? ` (${n})` : ''}
                                    </MenuItem>
                                );
                            })}
                        </Select>
                    </Box>
                ) : null}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>Sort:</Typography>
                    <Select
                    value={sort}
                    onChange={(e) => onSortChange(e.target.value as SortKey)}
                    variant="standard"
                    disableUnderline
                    sx={{
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: ATLAS_PALETTE.slate,
                        '& .MuiSelect-select': { py: 0.5, pr: 3 },
                    }}
                >
                    <MenuItem value="category-role">Category, then role</MenuItem>
                    <MenuItem value="role">Role A → Z</MenuItem>
                    <MenuItem value="last-run">Last run</MenuItem>
                    <MenuItem value="queue-depth">Queue depth</MenuItem>
                    </Select>
                </Box>
            </Box>
        </Box>
    );
}
