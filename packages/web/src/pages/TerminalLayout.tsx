import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import { cliIcon } from '../utils/cliIcons.js';
import type { ICliSession } from '@atlas/shared';
import { useCliSessions } from '../hooks/useCliSessions.js';
import { useToast } from '../hooks/useToast.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { TerminalXterm } from '../components/TerminalXterm.js';
import { PaneChrome } from '../components/PaneChrome.js';
import { StartSessionDialog } from '../components/StartSessionDialog.js';
import {
    LayoutPickerMenu,
    LAYOUT_PANE_COUNT,
    type LayoutKind,
} from '../components/LayoutPickerMenu.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const STORAGE_KEY = 'atlas.terminal-layout.v1';
const VALID_KINDS = new Set<LayoutKind>([
    'single',
    'h2',
    'v2',
    'h3-top',
    'h3-bottom',
    'v3',
    'h3',
    'grid2x2',
]);

interface PaneState {
    sessionId: string | null;
}

interface LayoutState {
    kind: LayoutKind;
    panes: PaneState[];
}

function isLayoutKind(s: string | null): s is LayoutKind {
    return s !== null && VALID_KINDS.has(s as LayoutKind);
}

function normalize(kind: LayoutKind, panes: PaneState[]): LayoutState {
    const want = LAYOUT_PANE_COUNT[kind];
    const next = panes.slice(0, want);
    while (next.length < want) next.push({ sessionId: null });
    return { kind, panes: next };
}

function loadFromStorage(): LayoutState | null {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (
            !parsed ||
            typeof parsed !== 'object' ||
            !('kind' in parsed) ||
            !('panes' in parsed)
        ) {
            return null;
        }
        const kind = (parsed as { kind: unknown }).kind;
        if (typeof kind !== 'string' || !isLayoutKind(kind)) return null;
        const panes = (parsed as { panes: unknown }).panes;
        if (!Array.isArray(panes)) return null;
        const safe: PaneState[] = panes.map((p) => ({
            sessionId:
                p && typeof p === 'object' && 'sessionId' in p
                    ? ((p as { sessionId: unknown }).sessionId as string | null)
                    : null,
        }));
        return normalize(kind, safe);
    } catch {
        return null;
    }
}

function parseUrl(params: URLSearchParams): LayoutState | null {
    const k = params.get('k');
    if (!isLayoutKind(k)) return null;
    const s = params.get('s');
    if (s === null) {
        // Layout kind present, sessions absent — render with all empty panes.
        // Padding happens in normalize().
        return normalize(k, []);
    }
    const ids = s.split(',').map((x) => (x.length === 0 ? null : x));
    return normalize(k, ids.map((id) => ({ sessionId: id })));
}

/**
 * Apply layout state to a search-params instance in place, preserving any
 * unrelated keys. Returns the same instance for chaining.
 */
function applyLayoutToParams(params: URLSearchParams, state: LayoutState): URLSearchParams {
    params.set('k', state.kind);
    params.set('s', state.panes.map((p) => p.sessionId ?? '').join(','));
    return params;
}

/**
 * Compare two URLSearchParams just on the layout keys we own (k, s) — used to
 * decide if an external URL change diverges from in-memory state.
 */
function layoutKeysDiffer(params: URLSearchParams, state: LayoutState): boolean {
    const expectedK = state.kind;
    const expectedS = state.panes.map((p) => p.sessionId ?? '').join(',');
    return params.get('k') !== expectedK || (params.get('s') ?? '') !== expectedS;
}

const DEFAULT_STATE: LayoutState = { kind: 'single', panes: [{ sessionId: null }] };

export function TerminalLayout() {
    useSetPageTitle('Terminal Layout');
    const navigate = useNavigate();
    const toast = useToast();
    const [params, setParams] = useSearchParams();
    const { data: sessions = [] } = useCliSessions();
    const [hideChrome, setHideChrome] = useState(false);
    const [newDialogPaneIdx, setNewDialogPaneIdx] = useState<number | null>(null);

    const [state, setStateRaw] = useState<LayoutState>(() => {
        return parseUrl(params) ?? loadFromStorage() ?? DEFAULT_STATE;
    });

    // Two effects, deliberately separated:
    //
    // (1) Persist state → localStorage on every state change. Cheap, no URL
    //     coupling.
    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {
            // private-mode quota errors are non-fatal.
        }
    }, [state]);

    // (2) Persist state → URL, but only when our layout keys diverge from the
    //     current URL — and merge over the existing search params instead of
    //     constructing a fresh URLSearchParams so unrelated query keys
    //     (debug flags, marketing params, future feature toggles) survive.
    //     Deps omit `params` so external URL changes don't re-trigger our
    //     write path; the URL→state sync in effect (3) handles that case.
    useEffect(() => {
        if (!layoutKeysDiffer(params, state)) return;
        const next = new URLSearchParams(params);
        applyLayoutToParams(next, state);
        setParams(next, { replace: true });
    }, [state]);

    // (3) Sync URL → state when an external navigation (Back / Forward, paste
    //     of a different layout URL, deep link) lands a different k/s on the
    //     same mounted component. Without this, useState's initializer (which
    //     only runs once) would leave the rendered layout stale until the
    //     persist effect in (2) overwrites the URL back to the in-memory
    //     state — silently reverting browser navigation.
    useEffect(() => {
        if (!layoutKeysDiffer(params, state)) return;
        const parsed = parseUrl(params);
        if (parsed) setStateRaw(parsed);
    }, [params]);

    const setState = useCallback((updater: (prev: LayoutState) => LayoutState) => {
        setStateRaw((prev) => {
            const next = updater(prev);
            return normalize(next.kind, next.panes);
        });
    }, []);

    function changeKind(kind: LayoutKind) {
        setState((prev) => {
            const want = LAYOUT_PANE_COUNT[kind];
            const dropped = Math.max(0, prev.panes.length - want);
            if (dropped > 0) {
                toast.show({
                    message: `${dropped} pane${dropped > 1 ? 's' : ''} detached — session${dropped > 1 ? 's' : ''} still running`,
                });
            }
            return { kind, panes: prev.panes };
        });
    }

    function setPane(idx: number, sessionId: string | null) {
        setState((prev) => {
            const next = prev.panes.slice();
            next[idx] = { sessionId };
            return { ...prev, panes: next };
        });
    }

    const attachedSet = useMemo(() => {
        const s = new Set<string>();
        for (const p of state.panes) if (p.sessionId) s.add(p.sessionId);
        return s;
    }, [state.panes]);

    const sessionById = useMemo(() => {
        const m = new Map<string, ICliSession>();
        for (const s of sessions) m.set(s.id, s);
        return m;
    }, [sessions]);

    function renderPane(idx: number) {
        const p = state.panes[idx];
        if (!p?.sessionId) {
            return (
                <EmptyPane
                    sessions={sessions}
                    attachedSet={attachedSet}
                    onAttach={(id) => setPane(idx, id)}
                    onNew={() => setNewDialogPaneIdx(idx)}
                />
            );
        }
        const session = sessionById.get(p.sessionId);
        if (!session) {
            return (
                <Box sx={paneShellSx}>
                    <Box
                        sx={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: ATLAS_PALETTE.slate60,
                            fontSize: 13,
                        }}
                    >
                        Session not found — it may have been deleted.{' '}
                        <Button size="small" onClick={() => setPane(idx, null)} sx={{ ml: 1 }}>
                            Clear
                        </Button>
                    </Box>
                </Box>
            );
        }
        const live = session.status === 'active';
        const showTerminal = session.status === 'active' || session.status === 'paused';
        return (
            <Box sx={paneShellSx}>
                <PaneChrome
                    session={session}
                    onDetach={() => setPane(idx, null)}
                    onStopped={() => setPane(idx, null)}
                />
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {showTerminal ? (
                        <TerminalXterm sessionId={session.id} sessionLive={live} />
                    ) : (
                        <Box
                            sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: ATLAS_PALETTE.slate60,
                                fontSize: 13,
                                px: 2,
                                textAlign: 'center',
                            }}
                        >
                            Session is {session.status}. Open in single view for transcript.
                        </Box>
                    )}
                </Box>
            </Box>
        );
    }

    const handleStyle = { background: ATLAS_PALETTE.slate12 };

    function renderTree(kind: LayoutKind) {
        switch (kind) {
            case 'single':
                return renderPane(0);
            case 'h2':
                return (
                    <PanelGroup direction="vertical" autoSaveId="atlas.terminal-layout.h2">
                        <Panel defaultSize={50} minSize={20}>
                            {renderPane(0)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, height: 4 }} />
                        <Panel defaultSize={50} minSize={20}>
                            {renderPane(1)}
                        </Panel>
                    </PanelGroup>
                );
            case 'v2':
                return (
                    <PanelGroup direction="horizontal" autoSaveId="atlas.terminal-layout.v2">
                        <Panel defaultSize={50} minSize={20}>
                            {renderPane(0)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                        <Panel defaultSize={50} minSize={20}>
                            {renderPane(1)}
                        </Panel>
                    </PanelGroup>
                );
            case 'h3-top':
                return (
                    <PanelGroup direction="vertical" autoSaveId="atlas.terminal-layout.h3top">
                        <Panel defaultSize={50} minSize={20}>
                            {renderPane(0)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, height: 4 }} />
                        <Panel defaultSize={50} minSize={20}>
                            <PanelGroup
                                direction="horizontal"
                                autoSaveId="atlas.terminal-layout.h3top.bottom"
                            >
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(1)}
                                </Panel>
                                <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(2)}
                                </Panel>
                            </PanelGroup>
                        </Panel>
                    </PanelGroup>
                );
            case 'h3-bottom':
                return (
                    <PanelGroup direction="vertical" autoSaveId="atlas.terminal-layout.h3bot">
                        <Panel defaultSize={50} minSize={20}>
                            <PanelGroup
                                direction="horizontal"
                                autoSaveId="atlas.terminal-layout.h3bot.top"
                            >
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(0)}
                                </Panel>
                                <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(1)}
                                </Panel>
                            </PanelGroup>
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, height: 4 }} />
                        <Panel defaultSize={50} minSize={20}>
                            {renderPane(2)}
                        </Panel>
                    </PanelGroup>
                );
            case 'v3':
                return (
                    <PanelGroup direction="horizontal" autoSaveId="atlas.terminal-layout.v3">
                        <Panel defaultSize={33} minSize={15}>
                            {renderPane(0)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                        <Panel defaultSize={34} minSize={15}>
                            {renderPane(1)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                        <Panel defaultSize={33} minSize={15}>
                            {renderPane(2)}
                        </Panel>
                    </PanelGroup>
                );
            case 'h3':
                return (
                    <PanelGroup direction="vertical" autoSaveId="atlas.terminal-layout.h3">
                        <Panel defaultSize={33} minSize={15}>
                            {renderPane(0)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, height: 4 }} />
                        <Panel defaultSize={34} minSize={15}>
                            {renderPane(1)}
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, height: 4 }} />
                        <Panel defaultSize={33} minSize={15}>
                            {renderPane(2)}
                        </Panel>
                    </PanelGroup>
                );
            case 'grid2x2':
                return (
                    <PanelGroup direction="vertical" autoSaveId="atlas.terminal-layout.grid">
                        <Panel defaultSize={50} minSize={20}>
                            <PanelGroup
                                direction="horizontal"
                                autoSaveId="atlas.terminal-layout.grid.top"
                            >
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(0)}
                                </Panel>
                                <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(1)}
                                </Panel>
                            </PanelGroup>
                        </Panel>
                        <PanelResizeHandle style={{ ...handleStyle, height: 4 }} />
                        <Panel defaultSize={50} minSize={20}>
                            <PanelGroup
                                direction="horizontal"
                                autoSaveId="atlas.terminal-layout.grid.bottom"
                            >
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(2)}
                                </Panel>
                                <PanelResizeHandle style={{ ...handleStyle, width: 4 }} />
                                <Panel defaultSize={50} minSize={20}>
                                    {renderPane(3)}
                                </Panel>
                            </PanelGroup>
                        </Panel>
                    </PanelGroup>
                );
        }
    }

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: 'calc(100vh - 64px)',
                background: ATLAS_PALETTE.pageBg,
                overflow: 'hidden',
            }}
        >
            {/* Toolbar */}
            {!hideChrome && (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 2,
                        height: 44,
                        flexShrink: 0,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate12}`,
                        background: ATLAS_PALETTE.surfaceRaised,
                    }}
                >
                    <Tooltip title="Back to sessions">
                        <IconButton size="small" onClick={() => navigate('/terminal')}>
                            <ArrowBackRounded fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <LayoutPickerMenu value={state.kind} onChange={changeKind} />
                    <Typography
                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}
                    >
                        {state.panes.filter((p) => p.sessionId).length} / {state.panes.length} attached
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title="Hide chrome (more terminal area)">
                        <IconButton size="small" onClick={() => setHideChrome(true)}>
                            <VisibilityOffRounded fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            )}
            {hideChrome && (
                <Box
                    onClick={() => setHideChrome(false)}
                    sx={{
                        position: 'absolute',
                        top: 64,
                        right: 16,
                        zIndex: 20,
                        background: ATLAS_PALETTE.surfaceRaised,
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        p: 0.5,
                        opacity: 0.7,
                        '&:hover': { opacity: 1 },
                    }}
                >
                    <VisibilityRounded fontSize="small" />
                </Box>
            )}

            <Box sx={{ flex: 1, minHeight: 0 }}>{renderTree(state.kind)}</Box>

            <StartSessionDialog
                open={newDialogPaneIdx !== null}
                onClose={() => setNewDialogPaneIdx(null)}
                onCreated={(created) => {
                    if (newDialogPaneIdx !== null) setPane(newDialogPaneIdx, created.id);
                    setNewDialogPaneIdx(null);
                    toast.show({ message: `Session "${created.title}" attached to pane` });
                }}
            />
        </Box>
    );
}

const paneShellSx = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    minWidth: 0,
    minHeight: 0,
    background: ATLAS_PALETTE.pageBg,
    overflow: 'hidden',
} as const;

interface EmptyPaneProps {
    sessions: ICliSession[];
    attachedSet: Set<string>;
    onAttach: (sessionId: string) => void;
    onNew: () => void;
}

function EmptyPane({ sessions, attachedSet, onAttach, onNew }: EmptyPaneProps) {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const close = () => setAnchor(null);
    const attachable = sessions
        .filter((s) => s.status === 'active' || s.status === 'paused')
        .sort((a, b) => b.last_active_at.localeCompare(a.last_active_at));
    return (
        <Box
            sx={{
                ...paneShellSx,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px dashed ${ATLAS_PALETTE.slate12}`,
            }}
        >
            <Box sx={{ textAlign: 'center', maxWidth: 320, px: 2 }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                    Empty pane — connect a session
                </Typography>
                <Button
                    variant="contained"
                    size="small"
                    onClick={(e) => setAnchor(e.currentTarget)}
                    sx={{
                        textTransform: 'none',
                        background: ATLAS_PALETTE.green,
                        '&:hover': { background: ATLAS_PALETTE.greenDark },
                    }}
                >
                    Connect ▾
                </Button>
                <Menu
                    anchorEl={anchor}
                    open={Boolean(anchor)}
                    onClose={close}
                    slotProps={{
                        paper: {
                            sx: {
                                minWidth: 280,
                                maxHeight: 400,
                                borderRadius: '10px',
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            },
                        },
                    }}
                >
                    <MenuItem
                        onClick={() => {
                            close();
                            onNew();
                        }}
                    >
                        <ListItemIcon>
                            <AddRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Start new session…</ListItemText>
                    </MenuItem>
                    <Divider />
                    <Typography
                        sx={{
                            fontSize: 11,
                            color: ATLAS_PALETTE.slate60,
                            px: 2,
                            py: 0.5,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                        }}
                    >
                        Attach to existing
                    </Typography>
                    {attachable.length === 0 ? (
                        <MenuItem disabled>
                            <ListItemText
                                primary="No live sessions"
                                secondary="Start one above"
                            />
                        </MenuItem>
                    ) : (
                        attachable.map((s) => {
                            const taken = attachedSet.has(s.id);
                            const CliIcon = cliIcon(s.cli);
                            return (
                                <MenuItem
                                    key={s.id}
                                    disabled={taken}
                                    onClick={() => {
                                        close();
                                        onAttach(s.id);
                                    }}
                                >
                                    <ListItemIcon>
                                        <CliIcon fontSize="small" />
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={
                                            <Fragment>
                                                {s.title}
                                                {taken ? (
                                                    <Typography
                                                        component="span"
                                                        sx={{
                                                            ml: 1,
                                                            fontSize: 11,
                                                            color: ATLAS_PALETTE.slate40,
                                                        }}
                                                    >
                                                        (in another pane)
                                                    </Typography>
                                                ) : null}
                                            </Fragment>
                                        }
                                        secondary={`${s.cli} · ${s.status} · ${s.worktree_branch ?? 'no branch'}`}
                                        slotProps={{
                                            primary: { sx: { fontSize: 13 } },
                                            secondary: { sx: { fontSize: 11 } },
                                        }}
                                    />
                                    <Box
                                        sx={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: '50%',
                                            ml: 1,
                                            background:
                                                s.status === 'active'
                                                    ? ATLAS_PALETTE.success
                                                    : ATLAS_PALETTE.warning,
                                        }}
                                    />
                                </MenuItem>
                            );
                        })
                    )}
                    <Divider />
                    <MenuItem onClick={close}>
                        <ListItemIcon>
                            <LinkRounded fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                            primary="Cancel"
                            slotProps={{ primary: { sx: { fontSize: 13 } } }}
                        />
                    </MenuItem>
                </Menu>
            </Box>
        </Box>
    );
}
