import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { CliSessionDiffFile } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY, MOTION } from '../../theme/tokens.js';
import { describeStatus, statusColor, statusLetter } from './fileStatus.js';

// 2026-08-04 — Terminal finalize diff, left panel. Deliberately a flat list
// rather than a tree: agent sessions touch a handful of files across unrelated
// directories, where a tree is mostly chrome. The path is rendered dir-dimmed
// + basename-bright, which gives the same scanability for far less machinery.

interface Props {
    files: CliSessionDiffFile[];
    /** Checkboxes only make sense for the stageable (uncommitted) scope. */
    selectable: boolean;
    selected: Record<string, boolean>;
    onToggle: (path: string, next: boolean) => void;
    onToggleAll: (next: boolean) => void;
    activePath: string | null;
    onActivate: (path: string) => void;
    onPrefetch?: ((path: string) => void) | undefined;
    /** Server hit its file cap; the list below is partial. */
    truncated: boolean;
    totalFiles: number;
}

function splitPath(path: string): { dir: string; base: string } {
    const idx = path.lastIndexOf('/');
    return idx < 0
        ? { dir: '', base: path }
        : { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

export function DiffFileList({
    files,
    selectable,
    selected,
    onToggle,
    onToggleAll,
    activePath,
    onActivate,
    onPrefetch,
    truncated,
    totalFiles,
}: Props) {
    const allChecked = files.length > 0 && files.every((f) => selected[f.path]);

    if (files.length === 0) {
        return (
            <Box sx={{ p: 3 }}>
                <Typography variant="body2" sx={{ color: ATLAS_PALETTE.slate60 }}>
                    No changes in this view.
                </Typography>
            </Box>
        );
    }

    return (
        <Stack sx={{ minHeight: 0, height: '100%' }}>
            {selectable && (
                <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{
                        px: 1.5,
                        py: 0.5,
                        borderBottom: `1px solid ${ATLAS_PALETTE.slate08}`,
                        flexShrink: 0,
                    }}
                >
                    <Typography variant="caption" sx={{ color: ATLAS_PALETTE.slate60 }}>
                        {files.filter((f) => selected[f.path]).length} of {files.length} selected
                    </Typography>
                    <Button size="small" onClick={() => onToggleAll(!allChecked)} sx={{ textTransform: 'none' }}>
                        {allChecked ? 'Uncheck all' : 'Check all'}
                    </Button>
                </Stack>
            )}

            <Box sx={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
                {files.map((f) => {
                    const { dir, base } = splitPath(f.path);
                    const isActive = f.path === activePath;
                    return (
                        <Stack
                            key={f.path}
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                            onClick={() => onActivate(f.path)}
                            onMouseEnter={() => onPrefetch?.(f.path)}
                            sx={{
                                px: 1,
                                py: 0.5,
                                cursor: 'pointer',
                                bgcolor: isActive ? ATLAS_PALETTE.accentSoft : 'transparent',
                                borderLeft: `2px solid ${isActive ? ATLAS_PALETTE.accentFg : 'transparent'}`,
                                transition: `background ${MOTION.hover}ms ease`,
                                '&:hover': { bgcolor: isActive ? ATLAS_PALETTE.accentSoft : ATLAS_PALETTE.slate06 },
                            }}
                        >
                            {selectable && (
                                <Checkbox
                                    size="small"
                                    checked={Boolean(selected[f.path])}
                                    onChange={(e) => onToggle(f.path, e.target.checked)}
                                    // The row's onClick selects the file for
                                    // viewing; the checkbox means "stage this".
                                    // Without this the two fight.
                                    onClick={(e) => e.stopPropagation()}
                                    slotProps={{ input: { 'aria-label': `Stage ${f.path}` } }}
                                    sx={{ p: 0.5 }}
                                />
                            )}
                            <Tooltip title={describeStatus(f.status)}>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        fontWeight: 700,
                                        color: statusColor(f.status),
                                        width: 14,
                                        flexShrink: 0,
                                        textAlign: 'center',
                                    }}
                                >
                                    {statusLetter(f.status)}
                                </Typography>
                            </Tooltip>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        display: 'block',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        direction: 'rtl',
                                        textAlign: 'left',
                                    }}
                                    title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}
                                >
                                    <Box component="span" sx={{ color: ATLAS_PALETTE.slate60 }}>
                                        {dir}
                                    </Box>
                                    <Box component="span" sx={{ color: ATLAS_PALETTE.slate }}>
                                        {base}
                                    </Box>
                                </Typography>
                                {f.old_path && (
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            display: 'block',
                                            color: ATLAS_PALETTE.slate60,
                                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                                            fontSize: 10,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        ← {f.old_path}
                                    </Typography>
                                )}
                            </Box>
                            <Typography
                                variant="caption"
                                sx={{
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    fontSize: 10,
                                    flexShrink: 0,
                                    color: ATLAS_PALETTE.slate60,
                                }}
                            >
                                {f.binary ? (
                                    'bin'
                                ) : (
                                    <>
                                        <Box component="span" sx={{ color: ATLAS_PALETTE.successFg }}>
                                            +{f.additions}
                                        </Box>{' '}
                                        <Box component="span" sx={{ color: ATLAS_PALETTE.dangerFg }}>
                                            −{f.deletions}
                                        </Box>
                                    </>
                                )}
                            </Typography>
                        </Stack>
                    );
                })}

                {truncated && (
                    <Typography
                        variant="caption"
                        sx={{ display: 'block', p: 1.5, color: ATLAS_PALETTE.warnFg }}
                    >
                        Showing {files.length} of {totalFiles} changed files.
                    </Typography>
                )}
            </Box>
        </Stack>
    );
}
