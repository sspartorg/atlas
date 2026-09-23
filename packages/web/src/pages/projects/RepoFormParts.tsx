import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import GitHubIcon from '@mui/icons-material/GitHub';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import type { ICredential } from '@atlas/shared';
import type { ConnectError } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// Form parts shared by the two ways a git repo enters Atlas: a new project
// (NewProjectModal) and a repo added to a project (AddRepoDialog).

const MONO = '"JetBrains Mono", monospace';

export const inputSx = {
    '& .MuiOutlinedInput-root': {
        fontSize: 14,
        '& fieldset': { borderColor: ATLAS_PALETTE.slate10 },
        '&:hover fieldset': { borderColor: ATLAS_PALETTE.slate30 },
        '&.Mui-focused fieldset': { borderColor: ATLAS_PALETTE.brandBlue },
    },
};

export const LABEL_SX = {
    fontSize: 12,
    fontWeight: 500,
    color: ATLAS_PALETTE.slate,
    mb: 1.5,
    display: 'block',
};
const HINT_SX = { fontSize: 11, color: ATLAS_PALETTE.slate60, ml: 1 };

interface CredentialSelectProps {
    credentials: ICredential[];
    value: string;
    onChange: (id: string) => void;
    /** Leaves the form for Settings → Credentials. */
    onManage: () => void;
}

export function CredentialSelect({
    credentials,
    value,
    onChange,
    onManage,
}: CredentialSelectProps) {
    return (
        <>
            <Typography sx={LABEL_SX}>
                Git credential
                <Box component="span" sx={HINT_SX}>
                    {credentials.length} saved ·{' '}
                    <Box
                        component="a"
                        onClick={onManage}
                        sx={{ color: ATLAS_PALETTE.brandBlue, cursor: 'pointer' }}
                    >
                        manage in Settings
                    </Box>
                </Box>
            </Typography>
            {credentials.length === 0 ? (
                <Alert
                    severity="warning"
                    icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.orange }} />}
                    action={
                        <Button size="small" onClick={onManage} sx={{ textTransform: 'none' }}>
                            Add credential →
                        </Button>
                    }
                    sx={{
                        mb: 3,
                        bgcolor: 'rgba(199,83,47,.06)',
                        color: ATLAS_PALETTE.slate,
                        '& .MuiAlert-message': { fontSize: 13 },
                    }}
                >
                    No credentials saved yet. Add a Personal Access Token first.
                </Alert>
            ) : (
                <Select
                    fullWidth
                    size="small"
                    value={value}
                    onChange={(e) => onChange(e.target.value as string)}
                    sx={{ ...inputSx, mb: 3 }}
                    renderValue={(id) => {
                        const c = credentials.find((x) => x.id === id);
                        if (!c) return <em>Pick a credential</em>;
                        return (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <GitHubIcon sx={{ fontSize: 16, color: ATLAS_PALETTE.slate70 }} />
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        color: ATLAS_PALETTE.slate,
                                        fontWeight: 500,
                                    }}
                                >
                                    GitHub · {c.label}
                                </Typography>
                                <Box
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        px: 1,
                                        py: 0.25,
                                        bgcolor: ATLAS_PALETTE.slate08,
                                        color: ATLAS_PALETTE.slate70,
                                        borderRadius: '4px',
                                    }}
                                >
                                    {c.kind === 'github_app' ? 'App' : 'PAT'}
                                </Box>
                            </Box>
                        );
                    }}
                >
                    {credentials.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    width: '100%',
                                }}
                            >
                                <GitHubIcon sx={{ fontSize: 16, color: ATLAS_PALETTE.slate70 }} />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography
                                        sx={{
                                            fontSize: 13,
                                            color: ATLAS_PALETTE.slate,
                                            fontWeight: 500,
                                        }}
                                    >
                                        GitHub · {c.label}
                                    </Typography>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            color: ATLAS_PALETTE.slate60,
                                        }}
                                    >
                                        github.com · {c.scope || 'repo'}
                                    </Typography>
                                </Box>
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            )}
        </>
    );
}

interface ConnectErrorDetailsProps {
    error: ConnectError;
    folder: string;
    repoUrl: string;
}

/** Why registering a local clone failed: headline, folder vs. URL, the checks, what to try. */
export function ConnectErrorDetails({ error, folder, repoUrl }: ConnectErrorDetailsProps) {
    return (
        <>
            <Alert
                severity="error"
                icon={<ErrorOutline sx={{ color: ATLAS_PALETTE.error }} />}
                sx={{
                    bgcolor: 'rgba(220,38,38,.06)',
                    border: `1px solid rgba(220,38,38,.18)`,
                    color: ATLAS_PALETTE.slate,
                    '& .MuiAlert-message': { fontSize: 13 },
                }}
            >
                <strong>
                    {error.error_kind === 'origin_mismatch' && 'Remote URL mismatch'}
                    {error.error_kind === 'auth_failed' && 'Credential cannot reach remote'}
                    {error.error_kind === 'credential_missing' && 'Credential not found'}
                    {error.error_kind === 'not_git' && 'Folder is not a git repository'}
                    {error.error_kind === 'missing_folder' && 'Folder does not exist'}
                    {error.error_kind === 'already_registered' && 'Folder already registered'}
                </strong>
                <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                    {error.error_kind === 'origin_mismatch' &&
                        "The folder you picked is a valid git repository, but its origin points somewhere else. Atlas won't register a project whose remote it can't verify."}
                    {error.error_kind === 'auth_failed' &&
                        'The credential you selected was rejected when we tried to ls-remote the URL. Check the PAT scope or pick a different credential.'}
                    {error.error_kind === 'credential_missing' &&
                        'The selected credential could not be loaded. Pick a different credential.'}
                    {error.error_kind === 'not_git' &&
                        "The folder you picked doesn't contain a .git directory. Pick a folder that was cloned with git."}
                    {error.error_kind === 'missing_folder' &&
                        'The folder path is not accessible. Pick a different folder.'}
                    {error.error_kind === 'already_registered' &&
                        `This folder is already registered as "${error.existing_project?.name ?? '—'}".`}
                </Box>
            </Alert>

            <Box
                sx={{
                    mt: 4,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '10px',
                    overflow: 'hidden',
                }}
            >
                {[
                    ['Folder', folder, false],
                    ['You entered', repoUrl, false],
                    [
                        "Folder's origin",
                        error.folder_origin ?? '—',
                        error.error_kind === 'origin_mismatch',
                    ],
                    [
                        'HEAD',
                        error.head_branch && error.head_sha
                            ? `${error.head_branch} · ${error.head_sha}`
                            : '—',
                        false,
                    ],
                ].map(([k, v, dirty], i) => (
                    <Box
                        key={k as string}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '160px 1fr',
                            px: 3,
                            py: 2,
                            borderBottom: i < 3 ? `1px solid ${ATLAS_PALETTE.slate06}` : 'none',
                            bgcolor: i % 2 === 0 ? ATLAS_PALETTE.white : ATLAS_PALETTE.slate08,
                        }}
                    >
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            {k as string}
                        </Typography>
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 12,
                                color: dirty ? ATLAS_PALETTE.error : ATLAS_PALETTE.slate,
                                fontWeight: dirty ? 600 : 400,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {v as string}
                        </Typography>
                    </Box>
                ))}
            </Box>

            <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {[
                    {
                        ok: error.checks.folder_exists,
                        label: 'Folder exists',
                        detail: folder,
                    },
                    {
                        ok: error.checks.has_git,
                        label: 'Contains .git directory',
                        detail: '.git/HEAD readable',
                    },
                    {
                        ok: error.checks.ls_remote_ok,
                        label: 'Credential reaches remote',
                        detail: error.checks.ls_remote_ok ? 'ls-remote OK' : 'ls-remote failed',
                    },
                    {
                        ok: error.checks.origin_matches,
                        label: 'origin matches URL',
                        detail: error.folder_origin
                            ? `local remote points at ${error.folder_origin}`
                            : '',
                    },
                ].map((c) => (
                    <Box
                        key={c.label}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            p: 2,
                            border: `1px solid ${c.ok ? ATLAS_PALETTE.slate10 : 'rgba(220,38,38,.25)'}`,
                            bgcolor: c.ok ? 'transparent' : 'rgba(220,38,38,.04)',
                            borderRadius: '8px',
                        }}
                    >
                        {c.ok ? (
                            <CheckCircleOutline sx={{ color: ATLAS_PALETTE.green, fontSize: 18 }} />
                        ) : (
                            <ErrorOutline sx={{ color: ATLAS_PALETTE.error, fontSize: 18 }} />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontSize: 13,
                                    color: ATLAS_PALETTE.slate,
                                    fontWeight: 500,
                                }}
                            >
                                {c.label}
                            </Typography>
                            {c.detail && (
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    {c.detail}
                                </Typography>
                            )}
                        </Box>
                    </Box>
                ))}
            </Box>

            <Box sx={{ mt: 3, p: 3, bgcolor: ATLAS_PALETTE.cloud, borderRadius: '8px' }}>
                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1.5,
                    }}
                >
                    Try
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {(error.error_kind === 'origin_mismatch'
                        ? [
                              "Update the entered URL to match the folder's origin",
                              'Or git remote set-url origin … in the folder, then retry',
                              'Or pick a different folder',
                          ]
                        : error.error_kind === 'auth_failed'
                          ? [
                                'Update the PAT scope in Settings → Credentials',
                                'Pick a different credential',
                                'Verify the URL is reachable from your machine',
                            ]
                          : error.error_kind === 'already_registered'
                            ? [
                                  'Open the existing project from the list',
                                  'Or pick a different folder',
                              ]
                            : error.error_kind === 'not_git'
                              ? ['Pick a folder cloned with git', 'Or use Clone fresh instead']
                              : ['Pick a different folder', 'Verify the path still exists on disk']
                    ).map((t) => (
                        <Box key={t} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <RadioButtonUnchecked
                                sx={{ fontSize: 14, color: ATLAS_PALETTE.slate40 }}
                            />
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70 }}>
                                {t}
                            </Typography>
                        </Box>
                    ))}
                </Box>
            </Box>
        </>
    );
}
