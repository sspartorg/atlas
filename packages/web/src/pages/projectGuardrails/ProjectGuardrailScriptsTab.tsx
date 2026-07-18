import { useState, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import AddRounded from '@mui/icons-material/AddRounded';
import TerminalRounded from '@mui/icons-material/TerminalRounded';
import type { IProjectGuardrailScript } from '@atlas/shared';
import {
    useProjectGuardrailScripts,
    useCreateProjectGuardrailScript,
    useUpdateProjectGuardrailScript,
    useDeleteProjectGuardrailScript,
} from '../../hooks/useProjectGuardrails.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ScriptModal, type ScriptModalValues } from '../../components/ScriptModal.js';

// Phase 1.5b â€” Per-project Scripts tab. Same shape as the Atlas-level
// tab but scoped to a single project. The orchestrator merges
// project-level scripts with org-wide scripts at regen time
// (project entries override atlas entries with the same id).

const ScriptCard = memo(function ScriptCard({
    script,
    onClick,
}: {
    script: IProjectGuardrailScript;
    onClick: () => void;
}) {
    return (
        <Box
            role="button"
            onClick={onClick}
            sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 2,
                p: 2.5,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: 2,
                cursor: 'pointer',
                bgcolor: ATLAS_PALETTE.white,
                transition: 'border-color 120ms ease, background 120ms ease',
                '&:hover': {
                    borderColor: ATLAS_PALETTE.brandBlue,
                    bgcolor: 'rgba(0,122,201,.04)',
                },
            }}
        >
            <Box
                sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '8px',
                    bgcolor: ATLAS_PALETTE.slate06,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                <TerminalRounded sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {script.name}
                </Typography>
                <Typography
                    sx={{
                        fontSize: 12,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        color: ATLAS_PALETTE.slate60,
                        mt: 0.25,
                    }}
                >
                    check-{script.id}.sh
                </Typography>
                {script.description ? (
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate60,
                            mt: 0.5,
                            lineHeight: 1.5,
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                        }}
                    >
                        {script.description}
                    </Typography>
                ) : null}
            </Box>
        </Box>
    );
});

export function ProjectGuardrailScriptsTab({ projectId }: { projectId: string }) {
    const { data: scripts = [], isLoading } = useProjectGuardrailScripts(projectId);
    const create = useCreateProjectGuardrailScript(projectId);
    const update = useUpdateProjectGuardrailScript(projectId);
    const del = useDeleteProjectGuardrailScript(projectId);
    const toast = useToast();
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<ScriptModalValues | null>(null);

    function openAdd() {
        setEditing(null);
        setModalOpen(true);
    }
    function openEdit(s: IProjectGuardrailScript) {
        setEditing({
            id: s.id,
            name: s.name,
            description: s.description,
            body_sh: s.body_sh,
            body_ps1: s.body_ps1,
        });
        setModalOpen(true);
    }
    async function handleSubmit(data: {
        id: string;
        name: string;
        description: string;
        body_sh: string;
        body_ps1: string;
    }) {
        if (editing?.id) {
            // Slug is immutable on update â€” strip `id` from the patch body.
            const { id: _unused, ...patch } = data;
            void _unused;
            await update.mutateAsync({ id: editing.id, patch });
            toast.show({ message: 'Project script updated' });
        } else {
            await create.mutateAsync(data);
            toast.show({ message: 'Project script added' });
        }
    }
    async function handleDelete(id: string) {
        await del.mutateAsync(id);
        toast.show({ message: 'Project script deleted' });
    }

    return (
        <Box>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
                gap={{ xs: 1.5, sm: 2 }}
                sx={{ mb: 3 }}
            >
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    Project-scoped shell scripts. {scripts.length}{' '}
                    {scripts.length === 1 ? 'script' : 'scripts'} configured for this project.
                </Typography>
                <Button
                    variant="contained"
                    onClick={openAdd}
                    startIcon={<AddRounded fontSize="small" />}
                    sx={{
                        textTransform: 'none',
                        fontWeight: 600,
                        alignSelf: { xs: 'flex-end', sm: 'auto' },
                        flexShrink: 0,
                    }}
                >
                    Add script
                </Button>
            </Stack>
            {isLoading ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Loadingâ€¦
                </Typography>
            ) : scripts.length === 0 ? (
                <Box
                    sx={{
                        border: `1px dashed ${ATLAS_PALETTE.slate10}`,
                        borderRadius: 2,
                        p: 5,
                        textAlign: 'center',
                        color: 'text.secondary',
                    }}
                >
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                        No project scripts yet
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Add a shell script scoped to this project. Org-wide scripts from Atlas
                        Guardrails apply automatically.
                    </Typography>
                    <Button variant="outlined" onClick={openAdd} startIcon={<AddRounded fontSize="small" />}>
                        Add first script
                    </Button>
                </Box>
            ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                    {scripts.map((s) => (
                        <ScriptCard key={s.id} script={s} onClick={() => openEdit(s)} />
                    ))}
                </Box>
            )}
            <ScriptModal
                open={modalOpen}
                editing={editing}
                onClose={() => setModalOpen(false)}
                onSubmit={handleSubmit}
                onDelete={handleDelete}
            />
        </Box>
    );
}
