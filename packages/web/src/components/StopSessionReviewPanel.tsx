import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { CliSessionDiffScopeName, CliSessionDiffSummaryResponse } from '@atlas/shared';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { DiffFileList } from './diff/DiffFileList.js';
import { DiffFilePane } from './diff/DiffFilePane.js';
import { DiffToolbar } from './diff/DiffToolbar.js';
import type { DiffViewMode } from './diff/diffViewPrefs.js';

// 2026-08-04 — Terminal finalize diff, the two-pane body of the Stop modal.
//
// Split out of StopSessionModal so the modal stays a dialog shell and the
// whole diff subsystem can sit behind a `lazyNamed` + Suspense boundary. The
// initial-chunk budget has ~0.3 KB of slack, so this MUST NOT be statically
// imported from a module the terminal routes pull in eagerly.

interface Props {
    sessionId: string;
    summary: CliSessionDiffSummaryResponse | undefined;
    isLoading: boolean;
    error: Error | null;
    scope: CliSessionDiffScopeName;
    onScopeChange: (next: CliSessionDiffScopeName) => void;
    selected: Record<string, boolean>;
    onToggle: (path: string, next: boolean) => void;
    onToggleAll: (next: boolean) => void;
    viewMode: DiffViewMode;
    onViewModeChange: (next: DiffViewMode) => void;
    wrap: boolean;
    onWrapChange: (next: boolean) => void;
}

export function StopSessionReviewPanel({
    sessionId,
    summary,
    isLoading,
    error,
    scope,
    onScopeChange,
    selected,
    onToggle,
    onToggleAll,
    viewMode,
    onViewModeChange,
    wrap,
    onWrapChange,
}: Props) {
    const theme = useTheme();
    const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
    const [activePath, setActivePath] = useState<string | null>(null);

    const current = scope === 'uncommitted' ? summary?.uncommitted : summary?.committed;
    const files = useMemo(() => current?.files ?? [], [current]);

    // Auto-select the first file so the pane is never empty on open, and reset
    // when the scope changes (its paths are a different set entirely).
    useEffect(() => {
        if (isNarrow) return;
        if (files.length === 0) {
            setActivePath(null);
            return;
        }
        if (!files.some((f) => f.path === activePath)) {
            setActivePath(files[0]!.path);
        }
    }, [files, activePath, isNarrow]);

    const activeFile = files.find((f) => f.path === activePath) ?? null;

    if (error) {
        return (
            <Box sx={{ p: 2, width: '100%' }}>
                <Alert severity="error">
                    Could not load the diff. {error.message} — you can still stop the session.
                </Alert>
            </Box>
        );
    }

    if (isLoading || !summary) {
        return (
            <Stack spacing={1} sx={{ p: 2, width: '100%' }}>
                <Skeleton variant="rectangular" height={24} />
                <Skeleton variant="rectangular" height={200} />
            </Stack>
        );
    }

    return (
        <Stack sx={{ width: '100%', minHeight: 0, flex: 1 }}>
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                flexWrap="wrap"
                sx={{ px: 1.5, borderBottom: `1px solid ${ATLAS_PALETTE.slate08}`, flexShrink: 0 }}
            >
                <Tabs
                    value={scope}
                    onChange={(_e, v: CliSessionDiffScopeName) => onScopeChange(v)}
                    sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none' } }}
                >
                    <Tab
                        value="uncommitted"
                        label={`Uncommitted (${summary.uncommitted.total_files})`}
                    />
                    <Tab
                        value="committed"
                        label={`Committed on branch (${summary.committed.total_files})`}
                    />
                </Tabs>
                <DiffToolbar
                    viewMode={viewMode}
                    onViewModeChange={onViewModeChange}
                    wrap={wrap}
                    onWrapChange={onWrapChange}
                    splitDisabled={isNarrow}
                    stats={{
                        files: current?.total_files ?? 0,
                        additions: current?.additions ?? 0,
                        deletions: current?.deletions ?? 0,
                    }}
                />
            </Stack>

            <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
                <Box
                    sx={{
                        width: { xs: '100%', md: 300 },
                        flexShrink: 0,
                        borderRight: { md: `1px solid ${ATLAS_PALETTE.slate08}` },
                        // Narrow viewport is master/detail: the list fills the
                        // pane until a file is tapped, then the diff replaces it.
                        display: { xs: activePath ? 'none' : 'flex', md: 'flex' },
                        flexDirection: 'column',
                        minHeight: 0,
                    }}
                >
                    <DiffFileList
                        files={files}
                        selectable={scope === 'uncommitted'}
                        selected={selected}
                        onToggle={onToggle}
                        onToggleAll={onToggleAll}
                        activePath={activePath}
                        onActivate={setActivePath}
                        truncated={current?.truncated ?? false}
                        totalFiles={current?.total_files ?? 0}
                    />
                </Box>
                <Box
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        minHeight: 0,
                        flexDirection: 'column',
                        display: { xs: activePath ? 'flex' : 'none', md: 'flex' },
                    }}
                >
                    <DiffFilePane
                        sessionId={sessionId}
                        scope={scope}
                        file={activeFile}
                        // Split needs horizontal room; force unified when narrow
                        // but leave `viewMode` untouched so it snaps back on resize.
                        viewMode={isNarrow ? 'unified' : viewMode}
                        wrap={wrap}
                        onBack={isNarrow ? () => setActivePath(null) : undefined}
                    />
                </Box>
            </Box>
        </Stack>
    );
}
