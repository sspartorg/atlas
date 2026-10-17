import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import TerminalRounded from '@mui/icons-material/TerminalRounded';
import type { IProjectRepo } from '@atlas/shared';
import { useProjectRepos, useUpdateProjectRepo } from '../../hooks/useProjectRepos.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// Setup scripts, one `.sh` and one `.ps1` per repo (ADR 0018). The tab lists
// the project's repos with what each has; a repo opens its two scripts in a
// dialog. Executed by the agent runner (project-setup-runner) in that repo's
// fresh worktree before the CLI starts.

const MONO = '"JetBrains Mono", monospace';

interface Props {
    projectId: string;
}

export function SetupTab({ projectId }: Props) {
    const { data: repos, isLoading, isError } = useProjectRepos(projectId);
    const [openId, setOpenId] = useState<string | null>(null);
    const open = repos?.find((r) => r.id === openId) ?? null;

    if (isError) {
        return (
            <Alert severity="error">
                Could not load this project&apos;s repos. Refresh to try again.
            </Alert>
        );
    }
    if (isLoading || !repos) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                <CircularProgress size={20} aria-label="Loading repos" />
            </Box>
        );
    }
    if (repos.length === 0) {
        return (
            <Alert severity="info">
                This project has no repos yet. Setup scripts belong to a repo — add one on the Repos
                tab.
            </Alert>
        );
    }

    return (
        <Box>
            <Typography
                component="h2"
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
                    mb: 2.5,
                    lineHeight: 1.5,
                }}
            >
                Each repo has a shell and a PowerShell script that run in its fresh worktree before
                the agent CLI starts. A failing script ends the run as setup failed.
            </Typography>

            <Box
                component="ul"
                aria-label="Repos"
                sx={{
                    listStyle: 'none',
                    m: 0,
                    p: 0,
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    borderRadius: 1.5,
                }}
            >
                {repos.map((r, i) => (
                    <Box
                        component="li"
                        key={r.id}
                        sx={{ borderTop: i === 0 ? 'none' : `1px solid ${ATLAS_PALETTE.slate12}` }}
                    >
                        <ButtonBase
                            onClick={() => setOpenId(r.id)}
                            aria-label={`Edit setup scripts for ${r.name}`}
                            sx={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.5,
                                px: 2,
                                py: 1.5,
                                textAlign: 'left',
                                '&:hover, &.Mui-focusVisible': { bgcolor: ATLAS_PALETTE.slate06 },
                            }}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                        overflowWrap: 'anywhere',
                                    }}
                                >
                                    {r.name}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
                                    <ScriptChip ext=".sh" body={r.setup_sh_body} />
                                    <ScriptChip ext=".ps1" body={r.setup_ps1_body} />
                                </Box>
                            </Box>
                            <ChevronRightRounded sx={{ color: ATLAS_PALETTE.slate40 }} />
                        </ButtonBase>
                    </Box>
                ))}
            </Box>

            {open && (
                <SetupScriptsDialog
                    projectId={projectId}
                    repo={open}
                    onClose={() => setOpenId(null)}
                />
            )}
        </Box>
    );
}

/** Line count shown on the list; a blank script is "empty". */
export function scriptSummary(body: string | null | undefined): string {
    const text = (body ?? '').trimEnd();
    if (!text.trim()) return 'empty';
    const n = text.split('\n').length;
    return `${n} line${n === 1 ? '' : 's'}`;
}

function ScriptChip({ ext, body }: { ext: string; body: string | null | undefined }) {
    const summary = scriptSummary(body);
    const set = summary !== 'empty';
    return (
        <Box
            component="span"
            sx={{
                fontFamily: MONO,
                fontSize: 11,
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: set ? ATLAS_PALETTE.accentSoft : ATLAS_PALETTE.slate08,
                color: set ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate60,
            }}
        >
            {ext} · {summary}
        </Box>
    );
}

function SetupScriptsDialog({
    projectId,
    repo,
    onClose,
}: {
    projectId: string;
    repo: IProjectRepo;
    onClose: () => void;
}) {
    const update = useUpdateProjectRepo(projectId);
    const toast = useToast();
    const fullScreen = useIsMobile();
    const [sh, setSh] = useState(repo.setup_sh_body ?? '');
    const [ps1, setPs1] = useState(repo.setup_ps1_body ?? '');
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const dirty = sh !== (repo.setup_sh_body ?? '') || ps1 !== (repo.setup_ps1_body ?? '');

    // A clean dialog follows the stored scripts if they change underneath it
    // (another tab saved); a dirty one keeps the Owner's edits.
    useEffect(() => {
        if (!dirty) {
            setSh(repo.setup_sh_body ?? '');
            setPs1(repo.setup_ps1_body ?? '');
        }
    }, [repo.setup_sh_body, repo.setup_ps1_body]);

    const requestClose = () => (dirty && !update.isPending ? setConfirmDiscard(true) : onClose());

    async function save(): Promise<void> {
        try {
            await update.mutateAsync({
                repoId: repo.id,
                data: { setup_sh_body: sh, setup_ps1_body: ps1 },
            });
            toast.show({ message: `Setup scripts saved for ${repo.name}` });
            onClose();
        } catch {
            // Shown in the dialog from update.error; the edits stay.
        }
    }

    return (
        <Dialog
            open
            onClose={requestClose}
            fullScreen={fullScreen}
            maxWidth="lg"
            fullWidth
            aria-labelledby="setup-dialog-title"
        >
            <DialogTitle
                id="setup-dialog-title"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}
            >
                <Box component="span" sx={{ fontSize: 16, fontWeight: 600 }}>
                    Setup scripts ·{' '}
                    <Box component="span" sx={{ fontFamily: MONO, overflowWrap: 'anywhere' }}>
                        {repo.name}
                    </Box>
                </Box>
                <IconButton
                    aria-label="Close"
                    onClick={requestClose}
                    sx={{ position: 'absolute', right: 8, top: 8 }}
                >
                    <CloseRounded />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Typography
                    sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mb: 2, lineHeight: 1.5 }}
                >
                    The API host runs the PowerShell script on Windows and the shell script
                    elsewhere. Leave a script blank if it isn&apos;t needed.
                </Typography>

                {update.isError && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        Could not save:{' '}
                        {update.error instanceof Error ? update.error.message : 'unknown error'}.
                        Your edits are still here.
                    </Alert>
                )}

                <SecretsHelp />

                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
                        gap: 3,
                    }}
                >
                    <ScriptEditor
                        ext=".sh"
                        label="Bash / POSIX shell"
                        ariaLabel="Bash setup script"
                        value={sh}
                        onChange={setSh}
                        placeholder={
                            '#!/usr/bin/env bash\nset -euo pipefail\n\n# Symlinks, env scaffolding, tool checks — anything one-shot per worktree.\n'
                        }
                    />
                    <ScriptEditor
                        ext=".ps1"
                        label="Windows PowerShell"
                        ariaLabel="PowerShell setup script"
                        value={ps1}
                        onChange={setPs1}
                        placeholder={
                            "$ErrorActionPreference = 'Stop'\n\n# Symlinks, env scaffolding, tool checks — anything one-shot per worktree.\n"
                        }
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
                {confirmDiscard ? (
                    <>
                        <Typography
                            role="alert"
                            sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, mr: 'auto' }}
                        >
                            Discard your unsaved changes?
                        </Typography>
                        <Button
                            onClick={() => setConfirmDiscard(false)}
                            sx={{ textTransform: 'none' }}
                        >
                            Keep editing
                        </Button>
                        <Button
                            color="error"
                            variant="contained"
                            onClick={onClose}
                            sx={{ textTransform: 'none' }}
                        >
                            Discard
                        </Button>
                    </>
                ) : (
                    <>
                        <Button onClick={requestClose} sx={{ textTransform: 'none' }}>
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => void save()}
                            disabled={!dirty || update.isPending}
                            startIcon={
                                update.isPending ? (
                                    <CircularProgress size={14} color="inherit" />
                                ) : null
                            }
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            {update.isPending ? 'Saving…' : 'Save scripts'}
                        </Button>
                    </>
                )}
            </DialogActions>
        </Dialog>
    );
}

function ScriptEditor(props: {
    ext: string;
    label: string;
    ariaLabel: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
}) {
    return (
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
                    {props.ext}
                </Box>
                {props.label}
            </Typography>
            <TextField
                fullWidth
                multiline
                minRows={14}
                maxRows={30}
                value={props.value}
                onChange={(e) => props.onChange(e.target.value)}
                placeholder={props.placeholder}
                slotProps={{
                    htmlInput: { 'aria-label': props.ariaLabel, spellCheck: false },
                    input: {
                        sx: {
                            fontFamily: MONO,
                            fontSize: 12.5,
                            lineHeight: 1.6,
                            alignItems: 'flex-start',
                            py: 1.5,
                        },
                    },
                }}
            />
        </Box>
    );
}

// Collapsed by default: the reference is for when you need it, not on every open.
function SecretsHelp() {
    const code = { fontFamily: MONO, color: ATLAS_PALETTE.slate } as const;
    return (
        <Box
            sx={{
                border: `1px solid ${ATLAS_PALETTE.slate12}`,
                bgcolor: ATLAS_PALETTE.slate08,
                borderRadius: 1.5,
                px: 2,
                py: 1.25,
                mb: 2.5,
                fontSize: 12.5,
                color: ATLAS_PALETTE.slate60,
                lineHeight: 1.6,
                '& summary': { cursor: 'pointer', fontWeight: 600, color: ATLAS_PALETTE.slate },
            }}
        >
            <details>
                <summary>Using secrets in your scripts</summary>
                <Box sx={{ mt: 1 }}>
                    Write{' '}
                    <Box component="span" sx={code}>
                        ${'{variable.KEY}'}
                    </Box>{' '}
                    anywhere in a script. It is replaced with the secret&apos;s value before the
                    script runs.
                </Box>
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
                        whiteSpace: 'pre',
                        overflowX: 'auto',
                    }}
                >
                    {`# bash\nexport GITHUB_TOKEN="\${variable.GITHUB_TOKEN}"\n\n# powershell\n$env:GITHUB_TOKEN = "\${variable.GITHUB_TOKEN}"`}
                </Box>
                <Box component="ul" sx={{ m: 0, mt: 1.25, pl: 2.5, '& li + li': { mt: 0.25 } }}>
                    <li>
                        <Box component="span" sx={code}>
                            KEY
                        </Box>{' '}
                        is the secret&apos;s name in UPPER_SNAKE_CASE, the only form Manage Secrets
                        and Shared Secrets save.
                    </li>
                    <li>
                        Values come from <strong>Settings &gt; Shared Secrets</strong> and this
                        project&apos;s <strong>Manage Secrets</strong>; the project&apos;s value
                        wins when both have the key.
                    </li>
                    <li>
                        Shell expansions like{' '}
                        <Box component="span" sx={code}>
                            ${'{HOME}'}
                        </Box>{' '}
                        or{' '}
                        <Box component="span" sx={code}>
                            $env:PATH
                        </Box>{' '}
                        are left alone; only{' '}
                        <Box component="span" sx={code}>
                            variable.
                        </Box>{' '}
                        is replaced.
                    </li>
                    <li>
                        A key that doesn&apos;t exist ends the run as{' '}
                        <Box component="span" sx={code}>
                            setup_failed
                        </Box>{' '}
                        before the CLI starts. Add the secret, then run again.
                    </li>
                </Box>
            </details>
        </Box>
    );
}
