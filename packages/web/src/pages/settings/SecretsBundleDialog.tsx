import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, type SecretsBundle, type SecretsImportReport } from '../../api/api.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MIN_PASSPHRASE = 8;

function summary(r: SecretsImportReport): string {
    const parts = [
        `${r.shared} shared secret${r.shared === 1 ? '' : 's'}`,
        ...r.projects.map((p) => `${p.prefix}: ${p.keys} secret${p.keys === 1 ? '' : 's'}`),
        ...(r.jira ? ['Jira token'] : []),
        ...(r.notification ? ['notification channel'] : []),
    ];
    const skipped = r.skipped_projects.length
        ? `\nSkipped (no such project here): ${r.skipped_projects.join(', ')}`
        : '';
    return `Imported ${parts.join(', ')}.${skipped}`;
}

/** Export or import every secret but git credentials, sealed with a passphrase. */
export function SecretsBundleDialog({ mode, onClose }: { mode: 'export' | 'import'; onClose: () => void }) {
    const qc = useQueryClient();
    const toast = useToast();
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const exporting = mode === 'export';
    const canSubmit = exporting
        ? passphrase.length >= MIN_PASSPHRASE && passphrase === confirm
        : passphrase.length > 0 && file !== null;

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            if (exporting) {
                const bundle = await api.secretsBundle.export(passphrase);
                const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `atlas-secrets-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                toast.show({ message: 'Secrets exported' });
            } else {
                let bundle: SecretsBundle;
                try {
                    bundle = JSON.parse(await file!.text()) as SecretsBundle;
                } catch {
                    throw new Error('That file is not an Atlas secrets file');
                }
                const report = await api.secretsBundle.import(passphrase, bundle);
                await qc.invalidateQueries();
                toast.show({ message: 'Secrets imported', detail: summary(report) });
            }
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong');
            setBusy(false);
        }
    }

    return (
        <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
                {exporting ? 'Export all secrets' : 'Import secrets'}
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    {exporting
                        ? 'Shared secrets, every project’s .env secrets, the Jira token and the notification channel, in one file locked with a passphrase. Git credentials are not included. Keep the file and the passphrase apart.'
                        : 'Values from the file replace the same keys here; keys only this machine has are kept. Projects are matched by their key prefix, and ones this machine does not have are skipped.'}
                </Typography>
                {!exporting && (
                    <Box>
                        <Button variant="outlined" size="small" component="label">
                            {file ? file.name : 'Choose secrets file'}
                            <input
                                hidden
                                type="file"
                                accept="application/json,.json"
                                aria-label="Secrets file"
                                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                            />
                        </Button>
                    </Box>
                )}
                <TextField
                    size="small"
                    type="password"
                    label="Passphrase"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    helperText={exporting ? `At least ${MIN_PASSPHRASE} characters. Atlas can’t recover it.` : undefined}
                    autoFocus
                />
                {exporting && (
                    <TextField
                        size="small"
                        type="password"
                        label="Confirm passphrase"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        error={confirm.length > 0 && confirm !== passphrase}
                        helperText={confirm.length > 0 && confirm !== passphrase ? 'Doesn’t match' : undefined}
                    />
                )}
                {error && (
                    <Typography role="alert" sx={{ fontSize: 12.5, color: ATLAS_PALETTE.dangerFg }}>
                        {error}
                    </Typography>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
                <Button onClick={onClose} disabled={busy}>
                    Cancel
                </Button>
                <Button variant="contained" onClick={() => void submit()} disabled={!canSubmit || busy}>
                    {busy ? (exporting ? 'Exporting…' : 'Importing…') : exporting ? 'Export' : 'Import'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
