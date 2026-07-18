import { useState, type ReactNode } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import AddRounded from '@mui/icons-material/AddRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';

export interface AddRelatedMenuOption {
    label: string;
    onClick: () => void;
    icon?: ReactNode | undefined;
    disabled?: boolean | undefined;
}

interface Props {
    options: AddRelatedMenuOption[];
    /** aria-label / tooltip for the trigger button. */
    label?: string;
}

/**
 * Jira-style `+` button rendered next to an issue title. Opens a popup
 * menu of "Add story / Add sub-task / Link an item / Add dependency"
 * style actions — what's offered depends on the issue type and is
 * decided by the parent page.
 *
 * Rendering nothing (returning null) is the caller's job — if `options`
 * is empty the menu still renders a disabled trigger, so callers should
 * gate on `options.length > 0` before passing it in.
 */
export function AddRelatedMenu({ options, label = 'Add related item' }: Props) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = Boolean(anchor);

    if (options.length === 0) return null;

    function handleClose() {
        setAnchor(null);
    }

    return (
        <>
            <Tooltip title={label}>
                <IconButton
                    aria-label={label}
                    onClick={(e) => setAnchor(e.currentTarget)}
                    size="small"
                    sx={{
                        width: 28,
                        height: 28,
                        color: ATLAS_PALETTE.slate60,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '8px',
                        background: ATLAS_PALETTE.white,
                        '&:hover': {
                            color: ATLAS_PALETTE.brandBlue,
                            borderColor: ATLAS_PALETTE.brandBlue,
                            background: ATLAS_PALETTE.cloud,
                        },
                    }}
                >
                    <AddRounded sx={{ fontSize: 18 }} />
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchor}
                open={open}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{
                    paper: {
                        sx: {
                            mt: 0.5,
                            minWidth: 200,
                            borderRadius: '10px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
                        },
                    },
                }}
            >
                {options.map((opt) => (
                    <MenuItem
                        key={opt.label}
                        disabled={opt.disabled === true}
                        onClick={() => {
                            handleClose();
                            opt.onClick();
                        }}
                        sx={{ fontSize: 13, py: 1.25 }}
                    >
                        {opt.icon !== undefined && (
                            <ListItemIcon sx={{ minWidth: '28px !important' }}>
                                {opt.icon}
                            </ListItemIcon>
                        )}
                        <ListItemText
                            primaryTypographyProps={{
                                sx: { fontSize: 13, color: ATLAS_PALETTE.slate },
                            }}
                        >
                            {opt.label}
                        </ListItemText>
                    </MenuItem>
                ))}
            </Menu>
        </>
    );
}
