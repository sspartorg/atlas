import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import type { CliSessionDiffFile, CliSessionDiffScopeName } from '@atlas/shared';
import { useCliSessionFilePatch } from '../../hooks/useCliSessions.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { parseUnifiedDiff } from './parseUnifiedDiff.js';
import { buildSplitRows, buildUnifiedRows } from './diffRows.js';
import { SplitDiffView, UnifiedDiffView, MAX_ROWS_PER_FILE } from './DiffViews.js';
import type { DiffViewMode } from './diffViewPrefs.js';

// 2026-08-04 — Terminal finalize diff, right pane. Owns the per-file patch
// query and every pane-level state (loading / error / binary / too-large /
// nothing-selected).

/**
 * Above this the pane makes you ask before downloading. Arrow-keying through
 * a file list shouldn't silently pull a multi-megabyte patch per keystroke.
 */
const LARGE_DIFF_LINES = 5_000;

/** Context ladder for the expand affordance. 25 is the server's max. */
const CONTEXT_STEPS = [3, 25] as const;

interface Props {
    sessionId: string;
    scope: CliSessionDiffScopeName;
    file: CliSessionDiffFile | null;
    viewMode: DiffViewMode;
    wrap: boolean;
    /** Mobile master/detail — shows a back button when provided. */
    onBack?: (() => void) | undefined;
}

export function DiffFilePane({ sessionId, scope, file, viewMode, wrap, onBack }: Props) {
    const [contextStep, setContextStep] = useState(0);
    const [largeConfirmed, setLargeConfirmed] = useState<string | null>(null);

    const isLarge =
        file !== null && !file.binary && file.additions + file.deletions > LARGE_DIFF_LINES;
    const gated = isLarge && largeConfirmed !== file?.path;
    const fetchable = file !== null && !file.binary && !file.too_large && !gated;

    const context = CONTEXT_STEPS[contextStep] ?? CONTEXT_STEPS[0];
    const query = useCliSessionFilePatch(
        sessionId,
        scope,
        file?.path ?? null,
        context,
        fetchable,
    );

    const parsed = useMemo(() => {
        const text = query.data?.patch;
        if (!text) return null;
        return parseUnifiedDiff(text);
    }, [query.data?.patch]);

    const rows = useMemo(() => {
        const first = parsed?.files[0];
        if (!first) return null;
        return viewMode === 'split' ? buildSplitRows(first) : buildUnifiedRows(first);
    }, [parsed, viewMode]);

    const header = (
        <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
                px: 1.5,
                py: 0.75,
                borderBottom: `1px solid ${ATLAS_PALETTE.slate08}`,
                flexShrink: 0,
                minHeight: 36,
            }}
        >
            {onBack && (
                <IconButton size="small" onClick={onBack} aria-label="Back to file list">
                    <ArrowBackRounded fontSize="small" />
                </IconButton>
            )}
            <Typography
                variant="caption"
                sx={{
                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {file ? (file.old_path ? `${file.old_path} → ${file.path}` : file.path) : ''}
            </Typography>
        </Stack>
    );

    if (!file) {
        return (
            <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 4 }}>
                <Typography variant="body2" sx={{ color: ATLAS_PALETTE.slate60 }}>
                    Select a file to see its changes.
                </Typography>
            </Stack>
        );
    }

    let body: React.ReactNode;
    if (file.binary) {
        body = (
            <Box sx={{ p: 2 }}>
                <Alert severity="info">Binary file — no text diff to show.</Alert>
            </Box>
        );
    } else if (file.too_large) {
        body = (
            <Box sx={{ p: 2 }}>
                <Alert severity="warning">
                    File is too large to diff. Review it in your editor.
                </Alert>
            </Box>
        );
    } else if (gated) {
        body = (
            <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ height: '100%', p: 4 }}>
                <Typography variant="body2" sx={{ color: ATLAS_PALETTE.slate60 }}>
                    Large diff — {file.additions + file.deletions} changed lines.
                </Typography>
                <Button
                    variant="outlined"
                    size="small"
                    sx={{ textTransform: 'none' }}
                    onClick={() => setLargeConfirmed(file.path)}
                >
                    Show anyway
                </Button>
            </Stack>
        );
    } else if (query.isPending) {
        body = (
            <Box sx={{ p: 1.5 }}>
                <Skeleton variant="rectangular" height={16} sx={{ mb: 0.5 }} />
                <Skeleton variant="rectangular" height={16} sx={{ mb: 0.5 }} />
                <Skeleton variant="rectangular" height={16} width="70%" />
            </Box>
        );
    } else if (query.isError) {
        body = (
            <Box sx={{ p: 2 }}>
                <Alert severity="error">
                    Could not load this diff. {(query.error as Error)?.message ?? ''}
                </Alert>
            </Box>
        );
    } else if (query.data?.truncated) {
        body = (
            <Box sx={{ p: 2 }}>
                <Alert severity="warning">
                    Diff truncated by the server ({query.data.byte_size} bytes).
                </Alert>
            </Box>
        );
    } else if (!rows || rows.length === 0) {
        body = (
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" sx={{ color: ATLAS_PALETTE.slate60 }}>
                    No textual changes (mode or rename only).
                </Typography>
            </Box>
        );
    } else if (rows.length > MAX_ROWS_PER_FILE) {
        body = (
            <Box sx={{ p: 2 }}>
                <Alert severity="warning">
                    Diff truncated at {MAX_ROWS_PER_FILE.toLocaleString()} lines.
                </Alert>
            </Box>
        );
    } else {
        const canExpand = contextStep < CONTEXT_STEPS.length - 1;
        const onExpand = canExpand ? () => setContextStep((s) => s + 1) : undefined;
        body =
            viewMode === 'split' ? (
                <SplitDiffView
                    rows={rows as never}
                    path={file.path}
                    wrap={wrap}
                    onExpandContext={onExpand}
                    canExpand={canExpand}
                />
            ) : (
                <UnifiedDiffView
                    rows={rows as never}
                    path={file.path}
                    wrap={wrap}
                    onExpandContext={onExpand}
                    canExpand={canExpand}
                />
            );
    }

    return (
        <Stack sx={{ height: '100%', minHeight: 0 }}>
            {header}
            <Box sx={{ flex: 1, minHeight: 0 }}>{body}</Box>
        </Stack>
    );
}
