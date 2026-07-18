import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import CloseRounded from '@mui/icons-material/CloseRounded';
import type { IssueType } from '@atlas/shared';
import { useCreateIssueExternalLink } from '../hooks/useIssueExternalLinks.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    open: boolean;
    onClose: () => void;
    issueType: IssueType;
    issueId: string;
}

// Same canonical regex the server enforces; doing the check on the client
// just lets us show the error inline before the round-trip.
const GITHUB_PR_RE = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+(?:[/?#].*)?$/;

export function AddPrLinkDialog({ open, onClose, issueType, issueId }: Props) {
    const [url, setUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const createLink = useCreateIssueExternalLink(issueType, issueId);
    const toast = useToast();

    function handleClose() {
        if (createLink.isPending) return;
        setUrl('');
        setError(null);
        onClose();
    }

    async function handleSubmit() {
        const trimmed = url.trim();
        if (!GITHUB_PR_RE.test(trimmed)) {
            setError('Enter a GitHub PR URL — https://github.com/<owner>/<repo>/pull/<number>');
            return;
        }
        setError(null);
        try {
            await createLink.mutateAsync({ url: trimmed });
            toast.show({ message: 'PR link added', detail: trimmed });
            setUrl('');
            onClose();
        } catch (err) {
            setError((err as Error).message);
        }
    }

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            PaperProps={{ sx: { width: 520, maxWidth: '90vw', borderRadius: 2 } }}
        >
            <Box sx={{ p: 3 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 2,
                    }}
                >
                    <Box>
                        <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Add PR link</Typography>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            Attach a GitHub Pull Request URL to this item.
                        </Typography>
                    </Box>
                    <IconButton
                        size="small"
                        onClick={handleClose}
                        aria-label="Close add PR link dialog"
                    >
                        <CloseRounded sx={{ fontSize: 18 }} />
                    </IconButton>
                </Box>
                <TextField
                    fullWidth
                    autoFocus
                    size="small"
                    placeholder="https://github.com/owner/repo/pull/123"
                    value={url}
                    onChange={(e) => {
                        setUrl(e.target.value);
                        if (error) setError(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSubmit();
                    }}
                    inputProps={{ 'aria-label': 'GitHub PR URL' }}
                    error={Boolean(error)}
                    helperText={error ?? ' '}
                    disabled={createLink.isPending}
                />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
                    <Button
                        onClick={handleClose}
                        disabled={createLink.isPending}
                        sx={{ textTransform: 'none' }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void handleSubmit()}
                        disabled={createLink.isPending || url.trim().length === 0}
                        sx={{ textTransform: 'none' }}
                    >
                        {createLink.isPending ? 'Adding…' : 'Add link'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}
