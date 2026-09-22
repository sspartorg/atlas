import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/api.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    open: boolean;
    onClose: () => void;
}

/**
 * ADR 0018 made a project a container of equal repos and dropped every git
 * column from `projects`, but creation still bundled "make a project" with
 * "clone its first repo" — one 1479-line modal owning a repo URL, a
 * credential, a folder picker, a branch and a live clone terminal, through
 * `POST /api/projects/clone` and `/connect`.
 *
 * A project is now just a wrapper: name, key, description. Repos are added
 * afterwards from Project Detail's Repos tab, which already owns every repo
 * action (Add, Edit, Re-clone, Auto-fetch, Remove) and whose `AddRepoDialog`
 * is the same clone/connect form this modal used to inline.
 */
export function NewProjectModal({ open, onClose }: Props) {
    const navigate = useNavigate();
    const qc = useQueryClient();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [issueKeyPrefix, setIssueKeyPrefix] = useState('');
    const [prefixTouched, setPrefixTouched] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [prefixStatus, setPrefixStatus] = useState<
        | { kind: 'idle' }
        | { kind: 'invalid' }
        | { kind: 'checking' }
        | { kind: 'ok' }
        | { kind: 'collision'; conflict: string | null }
    >({ kind: 'idle' });

    useEffect(() => {
        if (!open) {
            setName('');
            setDescription('');
            setIssueKeyPrefix('');
            setPrefixTouched(false);
            setSubmitting(false);
            setSubmitError(null);
            setPrefixStatus({ kind: 'idle' });
        }
    }, [open]);

    // The key follows the name until the Owner types their own, so the common
    // case is one field. It can't be changed after creation — item ids are
    // `{PREFIX}-N` — so it stays visible rather than being derived silently.
    useEffect(() => {
        if (prefixTouched) return;
        setIssueKeyPrefix(
            name
                .toUpperCase()
                .replace(/[^A-Z]/g, '')
                .slice(0, 3)
        );
    }, [name, prefixTouched]);

    // Debounced availability probe. Anything that isn't the canonical
    // 3-uppercase-letter shape is rejected locally without hitting the server.
    useEffect(() => {
        if (!open) return;
        if (issueKeyPrefix.length === 0) {
            setPrefixStatus({ kind: 'idle' });
            return;
        }
        if (!/^[A-Z]{3}$/.test(issueKeyPrefix)) {
            setPrefixStatus({ kind: 'invalid' });
            return;
        }
        setPrefixStatus({ kind: 'checking' });
        const handle = window.setTimeout(() => {
            void api.projects
                .prefixAvailable(issueKeyPrefix)
                .then((r) => {
                    if (r.available) setPrefixStatus({ kind: 'ok' });
                    else if (r.reason === 'in_use')
                        setPrefixStatus({ kind: 'collision', conflict: r.conflict ?? null });
                    else setPrefixStatus({ kind: 'invalid' });
                })
                .catch(() => {
                    // Network error — stays "checking"; the Owner can retry.
                });
        }, 350);
        return () => window.clearTimeout(handle);
    }, [issueKeyPrefix, open]);

    const canSubmit = name.trim().length > 0 && prefixStatus.kind === 'ok' && !submitting;

    async function handleCreate() {
        setSubmitting(true);
        setSubmitError(null);
        try {
            const project = await api.projects.create({
                name: name.trim(),
                issue_key_prefix: issueKeyPrefix,
                ...(description.trim() ? { description: description.trim() } : {}),
            });
            await qc.invalidateQueries({ queryKey: ['projects'] });
            onClose();
            // Straight to Repos: a project with no repo can't run a workflow,
            // so the next step is adding one.
            navigate(`/projects/${project.id}?tab=repos`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Could not create the project';
            if (/prefix/i.test(msg)) {
                // Another tab claimed the prefix between our probe and this POST.
                setPrefixStatus({ kind: 'collision', conflict: null });
            }
            setSubmitError(msg);
            setSubmitting(false);
        }
    }

    function prefixHelperText(): { text: string; error: boolean } {
        if (issueKeyPrefix.length > 0 && issueKeyPrefix.length < 3)
            return { text: 'Exactly 3 uppercase letters.', error: false };
        if (prefixStatus.kind === 'invalid')
            return {
                text: 'Exactly 3 uppercase letters (A–Z), no digits or symbols.',
                error: true,
            };
        if (prefixStatus.kind === 'checking')
            return { text: 'Checking availability…', error: false };
        if (prefixStatus.kind === 'collision')
            return {
                text: `Already used by "${prefixStatus.conflict ?? 'another project'}"`,
                error: true,
            };
        if (prefixStatus.kind === 'ok')
            return {
                text: `Available. New items will be ${issueKeyPrefix}-1, ${issueKeyPrefix}-2, …`,
                error: false,
            };
        return {
            text: 'Item ids in this project become {PREFIX}-1, {PREFIX}-2, … and the prefix can’t be changed later.',
            error: false,
        };
    }

    const helper = prefixHelperText();

    return (
        <Dialog
            open={open}
            onClose={submitting ? undefined : onClose}
            maxWidth="sm"
            fullWidth
            slotProps={{ paper: { sx: { borderRadius: '12px' } } }}
        >
            <Box sx={{ p: 6 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 4 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            component="h2"
                            sx={{ fontSize: 18, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                        >
                            New project
                        </Typography>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                            A project holds your Tasks and its repos. You&apos;ll add repos next.
                        </Typography>
                    </Box>
                    <IconButton
                        aria-label="Close"
                        onClick={onClose}
                        disabled={submitting}
                        sx={{ color: ATLAS_PALETTE.slate60 }}
                    >
                        <CloseRounded />
                    </IconButton>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <TextField
                        fullWidth
                        size="small"
                        required
                        autoFocus
                        label="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Atlas Web"
                    />
                    <TextField
                        fullWidth
                        size="small"
                        required
                        label="Issue key prefix"
                        value={issueKeyPrefix}
                        onChange={(e) => {
                            setPrefixTouched(true);
                            setIssueKeyPrefix(
                                e.target.value
                                    .toUpperCase()
                                    .replace(/[^A-Z]/g, '')
                                    .slice(0, 3)
                            );
                        }}
                        placeholder="ATL"
                        slotProps={{
                            htmlInput: {
                                maxLength: 3,
                                style: { fontFamily: MONO, letterSpacing: '0.08em' },
                            },
                        }}
                        error={helper.error}
                        helperText={helper.text}
                        FormHelperTextProps={
                            prefixStatus.kind === 'ok'
                                ? { sx: { color: ATLAS_PALETTE.green } }
                                : undefined
                        }
                    />
                    <TextField
                        fullWidth
                        size="small"
                        label="Description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        multiline
                        minRows={2}
                    />
                    {submitError && <Alert severity="error">{submitError}</Alert>}
                </Box>

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 5 }}>
                    <Button variant="outlined" onClick={onClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void handleCreate()}
                        disabled={!canSubmit}
                        sx={{
                            bgcolor: ATLAS_PALETTE.green,
                            boxShadow: 'none',
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                        }}
                    >
                        {submitting ? 'Creating…' : 'Create project'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}
