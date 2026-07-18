import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import VpnKeyOutlined from '@mui/icons-material/VpnKeyOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { HeroEmptyState } from '../../components/HeroEmptyState.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    onAdd: () => void;
}

const BULLETS = [
    'AES-256-GCM at rest with a per-install workspace key',
    'Decrypted only in memory during a clone — never written to disk',
    'Scoped per project so a leaked token can’t reach unrelated repos',
    'Delete a credential to revoke instantly',
];

export function CredentialsEmptyState({ onAdd }: Props) {
    return (
        <HeroEmptyState
            icon={<VpnKeyOutlined sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 28 }} />}
            title="No credentials yet."
            description={
                <>
                    Add a git credential and Atlas can clone your repos for you — no shell commands,
                    no tokens floating around in env files.
                </>
            }
            primaryAction={
                <Box
                    sx={{
                        p: 5,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        textAlign: 'left',
                        bgcolor: ATLAS_PALETTE.white,
                    }}
                >
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            mb: { xs: 3, sm: 0 },
                        }}
                    >
                        <Box
                            sx={{
                                width: 36,
                                height: 36,
                                borderRadius: '10px',
                                bgcolor: ATLAS_PALETTE.cloud,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <AddRounded sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                    mb: 0.5,
                                }}
                            >
                                Add your first credential
                            </Typography>
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                                Personal Access Token — encrypted at rest with AES-256-GCM,
                                scoped per project.
                            </Typography>
                        </Box>
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<AddRounded />}
                            onClick={onAdd}
                            sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                                display: { xs: 'none', sm: 'inline-flex' },
                            }}
                        >
                            Add credential
                        </Button>
                    </Box>
                    {/* Mobile: button drops below, full width. Desktop hides this copy. */}
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<AddRounded />}
                        onClick={onAdd}
                        fullWidth
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            display: { xs: 'inline-flex', sm: 'none' },
                        }}
                    >
                        Add credential
                    </Button>
                </Box>
            }
            supplemental={
                <Box
                    sx={{
                        p: 5,
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        borderRadius: '12px',
                        textAlign: 'left',
                        bgcolor: ATLAS_PALETTE.white,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                        <LockOutlined sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 18 }} />
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                            How we store credentials
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {BULLETS.map((b) => (
                            <Box key={b} sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                                <CheckCircleOutline
                                    sx={{ color: ATLAS_PALETTE.green, fontSize: 16, mt: '2px' }}
                                />
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        color: ATLAS_PALETTE.slate70,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {b}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                </Box>
            }
        />
    );
}
