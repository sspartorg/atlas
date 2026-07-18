import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import FormHelperText from '@mui/material/FormHelperText';
import CloseRounded from '@mui/icons-material/CloseRounded';
import LayersRounded from '@mui/icons-material/LayersRounded';
import BugReportRounded from '@mui/icons-material/BugReportRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import PestControlRounded from '@mui/icons-material/PestControlRounded';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useEpics } from '../../hooks/useEpics.js';
import { useStories } from '../../hooks/useStories.js';
import { useAgents } from '../../hooks/useAgents.js';
import { api } from '../../api/api.js';
import type { IAgent, BugFrequency, BugFailureScope, IssueType } from '@atlas/shared';
import { AgentSelect } from '../AgentSelect.js';

export type NewIssueKind = 'story' | 'bug' | 'sub_task' | 'sub_bug';

/** Optional pre-fill for the body fields. Used by the Clone action on
 *  detail pages to copy the source item's editable fields into the
 *  modal. Any field not supplied falls back to the empty default. */
export interface NewIssueInitialValues {
    title?: string;
    description?: string;
    acceptance_criteria?: string;
    steps_to_reproduce?: string;
    expected?: string;
    actual?: string;
    frequency?: BugFrequency;
    failure_scope?: BugFailureScope;
}

interface Props {
    open: boolean;
    onClose: () => void;
    initialKind?: NewIssueKind;
    initialProjectId?: string | null;
    initialParentEpicId?: string | null;
    initialParentStoryId?: string | null;
    /** Body-field pre-fill (Clone flow). */
    initialValues?: NewIssueInitialValues | undefined;
    /** When set, the modal is in Clone mode: after the create call
     *  succeeds, a `relates_to` link is attached between the new item
     *  and this source. Both id + type are required so we know which
     *  endpoint to hit. */
    cloneFromId?: string | undefined;
    cloneFromType?: IssueType | undefined;
}

const KIND_TABS: Array<{
    kind: NewIssueKind;
    label: string;
    description: string;
    Icon: typeof LayersRounded;
}> = [
    {
        kind: 'story',
        label: 'Story',
        description: 'User-facing value, under an epic.',
        Icon: LayersRounded,
    },
    {
        kind: 'bug',
        label: 'Bug',
        description: 'Standalone defect under an epic.',
        Icon: BugReportRounded,
    },
    {
        kind: 'sub_task',
        label: 'Sub-task',
        description: 'One step under a story.',
        Icon: CheckCircleOutlineRounded,
    },
    {
        kind: 'sub_bug',
        label: 'Sub-bug',
        description: 'Defect under a story.',
        Icon: PestControlRounded,
    },
];

function kindAccent(kind: NewIssueKind): string {
    if (kind === 'story') return ATLAS_PALETTE.brandBlue;
    if (kind === 'bug') return ATLAS_PALETTE.error;
    if (kind === 'sub_task') return ATLAS_PALETTE.green;
    return ATLAS_PALETTE.orange;
}

function kindSubtitle(kind: NewIssueKind): string {
    if (kind === 'bug' || kind === 'sub_bug')
        return 'Bugs are never orphans — they hang off an epic or a story.';
    if (kind === 'story') return 'Stories hang under an epic and split into sub-tasks.';
    return 'Pick a kind, then fill the fields. Agents will pick it up after submit.';
}

const FREQUENCIES: BugFrequency[] = ['always', 'sometimes', 'rare'];
const FAILURE_SCOPES: BugFailureScope[] = ['data-loss', 'functional', 'cosmetic', 'performance'];

const inputSx = {
    '& .MuiOutlinedInput-root': {
        background: ATLAS_PALETTE.white,
        fontSize: 13,
        fontFamily: '"Inter", system-ui, sans-serif',
    },
};

export function NewIssueModal({
    open,
    onClose,
    initialKind = 'story',
    initialProjectId = null,
    initialParentEpicId = null,
    initialParentStoryId = null,
    initialValues,
    cloneFromId,
    cloneFromType,
}: Props) {
    const qc = useQueryClient();
    const { data: projects = [] } = useProjects();
    const { data: epics = [] } = useEpics();
    const { data: stories = [] } = useStories();
    const { data: agents = [] } = useAgents();

    const [kind, setKind] = useState<NewIssueKind>(initialKind);
    const [projectId, setProjectId] = useState<string>('');
    const [parentEpicId, setParentEpicId] = useState<string>('');
    const [parentStoryId, setParentStoryId] = useState<string>('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
    const [stepsToReproduce, setStepsToReproduce] = useState('');
    const [expected, setExpected] = useState('');
    const [actual, setActual] = useState('');
    const [frequency, setFrequency] = useState<BugFrequency>('sometimes');
    const [failureScope, setFailureScope] = useState<BugFailureScope>('cosmetic');
    const [reporterId, setReporterId] = useState<'owner'>('owner');
    const [assigneeId, setAssigneeId] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [submitAttempted, setSubmitAttempted] = useState(false);
    type FieldKey =
        | 'projectId'
        | 'parent'
        | 'title'
        | 'description'
        | 'acceptanceCriteria'
        | 'stepsToReproduce';
    const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
        projectId: false,
        parent: false,
        title: false,
        description: false,
        acceptanceCriteria: false,
        stepsToReproduce: false,
    });
    const touch = (k: FieldKey) => setTouched((prev) => ({ ...prev, [k]: true }));

    // Reset when re-opened or initial values change.
    useEffect(() => {
        if (!open) return;
        setKind(initialKind);
        setProjectId(initialProjectId ?? '');
        setParentEpicId(initialParentEpicId ?? '');
        setParentStoryId(initialParentStoryId ?? '');
        setTitle(initialValues?.title ?? '');
        setDescription(initialValues?.description ?? '');
        setAcceptanceCriteria(initialValues?.acceptance_criteria ?? '');
        setStepsToReproduce(initialValues?.steps_to_reproduce ?? '');
        setExpected(initialValues?.expected ?? '');
        setActual(initialValues?.actual ?? '');
        setFrequency(initialValues?.frequency ?? 'sometimes');
        setFailureScope(initialValues?.failure_scope ?? 'cosmetic');
        setReporterId('owner');
        setAssigneeId('');
        setErrorMsg(null);
        setSubmitting(false);
        setSubmitAttempted(false);
        setTouched({
            projectId: false,
            parent: false,
            title: false,
            description: false,
            acceptanceCriteria: false,
            stepsToReproduce: false,
        });
    }, [
        open,
        initialKind,
        initialProjectId,
        initialParentEpicId,
        initialParentStoryId,
        initialValues,
    ]);

    const wantsEpicParent = kind === 'story' || kind === 'bug';
    const wantsBugFields = kind === 'bug' || kind === 'sub_bug';
    const wantsAC = kind !== 'sub_task'; // sub-task screen has no AC field per mockup 2.3

    // Filter epics by selected project, and stories by selected project's epics.
    const epicsForProject = useMemo(
        () => (projectId ? epics.filter((e) => e.project_id === projectId) : epics),
        [epics, projectId]
    );
    const storiesForProject = useMemo(() => {
        if (!projectId) return stories;
        const epicIds = new Set(epicsForProject.map((e) => e.id));
        return stories.filter((s) => epicIds.has(s.epic_id));
    }, [stories, epicsForProject, projectId]);

    // Default project to first project when none is selected so the parent select is non-empty.
    useEffect(() => {
        if (open && !projectId && projects.length > 0) {
            const first = projects[0];
            if (first) setProjectId(first.id);
        }
    }, [open, projectId, projects]);

    // Agents grouped to expose owner-as-reporter, AI agents as assignee.
    const aiAgents = agents;
    const defaultAssignee = useMemo<IAgent | undefined>(() => {
        if (kind === 'story') return aiAgents.find((w) => w.id === 'agent-po-writer');
        if (kind === 'bug') return aiAgents.find((w) => w.id === 'agent-coder');
        if (kind === 'sub_task') return aiAgents.find((w) => w.id === 'agent-coder');
        if (kind === 'sub_bug') return aiAgents.find((w) => w.id === 'agent-coder');
        return undefined;
    }, [aiAgents, kind]);

    useEffect(() => {
        if (!assigneeId && defaultAssignee) setAssigneeId(defaultAssignee.id);
    }, [assigneeId, defaultAssignee]);

    const errors = useMemo(() => {
        const e: Partial<Record<FieldKey, string>> = {};
        if (!projectId) e.projectId = 'Pick a project.';
        if (wantsEpicParent && !parentEpicId) e.parent = 'Pick an epic.';
        if (!wantsEpicParent && !parentStoryId) e.parent = 'Pick a story.';
        if (!title.trim()) e.title = 'Title is required.';
        if (!description.trim()) e.description = 'Description is required.';
        if (wantsAC && !acceptanceCriteria.trim()) {
            e.acceptanceCriteria = 'At least one acceptance criterion is required.';
        }
        if (wantsBugFields && !stepsToReproduce.trim()) {
            e.stepsToReproduce = 'Steps to reproduce are required.';
        }
        return e;
    }, [
        projectId,
        parentEpicId,
        parentStoryId,
        wantsEpicParent,
        title,
        description,
        acceptanceCriteria,
        stepsToReproduce,
        wantsAC,
        wantsBugFields,
    ]);

    const isValid = Object.keys(errors).length === 0;
    const showError = (key: FieldKey): string | undefined =>
        (touched[key] || submitAttempted) && errors[key] ? errors[key] : undefined;

    async function submit() {
        setErrorMsg(null);
        if (!isValid) {
            setSubmitAttempted(true);
            return;
        }
        // The "Create issue" button is `disabled={submitting}`, and browsers/
        // jsdom block click events on natively-disabled buttons, so a second
        // in-flight submit() call can't be triggered by re-clicking the UI.
        /* v8 ignore next */
        if (submitting) return;
        setSubmitting(true);

        // Every new issue lands in `draft`. The detail page is where it gets
        // transitioned to Ready (and beyond) once the assignee is finalised.
        const targetStatus = 'draft';

        try {
            const assignee = assigneeId || null;
            // Capture the new item's id so the Clone flow can attach a
            // relates_to link to the source after creation. The four
            // create endpoints all return the new entity typed
            // (IStory / IBug / ISubTask / ISubBug) — `.id` is the
            // assigned short id (e.g. ATL-7).
            let newId: string;
            let newType: IssueType;
            if (kind === 'story') {
                const created = await api.stories.create({
                    epic_id: parentEpicId,
                    title: title.trim(),
                    description,
                    acceptance_criteria: acceptanceCriteria,
                    status: targetStatus as IStoryStatus,
                    assignee_agent_id: assignee,
                } as never);
                newId = created.id;
                newType = 'story';
            } else if (kind === 'bug') {
                const created = await api.bugs.create({
                    epic_id: parentEpicId,
                    title: title.trim(),
                    description,
                    acceptance_criteria: acceptanceCriteria,
                    steps_to_reproduce: stepsToReproduce,
                    expected,
                    actual,
                    frequency,
                    failure_scope: failureScope,
                    status: targetStatus as IStoryStatus,
                    assignee_agent_id: assignee,
                } as never);
                newId = created.id;
                newType = 'bug';
            } else if (kind === 'sub_task') {
                const created = await api.stories.createSubTask(parentStoryId, {
                    title: title.trim(),
                    description,
                    acceptance_criteria: acceptanceCriteria,
                    status: targetStatus as never,
                    assignee_agent_id: assignee,
                } as never);
                newId = created.id;
                newType = 'sub_task';
            } else {
                const created = await api.stories.createSubBug(parentStoryId, {
                    title: title.trim(),
                    description,
                    acceptance_criteria: acceptanceCriteria,
                    steps_to_reproduce: stepsToReproduce,
                    expected,
                    actual,
                    frequency,
                    failure_scope: failureScope,
                    status: targetStatus as never,
                    assignee_agent_id: assignee,
                } as never);
                newId = created.id;
                newType = 'sub_bug';
            }

            // Clone mode: link the just-created item back to the source
            // as `relates_to`. Best-effort — if the link call errors,
            // the new item still exists and the owner can attach the
            // link manually from the source's detail page.
            if (cloneFromId && cloneFromType) {
                try {
                    await api.issueLinks.create(
                        newType,
                        newId,
                        cloneFromType,
                        cloneFromId,
                        'relates_to',
                    );
                    await qc.invalidateQueries({ queryKey: ['issue-links'] });
                } catch (linkErr) {
                    // Surface but don't block close — clone is created.
                    console.warn(
                        '[NewIssueModal] clone link create failed',
                        (linkErr as Error).message,
                    );
                }
            }

            await qc.invalidateQueries({ queryKey: ['issues'] });
            await qc.invalidateQueries({ queryKey: ['stories'] });
            await qc.invalidateQueries({ queryKey: ['bugs'] });
            await qc.invalidateQueries({ queryKey: ['sidenav-counts'] });
            onClose();
        } catch (err) {
            setErrorMsg((err as Error).message || 'Failed to create issue');
        } finally {
            setSubmitting(false);
        }
    }

    const accent = kindAccent(kind);
    // `kind` is a typed NewIssueKind only ever set from a KIND_TABS entry
    // (initialKind prop or setKind(tab.kind) in the tab click handler), so
    // .find() always succeeds — the ?? fallback guards a state that can't occur.
    /* v8 ignore next */
    const currentTab = KIND_TABS.find((t) => t.kind === kind) ?? KIND_TABS[0]!;
    const HeaderIcon = currentTab.Icon;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={false}
            PaperProps={{
                sx: {
                    width: 720,
                    maxWidth: '92vw',
                    borderRadius: '14px',
                    overflow: 'hidden',
                    m: 2,
                },
            }}
        >
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, p: 4, pb: 3 }}>
                <Box
                    sx={{
                        width: 34,
                        height: 34,
                        borderRadius: '8px',
                        background: `${accent}1A`,
                        color: accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <HeaderIcon sx={{ fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 18,
                            fontWeight: 700,
                            color: ATLAS_PALETTE.slate,
                            lineHeight: 1.2,
                        }}
                    >
                        New {currentTab.label.toLowerCase()}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        {kindSubtitle(kind)}
                    </Typography>
                </Box>
                <IconButton
                    onClick={onClose}
                    size="small"
                    sx={{ color: ATLAS_PALETTE.slate60, flexShrink: 0 }}
                >
                    <CloseRounded fontSize="small" />
                </IconButton>
            </Box>

            {/* Kind tabs */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
                    gap: 2,
                    px: 4,
                    pb: 3,
                }}
            >
                {KIND_TABS.map((tab) => {
                    const Icon = tab.Icon;
                    const active = tab.kind === kind;
                    return (
                        <Box
                            key={tab.kind}
                            role="button"
                            onClick={() => setKind(tab.kind)}
                            sx={{
                                p: 2.25,
                                borderRadius: '10px',
                                border: `1px solid ${active ? kindAccent(tab.kind) : ATLAS_PALETTE.slate10}`,
                                background: active ? `${kindAccent(tab.kind)}0F` : ATLAS_PALETTE.white,
                                cursor: 'pointer',
                                transition: 'all 150ms ease',
                                '&:hover': { borderColor: kindAccent(tab.kind) },
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Icon sx={{ fontSize: 16, color: kindAccent(tab.kind) }} />
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                    }}
                                >
                                    {tab.label}
                                </Typography>
                            </Box>
                            <Typography
                                sx={{
                                    fontSize: 11,
                                    color: ATLAS_PALETTE.slate60,
                                    lineHeight: 1.4,
                                }}
                            >
                                {tab.description}
                            </Typography>
                        </Box>
                    );
                })}
            </Box>

            {/* Form body */}
            <Box sx={{ px: 4, pt: 3, pb: 3, maxHeight: '62vh', overflow: 'auto' }}>
                {/* Project + Parent */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, mb: 4 }}>
                    <FormControl fullWidth size="small" required error={Boolean(showError('projectId'))}>
                        <InputLabel id="new-issue-project-label" shrink>
                            Project
                        </InputLabel>
                        <Select
                            labelId="new-issue-project-label"
                            label="Project"
                            value={projectId}
                            onChange={(e) => {
                                setProjectId(e.target.value);
                                setParentEpicId('');
                                setParentStoryId('');
                                touch('projectId');
                            }}
                            onBlur={() => touch('projectId')}
                            sx={{ fontSize: 13, background: ATLAS_PALETTE.white }}
                        >
                            {projects.map((p) => (
                                <MenuItem key={p.id} value={p.id} sx={{ fontSize: 13 }}>
                                    {p.name}
                                </MenuItem>
                            ))}
                        </Select>
                        {showError('projectId') && (
                            <FormHelperText>{showError('projectId')}</FormHelperText>
                        )}
                    </FormControl>
                    <FormControl fullWidth size="small" required error={Boolean(showError('parent'))}>
                        <InputLabel id="new-issue-parent-label" shrink>
                            {wantsEpicParent ? 'Parent epic' : 'Parent story'}
                        </InputLabel>
                        {wantsEpicParent ? (
                            <Select
                                labelId="new-issue-parent-label"
                                label="Parent epic"
                                value={parentEpicId}
                                onChange={(e) => {
                                    setParentEpicId(e.target.value);
                                    touch('parent');
                                }}
                                onBlur={() => touch('parent')}
                                displayEmpty
                                renderValue={(v) => {
                                    if (!v) {
                                        return (
                                            <Box
                                                component="span"
                                                sx={{ color: ATLAS_PALETTE.slate40 }}
                                            >
                                                Select
                                            </Box>
                                        );
                                    }
                                    const epic = epicsForProject.find((x) => x.id === v);
                                    return epic?.title ?? '';
                                }}
                                sx={{ fontSize: 13, background: ATLAS_PALETTE.white }}
                            >
                                {epicsForProject.map((e) => (
                                    <MenuItem key={e.id} value={e.id} sx={{ fontSize: 13 }}>
                                        {e.title}
                                    </MenuItem>
                                ))}
                            </Select>
                        ) : (
                            <Select
                                labelId="new-issue-parent-label"
                                label="Parent story"
                                value={parentStoryId}
                                onChange={(e) => {
                                    setParentStoryId(e.target.value);
                                    touch('parent');
                                }}
                                onBlur={() => touch('parent')}
                                displayEmpty
                                renderValue={(v) => {
                                    if (!v) {
                                        return (
                                            <Box
                                                component="span"
                                                sx={{ color: ATLAS_PALETTE.slate40 }}
                                            >
                                                Select
                                            </Box>
                                        );
                                    }
                                    const story = storiesForProject.find((x) => x.id === v);
                                    return story?.title ?? '';
                                }}
                                sx={{ fontSize: 13, background: ATLAS_PALETTE.white }}
                            >
                                {storiesForProject.map((s) => (
                                    <MenuItem key={s.id} value={s.id} sx={{ fontSize: 13 }}>
                                        {s.title}
                                    </MenuItem>
                                ))}
                            </Select>
                        )}
                        <FormHelperText>
                            {showError('parent') ?? 'Never orphan — must hang off a parent.'}
                        </FormHelperText>
                    </FormControl>
                </Box>

                {/* Title */}
                <TextField
                    fullWidth
                    size="small"
                    required
                    label="Title"
                    placeholder={
                        kind === 'bug'
                            ? 'e.g. Backfill historical refunds doesn’t deduplicate'
                            : 'Short summary…'
                    }
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => touch('title')}
                    error={Boolean(showError('title'))}
                    helperText={showError('title')}
                    sx={{ ...inputSx, mb: 4 }}
                />

                {/* Description */}
                <TextField
                    fullWidth
                    multiline
                    required
                    label="Description"
                    minRows={3}
                    maxRows={6}
                    placeholder="What needs to happen and why…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => touch('description')}
                    error={Boolean(showError('description'))}
                    helperText={showError('description')}
                    sx={{ ...inputSx, mb: 4 }}
                />

                {/* Acceptance criteria */}
                {wantsAC && (
                    <TextField
                        fullWidth
                        multiline
                        required
                        label="Acceptance criteria"
                        minRows={3}
                        maxRows={6}
                        placeholder={'- Given …\n- When …\n- Then …'}
                        value={acceptanceCriteria}
                        onChange={(e) => setAcceptanceCriteria(e.target.value)}
                        onBlur={() => touch('acceptanceCriteria')}
                        error={Boolean(showError('acceptanceCriteria'))}
                        helperText={showError('acceptanceCriteria') ?? 'One per line.'}
                        sx={{ ...inputSx, mb: 4 }}
                    />
                )}

                {/* Bug-only fields */}
                {wantsBugFields && (
                    <>
                        <TextField
                            fullWidth
                            multiline
                            required
                            label="Steps to reproduce"
                            minRows={3}
                            maxRows={6}
                            placeholder={'1. Open Stripe dashboard\n2. Run backfill\n3. …'}
                            value={stepsToReproduce}
                            onChange={(e) => setStepsToReproduce(e.target.value)}
                            onBlur={() => touch('stepsToReproduce')}
                            error={Boolean(showError('stepsToReproduce'))}
                            helperText={showError('stepsToReproduce')}
                            sx={{ ...inputSx, mb: 4 }}
                        />
                        <Box
                            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, mb: 4 }}
                        >
                            <TextField
                                fullWidth
                                multiline
                                label="Expected"
                                minRows={2}
                                maxRows={4}
                                placeholder="What should happen"
                                value={expected}
                                onChange={(e) => setExpected(e.target.value)}
                                sx={inputSx}
                            />
                            <TextField
                                fullWidth
                                multiline
                                label="Actual"
                                minRows={2}
                                maxRows={4}
                                placeholder="What actually happens"
                                value={actual}
                                onChange={(e) => setActual(e.target.value)}
                                sx={inputSx}
                            />
                        </Box>
                        <Box
                            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, mb: 4 }}
                        >
                            <FormControl fullWidth size="small">
                                <InputLabel id="new-issue-frequency-label">Frequency</InputLabel>
                                <Select
                                    labelId="new-issue-frequency-label"
                                    label="Frequency"
                                    value={frequency}
                                    onChange={(e) =>
                                        setFrequency(e.target.value as BugFrequency)
                                    }
                                    sx={{ fontSize: 13, background: ATLAS_PALETTE.white }}
                                >
                                    {FREQUENCIES.map((f) => (
                                        <MenuItem key={f} value={f} sx={{ fontSize: 13 }}>
                                            {f}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl fullWidth size="small">
                                <InputLabel id="new-issue-scope-label">Failure scope</InputLabel>
                                <Select
                                    labelId="new-issue-scope-label"
                                    label="Failure scope"
                                    value={failureScope}
                                    onChange={(e) =>
                                        setFailureScope(e.target.value as BugFailureScope)
                                    }
                                    sx={{ fontSize: 13, background: ATLAS_PALETTE.white }}
                                >
                                    {FAILURE_SCOPES.map((f) => (
                                        <MenuItem key={f} value={f} sx={{ fontSize: 13 }}>
                                            {f}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Box>
                    </>
                )}

                {/* Reporter + Assignee */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, mt: 4, mb: 1 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel id="new-issue-reporter-label" shrink>
                            Reporter
                        </InputLabel>
                        <Select
                            labelId="new-issue-reporter-label"
                            label="Reporter"
                            value={reporterId}
                            onChange={() => setReporterId('owner')}
                            sx={{ fontSize: 13, background: ATLAS_PALETTE.white }}
                        >
                            <MenuItem value="owner" sx={{ fontSize: 13 }}>
                                sspart · Owner
                            </MenuItem>
                        </Select>
                    </FormControl>
                    <AgentSelect
                        agents={aiAgents}
                        value={assigneeId}
                        onChange={setAssigneeId}
                        label="Assignee"
                        placeholder="Search by name or designation…"
                        size="small"
                    />
                </Box>

                {errorMsg && (
                    <Typography sx={{ mt: 2, fontSize: 12, color: ATLAS_PALETTE.error }}>
                        {errorMsg}
                    </Typography>
                )}
            </Box>

            {/* Footer — Cancel + Create (always creates in Draft). */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 2,
                    px: 4,
                    py: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                }}
            >
                <Button
                    onClick={onClose}
                    sx={{ color: ATLAS_PALETTE.slate60, textTransform: 'none' }}
                    disabled={submitting}
                >
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={() => void submit()}
                    sx={{
                        textTransform: 'none',
                        background: ATLAS_PALETTE.green,
                        '&:hover': { background: ATLAS_PALETTE.greenDark },
                    }}
                    disabled={submitting}
                >
                    Create issue
                </Button>
            </Box>
        </Dialog>
    );
}

// Helper local alias so the create payload typechecks against the `Partial<IStory>`-like shapes
// that the api wrapper expects. We expand the wrapper types in api.ts at the call sites.
type IStoryStatus = string;
