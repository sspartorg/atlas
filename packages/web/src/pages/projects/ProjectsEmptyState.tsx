import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import { Link as RouterLink } from 'react-router-dom';
import FolderOpenRounded from '@mui/icons-material/FolderOpenRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { HeroEmptyState } from '../../components/HeroEmptyState.js';
import { HeroActionCard } from '../../components/HeroActionCard.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { useCredentials } from '../../hooks/useCredentials.js';

interface IProjectsEmptyStateProps {
    onNewProject: () => void;
}

export function ProjectsEmptyState({ onNewProject }: IProjectsEmptyStateProps) {
    // F-007 — this hint rendered unconditionally, telling an Owner who already
    // has a credential to go and add one, and naming a PAT even when the saved
    // credential is a GitHub App.
    const { data: credentials } = useCredentials();
    // Only hide the hint once we positively know a credential exists.
    // While the query is still loading, `credentials` is undefined and the
    // hint shows — the pre-F-007 behaviour — so it never flashes in late.
    const noCredentials = (credentials?.length ?? 0) === 0;
    return (
        <HeroEmptyState
            icon={
                <FolderOpenRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 28 }} />
            }
            title="No projects yet."
            description={
                <>
                    A project holds your Tasks and the repos they work on. Create one, then add its
                    repos — Atlas clones each into your workspace folder in the background.
                </>
            }
            primaryAction={
                <HeroActionCard
                    icon={<AddRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />}
                    title="Add your first project"
                    description={
                        <>
                            Give it a name and a 3-letter issue key. You&apos;ll add its repos
                            next.
                        </>
                    }
                    cta={{
                        label: 'New Project',
                        icon: <AddRounded />,
                        onClick: onNewProject,
                    }}
                />
            }
            supplemental={
                noCredentials ? (
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
                            Cloning a private repo?
                        </Box>{' '}
                        Add a credential in{' '}
                        <Box
                            component={RouterLink}
                            to="/settings/credentials"
                            sx={{
                                color: ATLAS_PALETTE.brandBlue,
                                fontWeight: 500,
                            }}
                        >
                            Settings → Credentials
                        </Box>{' '}
                        before you add the repo. Atlas encrypts it with AES-256-GCM and never writes
                        it to disk in plaintext.
                    </Alert>
                ) : undefined
            }
        />
    );
}
