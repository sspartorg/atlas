import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import Home from '@mui/icons-material/Home';
import Check from '@mui/icons-material/Check';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import { api } from '../api/api.js';
import type { FsListResponse } from '../api/api.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

type StatStatus = 'idle' | 'checking' | 'exists' | 'missing' | 'not_a_directory';

interface Props {
    value: string;
    onChange: (path: string) => void;
    placeholder?: string;
    error?: boolean;
    autoFocus?: boolean;
    fullWidth?: boolean;
    size?: 'small' | 'medium';
    textFieldSx?: object;
    inputStyle?: CSSProperties;
    onEnterCommit?: () => void;
}

const MONO = '"JetBrains Mono", monospace';

export function FolderPicker(props: Props) {
    const {
        value,
        onChange,
        placeholder,
        error = false,
        autoFocus = false,
        fullWidth = true,
        size = 'medium',
        textFieldSx,
        onEnterCommit,
    } = props;

    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [listing, setListing] = useState<FsListResponse | null>(null);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState<string | null>(null);
    const [stat, setStat] = useState<StatStatus>('idle');
    const statTimer = useRef<number | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        if (statTimer.current !== null) window.clearTimeout(statTimer.current);
        const trimmed = value.trim();
        if (trimmed === '') {
            setStat('idle');
            return;
        }
        setStat('checking');
        statTimer.current = window.setTimeout(() => {
            void api.fs
                .stat(trimmed)
                .then((r) => {
                    if (!r.exists) setStat('missing');
                    else if (!r.is_directory) setStat('not_a_directory');
                    else setStat('exists');
                })
                .catch(() => setStat('missing'));
        }, 300);
        return () => {
            if (statTimer.current !== null) window.clearTimeout(statTimer.current);
        };
    }, [value]);

    async function loadListing(path: string) {
        setListLoading(true);
        setListError(null);
        try {
            const r = await api.fs.list(path);
            setListing(r);
        } catch (err) {
            setListError(err instanceof Error ? err.message : 'Could not list folder');
        } finally {
            setListLoading(false);
        }
    }

    async function handleOpen() {
        if (!buttonRef.current) return;
        setAnchorEl(buttonRef.current);
        const trimmed = value.trim();
        if (trimmed === '') {
            try {
                const home = await api.fs.home();
                await loadListing(home.path);
            } catch {
                await loadListing('');
            }
            return;
        }
        try {
            await loadListing(trimmed);
            /* v8 ignore start -- loadListing() catches internally and never rethrows, so this
             * catch block (and its nested home-fallback) is unreachable given the current
             * implementation; kept defensively in case that invariant ever changes. */
        } catch {
            try {
                const home = await api.fs.home();
                await loadListing(home.path);
            } catch {
                await loadListing('');
            }
        }
        /* v8 ignore stop */
    }

    function handleClose() {
        setAnchorEl(null);
        setListError(null);
    }

    async function descendInto(name: string) {
        /* v8 ignore next -- defensive guard: only invoked from list rows that exist solely when listing is non-null. */
        if (!listing) return;
        if (listing.path === '') {
            // Drives mode — child names are already absolute paths like "C:\\".
            await loadListing(name);
            return;
        }
        try {
            const r = await api.fs.join(listing.path, name);
            await loadListing(r.path);
        } catch {
            setListError('Could not enter folder');
        }
    }

    async function goUp() {
        /* v8 ignore next -- defensive guard: the Up button is disabled while listing is null, so a real/jsdom click can never reach this. */
        if (!listing) return;
        if (listing.parent === null) {
            // At a drive root on Windows — pop up to the drives list.
            if (listing.path.match(/^[A-Za-z]:\\?$/)) {
                await loadListing('drives');
            }
            return;
        }
        await loadListing(listing.parent);
    }

    async function goHome() {
        try {
            const r = await api.fs.home();
            await loadListing(r.path);
        } catch {
            setListError('Could not resolve home');
        }
    }

    function useThisFolder() {
        // The "Use this folder" button is disabled whenever `!listing || listing.path === ''`,
        // so a real/jsdom click can only ever reach here with `listing.path === ''` (drives mode) —
        // the `!listing` half is unreachable through the UI (covered by the drives-mode test below).
        /* v8 ignore next */
        if (!listing || listing.path === '') return;
        onChange(listing.path);
        handleClose();
    }

    const statAdornment = (() => {
        if (stat === 'checking') {
            return <CircularProgress size={14} sx={{ color: ATLAS_PALETTE.slate40 }} />;
        }
        if (stat === 'exists') {
            return (
                <Tooltip title="Folder exists">
                    <Check sx={{ fontSize: 18, color: ATLAS_PALETTE.success }} />
                </Tooltip>
            );
        }
        if (stat === 'missing' || stat === 'not_a_directory') {
            return (
                <Tooltip
                    title={stat === 'missing' ? 'Folder not found' : 'Path is not a directory'}
                >
                    <ErrorOutline sx={{ fontSize: 18, color: ATLAS_PALETTE.orange }} />
                </Tooltip>
            );
        }
        return null;
    })();

    const open = anchorEl !== null;

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'stretch' },
                gap: 1.5,
                flex: fullWidth ? 1 : undefined,
            }}
        >
            <TextField
                value={value}
                onChange={(e) => onChange(e.target.value)}
                {...(placeholder !== undefined ? { placeholder } : {})}
                error={error}
                autoFocus={autoFocus}
                size={size}
                fullWidth={fullWidth}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && onEnterCommit) onEnterCommit();
                }}
                {...(textFieldSx ? { sx: textFieldSx } : {})}
                slotProps={{
                    input: {
                        endAdornment: statAdornment ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', mr: 0.5 }}>
                                {statAdornment}
                            </Box>
                        ) : null,
                        sx: { fontFamily: MONO, fontSize: 14 },
                    },
                }}
            />
            <Button
                ref={buttonRef}
                variant="outlined"
                startIcon={<FolderOutlined />}
                onClick={() => void handleOpen()}
                sx={{
                    textTransform: 'none',
                    fontWeight: 500,
                    color: ATLAS_PALETTE.brandBlue,
                    borderColor: ATLAS_PALETTE.brandBlue,
                    whiteSpace: 'nowrap',
                    '&:hover': {
                        bgcolor: 'rgba(0,122,201,.06)',
                        borderColor: ATLAS_PALETTE.brandBlue,
                    },
                }}
            >
                Browse…
            </Button>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                PaperProps={{
                    sx: {
                        width: 460,
                        maxHeight: 480,
                        display: 'flex',
                        flexDirection: 'column',
                        mt: 1,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    },
                }}
            >
                <Box
                    sx={{
                        px: 2,
                        py: 1.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate08}`,
                        bgcolor: ATLAS_PALETTE.slate06,
                    }}
                >
                    <Tooltip title="Up">
                        <span>
                            <IconButton
                                size="small"
                                onClick={() => void goUp()}
                                disabled={
                                    !listing ||
                                    listing.path === '' ||
                                    (listing.parent === null &&
                                        !listing.path.match(/^[A-Za-z]:\\?$/))
                                }
                            >
                                <ArrowUpward sx={{ fontSize: 18 }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                    <Tooltip title="Home">
                        <IconButton size="small" onClick={() => void goHome()}>
                            <Home sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                    <Typography
                        sx={{
                            flex: 1,
                            fontFamily: MONO,
                            fontSize: 12,
                            color: ATLAS_PALETTE.slate70,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                        title={listing?.path ?? ''}
                    >
                        {listing?.path === '' ? 'Drives' : (listing?.path ?? '—')}
                    </Typography>
                </Box>

                <Box sx={{ flex: 1, overflow: 'auto', minHeight: 200 }}>
                    {listLoading ? (
                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                height: 200,
                            }}
                        >
                            <CircularProgress size={20} />
                        </Box>
                    ) : listError ? (
                        <Box
                            sx={{
                                p: 3,
                                color: ATLAS_PALETTE.orange,
                                fontSize: 13,
                                display: 'flex',
                                gap: 1,
                                alignItems: 'center',
                            }}
                        >
                            <ErrorOutline sx={{ fontSize: 18 }} />
                            {listError}
                        </Box>
                    ) : listing && listing.entries.length === 0 ? (
                        <Box
                            sx={{
                                p: 3,
                                color: ATLAS_PALETTE.slate60,
                                fontSize: 13,
                                textAlign: 'center',
                            }}
                        >
                            No subfolders here.
                        </Box>
                    ) : (
                        <List dense disablePadding>
                            {listing?.entries.map((entry) => (
                                <ListItemButton
                                    key={entry.name}
                                    onClick={() => void descendInto(entry.name)}
                                    sx={{
                                        py: 0.75,
                                        '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                                    }}
                                >
                                    <ListItemIcon sx={{ minWidth: 32 }}>
                                        {listing.path === '' ? (
                                            <StorageOutlined
                                                sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                                            />
                                        ) : (
                                            <FolderOutlined
                                                sx={{
                                                    fontSize: 18,
                                                    color: ATLAS_PALETTE.brandBlue,
                                                }}
                                            />
                                        )}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={entry.name}
                                        primaryTypographyProps={{
                                            sx: {
                                                fontFamily: MONO,
                                                fontSize: 13,
                                                color: ATLAS_PALETTE.slate,
                                            },
                                        }}
                                    />
                                </ListItemButton>
                            ))}
                        </List>
                    )}
                </Box>

                <Box
                    sx={{
                        px: 2,
                        py: 1.5,
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 1,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate08}`,
                        bgcolor: ATLAS_PALETTE.slate06,
                    }}
                >
                    <Button
                        size="small"
                        onClick={handleClose}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate70 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        disabled={!listing || listing.path === ''}
                        onClick={useThisFolder}
                        sx={{
                            textTransform: 'none',
                            bgcolor: ATLAS_PALETTE.brandBlue,
                            '&:hover': {
                                bgcolor: ATLAS_PALETTE.brandBlue,
                                filter: 'brightness(.95)',
                            },
                        }}
                    >
                        Use this folder
                    </Button>
                </Box>
            </Popover>
        </Box>
    );
}
