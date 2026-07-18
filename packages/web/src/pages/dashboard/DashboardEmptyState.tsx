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

const NewProjectModal = lazyNamed(
    () => import('../projects/NewProjectModal.js'),
    'NewProjectModal',
);

interface IDashboardEmptyStateProps {
    ownerFirstName: string;
}

export function DashboardEmptyState({
    ownerFirstName: _ownerFirstName,
}: IDashboardEmptyStateProps) {
    const navigate = useNavigate();
    const [newProjectOpen, setNewProjectOpen] = useState(false);

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
                        Point Atlas at a git URL and we&apos;ll clone it into your workspace folder
                        in the background — no shell, no commands, no leaked tokens. Your stored
                        credential will be decrypted in-memory just for the clone.
                    </>
                }
                primaryAction={
                    <HeroActionCard
                        icon={
                            <AddRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />
                        }
                        title="Add your first project"
                        description={
                            <>
                                Paste a GitHub, GitLab, or Bitbucket URL. Pick a saved credential.
                                We&apos;ll do the rest.
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
                    <Alert
                        icon={<InfoOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                        sx={{
                            bgcolor: ATLAS_PALETTE.cloud,
                            color: ATLAS_PALETTE.slate,
                            textAlign: 'left',
                            '& .MuiAlert-message': { fontSize: 13, lineHeight: 1.6 },
                        }}
                    >
                        <Box component="span" sx={{ fontWeight: 600 }}>
                            No credentials yet?
                        </Box>{' '}
                        Add a Personal Access Token or SSH key in{' '}
                        <Box
                            component="a"
                            onClick={() => navigate('/settings/credentials')}
                            sx={{
                                color: ATLAS_PALETTE.brandBlue,
                                cursor: 'pointer',
                                fontWeight: 500,
                            }}
                        >
                            Settings → Credentials
                        </Box>{' '}
                        first. Atlas encrypts them with AES-256-GCM and never writes them to disk
                        in plaintext.
                    </Alert>
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
