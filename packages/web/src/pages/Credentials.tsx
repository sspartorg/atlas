import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import AddRounded from '@mui/icons-material/AddRounded';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCredentials } from '../hooks/useCredentials.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { CredentialsEmptyState } from './credentials/CredentialsEmptyState.js';
import { CredentialsTable } from './credentials/CredentialsTable.js';
import { type CredentialModalMode } from './credentials/CredentialModal.js';
const CredentialModal = lazyNamed(
    () => import('./credentials/CredentialModal.js'),
    'CredentialModal',
);
import { useSetPageTitle } from '../components/shell/index.js';

const MONO = '"JetBrains Mono", monospace';

export function Credentials() {
    useSetPageTitle('Git credentials');
    const navigate = useNavigate();
    const qc = useQueryClient();
    const toast = useToast();
    const { data: rows = [], isPending } = useCredentials();
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<CredentialModalMode>({ kind: 'add' });
    const [deleteId, setDeleteId] = useState<string | null>(null);

    const expiringSoon = useMemo(() => {
        const now = Date.now();
        return rows.filter((c) => {
            if (!c.expires_at) return false;
            const ms = new Date(c.expires_at).getTime();
            if (Number.isNaN(ms)) return false;
            const days = Math.round((ms - now) / (1000 * 60 * 60 * 24));
            return days >= 0 && days <= 30;
        }).length;
    }, [rows]);

    const hostsCount = useMemo(() => new Set(rows.map((c) => c.host)).size, [rows]);

    const deleteMut = useMutation({
        mutationFn: (id: string) => api.credentials.delete(id),
        onSuccess: (_data, id) => {
            const cred = rows.find((c) => c.id === id);
            void qc.invalidateQueries({ queryKey: ['credentials'] });
            setDeleteId(null);
            toast.show({
                message: cred ? `Credential "${cred.label}" deleted` : 'Credential deleted',
            });
        },
        onError: (err) => {
            toast.show({
                message: 'Could not delete credential',
                detail: err instanceof Error ? err.message : String(err),
            });
        },
    });

    if (isPending) {
        return (
            <Box
                sx={{
                    minHeight: '60vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    function openAdd() {
        setModalMode({ kind: 'add' });
        setModalOpen(true);
    }

    function openEdit(id: string) {
        const cred = rows.find((c) => c.id === id);
        if (!cred) return;
        setModalMode({ kind: 'edit', credential: cred });
        setModalOpen(true);
    }


    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            {/* Breadcrumb */}
            <Box sx={{ mb: 3 }}>
                <Box
                    component="a"
                    onClick={(e) => {
                        e.preventDefault();
                        navigate('/settings');
                    }}
                    sx={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        cursor: 'pointer',
                        textDecoration: 'none',
                        '&:hover': { color: ATLAS_PALETTE.brandBlue },
                    }}
                >
                    Settings
                </Box>
                <Box
                    component="span"
                    sx={{
                        mx: 1.5,
                        fontSize: '0.6875rem',
                        color: ATLAS_PALETTE.slate30,
                    }}
                >
                    ·
                </Box>
                <Box
                    component="span"
                    sx={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    Credentials
                </Box>
            </Box>

            {/* Header — title stacks above the action row on mobile; on
                desktop they sit side-by-side. The two buttons split the
                available row width 50/50 on mobile so they don't shrink to
                "Check exp…" / "Add cred…" ellipsis. */}
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', md: 'row' },
                    alignItems: { xs: 'stretch', md: 'flex-end' },
                    justifyContent: 'space-between',
                    mb: 6,
                    gap: 4,
                }}
            >
                <Box>
                    <Typography
                        variant="h1"
                        sx={{
                            fontSize: '2.25rem',
                            fontWeight: 700,
                            color: ATLAS_PALETTE.slate,
                            letterSpacing: '-0.01em',
                        }}
                    >
                        Git credentials
                    </Typography>
                    {rows.length > 0 && (
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: '0.8125rem',
                                color: ATLAS_PALETTE.slate60,
                                mt: 1.5,
                            }}
                        >
                            {rows.length} {rows.length === 1 ? 'credential' : 'credentials'} ·{' '}
                            {hostsCount} {hostsCount === 1 ? 'host' : 'hosts'}
                            {expiringSoon > 0 && ` · ${expiringSoon} expiring soon`}
                        </Typography>
                    )}
                </Box>
                <Button
                    variant="contained"
                    color="success"
                    startIcon={<AddRounded />}
                    onClick={openAdd}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        alignSelf: { xs: 'flex-start', md: 'flex-end' },
                    }}
                >
                    Add credential
                </Button>
            </Box>

            {rows.length === 0 ? (
                <CredentialsEmptyState onAdd={openAdd} />
            ) : (
                <>
                    <Alert
                        icon={<LockOutlined sx={{ color: ATLAS_PALETTE.brandBlue }} />}
                        sx={{
                            mb: 4,
                            bgcolor: ATLAS_PALETTE.cloud,
                            color: ATLAS_PALETTE.slate,
                            border: `1px solid rgba(0,122,201,.12)`,
                            alignItems: 'center',
                            '& .MuiAlert-icon': { alignSelf: 'center', py: 0 },
                            '& .MuiAlert-message': { fontSize: 13 },
                        }}
                    >
                        Credentials are encrypted with AES-256-GCM at rest and decrypted in-memory
                        only for the duration of a clone.
                    </Alert>
                    <CredentialsTable
                        rows={rows}
                        onEdit={openEdit}
                        onDelete={(id) => setDeleteId(id)}
                    />
                </>
            )}

            {modalOpen && (
                <Suspense fallback={null}>
                    <CredentialModal
                        open={modalOpen}
                        mode={modalMode}
                        onClose={() => setModalOpen(false)}
                    />
                </Suspense>
            )}

            <Dialog
                open={Boolean(deleteId)}
                onClose={() => setDeleteId(null)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>Delete credential?</DialogTitle>
                <DialogContent>
                    <Typography
                        sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70, lineHeight: 1.6 }}
                    >
                        This will not affect projects already cloned — but new clones using this
                        credential will fail until you replace it.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ p: 4 }}>
                    <Button
                        onClick={() => setDeleteId(null)}
                        sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => deleteId && deleteMut.mutate(deleteId)}
                        disabled={deleteMut.isPending}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Delete
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
