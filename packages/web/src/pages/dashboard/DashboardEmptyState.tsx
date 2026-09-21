import { Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import ImageNotSupportedRounded from '@mui/icons-material/ImageNotSupportedRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { HeroEmptyState } from '../../components/HeroEmptyState.js';
import { HeroActionCard } from '../../components/HeroActionCard.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { lazyNamed } from '../../utils/lazyNamed.js';
import { useAgents } from '../../hooks/useAgents.js';
import { useCredentials } from '../../hooks/useCredentials.js';

const NewProjectModal = lazyNamed(
    () => import('../projects/NewProjectModal.js'),
    'NewProjectModal'
);

interface IDashboardEmptyStateProps {
    ownerFirstName: string;
}

export function DashboardEmptyState({
    ownerFirstName: _ownerFirstName,
}: IDashboardEmptyStateProps) {
    const navigate = useNavigate();
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const { data: agents } = useAgents();
    // F-007 — this hint used to render unconditionally, telling an Owner who
    // already has credentials to go and add one. The agents hint below was
    // already conditioned; credentials simply were not.
    const { data: credentials } = useCredentials();
    // Only hide the hint once we positively know a credential exists.
    // While the query is still loading, `credentials` is undefined and the
    // hint shows — the pre-F-007 behaviour — so it never flashes in late.
    const noCredentials = (credentials?.length ?? 0) === 0;
    const noAgents = agents?.length === 0;
    const alertSx = {
        bgcolor: ATLAS_PALETTE.cloud,
        color: ATLAS_PALETTE.slate,
        textAlign: 'left',
        '& .MuiAlert-message': { fontSize: 13, lineHeight: 1.6 },
    } as const;
    const linkSx = { color: ATLAS_PALETTE.brandBlue, cursor: 'pointer', fontWeight: 500 } as const;

    return (
        <>
            <HeroEmptyState
                icon={
                    <ImageNotSupportedRounded
                        sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 28 }}
                    />
                }
                title="No projects yet."
                description={
                    <>
                        Point Atlas at a GitHub URL and we&apos;ll clone it into your workspace
                        folder in the background — no shell, no commands, no leaked tokens. Your
                        stored credential will be decrypted in-memory just for the clone.
                    </>
                }
                primaryAction={
                    <HeroActionCard
                        icon={<AddRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />}
                        title="Add your first project"
                        description={
                            <>
                                Paste a GitHub repository URL. Pick a saved credential. We&apos;ll
                                do the rest.
                            </>
                        }
                        cta={{
                            label: 'New Project',
                            icon: <AddRounded />,
                            onClick: () => setNewProjectOpen(true),
                        }}
                    />
                }
                supplemental={
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {noCredentials && (
                            <Alert
                                icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                                sx={alertSx}
                            >
                                <Box component="span" sx={{ fontWeight: 600 }}>
                                    No credentials yet?
                                </Box>{' '}
                                Add a Personal Access Token or GitHub App in{' '}
                                <Box
                                    component="a"
                                    onClick={() => navigate('/settings/credentials')}
                                    sx={linkSx}
                                >
                                    Settings → Credentials
                                </Box>{' '}
                                first. Atlas encrypts them with AES-256-GCM and never writes them to
                                disk in plaintext.
                            </Alert>
                        )}
                        {noAgents && (
                            <Alert
                                icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                                sx={alertSx}
                            >
                                <Box component="span" sx={{ fontWeight: 600 }}>
                                    No agents yet?
                                </Box>{' '}
                                Install them from{' '}
                                <Box
                                    component="a"
                                    onClick={() => navigate('/agents/marketplace')}
                                    sx={linkSx}
                                >
                                    Agents → Marketplace
                                </Box>
                                .
                            </Alert>
                        )}
                    </Box>
                }
            />
            {newProjectOpen && (
                <Suspense fallback={null}>
                    <NewProjectModal
                        open={newProjectOpen}
                        onClose={() => setNewProjectOpen(false)}
                    />
                </Suspense>
            )}
        </>
    );
}
