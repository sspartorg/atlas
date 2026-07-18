import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import type { IssuePriority } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { PriorityChip } from './PriorityChip.js';

interface Props {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    current: IssuePriority | undefined;
    onPick: (next: IssuePriority) => void;
}

const OPTIONS: IssuePriority[] = ['low', 'normal', 'high', 'urgent'];

export function PriorityPickerPopover({ anchorEl, open, onClose, current, onPick }: Props) {
    return (
        <Menu
            anchorEl={anchorEl}
            open={open}
            onClose={onClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{
                paper: {
                    sx: {
                        background: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '10px',
                        boxShadow: '0 12px 32px rgba(0,0,14,.12)',
                        minWidth: 160,
                        mt: 1,
                    },
                },
            }}
        >
            {OPTIONS.map((p) => (
                <MenuItem
                    key={p}
                    onClick={() => {
                        onPick(p);
                        onClose();
                    }}
                    sx={{ py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5 }}
                >
                    <PriorityChip priority={p} size="sm" />
                    {current === p && (
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ ml: 'auto', fontSize: 18, color: ATLAS_PALETTE.brandBlue }}
                        >
                            check
                        </Box>
                    )}
                </MenuItem>
            ))}
        </Menu>
    );
}
