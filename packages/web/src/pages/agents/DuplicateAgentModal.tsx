import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { IAgent } from '@atlas/shared';
import { api } from '../../api/api.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { CATEGORY_LABEL, getAgentView } from './agentViewModel.js';
import { FormHeading } from '../../components/FormHeading.js';

const MONO = TYPOGRAPHY.fontFamilyMono;

interface Props {
    open: boolean;
    agent: IAgent | null;
    existingIds: string[];
    onClose: () => void;
}

type View = 'confirm' | 'submitting' | 'success' | 'error';

function hexToRgba(hex: string, alpha: number): string {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
    if (!m || !m[1] || !m[2] || !m[3]) return hex;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function suggestNewName(name: string, taken: Set<string>): string {
    const base = name.replace(/\s+\(copy(?:\s+\d+)?\)$/i, '').trim();
    let i = 1;
    let candidate = `${base} (copy)`;
    while (taken.has(candidate.toLowerCase())) {
        i += 1;
        candidate = `${base} (copy ${i})`;
    }
    return candidate;
}

function suggestNewId(originalId: string, taken: Set<string>): string {
    const base = originalId.replace(/-(copy(?:-\d+)?)$/i, '');
    let i = 1;
    let candidate = `${base}-copy`;
    while (taken.has(candidate)) {
        i += 1;
        candidate = `${base}-copy-${i}`;
    }
    return candidate;
}

export function DuplicateAgentModal({ open, agent, existingIds, onClose }: Props) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const toast = useToast();

    const [view, setView] = useState<View>('confirm');
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [createdId, setCreatedId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setView('confirm');
            setError(null);
            setCreatedId(null);
            return;
        }
        if (agent) {
            const takenNames = new Set(existingIds.map((id) => id.toLowerCase()));
            const seedNames = new Set<string>(); // names handled at API by uniqueness if any
            setName(suggestNewName(agent.name, new Set([...takenNames, ...seedNames])));
        }
    }, [open, agent, existingIds]);

    if (!agent) return null;

    const view_ = getAgentView(agent);
    const trimmedName = name.trim();
    const takenIds = new Set(existingIds);
    const newId = suggestNewId(agent.id, takenIds);
    const canSubmit = trimmedName.length > 0 && view === 'confirm';

    async function handleSubmit() {
        if (!agent) return;
        setError(null);
        setView('submitting');
        try {
            const created = await api.agents.create({
                id: newId,
                name: trimmedName,
                category: agent.category,
                cli: agent.cli,
                model: agent.model,
                framework: agent.framework,
                prompt_md: agent.prompt_md,
                prompt_version: 1,
                status: 'inactive',
                accent_color: agent.accent_color,
                sort_order: existingIds.length + 1,
            });
            setCreatedId(created.id);
            await queryClient.invalidateQueries({ queryKey: ['agents'] });
            setView('success');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not duplicate agent');
            setView('error');
        }
    }

    function handleOpenCopy() {
        if (!createdId) return;
        toast.show({ message: 'Opening duplicate' });
        onClose();
        navigate(`/agents/${createdId}`);
    }

    return (
        <Dialog
            open={open}
            onClose={view === 'submitting' ? undefined : onClose}
            maxWidth="sm"
            fullWidth
            disableEscapeKeyDown={view === 'submitting'}
            PaperProps={{
                sx: {
                    borderRadius: '14px',
                    bgcolor: ATLAS_PALETTE.white,
                    boxShadow: '0 24px 48px rgba(0,0,0,.18)',
                    m: { xs: 2, sm: 4 },
                    maxHeight: { xs: 'calc(100% - 32px)', sm: 'calc(100% - 64px)' },
                },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, p: 4, pb: 0 }}>
                <Box
                    sx={{
                        width: 36,
                        height: 36,
                        borderRadius: '10px',
                        bgcolor:
                            view === 'success'
                                ? 'rgba(49,171,70,.12)'
                                : view === 'error'
                                  ? 'rgba(220,38,38,.10)'
                                  : 'rgba(0,122,201,.12)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {view === 'success' ? (
                        <CheckCircleOutline sx={{ color: ATLAS_PALETTE.green, fontSize: 22 }} />
                    ) : view === 'error' ? (
                        <ErrorOutline sx={{ color: ATLAS_PALETTE.error, fontSize: 22 }} />
                    ) : (
                        <ContentCopyRounded
                            sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 20 }}
                        />
                    )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <FormHeading>
                        {view === 'confirm' && 'Duplicate agent?'}
                        {view === 'submitting' && 'Duplicating agent…'}
                        {view === 'success' && 'Agent duplicated'}
                        {view === 'error' && 'Duplicate failed'}
                    </FormHeading>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {view === 'confirm' &&
                            'A new agent will be created with the same prompt, model, and configuration. You can rename it before saving.'}
                        {view === 'submitting' && 'Creating the new agent in the registry.'}
                        {view === 'success' &&
                            "The duplicate was created in Paused state so it doesn't pick up work until you review it."}
                        {view === 'error' && 'The server rejected the duplicate request.'}
                    </Typography>
                </Box>
                {view !== 'submitting' && (
                    <IconButton onClick={onClose} size="small">
                        <CloseRounded sx={{ color: ATLAS_PALETTE.slate60 }} />
                    </IconButton>
                )}
            </Box>

            <Box sx={{ p: 4, pt: 3 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 2,
                        p: 2.5,
                        bgcolor: hexToRgba(agent.accent_color, 0.06),
                        border: `1px solid ${hexToRgba(agent.accent_color, 0.2)}`,
                        borderRadius: '10px',
                        mb: view === 'confirm' ? 3 : 0,
                    }}
                >
                    <Box
                        sx={{
                            width: 36,
                            height: 36,
                            borderRadius: '8px',
                            background: hexToRgba(agent.accent_color, 0.18),
                            border: `1px solid ${hexToRgba(agent.accent_color, 0.3)}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 20, color: agent.accent_color }}
                        >
                            {view_.glyph}
                        </Box>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1.5,
                                flexWrap: 'wrap',
                            }}
                        >
                            <Typography
                                sx={{
                                    fontSize: 13.5,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                {agent.name}
                            </Typography>
                            <Box
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    px: 1,
                                    py: 0.25,
                                    bgcolor: ATLAS_PALETTE.slate08,
                                    color: ATLAS_PALETTE.slate70,
                                    borderRadius: '4px',
                                }}
                            >
                                {CATEGORY_LABEL[agent.category]}
                            </Box>
                        </Box>
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                color: ATLAS_PALETTE.slate70,
                                mt: 0.5,
                            }}
                        >
                            {agent.cli} · {agent.model} · prompt v{agent.prompt_version}
                        </Typography>
                    </Box>
                </Box>

                {view === 'confirm' && (
                    <>
                        <Typography
                            sx={{
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 1.5,
                            }}
                        >
                            New agent name
                        </Typography>
                        <TextField
                            fullWidth
                            size="small"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                            sx={{
                                '& .MuiOutlinedInput-root': { fontSize: 13.5 },
                                mb: 1.5,
                            }}
                        />
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                p: 2,
                                borderRadius: '8px',
                                bgcolor: ATLAS_PALETTE.slate08,
                                mb: 1,
                            }}
                        >
                            <Box>
                                <Typography
                                    sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mb: 0.25 }}
                                >
                                    New slug
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12.5,
                                        fontWeight: 500,
                                        color: ATLAS_PALETTE.slate,
                                    }}
                                >
                                    {newId.replace(/^agent-/, '')}
                                </Typography>
                            </Box>
                            <Box
                                sx={{
                                    px: 1.5,
                                    py: 0.5,
                                    bgcolor: ATLAS_PALETTE.slate10,
                                    color: ATLAS_PALETTE.slate70,
                                    fontSize: 10.5,
                                    fontWeight: 600,
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                    borderRadius: '4px',
                                }}
                            >
                                Created paused
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2.5 }}>
                            {[
                                'Prompt history starts fresh',
                                'Handoff rules and allowed tools start empty',
                                'Schedule defaults to the source cadence',
                            ].map((t) => (
                                <Box
                                    key={t}
                                    sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
                                >
                                    <Box
                                        component="span"
                                        className="material-symbols-rounded"
                                        sx={{ fontSize: 14, color: ATLAS_PALETTE.slate40 }}
                                    >
                                        radio_button_unchecked
                                    </Box>
                                    <Typography
                                        sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70 }}
                                    >
                                        {t}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>

                        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                            <Button
                                onClick={onClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                onClick={() => {
                                    void handleSubmit();
                                }}
                                disabled={!canSubmit}
                                startIcon={<ContentCopyRounded sx={{ fontSize: 18 }} />}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    bgcolor: ATLAS_PALETTE.brandBlue,
                                    '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue },
                                }}
                            >
                                Duplicate agent
                            </Button>
                        </Box>
                    </>
                )}

                {view === 'submitting' && (
                    <Box
                        sx={{
                            mt: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            py: 4,
                        }}
                    >
                        <CircularProgress
                            size={24}
                            sx={{ color: ATLAS_PALETTE.brandBlue, mr: 2 }}
                        />
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate70 }}>
                            Creating{' '}
                            <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                                {trimmedName}
                            </Box>
                            …
                        </Typography>
                    </Box>
                )}

                {view === 'success' && (
                    <Box sx={{ mt: 3 }}>
                        <Alert
                            icon={<CheckCircleOutline sx={{ color: ATLAS_PALETTE.green }} />}
                            sx={{
                                bgcolor: 'rgba(49,171,70,.08)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 13 },
                            }}
                        >
                            <strong>{trimmedName}</strong> is ready.
                            <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                                It starts paused — review the prompt and handoffs, then flip status
                                to Active.
                            </Box>
                        </Alert>
                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                            <Button
                                onClick={onClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Stay here
                            </Button>
                            <Button
                                variant="contained"
                                onClick={handleOpenCopy}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    bgcolor: ATLAS_PALETTE.brandBlue,
                                    '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue },
                                }}
                            >
                                Open duplicate →
                            </Button>
                        </Box>
                    </Box>
                )}

                {view === 'error' && (
                    <Box sx={{ mt: 3 }}>
                        <Alert
                            severity="error"
                            icon={<ErrorOutline sx={{ color: ATLAS_PALETTE.error }} />}
                            sx={{
                                bgcolor: 'rgba(220,38,38,.06)',
                                color: ATLAS_PALETTE.slate,
                                '& .MuiAlert-message': { fontSize: 13 },
                            }}
                        >
                            <strong>Could not duplicate</strong>
                            <Box sx={{ fontSize: 12, color: ATLAS_PALETTE.slate70, mt: 0.5 }}>
                                {error ?? 'The server rejected the request.'}
                            </Box>
                        </Alert>
                        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                            <Button
                                onClick={onClose}
                                sx={{ textTransform: 'none', color: ATLAS_PALETTE.slate60 }}
                            >
                                Close
                            </Button>
                            <Button
                                variant="contained"
                                onClick={() => setView('confirm')}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    bgcolor: ATLAS_PALETTE.brandBlue,
                                    '&:hover': { bgcolor: ATLAS_PALETTE.brandBlue },
                                }}
                            >
                                Try again
                            </Button>
                        </Box>
                    </Box>
                )}
            </Box>
        </Dialog>
    );
}
