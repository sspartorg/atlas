import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Radio from '@mui/material/Radio';
import FormControlLabel from '@mui/material/FormControlLabel';
import RadioGroup from '@mui/material/RadioGroup';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import VpnKeyOutlined from '@mui/icons-material/VpnKeyOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ArrowForward from '@mui/icons-material/ArrowForward';
import ArrowBack from '@mui/icons-material/ArrowBack';
import GitHubIcon from '@mui/icons-material/GitHub';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, AtlasApiError } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { ICredential } from '@atlas/shared';
import { FormHeading } from '../../components/FormHeading.js';
import { ApiErrorAlert } from '../../components/ApiErrorAlert.js';

export type CredentialModalMode = { kind: 'add' } | { kind: 'edit'; credential: ICredential };

interface Props {
    open: boolean;
    mode: CredentialModalMode;
    onClose: () => void;
}

type View = 'kind' | 'form' | 'saved';

const SECTION_LABEL_SX = {
    fontSize: 12,
    fontWeight: 500,
    color: ATLAS_PALETTE.slate,
    mb: 1.5,
    display: 'block',
};

export function CredentialModal({ open, mode, onClose }: Props) {
    const qc = useQueryClient();
    // On edit we open directly into the form. On add we let the user pick
    // between PAT and GitHub App first.
    const initialKind: 'pat' | 'ssh' | 'app' =
        mode.kind === 'edit'
            ? mode.credential.kind === 'github_app'
                ? 'app'
                : 'pat'
            : 'pat';
    const [view, setView] = useState<View>(mode.kind === 'edit' ? 'form' : 'kind');
    const [chosenKind, setChosenKind] = useState<'pat' | 'ssh' | 'app'>(initialKind);
    const [label, setLabel] = useState(mode.kind === 'edit' ? mode.credential.label : '');
    const [token, setToken] = useState('');
    const [scope, setScope] = useState(mode.kind === 'edit' ? mode.credential.scope : '');
    const [showToken, setShowToken] = useState(false);
    // GitHub App branch fields — only used when chosenKind === 'app'.
    const [botInfoPath, setBotInfoPath] = useState('');
    const [installOwner, setInstallOwner] = useState(
        mode.kind === 'edit' ? (mode.credential.app_installation_owner ?? '') : '',
    );
    // Human-attribution fields (migration 025). Optional — leaving them
    // blank keeps bot-only attribution. When all three are set, commits
    // get a `Co-Authored-By: <name> <email>` trailer and PRs get
    // `--assignee <login>` + `Requested-By:` prefix in the body.
    const [humanName, setHumanName] = useState(
        mode.kind === 'edit' ? (mode.credential.human_name ?? '') : '',
    );
    const [humanEmail, setHumanEmail] = useState(
        mode.kind === 'edit' ? (mode.credential.human_email ?? '') : '',
    );
    const [humanGhLogin, setHumanGhLogin] = useState(
        mode.kind === 'edit' ? (mode.credential.human_gh_login ?? '') : '',
    );
    // W4 — `error` holds either a string (client-side validation messages)
    // or a AtlasApiError thrown from `request<T>`. ApiErrorAlert switches
    // on AtlasApiError.kind for the actionable copy; plain strings fall
    // through to the generic severity="error" alert.
    const [error, setError] = useState<unknown>(null);
    const [savedCred, setSavedCred] = useState<ICredential | null>(null);

    // Reset internal state when modal reopens or mode flips
    useEffect(() => {
        if (!open) return;
        if (mode.kind === 'edit') {
            setView('form');
            setLabel(mode.credential.label);
            setScope(mode.credential.scope);
            setToken('');
            setSavedCred(null);
            setInstallOwner(mode.credential.app_installation_owner ?? '');
            setBotInfoPath('');
            setHumanName(mode.credential.human_name ?? '');
            setHumanEmail(mode.credential.human_email ?? '');
            setHumanGhLogin(mode.credential.human_gh_login ?? '');
            setChosenKind(mode.credential.kind === 'github_app' ? 'app' : 'pat');
        } else {
            setView('kind');
            setLabel('');
            setScope('');
            setToken('');
            setSavedCred(null);
            setBotInfoPath('');
            setInstallOwner('');
            setHumanName('');
            setHumanEmail('');
            setHumanGhLogin('');
            setChosenKind('pat');
        }
        setError(null);
        setShowToken(false);
    }, [open, mode]);

    const create = useMutation({
        mutationFn: () =>
            chosenKind === 'app'
                ? api.credentials.create({
                      label: label.trim(),
                      host: 'github',
                      kind: 'github_app',
                      bot_info_path: botInfoPath.trim(),
                      app_installation_owner: installOwner.trim(),
                      scope: scope.trim(),
                      human_name: humanName.trim() || null,
                      human_email: humanEmail.trim() || null,
                      human_gh_login: humanGhLogin.trim() || null,
                  })
                : api.credentials.create({
                      label: label.trim(),
                      host: 'github',
                      kind: 'pat',
                      username: 'x-access-token',
                      token: token.trim(),
                      scope: scope.trim(),
                      expires_at: null,
                  }),
        onSuccess: (cred) => {
            setSavedCred(cred);
            setView('saved');
            void qc.invalidateQueries({ queryKey: ['credentials'] });
        },
        onError: (err) =>
            setError(err instanceof AtlasApiError ? err : (err as Error).message),
    });

    const updateCred = useMutation({
        mutationFn: () => {
            if (mode.kind !== 'edit') throw new Error('Not in edit mode');
            const patch: Record<string, string | null> = {
                label: label.trim(),
                scope: scope.trim(),
            };
            if (token.trim() && mode.credential.kind === 'pat') patch['token'] = token.trim();
            if (mode.credential.kind === 'github_app') {
                // Always send `app_installation_owner` on github_app edit
                // — omitting when blank silently swallowed the Owner's
                // intent to reassign the installation (finding
                // CredentialModal.tsx:166 in the 2026-07-03 audit). If
                // the trimmed value is empty, the server-side kind-check
                // returns a 400 with a clear message rather than a 200
                // that changed nothing.
                patch['app_installation_owner'] = installOwner.trim();
                // Send the human_* fields as-is (blank string clears the
                // row's value; server-side we normalize '' → null via
                // `.trim() || null`).
                patch['human_name'] = humanName.trim() || null;
                patch['human_email'] = humanEmail.trim() || null;
                patch['human_gh_login'] = humanGhLogin.trim() || null;
            }
            return api.credentials.update(mode.credential.id, patch);
        },
        onSuccess: (cred) => {
            setSavedCred(cred);
            setView('saved');
            void qc.invalidateQueries({ queryKey: ['credentials'] });
        },
        onError: (err) =>
            setError(err instanceof AtlasApiError ? err : (err as Error).message),
    });

    function handleSave() {
        setError(null);
        if (!label.trim()) {
            setError('Label is required.');
            return;
        }
        if (mode.kind === 'add') {
            if (chosenKind === 'app') {
                if (!botInfoPath.trim()) {
                    setError('Paste the path to the bot info folder.');
                    return;
                }
                if (!installOwner.trim()) {
                    setError('Enter the GitHub account the App is installed on.');
                    return;
                }
            } else {
                if (!token.trim() || token.trim().length < 8) {
                    setError('Paste a valid Personal Access Token.');
                    return;
                }
            }
            create.mutate();
        } else {
            updateCred.mutate();
        }
    }

    function handleClose() {
        if (create.isPending || updateCred.isPending) return;
        onClose();
    }

    function resetForAddAnother() {
        setView('kind');
        setLabel('');
        setToken('');
        setScope('');
        setBotInfoPath('');
        setInstallOwner('');
        setHumanName('');
        setHumanEmail('');
        setHumanGhLogin('');
        setSavedCred(null);
        setError(null);
        setChosenKind('pat');
    }

    const isPending = create.isPending || updateCred.isPending;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.white,
                    boxShadow: '0 24px 48px rgba(0,0,0,.18)',
                    m: 2,
                },
            }}
        >
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, p: 5, pb: 0 }}>
                {view !== 'saved' ? (
                    <Box
                        sx={{
                            width: 36,
                            height: 36,
                            borderRadius: '10px',
                            bgcolor: ATLAS_PALETTE.cloud,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <VpnKeyOutlined sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 18 }} />
                    </Box>
                ) : (
                    <Box
                        sx={{
                            width: 36,
                            height: 36,
                            borderRadius: '10px',
                            bgcolor: 'rgba(49,171,70,.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <CheckCircleOutline sx={{ color: ATLAS_PALETTE.green, fontSize: 22 }} />
                    </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>
                        {view === 'kind' && 'Add credential'}
                        {view === 'form' &&
                            (mode.kind === 'edit'
                                ? chosenKind === 'app'
                                    ? 'Edit GitHub App'
                                    : 'Edit Personal Access Token'
                                : chosenKind === 'app'
                                  ? 'Add GitHub App'
                                  : 'Add Personal Access Token')}
                        {view === 'saved' && 'Credential saved'}
                    </FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {view === 'kind' && 'Pick the credential type your git host supports.'}
                        {view === 'form' &&
                            (chosenKind === 'app'
                                ? 'Point atlas at the folder holding your App id and .pem file.'
                                : 'Atlas encrypts the token before it leaves your browser.')}
                        {view === 'saved' && 'Encrypted and ready to use in any project.'}
                    </Typography>
                </Box>
            </Box>

            <Box sx={{ p: 5, pt: 4 }}>
                {view === 'kind' && (
                    <>
                        <Typography sx={SECTION_LABEL_SX}>Credential type</Typography>
                        <RadioGroup
                            value={chosenKind}
                            onChange={(e) => setChosenKind(e.target.value as 'pat' | 'ssh' | 'app')}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2,
                                }}
                            >
                                <FormControlLabel
                                    value="pat"
                                    control={<Radio sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                                    label={
                                        <Box>
                                            <Typography
                                                sx={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: ATLAS_PALETTE.slate,
                                                }}
                                            >
                                                Personal Access Token
                                            </Typography>
                                            <Typography
                                                sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}
                                            >
                                                GitHub · GitLab · Bitbucket
                                            </Typography>
                                        </Box>
                                    }
                                    sx={{
                                        border: `1px solid ${chosenKind === 'pat' ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                                        borderRadius: '10px',
                                        m: 0,
                                        p: 2.5,
                                        bgcolor:
                                            chosenKind === 'pat'
                                                ? ATLAS_PALETTE.slate06
                                                : 'transparent',
                                    }}
                                />
                                <FormControlLabel
                                    value="ssh"
                                    disabled
                                    control={<Radio />}
                                    label={
                                        <Box>
                                            <Typography
                                                sx={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: ATLAS_PALETTE.slate40,
                                                }}
                                            >
                                                SSH key
                                            </Typography>
                                            <Typography
                                                sx={{ fontSize: 11, color: ATLAS_PALETTE.slate40 }}
                                            >
                                                coming soon
                                            </Typography>
                                        </Box>
                                    }
                                    sx={{
                                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                        borderRadius: '10px',
                                        m: 0,
                                        p: 2.5,
                                    }}
                                />
                                <FormControlLabel
                                    value="app"
                                    control={<Radio sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                                    label={
                                        <Box>
                                            <Typography
                                                sx={{
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                    color: ATLAS_PALETTE.slate,
                                                }}
                                            >
                                                GitHub App
                                            </Typography>
                                            <Typography
                                                sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}
                                            >
                                                Commits &amp; PRs authored as a bot identity
                                            </Typography>
                                        </Box>
                                    }
                                    sx={{
                                        border: `1px solid ${chosenKind === 'app' ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                                        borderRadius: '10px',
                                        m: 0,
                                        p: 2.5,
                                        bgcolor:
                                            chosenKind === 'app'
                                                ? ATLAS_PALETTE.slate06
                                                : 'transparent',
                                    }}
                                />
                            </Box>
                        </RadioGroup>

                        <Alert
                            icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                            sx={{
                                mt: 4,
                                bgcolor: ATLAS_PALETTE.cloud,
                                color: ATLAS_PALETTE.slate,
                                fontSize: 12,
                                '& .MuiAlert-message': { fontSize: 12 },
                            }}
                        >
                            PATs are easiest for GitHub — generate one with <strong>repo</strong>{' '}
                            scope.
                        </Alert>

                        <Box sx={{ mt: 5, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                onClick={handleClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                color="success"
                                endIcon={<ArrowForward />}
                                onClick={() => setView('form')}
                                disabled={chosenKind !== 'pat' && chosenKind !== 'app'}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Continue
                            </Button>
                        </Box>
                    </>
                )}

                {view === 'form' && (
                    <>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                gap: { xs: 4, md: 3 },
                                mb: 3,
                            }}
                        >
                            <FormControl fullWidth size="small">
                                <InputLabel id="credential-host-label">Host</InputLabel>
                                <Select
                                    labelId="credential-host-label"
                                    label="Host"
                                    value="github"
                                    disabled
                                >
                                    <MenuItem value="github">
                                        <Box
                                            sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
                                        >
                                            <GitHubIcon sx={{ fontSize: 16 }} />
                                            GitHub
                                        </Box>
                                    </MenuItem>
                                </Select>
                            </FormControl>
                            <TextField
                                fullWidth
                                size="small"
                                required
                                label="Label"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="acme-bot"
                                helperText="Your choice — used in the project picker."
                            />
                        </Box>

                        {chosenKind === 'pat' && (
                            <TextField
                                fullWidth
                                size="small"
                                required={mode.kind !== 'edit'}
                                label="Token"
                                type={showToken ? 'text' : 'password'}
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                placeholder={mode.kind === 'edit' ? '••••••••••••••••' : 'ghp_…'}
                                helperText={
                                    mode.kind === 'edit'
                                        ? 'Leave blank to keep existing token.'
                                        : 'ghp_… classic or fine-grained.'
                                }
                                sx={{ mb: 3 }}
                                slotProps={{
                                    input: {
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    size="small"
                                                    onClick={() => setShowToken((v) => !v)}
                                                >
                                                    {showToken ? (
                                                        <VisibilityOffOutlined sx={{ fontSize: 16 }} />
                                                    ) : (
                                                        <VisibilityOutlined sx={{ fontSize: 16 }} />
                                                    )}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    },
                                }}
                            />
                        )}

                        {chosenKind === 'app' && (
                            <>
                                {mode.kind !== 'edit' && (
                                    <TextField
                                        fullWidth
                                        size="small"
                                        required
                                        label="Bot info folder"
                                        value={botInfoPath}
                                        onChange={(e) => setBotInfoPath(e.target.value)}
                                        placeholder="C:\Users\you\AIPrograms\atlas\bots-info\atlas-bot"
                                        helperText="Folder holding app-config.json and one .pem file. Atlas reads and encrypts them — the files stay put."
                                        sx={{ mb: 3 }}
                                    />
                                )}
                                <TextField
                                    fullWidth
                                    size="small"
                                    required
                                    label="Installation owner"
                                    value={installOwner}
                                    onChange={(e) => setInstallOwner(e.target.value)}
                                    placeholder="sspartorg"
                                    helperText="GitHub user or org the App is installed on."
                                    sx={{ mb: 3 }}
                                />
                                <Typography sx={{ ...SECTION_LABEL_SX, mt: 2, mb: 1 }}>
                                    Human attribution (optional)
                                </Typography>
                                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                                    When set, commits get a Co-Authored-By trailer and PRs are
                                    assigned to you. Bot stays as the primary author.
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                        gap: { xs: 3, md: 2 },
                                        mb: 3,
                                    }}
                                >
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="Your name"
                                        value={humanName}
                                        onChange={(e) => setHumanName(e.target.value)}
                                        placeholder="sspart"
                                        helperText="Shows on the Co-Authored-By trailer."
                                    />
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label="Your email"
                                        type="email"
                                        value={humanEmail}
                                        onChange={(e) => setHumanEmail(e.target.value)}
                                        placeholder="sspart.org@gmail.com"
                                        helperText="Trailer email — GitHub matches this to your profile."
                                    />
                                </Box>
                                <TextField
                                    fullWidth
                                    size="small"
                                    label="Your GitHub login"
                                    value={humanGhLogin}
                                    onChange={(e) => setHumanGhLogin(e.target.value)}
                                    placeholder="sspartorg"
                                    helperText="Used for --assignee and Requested-By: @<login> in the PR body."
                                    sx={{ mb: 3 }}
                                />
                            </>
                        )}

                        <TextField
                            fullWidth
                            size="small"
                            label="Repo scope"
                            value={scope}
                            onChange={(e) => setScope(e.target.value)}
                            placeholder="acme/*, mantra-*"
                            helperText="Comma-separated — used for the project picker."
                            sx={{ mb: 3 }}
                        />

                        <Alert
                            icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                            sx={{
                                bgcolor: ATLAS_PALETTE.cloud,
                                color: ATLAS_PALETTE.slate,
                                fontSize: 12,
                                '& .MuiAlert-message': { fontSize: 12 },
                            }}
                        >
                            {chosenKind === 'app' ? (
                                <>
                                    Atlas reads <strong>app-config.json</strong> and the{' '}
                                    <Box
                                        component="code"
                                        sx={{
                                            bgcolor: ATLAS_PALETTE.white,
                                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: '4px',
                                            fontFamily: '"JetBrains Mono", monospace',
                                            fontSize: 11,
                                        }}
                                    >
                                        *.pem
                                    </Box>{' '}
                                    from that folder, encrypts the private key, and mints
                                    short-lived installation tokens on demand. Commits pushed with
                                    this credential are authored by the App&apos;s bot identity.
                                </>
                            ) : (
                                <>
                                    We&apos;ll verify the token against github.com and store it
                                    encrypted. Required scopes:{' '}
                                    <Box
                                        component="code"
                                        sx={{
                                            bgcolor: ATLAS_PALETTE.white,
                                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: '4px',
                                            fontFamily: '"JetBrains Mono", monospace',
                                            fontSize: 11,
                                        }}
                                    >
                                        repo
                                    </Box>{' '}
                                    <Box
                                        component="code"
                                        sx={{
                                            bgcolor: ATLAS_PALETTE.white,
                                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: '4px',
                                            fontFamily: '"JetBrains Mono", monospace',
                                            fontSize: 11,
                                        }}
                                    >
                                        read:org
                                    </Box>
                                    .
                                </>
                            )}
                        </Alert>

                        {error != null && error !== '' && (
                            <Box sx={{ mt: 3 }}>
                                <ApiErrorAlert
                                    error={error}
                                    contextLabel="Couldn't save credential"
                                />
                            </Box>
                        )}

                        <Box
                            sx={{
                                mt: 4,
                                display: 'flex',
                                flexDirection: { xs: 'column', sm: 'row' },
                                alignItems: { xs: 'stretch', sm: 'center' },
                                justifyContent: 'space-between',
                                gap: 2,
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    color: ATLAS_PALETTE.slate60,
                                    fontSize: 11,
                                }}
                            >
                                <LockOutlined sx={{ fontSize: 14 }} />
                                Encrypted before upload
                            </Box>
                            <Box
                                sx={{
                                    display: 'flex',
                                    gap: 2,
                                    justifyContent: { xs: 'flex-end', sm: 'flex-start' },
                                }}
                            >
                                {mode.kind === 'add' && (
                                    <Button
                                        onClick={() => setView('kind')}
                                        sx={{
                                            textTransform: 'none',
                                            color: ATLAS_PALETTE.slate60,
                                        }}
                                        disabled={isPending}
                                    >
                                        <ArrowBack sx={{ fontSize: 16, mr: 1 }} />
                                        Back
                                    </Button>
                                )}
                                <Button
                                    variant="contained"
                                    color="success"
                                    onClick={handleSave}
                                    disabled={isPending}
                                    endIcon={
                                        isPending ? (
                                            <CircularProgress size={14} color="inherit" />
                                        ) : (
                                            <CheckCircleOutline />
                                        )
                                    }
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                    {mode.kind === 'edit' ? 'Save changes' : 'Verify & save'}
                                </Button>
                            </Box>
                        </Box>
                    </>
                )}

                {view === 'saved' && savedCred && (
                    <>
                        <Alert
                            icon={<CheckCircleOutline sx={{ color: ATLAS_PALETTE.green }} />}
                            sx={{
                                bgcolor: 'rgba(49,171,70,.08)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 12 },
                            }}
                        >
                            <strong>Encrypted at rest.</strong> Available in the New Project picker
                            as GitHub · {savedCred.label}.
                        </Alert>

                        <Box
                            sx={{
                                mt: 4,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '10px',
                                overflow: 'hidden',
                            }}
                        >
                            {(savedCred.kind === 'github_app'
                                ? ([
                                      ['Label', savedCred.label],
                                      ['Host', 'github.com'],
                                      ['Kind', 'GitHub App'],
                                      ['App id', String(savedCred.app_id ?? '—')],
                                      ['Installation owner', savedCred.app_installation_owner ?? '—'],
                                      [
                                          'Token expires',
                                          savedCred.expires_at
                                              ? new Date(savedCred.expires_at).toLocaleString()
                                              : 'not minted yet',
                                      ],
                                  ] as const)
                                : ([
                                      ['Label', savedCred.label],
                                      ['Host', 'github.com'],
                                      ['Kind', 'Personal Access Token'],
                                      ['Scope', savedCred.scope || 'repo'],
                                      ['Fingerprint', savedCred.token_fingerprint ?? '—'],
                                  ] as const)
                            ).map(([k, v], i, arr) => (
                                <Box
                                    key={k}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '160px 1fr',
                                        px: 3,
                                        py: 2,
                                        borderBottom:
                                            i < arr.length - 1
                                                ? `1px solid ${ATLAS_PALETTE.slate06}`
                                                : 'none',
                                        bgcolor: i % 2 === 0 ? ATLAS_PALETTE.white : ATLAS_PALETTE.slate08,
                                    }}
                                >
                                    <Typography
                                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}
                                    >
                                        {k}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily:
                                                k === 'Fingerprint'
                                                    ? '"JetBrains Mono", monospace'
                                                    : 'inherit',
                                            fontSize: 12,
                                            color: ATLAS_PALETTE.slate,
                                        }}
                                    >
                                        {v}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            {mode.kind === 'add' && (
                                <Button
                                    onClick={resetForAddAnother}
                                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                                >
                                    Add another
                                </Button>
                            )}
                            <Button
                                variant="contained"
                                color="success"
                                onClick={handleClose}
                                sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                                Done
                            </Button>
                        </Box>
                    </>
                )}
            </Box>
        </Dialog>
    );
}
