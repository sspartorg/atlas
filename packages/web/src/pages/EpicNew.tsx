import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import type { IAgent, IssuePriority } from '@atlas/shared';
import { Breadcrumb } from '../components/index.js';
import { AgentSelect } from '../components/AgentSelect.js';
import { useCreateEpic, useTransitionEpic } from '../hooks/useEpics.js';
import { useProjects } from '../hooks/useProjects.js';
import { useAgents } from '../hooks/useAgents.js';
import { useSettings } from '../hooks/useSettings.js';
import { useToast } from '../hooks/useToast.js';
import { MOBILE_SHELL, ATLAS_PALETTE } from '../theme/tokens.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { useIsMobile } from '../hooks/useIsMobile.js';

const PRIORITY_OPTIONS: Array<{ value: IssuePriority; label: string }> = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
];

export interface EpicNewBannerCopyInput {
    /** `'OWNER'` sentinel or an agent id from the Assignee picker. */
    assigneeId: string;
    activeAgents: IAgent[];
}

/**
 * A03 — dynamic copy for the tips banner above the New Epic form. Names
 * the picked agent verbatim when one is selected, falls back to generic
 * "the agent you assign" wording when the Owner is the default (or the
 * id no longer resolves — a stale dropdown id shouldn't crash the page).
 * Pure function so the test asserts on the strings directly without
 * driving the AgentSelect custom dropdown.
 *
 * Copy stays workflow-agnostic — only PO Writer's chain decomposes the
 * epic into stories, and the same banner renders for any assignee, so
 * we don't promise downstream behaviour the picked agent may not do.
 */
export function epicNewBannerCopy(input: EpicNewBannerCopyInput): string {
    const picked = input.assigneeId !== 'OWNER'
        ? input.activeAgents.find((a) => a.id === input.assigneeId)
        : null;
    if (picked) {
        return (
            `Write a rough goal — even one line is fine. ${picked.name} will pick this up ` +
            `once you save. You'll see comments as each agent finishes its run.`
        );
    }
    return (
        `Write a rough goal — even one line is fine. The agent you assign will pick this ` +
        `up. You'll see comments as each agent finishes its run.`
    );
}

export function EpicNew() {
    useSetPageTitle('Draft a new epic');
    const navigate = useNavigate();
    const isMobile = useIsMobile();
    const [params] = useSearchParams();
    const defaultProjectName = params.get('project');

    const { data: projects = [] } = useProjects();
    const { data: agents = [] } = useAgents();
    const { data: settings } = useSettings();
    const createEpic = useCreateEpic();
    const transitionEpic = useTransitionEpic();
    const toast = useToast();

    const projectByName = useMemo(() => new Map(projects.map((p) => [p.name, p])), [projects]);
    const defaultProjectId = defaultProjectName
        ? (projectByName.get(defaultProjectName)?.id ?? '')
        : '';

    const activeAgents = useMemo(() => agents.filter((w) => w.status === 'active'), [agents]);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [projectId, setProjectId] = useState(defaultProjectId);
    const [priority, setPriority] = useState<IssuePriority>('low');
    const [reporterId, setReporterId] = useState<string>('OWNER');
    // No hardcoded PO-Writer default — any agent (or the Owner) can take the
    // initial draft. The previous behavior was a UI default only; the API
    // already accepts any assignee. Defaulting to OWNER means "I'll route it
    // myself once it's drafted", which is the safer floor.
    const [assigneeId, setAssigneeId] = useState<string>('OWNER');
    const [submitAttempted, setSubmitAttempted] = useState(false);
    type FieldKey = 'title' | 'description' | 'project';
    const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
        title: false,
        description: false,
        project: false,
    });
    const touch = (k: FieldKey) => setTouched((prev) => ({ ...prev, [k]: true }));

    const ownerName = settings?.owner_name ?? 'Owner';
    const projectMissing = projects.length === 0;

    const errors = useMemo(() => {
        const e: Partial<Record<FieldKey, string>> = {};
        if (!title.trim()) e.title = 'Title is required.';
        if (!description.trim()) e.description = 'Description is required.';
        if (!projectId) e.project = 'Pick a project.';
        return e;
    }, [title, description, projectId]);
    const isValid = Object.keys(errors).length === 0;
    const showError = (k: FieldKey): string | undefined =>
        (touched[k] || submitAttempted) && errors[k] ? errors[k] : undefined;

    async function submit(mode: 'draft' | 'submit') {
        if (!isValid) {
            setSubmitAttempted(true);
            return;
        }
        try {
            const created = await createEpic.mutateAsync({
                project_id: projectId,
                title: title.trim(),
                description: description.trim(),
                priority,
                reporter_agent_id: reporterId === 'OWNER' ? null : reporterId,
                assignee_agent_id: assigneeId === 'OWNER' ? null : assigneeId,
            });
            if (mode === 'submit') {
                try {
                    await transitionEpic.mutateAsync({ id: created.id, status: 'ready' });
                    toast.show({ message: `Submitted — ${created.title}` });
                } catch {
                    toast.show({ message: `Saved — ${created.title}` });
                }
            } else {
                toast.show({ message: `Saved as draft — ${created.title}` });
            }
            navigate(`/epics/${created.id}`);
        } catch (err) {
            toast.show({ message: (err as Error).message });
        }
    }

    return (
        <Box
            sx={{
                px: { xs: 3, md: 8 },
                py: 4,
                pb: {
                    xs: `calc(${MOBILE_SHELL.bottomNavHeight + 72}px + env(safe-area-inset-bottom))`,
                    md: 4,
                },
            }}
        >
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <Breadcrumb items={[{ label: 'Epics', to: '/epics' }, { label: 'New Epic' }]} />
            </Box>

            <Box sx={{ mb: 5 }}>
                <Typography
                    sx={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1,
                    }}
                >
                    New Epic
                </Typography>
                <Typography
                    sx={{
                        fontSize: 26,
                        fontWeight: 700,
                        color: ATLAS_PALETTE.slate,
                        lineHeight: 1.2,
                        mb: 1,
                    }}
                >
                    Draft a new epic
                </Typography>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    {(() => {
                        if (assigneeId === 'OWNER') {
                            return `${ownerName} will route this once you submit · estimated 4 m to first plan`;
                        }
                        const a = activeAgents.find((w) => w.id === assigneeId);
                        return a
                            ? `${a.name} will pick this up once you submit · estimated 4 m to first plan`
                            : 'Pick an assignee to set up the handoff';
                    })()}
                </Typography>
            </Box>

            <Box
                sx={{
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                    p: 5,
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 2,
                        p: 2.5,
                        mb: 4,
                        background: 'rgba(0,185,255,.08)',
                        border: `1px solid rgba(0,185,255,.18)`,
                        borderRadius: '10px',
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.cerulean, mt: 0.25 }}
                    >
                        tips_and_updates
                    </Box>
                    <Typography
                        sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate80, lineHeight: 1.6 }}
                    >
                        {epicNewBannerCopy({ assigneeId, activeAgents })}
                    </Typography>
                </Box>

                <Box sx={{ mb: 4 }}>
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate60,
                            mb: 1.5,
                        }}
                    >
                        Title
                    </Typography>
                    <TextField
                        fullWidth
                        required
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={() => touch('title')}
                        error={Boolean(showError('title'))}
                        helperText={showError('title')}
                        placeholder="e.g. Refund automation"
                        autoFocus
                        sx={{ '& .MuiOutlinedInput-root': { fontSize: 14, background: ATLAS_PALETTE.white } }}
                    />
                </Box>

                <Box sx={{ mb: 4 }}>
                    <Typography
                        sx={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate60,
                            mb: 1.5,
                        }}
                    >
                        Description{' '}
                        <Box
                            component="span"
                            sx={{ color: ATLAS_PALETTE.slate40, fontWeight: 400 }}
                        >
                            — what you're trying to do, why it matters, anything PO Writer needs to
                            know
                        </Box>
                    </Typography>
                    <TextField
                        fullWidth
                        required
                        multiline
                        minRows={4}
                        maxRows={10}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onBlur={() => touch('description')}
                        error={Boolean(showError('description'))}
                        helperText={showError('description')}
                        placeholder="Refunds today are manual: support reviews each request, posts a Stripe refund, and emails the customer…"
                        sx={{ '& .MuiOutlinedInput-root': { fontSize: 13, background: ATLAS_PALETTE.white } }}
                    />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, mb: 4 }}>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate60,
                                mb: 1.5,
                            }}
                        >
                            Project
                        </Typography>
                        <FormControl
                            fullWidth
                            disabled={projectMissing}
                            error={Boolean(showError('project'))}
                        >
                            <InputLabel shrink={false} sx={{ display: 'none' }}>
                                Project
                            </InputLabel>
                            <Select
                                value={projectId}
                                onChange={(e) => {
                                    setProjectId(e.target.value);
                                    touch('project');
                                }}
                                onBlur={() => touch('project')}
                                displayEmpty
                                sx={{ background: ATLAS_PALETTE.white, fontSize: 13 }}
                            >
                                <MenuItem value="" disabled>
                                    <Typography
                                        sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40 }}
                                    >
                                        Choose a project…
                                    </Typography>
                                </MenuItem>
                                {projects.map((p) => (
                                    <MenuItem key={p.id} value={p.id} sx={{ fontSize: 13 }}>
                                        {p.name}
                                    </MenuItem>
                                ))}
                            </Select>
                            {showError('project') && (
                                <Typography
                                    sx={{ fontSize: 11, color: ATLAS_PALETTE.error, mt: 0.5 }}
                                >
                                    {showError('project')}
                                </Typography>
                            )}
                        </FormControl>
                    </Box>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate60,
                                mb: 1.5,
                            }}
                        >
                            Priority
                        </Typography>
                        <FormControl fullWidth>
                            <InputLabel shrink={false} sx={{ display: 'none' }}>
                                Priority
                            </InputLabel>
                            <Select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as IssuePriority)}
                                sx={{ background: ATLAS_PALETTE.white, fontSize: 13 }}
                            >
                                {PRIORITY_OPTIONS.map((p) => (
                                    <MenuItem key={p.value} value={p.value} sx={{ fontSize: 13 }}>
                                        {p.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, mb: 4 }}>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate60,
                                mb: 1.5,
                            }}
                        >
                            Reporter{' '}
                            <Box
                                component="span"
                                sx={{ color: ATLAS_PALETTE.slate40, fontWeight: 400 }}
                            >
                                — defaults to you
                            </Box>
                        </Typography>
                        <FormControl fullWidth>
                            <Select
                                value={reporterId}
                                onChange={(e) => setReporterId(e.target.value)}
                                sx={{ background: ATLAS_PALETTE.white, fontSize: 13 }}
                            >
                                <MenuItem value="OWNER" sx={{ fontSize: 13 }}>
                                    {ownerName} (Owner)
                                </MenuItem>
                                {activeAgents.map((w) => (
                                    <MenuItem key={w.id} value={w.id} sx={{ fontSize: 13 }}>
                                        {w.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                    <Box>
                        <Typography
                            sx={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate60,
                                mb: 1.5,
                            }}
                        >
                            Assignee{' '}
                            <Box
                                component="span"
                                sx={{ color: ATLAS_PALETTE.slate40, fontWeight: 400 }}
                            >
                                — who works it first
                            </Box>
                        </Typography>
                        <AgentSelect
                            agents={activeAgents}
                            value={assigneeId}
                            onChange={(v) => setAssigneeId(v || 'OWNER')}
                            ownerName={ownerName}
                            placeholder="Search by name or designation…"
                        />
                    </Box>
                </Box>

                {!isMobile && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                        <Button
                            variant="outlined"
                            onClick={() => void submit('draft')}
                            disabled={createEpic.isPending}
                            sx={{ textTransform: 'none', fontFamily: '"Inter", system-ui, sans-serif' }}
                        >
                            Save as draft
                        </Button>
                        <Button
                            variant="text"
                            onClick={() => navigate('/epics')}
                            sx={{
                                textTransform: 'none',
                                fontFamily: '"Inter", system-ui, sans-serif',
                                color: ATLAS_PALETTE.slate60,
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={() => void submit('submit')}
                            disabled={createEpic.isPending}
                            startIcon={
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    send
                                </Box>
                            }
                            sx={{ textTransform: 'none', fontFamily: '"Inter", system-ui, sans-serif' }}
                        >
                            Submit
                        </Button>
                    </Box>
                )}
            </Box>
            {isMobile && (
                <Box
                    sx={{
                        position: 'fixed',
                        left: 0,
                        right: 0,
                        bottom: `calc(${MOBILE_SHELL.bottomNavHeight}px + env(safe-area-inset-bottom))`,
                        bgcolor: ATLAS_PALETTE.white,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                        px: 3,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        zIndex: 10,
                    }}
                >
                    <Button
                        variant="outlined"
                        onClick={() => void submit('draft')}
                        disabled={createEpic.isPending}
                        sx={{
                            textTransform: 'none',
                            fontFamily: '"Inter", system-ui, sans-serif',
                            flex: 1,
                        }}
                    >
                        Draft
                    </Button>
                    <Button
                        variant="text"
                        onClick={() => navigate('/epics')}
                        sx={{
                            textTransform: 'none',
                            fontFamily: '"Inter", system-ui, sans-serif',
                            color: ATLAS_PALETTE.slate60,
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => void submit('submit')}
                        disabled={createEpic.isPending}
                        startIcon={
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 16 }}
                            >
                                send
                            </Box>
                        }
                        sx={{
                            textTransform: 'none',
                            fontFamily: '"Inter", system-ui, sans-serif',
                            flex: 1,
                            bgcolor: ATLAS_PALETTE.green,
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                        }}
                    >
                        Submit
                    </Button>
                </Box>
            )}
        </Box>
    );
}
