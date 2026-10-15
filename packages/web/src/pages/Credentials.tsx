import { Suspense, useMemo, useState } from 'react';
import { lazyNamed } from '../utils/lazyNamed.js';
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
import { useTeamConfig } from '../hooks/useTeamConfig.js';
import { useToast } from '../hooks/useToast.js';
import { api } from '../api/api.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { CredentialsEmptyState } from './credentials/CredentialsEmptyState.js';
import { CredentialsTable, daysUntilExpiry } from './credentials/CredentialsTable.js';
import { type CredentialModalMode } from './credentials/CredentialModal.js';
const CredentialModal = lazyNamed(
    () => import('./credentials/CredentialModal.js'),
    'CredentialModal'
);
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { PageHeader } from '../components/PageHeader.js';

export function Credentials() {
    useSetPageTitle('Git credentials');
    const qc = useQueryClient();
    const toast = useToast();
    const { data: rows = [], isPending } = useCredentials();
    const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<CredentialModalMode>({ kind: 'add' });
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const { data: teamConfig } = useTeamConfig();
    // Deleting the team-config credential unsets it server-side (and stops sync).
    const deletingTeamCredential =
        deleteId !== null && teamConfig?.credential_id === deleteId && teamConfig.role !== 'off';

    const expiringSoon = useMemo(
        () => rows.filter((c) => daysUntilExpiry(c) !== null).length,
        [rows]
    );

    const hostsCount = useMemo(() => new Set(rows.map((c) => c.host)).size, [rows]);

    const deleteMut = useMutation({
        mutationFn: (id: string) => api.credentials.delete(id),
        onSuccess: (_data, id) => {
            const cred = rows.find((c) => c.id === id);
            void qc.invalidateQueries({ queryKey: ['credentials'] });
            void qc.invalidateQueries({ queryKey: ['team-config'] });
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
            <PageHeader
                icon="key"
                title="Git credentials"
                hideActionsOnMobile
                breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Credentials' }]}
                subtitle={
                    rows.length > 0 ? (
                        <>
                            {rows.length} {rows.length === 1 ? 'credential' : 'credentials'} ·{' '}
                            {hostsCount} {hostsCount === 1 ? 'host' : 'hosts'}
                            {expiringSoon > 0 && ` · ${expiringSoon} expiring soon`}
                        </>
                    ) : undefined
                }
                actions={
                    <Button
                        variant="contained"
                        color="success"
                        startIcon={<AddRounded />}
                        onClick={openAdd}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Add credential
                    </Button>
                }
            />

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
                    {deletingTeamCredential && (
                        <Alert severity="warning" sx={{ mt: 2, fontSize: 13 }}>
                            Team config syncs with this credential. Deleting it unsets the team
                            config credential and stops syncing until you pick another one in
                            Settings → Team config.
                        </Alert>
                    )}
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

            {/* Mobile: the add action is a FAB, like every other add page. */}
            <PageFab onClick={openAdd} label="Add credential" />
        </Box>
    );
}
