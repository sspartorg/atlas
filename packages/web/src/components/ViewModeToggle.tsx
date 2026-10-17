import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import TableRowsRounded from '@mui/icons-material/TableRowsRounded';
import ViewColumnRounded from '@mui/icons-material/ViewColumnRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';

export type ViewMode = 'table' | 'kanban';

interface Props {
    value: ViewMode;
    onChange: (next: ViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: Props) {
    return (
        <ToggleButtonGroup
            exclusive
            size="small"
            value={value}
            onChange={(_e, next: ViewMode | null) => {
                if (next) onChange(next);
            }}
            sx={{
                '& .MuiToggleButton-root': {
                    textTransform: 'none',
                    fontWeight: 600,
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate,
                    borderColor: ATLAS_PALETTE.slate10,
                    backgroundColor: ATLAS_PALETTE.white,
                    px: 3,
                    py: 1.5,
                    gap: 1.5,
                    '&:hover': { backgroundColor: ATLAS_PALETTE.cloud },
                    '&.Mui-selected': {
                        backgroundColor: ATLAS_PALETTE.slate,
                        color: ATLAS_PALETTE.white,
                        '&:hover': { backgroundColor: ATLAS_PALETTE.slate },
                    },
                },
            }}
        >
            <ToggleButton value="table">
                <TableRowsRounded sx={{ fontSize: 16 }} />
                Table
            </ToggleButton>
            <ToggleButton value="kanban">
                <ViewColumnRounded sx={{ fontSize: 16 }} />
                Kanban
            </ToggleButton>
        </ToggleButtonGroup>
    );
}

const STORAGE_KEY = (page: string) => `atlas.viewMode.${page}`;

// Storage can throw (blocked site data, some private windows); the view mode
// is a convenience, so fall back instead of breaking the page's render.
export function loadViewMode(page: string, fallback: ViewMode = 'table'): ViewMode {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY(page));
        if (raw === 'kanban' || raw === 'table') return raw;
    } catch {
        // fall through
    }
    return fallback;
}

export function saveViewMode(page: string, mode: ViewMode): void {
    try {
        window.localStorage.setItem(STORAGE_KEY(page), mode);
    } catch {
        // not remembered this time
    }
}
