import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SaveRounded from '@mui/icons-material/SaveRounded';
import TerminalRounded from '@mui/icons-material/TerminalRounded';
import { useProjectRepos, useUpdateProjectRepo } from '../../hooks/useProjectRepos.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// 2026-06-10 — Setup scripts editor.
//
// ADR 0018 — the two free-text editors (`.sh` and `.ps1`) belong to a repo,
// not the project: pick the repo, edit its scripts. Executed by the agent
// runner (project-setup-runner) in that repo's checkout before the CLI starts.

const MONO = '"JetBrains Mono", monospace';

interface Props {
    projectId: string;
}

export function SetupTab({ projectId }: Props) {
    const { data: repos, isLoading } = useProjectRepos(projectId);
    const update = useUpdateProjectRepo(projectId);
    const toast = useToast();

    const [selectedId, setSelectedId] = useState('');
    // Falls back to the first repo until the Owner picks one (and again if the
    // picked one is removed under us).
    const repo = repos?.find((r) => r.id === selectedId) ?? repos?.[0];

    const [sh, setSh] = useState('');
    const [ps1, setPs1] = useState('');

    // Sync local state when the repo finishes loading, refetches, or changes.
    useEffect(() => {
        if (repo) {
            setSh(repo.setup_sh_body ?? '');
            setPs1(repo.setup_ps1_body ?? '');
        }
    }, [repo]);

    const dirty = useMemo(
        () =>
            repo !== undefined &&
            (sh !== (repo.setup_sh_body ?? '') || ps1 !== (repo.setup_ps1_body ?? '')),
        [repo, sh, ps1]
    );

    async function handleSave(): Promise<void> {
        if (!repo) return;
        await update.mutateAsync(
            {
                repoId: repo.id,
                data: { setup_sh_body: sh, setup_ps1_body: ps1 },
            },
            {
                onSuccess: () => toast.show({ message: 'Setup scripts saved' }),
            }
        );
    }

    if (isLoading || !repos) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress size={20} />
            </Box>
        );
    }

    if (!repo) {
        return (
            <Alert severity="info">
                This project has no repos yet. Setup scripts belong to a repo — add one on the Repos
                tab.
            </Alert>
        );
    }

    return (
        <Box>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 2,
                    mb: 3,
                    flexWrap: 'wrap',
                }}
            >
                <Box sx={{ flex: 1, minWidth: 300 }}>
                    <Typography
                        sx={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                        }}
                    >
                        <TerminalRounded sx={{ fontSize: 20, color: ATLAS_PALETTE.brandBlue }} />
                        Setup scripts
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 13,
                            color: ATLAS_PALETTE.slate60,
                            mt: 0.5,
                            lineHeight: 1.5,
                        }}
                    >
                        Runs in this repo&apos;s fresh worktree before the agent CLI starts —
                        symlinks, env-file generation, system checks, anything project-specific. The
                        API host runs the PowerShell body on Windows and the shell body elsewhere;
                        leave blank if not needed. A failing script ends the run as setup failed and
                        the CLI never starts.
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={!dirty || update.isPending}
                    startIcon={
                        update.isPending ? (
                            <CircularProgress size={14} sx={{ color: ATLAS_PALETTE.white }} />
                        ) : (
                            <SaveRounded sx={{ fontSize: 16 }} />
                        )
                    }
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.brandBlue,
                        '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue, opacity: 0.9 },
                        '&.Mui-disabled': {
                            bgcolor: ATLAS_PALETTE.slate12,
                            color: ATLAS_PALETTE.slate60,
                        },
                    }}
                >
                    {update.isPending ? 'Saving…' : 'Save'}
                </Button>
            </Box>

            <FormControl size="small" sx={{ mb: 3, minWidth: 220 }}>
                <InputLabel id="setup-repo-label">Repo</InputLabel>
                <Select
                    labelId="setup-repo-label"
                    id="setup-repo"
                    label="Repo"
                    value={repo.id}
                    onChange={(e) => setSelectedId(e.target.value)}
                    sx={{ fontFamily: MONO, fontSize: 13 }}
                >
                    {repos.map((r) => (
                        <MenuItem key={r.id} value={r.id} sx={{ fontFamily: MONO, fontSize: 13 }}>
                            {r.name}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            {update.isError && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    Failed to save:{' '}
                    {update.error instanceof Error ? update.error.message : 'Unknown error'}
                </Alert>
            )}

            <Box
                sx={{
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    bgcolor: ATLAS_PALETTE.slate08,
                    borderRadius: 1.5,
                    px: 2,
                    py: 1.75,
                    mb: 3,
                }}
            >
                <Typography
                    sx={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: ATLAS_PALETTE.slate,
                        mb: 0.75,
                    }}
                >
                    Using secrets in your scripts
                </Typography>
                <Typography
                    sx={{
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate60,
                        lineHeight: 1.6,
                    }}
                >
                    Reference any secret with{' '}
                    <Box component="span" sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}>
                        ${'{variable.KEY}'}
                    </Box>{' '}
                    anywhere in the script body. Before the orchestrator runs the script it replaces
                    each placeholder with the resolved value — the substituted text is what actually
                    gets executed, so the shell never sees{' '}
                    <Box component="span" sx={{ fontFamily: MONO }}>
                        ${'{variable.…}'}
                    </Box>
                    .
                </Typography>

                <Box
                    sx={{
                        mt: 1,
                        fontFamily: MONO,
                        fontSize: 12,
                        color: ATLAS_PALETTE.slate,
                        bgcolor: ATLAS_PALETTE.white,
                        border: `1px solid ${ATLAS_PALETTE.slate12}`,
                        borderRadius: 1,
                        px: 1.25,
                        py: 1,
                        lineHeight: 1.7,
                        whiteSpace: 'pre',
                        overflowX: 'auto',
                    }}
                >
                    {`# bash\nexport GITHUB_TOKEN="\${variable.GITHUB_TOKEN}"\n\n# powershell\n$env:GITHUB_TOKEN = "\${variable.GITHUB_TOKEN}"`}
                </Box>

                <Box
                    component="ul"
                    sx={{
                        m: 0,
                        mt: 1.25,
                        pl: 2.5,
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate60,
                        lineHeight: 1.7,
                        '& li + li': { mt: 0.25 },
                    }}
                >
                    <li>
                        <Box component="span" sx={{ fontFamily: MONO, color: ATLAS_PALETTE.slate }}>
                            KEY
                        </Box>{' '}
                        must match{' '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            [A-Za-z_][A-Za-z0-9_]*
                        </Box>{' '}
                        — start with a letter or underscore, then letters/digits/underscores.
                    </li>
                    <li>
                        Values resolve from <strong>Settings &gt; Shared Secrets</strong> first,
                        then <strong>Project &gt; Manage Secrets</strong> — project entries override
                        shared ones on key collision.
                    </li>
                    <li>
                        Native shell expansions like{' '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            ${'{HOME}'}
                        </Box>{' '}
                        or{' '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            $env:PATH
                        </Box>{' '}
                        are left untouched — only the{' '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            variable.
                        </Box>{' '}
                        namespace is substituted.
                    </li>
                    <li>
                        If a referenced key isn&apos;t defined, the run aborts with{' '}
                        <Box component="span" sx={{ fontFamily: MONO }}>
                            setup_failed
                        </Box>{' '}
                        before the CLI is spawned — add the secret and re-dispatch.
                    </li>
                </Box>
            </Box>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                    gap: 3,
                }}
            >
                <Box>
                    <Typography
                        sx={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            mb: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                        }}
                    >
                        <Box
                            component="span"
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                bgcolor: ATLAS_PALETTE.slate08,
                                color: ATLAS_PALETTE.slate60,
                                px: 1,
                                py: 0.25,
                                borderRadius: 1,
                            }}
                        >
                            .sh
                        </Box>
                        Bash / POSIX shell
                    </Typography>
                    <TextField
                        fullWidth
                        multiline
                        minRows={18}
                        maxRows={36}
                        value={sh}
                        onChange={(e) => setSh(e.target.value)}
                        placeholder={
                            '#!/usr/bin/env bash\nset -euo pipefail\n\n# Symlinks, env scaffolding, tool checks — anything one-shot per worktree.\n'
                        }
                        InputProps={{
                            sx: {
                                fontFamily: MONO,
                                fontSize: 12.5,
                                lineHeight: 1.6,
                                alignItems: 'flex-start',
                                py: 1.5,
                            },
                        }}
                    />
                </Box>
                <Box>
                    <Typography
                        sx={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            mb: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                        }}
                    >
                        <Box
                            component="span"
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                bgcolor: ATLAS_PALETTE.slate08,
                                color: ATLAS_PALETTE.slate60,
                                px: 1,
                                py: 0.25,
                                borderRadius: 1,
                            }}
                        >
                            .ps1
                        </Box>
                        Windows PowerShell
                    </Typography>
                    <TextField
                        fullWidth
                        multiline
                        minRows={18}
                        maxRows={36}
                        value={ps1}
                        onChange={(e) => setPs1(e.target.value)}
                        placeholder={
                            "$ErrorActionPreference = 'Stop'\n\n# Symlinks, env scaffolding, tool checks — anything one-shot per worktree.\n"
                        }
                        InputProps={{
                            sx: {
                                fontFamily: MONO,
                                fontSize: 12.5,
                                lineHeight: 1.6,
                                alignItems: 'flex-start',
                                py: 1.5,
                            },
                        }}
                    />
                </Box>
            </Box>
        </Box>
    );
}
