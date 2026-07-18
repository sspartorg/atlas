import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';

interface PreviewData {
    prompt: string;
    filename: string;
    length: number;
    agent: { id: string; name: string; cli: string; model: string };
    issue: { type: string; id: string; title: string } | null;
    guardrails_count: number;
    sections: string[];
}

interface Props {
    open: boolean;
    data: PreviewData | null;
    onClose: () => void;
}

export function PromptPreviewDialog({ open, data, onClose }: Props) {
    const toast = useToast();

    function handleDownload() {
        if (!data) return;
        const blob = new Blob([data.prompt], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.show({ message: 'Prompt downloaded', detail: data.filename });
    }

    function handleCopy() {
        if (!data) return;
        void navigator.clipboard.writeText(data.prompt);
        toast.show({ message: 'Prompt copied' });
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="md"
            PaperProps={{ sx: { borderRadius: '12px' } }}
        >
            <DialogTitle
                sx={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: ATLAS_PALETTE.slate,
                    pb: 1,
                }}
            >
                Prompt preview
            </DialogTitle>
            <DialogContent sx={{ pt: 1 }}>
                {data === null ? (
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                        Compiling…
                    </Typography>
                ) : (
                    <>
                        <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                            This is the exact markdown that would be piped to the {data.agent.cli}{' '}
                            CLI on <strong>Run now</strong>. Nothing was queued or written. The CLI
                            would be invoked with{' '}
                            <Box
                                component="span"
                                sx={{
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    fontSize: 11.5,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                --model {data.agent.model}
                            </Box>{' '}
                            and this content on stdin.
                        </Typography>

                        <Box
                            sx={{
                                display: 'flex',
                                gap: 2,
                                flexWrap: 'wrap',
                                p: 1.5,
                                mb: 2,
                                borderRadius: '8px',
                                background: ATLAS_PALETTE.slate08,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 11.5,
                                color: ATLAS_PALETTE.slate70,
                            }}
                        >
                            <span>
                                agent · <strong>{data.agent.name}</strong>
                            </span>
                            <span>·</span>
                            <span>
                                {data.issue
                                    ? `issue · ${data.issue.type} ${data.issue.id}`
                                    : 'freedom run · no item'}
                            </span>
                            <span>·</span>
                            <span>{data.length.toLocaleString()} chars</span>
                            <span>·</span>
                            <span>{data.guardrails_count} guard-rail rules</span>
                            <span>·</span>
                            <span>{data.sections.length} sections</span>
                        </Box>

                        {data.sections.length > 0 ? (
                            <Box sx={{ mb: 1.5 }}>
                                <Typography
                                    sx={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        letterSpacing: '0.08em',
                                        textTransform: 'uppercase',
                                        color: ATLAS_PALETTE.slate60,
                                        mb: 0.75,
                                    }}
                                >
                                    Sections
                                </Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                    {data.sections.map((s, i) => (
                                        <Box
                                            key={i}
                                            sx={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 0.5,
                                                px: 1.25,
                                                py: 0.25,
                                                borderRadius: '9999px',
                                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                                bgcolor: '#fff',
                                                fontSize: 11.5,
                                                color: ATLAS_PALETTE.slate70,
                                            }}
                                        >
                                            {i + 1}. {s}
                                        </Box>
                                    ))}
                                </Box>
                            </Box>
                        ) : null}

                        <Box
                            component="pre"
                            sx={{
                                m: 0,
                                p: 2,
                                maxHeight: 480,
                                overflow: 'auto',
                                borderRadius: '8px',
                                background: '#0F1117',
                                color: '#D8DCE3',
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12,
                                lineHeight: 1.6,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}
                        >
                            {data.prompt}
                        </Box>
                    </>
                )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 3 }}>
                <Button
                    onClick={onClose}
                    sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                >
                    Close
                </Button>
                <Button
                    variant="outlined"
                    onClick={handleCopy}
                    disabled={data === null}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            content_copy
                        </Box>
                    }
                    sx={{ textTransform: 'none' }}
                >
                    Copy
                </Button>
                <Button
                    variant="contained"
                    onClick={handleDownload}
                    disabled={data === null}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 18 }}
                        >
                            download
                        </Box>
                    }
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        bgcolor: ATLAS_PALETTE.brandBlue,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue, boxShadow: 'none' },
                    }}
                >
                    Download .md
                </Button>
            </DialogActions>
        </Dialog>
    );
}
