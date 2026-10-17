import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import Skeleton from '@mui/material/Skeleton';
import Dialog from '@mui/material/Dialog';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import type { IProjectGuardrail } from '@atlas/shared';
import {
    useProjectGuardrails,
    useProjectGuardrailScripts,
    useCreateProjectGuardrail,
    useUpdateProjectGuardrail,
    useDeleteProjectGuardrail,
    useToggleProjectGuardrail,
} from '../hooks/useProjectGuardrails.js';
import { ConfirmActionModal } from '../components/ConfirmActionModal.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { ProjectGuardrailScriptsTab } from './projectGuardrails/ProjectGuardrailScriptsTab.js';
import { RetryAlert } from '../components/ApiErrorAlert.js';
import { iconOr } from '../theme/icons.js';

function RuleCard({
    rule,
    projectId,
    onEdit,
}: {
    rule: IProjectGuardrail;
    projectId: string;
    onEdit: (rule: IProjectGuardrail) => void;
}) {
    const toggle = useToggleProjectGuardrail(projectId);
    const remove = useDeleteProjectGuardrail(projectId);
    const toast = useToast();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const enabled = rule.enabled === 1;

    async function confirmDelete() {
        try {
            await remove.mutateAsync(rule.id);
            toast.show({ message: `Deleted guard-rail — ${rule.title}` });
            setConfirmOpen(false);
        } catch (err) {
            toast.show({ message: 'Could not delete guard-rail', detail: (err as Error).message });
        }
    }
    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
                opacity: enabled ? 1 : 0.6,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5, mb: 2.5 }}>
                <Box
                    sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '10px',
                        background: 'rgba(70,33,124,.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 22, color: ATLAS_PALETTE.purple }}
                    >
                        {iconOr(rule.icon, 'shield')}
                    </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate, mb: 0.5 }}
                    >
                        {rule.title}
                    </Typography>
                    <Typography
                        sx={{
                            fontSize: 12.5,
                            color: ATLAS_PALETTE.slate80,
                            lineHeight: 1.6,
                            whiteSpace: 'pre-wrap',
                        }}
                    >
                        {rule.body_md}
                    </Typography>
                </Box>
                <Box
                    component="span"
                    sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 22,
                        px: '9px',
                        borderRadius: '9999px',
                        background: enabled ? 'rgba(49,171,70,.16)' : ATLAS_PALETTE.slate08,
                        color: enabled ? ATLAS_PALETTE.green : ATLAS_PALETTE.slate60,
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                    }}
                >
                    {enabled ? 'Active' : 'Paused'}
                </Box>
                <Switch
                    checked={enabled}
                    onChange={(e) =>
                        toggle.mutate(
                            { id: rule.id, enabled: e.target.checked ? 1 : 0 },
                            {
                                onError: (err) =>
                                    toast.show({
                                        message: 'Could not update guard-rail',
                                        detail: err.message,
                                    }),
                            }
                        )
                    }
                    size="small"
                    slotProps={{ input: { 'aria-label': `${enabled ? 'Pause' : 'Resume'} ${rule.title}` } }}
                />
                <IconButton size="small" aria-label={`Edit ${rule.title}`} onClick={() => onEdit(rule)}>
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.slate60 }}
                    >
                        edit
                    </Box>
                </IconButton>
                <IconButton
                    size="small"
                    aria-label={`Delete ${rule.title}`}
                    onClick={() => setConfirmOpen(true)}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        aria-hidden="true"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.error }}
                    >
                        delete
                    </Box>
                </IconButton>
            </Box>
            <ConfirmActionModal
                open={confirmOpen}
                title="Delete this rule?"
                body={`Removes "${rule.title}" from this project. Agents won't see it on their next run.`}
                confirmLabel="Delete"
                tone="destructive"
                busy={remove.isPending}
                onConfirm={() => void confirmDelete()}
                onCancel={() => setConfirmOpen(false)}
            />
        </Box>
    );
}

function RuleDialog({
    open,
    onClose,
    projectId,
    editing,
}: {
    open: boolean;
    onClose: () => void;
    projectId: string;
    editing: IProjectGuardrail | null;
}) {
    const create = useCreateProjectGuardrail(projectId);
    const update = useUpdateProjectGuardrail(projectId);
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');

    // Seed on every open so a cancelled draft or the last edited rule doesn't
    // leak into the next open.
    useEffect(() => {
        if (!open) return;
        setTitle(editing?.title ?? '');
        setBody(editing?.body_md ?? '');
    }, [open, editing]);

    async function submit() {
        if (!title.trim() || !body.trim()) return;
        const data = { title: title.trim(), body_md: body.trim() };
        try {
            if (editing) {
                await update.mutateAsync({ id: editing.id, data });
                toast.show({ message: `Updated guard-rail — ${data.title}` });
            } else {
                await create.mutateAsync(data);
                toast.show({ message: `Added guard-rail — ${data.title}` });
            }
            onClose();
        } catch (err) {
            toast.show({ message: (err as Error).message });
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            aria-labelledby="project-rule-dialog-title"
            slotProps={{ paper: { sx: { borderRadius: '12px' } } }}
        >
            <Box sx={{ p: 4 }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 3,
                    }}
                >
                    <Typography id="project-rule-dialog-title" sx={{ fontSize: 16, fontWeight: 600 }}>
                        {editing ? 'Edit guard-rail' : 'Add guard-rail'}
                    </Typography>
                    <IconButton onClick={onClose} size="small" aria-label="Close">
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            aria-hidden="true"
                            sx={{ fontSize: 20, color: ATLAS_PALETTE.slate60 }}
                        >
                            close
                        </Box>
                    </IconButton>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <TextField
                        label="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        fullWidth
                    />
                    <TextField
                        label="Rule"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        fullWidth
                        multiline
                        minRows={3}
                    />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 4 }}>
                    <Button variant="outlined" onClick={onClose} sx={{ textTransform: 'none' }}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void submit()}
                        disabled={
                            !title.trim() || !body.trim() || create.isPending || update.isPending
                        }
                        sx={{ textTransform: 'none' }}
                    >
                        {editing ? 'Save changes' : 'Add rule'}
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}

export function ProjectGuardrailsBody({
    projectId,
    projectName,
}: {
    projectId: string;
    projectName?: string | undefined;
}) {
    const { data: rules = [], isLoading, isError, error, refetch } = useProjectGuardrails(projectId);
    const { data: scripts = [] } = useProjectGuardrailScripts(projectId);
    const [addOpen, setAddOpen] = useState(false);
    const [editing, setEditing] = useState<IProjectGuardrail | null>(null);
    const openAdd = () => {
        setEditing(null);
        setAddOpen(true);
    };
    const [tab, setTab] = useState<'rules' | 'scripts'>('rules');
    const active = rules.filter((r) => r.enabled === 1);

    return (
        <Box>
            <Tabs
                value={tab}
                onChange={(_, v: 'rules' | 'scripts') => setTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                    mb: 4,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                    '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 },
                }}
            >
                <Tab value="rules" label={`Rules  ${rules.length}`} />
                <Tab value="scripts" label={`Scripts  ${scripts.length}`} />
            </Tabs>

            {tab === 'scripts' && <ProjectGuardrailScriptsTab projectId={projectId} />}

            {tab === 'rules' && (
                <>
                    <Box
                        sx={{
                            display: 'flex',
                            flexDirection: { xs: 'column', sm: 'row' },
                            alignItems: { xs: 'stretch', sm: 'center' },
                            justifyContent: 'space-between',
                            gap: { xs: 1.5, sm: 2 },
                            mb: 4,
                        }}
                    >
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Rules every agent must respect inside this project ·{' '}
                            <Box
                                component="span"
                                sx={{
                                    fontFamily: '"JetBrains Mono", monospace',
                                    color: ATLAS_PALETTE.slate,
                                }}
                            >
                                {active.length}
                            </Box>{' '}
                            active
                        </Typography>
                        <Button
                            variant="contained"
                            onClick={openAdd}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    aria-hidden="true"
                                    sx={{ fontSize: 16 }}
                                >
                                    add
                                </Box>
                            }
                            sx={{
                                height: 32,
                                textTransform: 'none',
                                fontFamily: '"Inter", system-ui, sans-serif',
                                fontSize: 12.5,
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                alignSelf: { xs: 'flex-end', sm: 'auto' },
                            }}
                        >
                            Add rule
                        </Button>
                    </Box>

                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                            gridTemplateAreas: {
                                xs: `"icon title switch" "icon desc desc"`,
                                sm: `"icon title-and-desc switch"`,
                            },
                            columnGap: { xs: 1.75, sm: 3 },
                            rowGap: { xs: 0.75, sm: 0 },
                            alignItems: { xs: 'start', sm: 'center' },
                            p: { xs: 2.5, sm: 4 },
                            mb: 5,
                            bgcolor: ATLAS_PALETTE.accentSoft,
                            border: `1px solid ${ATLAS_PALETTE.slate12}`,
                            borderRadius: '12px',
                        }}
                    >
                        <Box
                            sx={{
                                gridArea: 'icon',
                                width: 36,
                                height: 36,
                                borderRadius: '10px',
                                bgcolor: ATLAS_PALETTE.cloud,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                alignSelf: 'center',
                            }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 20, color: ATLAS_PALETTE.slate }}
                            >
                                shield
                            </Box>
                        </Box>
                        <Typography
                            sx={{
                                gridArea: { xs: 'title', sm: 'title-and-desc' },
                                fontSize: 14,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                alignSelf: 'center',
                            }}
                        >
                            Guard-rails are active
                            <Box
                                component="span"
                                sx={{
                                    display: { xs: 'none', sm: 'block' },
                                    fontSize: 12.5,
                                    fontWeight: 400,
                                    color: ATLAS_PALETTE.slate60,
                                    lineHeight: 1.6,
                                    mt: 0.5,
                                }}
                            >
                                Every task and sub-task under {projectName ?? 'this project'}{' '}
                                inherits these rules. The{' '}
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    aria-hidden="true"
                                    sx={{
                                        fontSize: 14,
                                        color: ATLAS_PALETTE.purple,
                                        verticalAlign: 'middle',
                                    }}
                                >
                                    shield
                                </Box>{' '}
                                icon appears next to the rule anywhere it's listed.
                            </Box>
                        </Typography>
                        <Typography
                            sx={{
                                gridArea: 'desc',
                                display: { xs: 'block', sm: 'none' },
                                fontSize: 12.5,
                                color: ATLAS_PALETTE.slate60,
                                lineHeight: 1.6,
                            }}
                        >
                            Every task and sub-task under {projectName ?? 'this project'} inherits
                            these rules. The{' '}
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{
                                    fontSize: 14,
                                    color: ATLAS_PALETTE.purple,
                                    verticalAlign: 'middle',
                                }}
                            >
                                shield
                            </Box>{' '}
                            icon appears next to the rule anywhere it's listed.
                        </Typography>
                        <Box
                            sx={{
                                gridArea: 'switch',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                alignSelf: 'center',
                            }}
                        >
                            <Typography
                                sx={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: ATLAS_PALETTE.green,
                                    display: { xs: 'none', sm: 'inline' },
                                }}
                            >
                                Enabled
                            </Typography>
                            <Switch checked readOnly size="small" slotProps={{ input: { 'aria-label': 'Guard-rails enabled' } }} />
                        </Box>
                    </Box>

                    {isError ? (
                        <RetryAlert error={error} label="Could not load this project's rules" onRetry={() => void refetch()} />
                    ) : isLoading ? (
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                gap: 3,
                            }}
                        >
                            {[1, 2, 3, 4].map((i) => (
                                <Skeleton
                                    key={i}
                                    variant="rectangular"
                                    height={160}
                                    sx={{ borderRadius: '12px' }}
                                />
                            ))}
                        </Box>
                    ) : rules.length === 0 ? (
                        <Box
                            sx={{
                                textAlign: 'center',
                                py: 16,
                                background: ATLAS_PALETTE.white,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: '12px',
                            }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{
                                    fontSize: 48,
                                    color: ATLAS_PALETTE.slate40,
                                    display: 'block',
                                    mb: 3,
                                }}
                            >
                                shield
                            </Box>
                            <Typography
                                sx={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate60,
                                    mb: 1.5,
                                }}
                            >
                                No guard-rails yet for this project
                            </Typography>
                            <Typography
                                sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40, mb: 4 }}
                            >
                                Workspace rules still apply. Add a rule to enforce something
                                project-specific.
                            </Typography>
                            <Button variant="contained" onClick={openAdd}>
                                Add first rule
                            </Button>
                        </Box>
                    ) : (
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                gap: 3,
                            }}
                        >
                            {rules.map((r) => (
                                <RuleCard
                                    key={r.id}
                                    rule={r}
                                    projectId={projectId}
                                    onEdit={(rule) => {
                                        setEditing(rule);
                                        setAddOpen(true);
                                    }}
                                />
                            ))}
                        </Box>
                    )}
                </>
            )}

            <RuleDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                projectId={projectId}
                editing={editing}
            />
        </Box>
    );
}

export function ProjectGuardrails() {
    const { id: projectId = '' } = useParams<{ id: string }>();
    return <Navigate to={`/projects/${projectId}?tab=guardrails`} replace />;
}
