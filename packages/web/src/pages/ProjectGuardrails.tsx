import { useState } from 'react';
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
    useToggleProjectGuardrail,
} from '../hooks/useProjectGuardrails.js';
import { useToast } from '../hooks/useToast.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import { ProjectGuardrailScriptsTab } from './projectGuardrails/ProjectGuardrailScriptsTab.js';

function RuleCard({ rule, projectId }: { rule: IProjectGuardrail; projectId: string }) {
    const toggle = useToggleProjectGuardrail(projectId);
    const enabled = rule.enabled === 1;
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
                        sx={{ fontSize: 22, color: ATLAS_PALETTE.purple }}
                    >
                        {rule.icon}
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
                        toggle.mutate({ id: rule.id, enabled: e.target.checked ? 1 : 0 })
                    }
                    size="small"
                />
            </Box>
        </Box>
    );
}

function AddRuleDialog({
    open,
    onClose,
    projectId,
}: {
    open: boolean;
    onClose: () => void;
    projectId: string;
}) {
    const create = useCreateProjectGuardrail(projectId);
    const toast = useToast();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [appliesTo, setAppliesTo] = useState('');

    function reset() {
        setTitle('');
        setBody('');
        setAppliesTo('');
    }

    async function submit() {
        if (!title.trim() || !body.trim()) return;
        try {
            await create.mutateAsync({
                title: title.trim(),
                body_md: body.trim(),
                applies_to: appliesTo.trim(),
            });
            toast.show({ message: `Added guard-rail — ${title.trim()}` });
            reset();
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
                    <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Add guard-rail</Typography>
                    <IconButton onClick={onClose} size="small">
                        <Box
                            component="span"
                            className="material-symbols-rounded"
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
                    <TextField
                        label="Applies to (optional)"
                        value={appliesTo}
                        onChange={(e) => setAppliesTo(e.target.value)}
                        fullWidth
                    />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 4 }}>
                    <Button variant="outlined" onClick={onClose} sx={{ textTransform: 'none' }}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void submit()}
                        disabled={!title.trim() || !body.trim() || create.isPending}
                        sx={{ textTransform: 'none' }}
                    >
                        Add rule
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
    const { data: rules = [], isLoading } = useProjectGuardrails(projectId);
    const { data: scripts = [] } = useProjectGuardrailScripts(projectId);
    const [addOpen, setAddOpen] = useState(false);
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
                    onClick={() => setAddOpen(true)}
                    startIcon={
                        <Box
                            component="span"
                            className="material-symbols-rounded"
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
                        Every epic and story under {projectName ?? 'this project'} inherits these
                        rules. The{' '}
                        <Box
                            component="span"
                            className="material-symbols-rounded"
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
                    Every epic and story under {projectName ?? 'this project'} inherits these
                    rules. The{' '}
                    <Box
                        component="span"
                        className="material-symbols-rounded"
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
                    <Switch checked readOnly size="small" />
                </Box>
            </Box>

            {isLoading ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
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
                    <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate40, mb: 4 }}>
                        Workspace rules still apply. Add a rule to enforce something
                        project-specific.
                    </Typography>
                    <Button variant="contained" onClick={() => setAddOpen(true)}>
                        Add first rule
                    </Button>
                </Box>
            ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                    {rules.map((r) => (
                        <RuleCard key={r.id} rule={r} projectId={projectId} />
                    ))}
                </Box>
            )}

                </>
            )}

            <AddRuleDialog open={addOpen} onClose={() => setAddOpen(false)} projectId={projectId} />
        </Box>
    );
}

export function ProjectGuardrails() {
    const { id: projectId = '' } = useParams<{ id: string }>();
    return <Navigate to={`/projects/${projectId}?tab=guardrails`} replace />;
}
