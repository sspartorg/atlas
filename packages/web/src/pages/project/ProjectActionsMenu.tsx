import { useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    onRename: () => void;
    onEditGuardrails: () => void;
    onManageSecrets: () => void;
    onDelete: () => void;
    // Theme 09b — AI-Readiness Agent trigger. Optional so consumers
    // that don't wire it (e.g., a future read-only project view)
    // don't have to bother; menu item hidden when absent.
    onGenerateAiScaffold?: () => void;
    /** When false, the AI-Readiness item shows as disabled with a
     *  tooltip explaining the prerequisite (not cloned yet). */
    aiScaffoldEnabled?: boolean;
}

interface Item {
    key: string;
    icon: string;
    label: string;
    onSelect?: () => void;
    disabled?: boolean;
    danger?: boolean;
    group: 'EDIT' | 'WORKSPACE';
}

export function ProjectActionsMenu({
    onRename,
    onEditGuardrails,
    onManageSecrets,
    onDelete,
    onGenerateAiScaffold,
    aiScaffoldEnabled = true,
}: Props) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = Boolean(anchor);

    function close() {
        setAnchor(null);
    }

    function pick(action?: () => void) {
        close();
        action?.();
    }

    const items: Item[] = [
        {
            key: 'rename',
            icon: 'edit',
            label: 'Rename project…',
            group: 'EDIT',
            onSelect: onRename,
        },
        {
            key: 'guardrails',
            icon: 'shield',
            label: 'Edit guard-rails',
            group: 'EDIT',
            onSelect: onEditGuardrails,
        },
        {
            key: 'secrets',
            icon: 'key',
            label: 'Manage Secrets',
            group: 'WORKSPACE',
            onSelect: onManageSecrets,
        },
        ...(onGenerateAiScaffold
            ? [
                  {
                      key: 'ai-scaffold',
                      icon: 'rocket_launch',
                      label: 'Generate AI scaffold…',
                      group: 'WORKSPACE' as const,
                      disabled: !aiScaffoldEnabled,
                      onSelect: onGenerateAiScaffold,
                  },
              ]
            : []),
        {
            key: 'delete',
            icon: 'delete',
            label: 'Delete project…',
            group: 'WORKSPACE',
            danger: true,
            onSelect: onDelete,
        },
    ];

    let lastGroup: Item['group'] | null = null;

    return (
        <>
            <Tooltip title="Project actions">
                <IconButton
                    size="small"
                    onClick={(e: MouseEvent<HTMLButtonElement>) => setAnchor(e.currentTarget)}
                    sx={{
                        color: ATLAS_PALETTE.slate60,
                        '&:hover': { color: ATLAS_PALETTE.slate },
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 22 }}
                    >
                        more_horiz
                    </Box>
                </IconButton>
            </Tooltip>
            <Menu
                anchorEl={anchor}
                open={open}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { minWidth: 248, borderRadius: '10px', mt: 1 } } }}
            >
                {items.map((it) => {
                    const showGroupHeader = it.group !== lastGroup;
                    lastGroup = it.group;
                    const inner = (
                        <MenuItem
                            key={it.key}
                            onClick={() => {
                                if (it.disabled) return;
                                pick(it.onSelect);
                            }}
                            disabled={Boolean(it.disabled)}
                            sx={{
                                py: 1.5,
                                color: it.danger ? ATLAS_PALETTE.error : ATLAS_PALETTE.slate,
                                '&:hover': {
                                    background: it.danger
                                        ? 'rgba(220,38,38,.08)'
                                        : ATLAS_PALETTE.cloud,
                                },
                            }}
                        >
                            <ListItemIcon
                                sx={{
                                    minWidth: 28,
                                    color: it.danger
                                        ? ATLAS_PALETTE.error
                                        : ATLAS_PALETTE.slate60,
                                }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 18 }}
                                >
                                    {it.icon}
                                </Box>
                            </ListItemIcon>
                            <ListItemText primaryTypographyProps={{ sx: { fontSize: 13 } }}>
                                {it.label}
                            </ListItemText>
                        </MenuItem>
                    );
                    const wrapped = it.disabled ? (
                        <Tooltip
                            key={it.key}
                            title="Coming soon"
                            placement="left"
                            disableInteractive
                        >
                            <Box>{inner}</Box>
                        </Tooltip>
                    ) : (
                        inner
                    );

                    return (
                        <Box key={`${it.key}-wrap`}>
                            {showGroupHeader && (
                                <>
                                    {lastGroup !== 'EDIT' && <Divider sx={{ my: 1 }} />}
                                    <Typography
                                        sx={{
                                            px: 2,
                                            pt: 1,
                                            pb: 0.5,
                                            fontSize: 10,
                                            fontWeight: 600,
                                            letterSpacing: '0.08em',
                                            textTransform: 'uppercase',
                                            color: ATLAS_PALETTE.slate40,
                                        }}
                                    >
                                        {it.group === 'EDIT' ? 'Edit' : 'Workspace'}
                                    </Typography>
                                </>
                            )}
                            {wrapped}
                        </Box>
                    );
                })}
            </Menu>
        </>
    );
}
