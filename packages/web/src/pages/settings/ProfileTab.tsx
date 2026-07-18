import { Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import VpnKeyOutlined from '@mui/icons-material/VpnKeyOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import { useSettings, useUpdateProfile } from '../../hooks/useSettings.js';
import { useCredentials } from '../../hooks/useCredentials.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useToast } from '../../hooks/useToast.js';
import { FolderPicker } from '../../components/FolderPicker.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { SettingsSection } from './SettingsSection.js';
import { AccentColorPicker } from './AccentColorPicker.js';
import { ThemeModeToggle } from '../../components/ThemeModeToggle.js';
import { lazyNamed } from '../../utils/lazyNamed.js';
// Lazy: pulls in 5 entity-list hooks (projects/epics/stories/agents/bugs) that
// otherwise fire on every Settings cold-load even when the modal is closed.
const ResetWorkspaceModal = lazyNamed(
    () => import('./ResetWorkspaceModal.js'),
    'ResetWorkspaceModal',
);

const MONO = '"JetBrains Mono", monospace';

export function ProfileTab() {
    const navigate = useNavigate();
    const toast = useToast();
    const { data: settings } = useSettings();
    const { data: credentials = [] } = useCredentials();
    const { data: projects = [] } = useProjects();
    const updateProfile = useUpdateProfile();

    const [ownerName, setOwnerName] = useState(settings?.owner_name ?? '');
    const [workspacePath, setWorkspacePath] = useState(settings?.workspace_path ?? '');
    const [resetOpen, setResetOpen] = useState(false);

    // Accent color is click-driven (no typing buffer needed), so it reads
    // straight off the query cache. Combined with the optimistic update in
    // useUpdateProfile this makes the ring update instantly on mobile.
    const accentColor = settings?.accent_color ?? '#2E2E2E';

    useEffect(() => {
        if (!settings) return;
        setOwnerName(settings.owner_name);
        setWorkspacePath(settings.workspace_path);
    }, [settings]);

    const credentialsSummary = useMemo(() => {
        if (credentials.length === 0) return null;
        const labels = credentials
            .slice(0, 3)
            .map((c) => `${c.host === 'github' ? 'GitHub' : c.host} (${c.label})`);
        if (credentials.length > 3) labels.push(`+${credentials.length - 3} more`);
        return `${credentials.length} ${credentials.length === 1 ? 'token' : 'tokens'} stored · ${labels.join(' · ')}`;
    }, [credentials]);

    function commitName() {
        if (ownerName.trim() && ownerName.trim() !== settings?.owner_name) {
            updateProfile.mutate(
                { owner_name: ownerName.trim() },
                { onSuccess: () => toast.show({ message: 'Display name updated' }) }
            );
        }
    }

    function commitAccent(next: string) {
        updateProfile.mutate(
            { accent_color: next },
            { onSuccess: () => toast.show({ message: 'Accent color updated' }) }
        );
    }

    function commitWorkspace(next: string) {
        if (next.trim() && next.trim() !== settings?.workspace_path) {
            updateProfile.mutate(
                { workspace_path: next.trim() },
                { onSuccess: () => toast.show({ message: 'Workspace folder updated' }) }
            );
        }
    }

    const projectsCount = projects.length;

    return (
        <Box>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                    gap: 6,
                    alignItems: 'flex-start',
                }}
            >
                <Box>
            <SettingsSection title="Owner Profile" subtitle="Atlas is single-user. This is you.">
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Row label="Display Name">
                        <Box sx={{ width: '100%' }}>
                            <TextField
                                fullWidth
                                size="small"
                                value={ownerName}
                                onChange={(e) => setOwnerName(e.target.value)}
                                onBlur={commitName}
                                onKeyDown={(e) =>
                                    e.key === 'Enter' && (e.target as HTMLInputElement).blur()
                                }
                            />
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                                Shown on your assignee chip across the app.
                            </Typography>
                        </Box>
                    </Row>

<Row label="Accent Color">
                        <AccentColorPicker value={accentColor} onChange={commitAccent} />
                    </Row>

                    <Row label="Appearance">
                        <ThemeModeToggle />
                        <Typography
                            sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 1.5 }}
                        >
                            Light or dark. Saved in this browser and applied immediately across the app.
                        </Typography>
                    </Row>

<Row label="Workspace Folder">
                        <Box sx={{ width: '100%' }}>
                            <FolderPicker
                                value={workspacePath}
                                onChange={(next) => {
                                    setWorkspacePath(next);
                                    commitWorkspace(next);
                                }}
                                placeholder="C:\Users\…\atlas-workspace"
                                size="small"
                            />
                            {projectsCount > 0 && (
                                <Alert
                                    icon={
                                        <WarningAmberRounded
                                            sx={{ color: ATLAS_PALETTE.warning, fontSize: 18 }}
                                        />
                                    }
                                    sx={{
                                        mt: 2,
                                        fontSize: 12,
                                        bgcolor: 'rgba(199,83,47,.06)',
                                        border: `1px solid rgba(199,83,47,.18)`,
                                        color: ATLAS_PALETTE.slate,
                                        '& .MuiAlert-message': { fontSize: 12 },
                                    }}
                                >
                                    <strong>Existing projects won&apos;t auto-migrate.</strong> Move
                                    or symlink the {projectsCount} project
                                    {projectsCount === 1 ? '' : 's'} in this folder before changing
                                    the path.
                                </Alert>
                            )}
                        </Box>
                    </Row>
                </Box>
            </SettingsSection>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <SettingsSection
                title="Git Credentials"
                subtitle="Save PATs so Atlas can clone repos without shell. Encrypted at rest with AES-256-GCM."
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        p: 3,
                        mb: 5,
                        border: `1px solid ${ATLAS_PALETTE.slate08}`,
                        borderRadius: '8px',
                        bgcolor: ATLAS_PALETTE.cloud,
                    }}
                >
                    <VpnKeyOutlined
                        sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue, flexShrink: 0 }}
                    />
                    <Typography
                        sx={{ fontFamily: MONO, fontSize: 12, color: ATLAS_PALETTE.slate70 }}
                    >
                        {credentialsSummary ?? 'No credentials yet. Add one in Manage credentials.'}
                    </Typography>
                </Box>
                <Button
                    variant="outlined"
                    onClick={() => navigate('/settings/credentials')}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 500,
                        alignSelf: 'flex-start',
                    }}
                >
                    Manage credentials →
                </Button>
            </SettingsSection>

            <SettingsSection
                title="Reset"
                subtitle="Wipes all projects, epics, stories, bugs, agents, runs and notifications from the local database and returns to onboarding. Git repositories on disk are not touched."
            >
                <Button
                    variant="outlined"
                    startIcon={<RestartAltRounded sx={{ fontSize: 16 }} />}
                    onClick={() => setResetOpen(true)}
                    sx={{
                        textTransform: 'none',
                        borderColor: ATLAS_PALETTE.error,
                        color: ATLAS_PALETTE.error,
                        '&:hover': {
                            borderColor: ATLAS_PALETTE.error,
                            background: 'rgba(199,83,47,.06)',
                        },
                    }}
                >
                    Reset Workspace
                </Button>
            </SettingsSection>
                </Box>
            </Box>

            {resetOpen && (
                <Suspense fallback={null}>
                    <ResetWorkspaceModal open onClose={() => setResetOpen(false)} />
                </Suspense>
            )}
        </Box>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 5 }}>
            <Typography
                sx={{ fontSize: 14, color: ATLAS_PALETTE.slate, fontWeight: 600 }}
            >
                {label}
            </Typography>
            <Box sx={{ minWidth: 0 }}>{children}</Box>
        </Box>
    );
}

