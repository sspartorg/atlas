import { useState, type ReactNode } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';

export interface RowActionMenuItem {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
    danger?: boolean;
    /** Render a Divider above this item (visual group separator). */
    dividerAbove?: boolean;
}

interface RowActionMenuProps {
    ariaLabel: string;
    /**
     * Items to render. `false`/`null`/`undefined` entries are skipped so callers
     * can do `[!isMobile && { ... }, ...]` without filtering upstream.
     */
    items: Array<RowActionMenuItem | false | null | undefined>;
}

// Shared row-level kebab menu. Consolidates the anchor + IconButton + Menu +
// MenuItem boilerplate that was duplicated across the project/credential/agent
// row components. `e.stopPropagation()` is built in so clicking the kebab
// inside a clickable row doesn't navigate.
export function RowActionMenu({ ariaLabel, items }: RowActionMenuProps) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);
    const visible = items.filter(
        (i): i is RowActionMenuItem => i !== false && i !== null && i !== undefined,
    );

    return (
        <>
            <IconButton
                size="small"
                aria-label={ariaLabel}
                onClick={(e) => {
                    e.stopPropagation();
                    setAnchor(e.currentTarget);
                }}
                sx={{ color: ATLAS_PALETTE.slate60 }}
            >
                <MoreVertRounded sx={{ fontSize: 18 }} />
            </IconButton>
            <Menu
                anchorEl={anchor}
                open={Boolean(anchor)}
                onClose={close}
                onClick={(e) => e.stopPropagation()}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{
                    sx: {
                        mt: 0.5,
                        minWidth: 200,
                        borderRadius: '10px',
                        boxShadow: '0 10px 28px rgba(0,0,0,.12)',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    },
                }}
            >
                {visible.map((item) => {
                    const node = (
                        <MenuItem
                            key={item.label}
                            onClick={() => {
                                close();
                                item.onClick();
                            }}
                            sx={item.danger ? { color: ATLAS_PALETTE.error } : undefined}
                        >
                            {item.icon && (
                                <ListItemIcon
                                    sx={{
                                        color: item.danger
                                            ? ATLAS_PALETTE.error
                                            : ATLAS_PALETTE.slate70,
                                    }}
                                >
                                    {item.icon}
                                </ListItemIcon>
                            )}
                            <ListItemText
                                primaryTypographyProps={{
                                    fontSize: 13,
                                    color: item.danger ? ATLAS_PALETTE.error : undefined,
                                }}
                            >
                                {item.label}
                            </ListItemText>
                        </MenuItem>
                    );
                    if (item.dividerAbove) {
                        return (
                            <span key={`${item.label}-grp`}>
                                <Divider sx={{ my: 0.5 }} />
                                {node}
                            </span>
                        );
                    }
                    return node;
                })}
            </Menu>
        </>
    );
}
