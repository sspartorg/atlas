import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import TableRowsRounded from '@mui/icons-material/TableRowsRounded';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export type ProjectsView = 'cards' | 'table';

interface IViewToggleProps {
    value: ProjectsView;
    onChange: (next: ProjectsView) => void;
}

export function ViewToggle({ value, onChange }: IViewToggleProps) {
    return (
        <ToggleButtonGroup
            exclusive
            size="small"
            value={value}
            onChange={(_e, next: ProjectsView | null) => {
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
            <ToggleButton value="cards">
                <GridViewRounded sx={{ fontSize: 16 }} />
                Cards
            </ToggleButton>
            <ToggleButton value="table">
                <TableRowsRounded sx={{ fontSize: 16 }} />
                Table
            </ToggleButton>
        </ToggleButtonGroup>
    );
}
