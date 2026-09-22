import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import { useNavigate } from 'react-router-dom';
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
    const navigate = useNavigate();
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
                    Point Atlas at a git URL and we&apos;ll clone it into your workspace folder in
                    the background — no shell, no commands, no leaked tokens. Your stored credential
                    is decrypted in-memory just for the clone.
                </>
            }
            primaryAction={
                <HeroActionCard
                    icon={<AddRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />}
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
                            No credentials yet?
                        </Box>{' '}
                        Add a Personal Access Token in{' '}
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
                        first. Atlas encrypts them with AES-256-GCM and never writes them to disk in
                        plaintext.
                    </Alert>
                ) : undefined
            }
        />
    );
}
