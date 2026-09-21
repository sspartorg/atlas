import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import type {
    IProject,
    IProjectRepo,
    IProjectSchedule,
    ScheduleConflictPolicy,
} from '@atlas/shared';
import { useRepoSchedule, useSaveRepoSchedule } from '../../hooks/useProjectSchedule.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { SchedulePresetFields, SelectableCard } from '../../components/SchedulePresetFields.js';

interface Props {
    open: boolean;
    project: IProject | null;
    /** ADR 0018 — auto-fetch is per repo; the branch it pulls is this repo's. */
    repo: IProjectRepo | null;
    onClose: () => void;
}

const MONO = '"JetBrains Mono", monospace';

const POLICIES: Array<{ value: ScheduleConflictPolicy; label: string; sub: string }> = [
    { value: 'skip', label: 'Skip & notify', sub: 'default — leave folder alone' },
    { value: 'stash', label: 'Stash & merge', sub: 'auto-stash, ff-merge' },
    { value: 'abort', label: 'Abort & alert', sub: 'raise an error on the project' },
];

const GUARDS: Array<{
    key: 'skip_if_dirty' | 'pause_while_agents_active';
    label: string;
    sub: string;
}> = [
    {
        key: 'skip_if_dirty',
        label: 'Skip if working tree is dirty',
        sub: "we won't pull when you have uncommitted edits",
    },
    {
        key: 'pause_while_agents_active',
        label: 'Pause fetch while agents are active',
        sub: 'avoid mid-task branch shifts',
    },
];

function SectionHeader({ title, hint }: { title: string; hint: string }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: ATLAS_PALETTE.slate }}>
                {title}
            </Typography>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{hint}</Typography>
        </Box>
    );
}

function InlineTagAdornment({ tag }: { tag: string }) {
    return (
        <InputAdornment position="start">
            <Box
                sx={{
                    fontFamily: MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate60,
                    bgcolor: ATLAS_PALETTE.slate06,
                    px: 1,
                    py: 0.5,
                    borderRadius: '4px',
                    lineHeight: 1,
                }}
            >
                {tag}
            </Box>
        </InputAdornment>
    );
}

interface LabeledFieldProps {
    label: string;
    hint: string;
    tag: string;
    value: string;
    onChange?: ((next: string) => void) | undefined;
    readOnly?: boolean | undefined;
    mono?: boolean | undefined;
}

function LabeledField({ label, hint, tag, value, onChange, readOnly, mono }: LabeledFieldProps) {
    return (
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: ATLAS_PALETTE.slate }}>
                    {label}
                </Typography>
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>{hint}</Typography>
            </Box>
            <TextField
                fullWidth
                size="small"
                value={value}
                onChange={(e) => onChange?.(e.target.value)}
                slotProps={{
                    input: {
                        readOnly: readOnly ?? false,
                        startAdornment: <InlineTagAdornment tag={tag} />,
                    },
                }}
                inputProps={{
                    style: mono ? { fontFamily: MONO, fontSize: 13 } : { fontSize: 13 },
                }}
                sx={{
                    '& .MuiOutlinedInput-root': {
                        '& fieldset': { borderColor: ATLAS_PALETTE.slate10 },
                        '&:hover fieldset': { borderColor: ATLAS_PALETTE.slate30 },
                        '&.Mui-focused fieldset': { borderColor: ATLAS_PALETTE.brandBlue },
                    },
                }}
            />
        </Box>
    );
}

interface GuardRowProps {
    label: string;
    sub: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}

function GuardRow({ label, sub, checked, onChange, disabled }: GuardRowProps) {
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                py: 1.5,
                opacity: disabled ? 0.5 : 1,
                '&:not(:last-of-type)': {
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                },
            }}
        >
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {label}
                </Typography>
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 0.25 }}>
                    {sub}
                </Typography>
            </Box>
            <Switch
                checked={checked}
                onChange={(_, v) => onChange(v)}
                disabled={Boolean(disabled)}
            />
        </Box>
    );
}

export function AutoFetchScheduleModal({ open, project, repo, onClose }: Props) {
    const projectId = project?.id ?? null;
    const repoId = repo?.id ?? null;
    const { data: server, isLoading } = useRepoSchedule(projectId, repoId);
    const save = useSaveRepoSchedule(projectId ?? '', repoId ?? '');

    const [form, setForm] = useState<IProjectSchedule | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    useEffect(() => {
        if (server) setForm(server);
    }, [server]);
    useEffect(() => {
        if (!open) {
            setForm(null);
            setSaveError(null);
        }
    }, [open]);

    if (!project || !repo) return null;
    const f = form ?? server;
    const enabled = f?.enabled ?? false;

    function update<K extends keyof IProjectSchedule>(k: K, v: IProjectSchedule[K]) {
        setForm((prev) => (prev ? { ...prev, [k]: v } : prev));
    }

    async function handleSave(nextEnabled: boolean) {
        if (!f || !projectId || !repoId) return;
        setSaveError(null);
        try {
            await save.mutateAsync({
                enabled: nextEnabled,
                preset: f.preset,
                time_of_day: f.time_of_day,
                weekday: f.weekday,
                cron_expression: f.cron_expression,
                skip_if_dirty: f.skip_if_dirty,
                pause_while_agents_active: f.pause_while_agents_active,
                conflict_policy: f.conflict_policy,
            });
            onClose();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        }
    }

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
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
            <Box sx={{ p: 4 }}>
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5, mb: 3 }}>
                    <Box
                        sx={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            bgcolor: enabled ? 'rgba(49,171,70,.14)' : 'rgba(0,122,201,.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        {enabled ? (
                            <CheckCircleOutline
                                sx={{ color: ATLAS_PALETTE.success, fontSize: 22 }}
                            />
                        ) : (
                            <ScheduleRounded
                                sx={{ color: ATLAS_PALETTE.brandBlue, fontSize: 22 }}
                            />
                        )}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            sx={{ fontSize: 17, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                        >
                            {enabled ? 'Auto-fetch enabled' : 'Auto-fetch schedule'}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                            {project.name} ·{' '}
                            <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                                {repo.name}
                            </Box>{' '}
                            pulls{' '}
                            <Box component="span" sx={{ fontFamily: MONO, fontWeight: 600 }}>
                                origin/{repo.default_branch}
                            </Box>{' '}
                            in the background
                        </Typography>
                    </Box>
                    <IconButton onClick={onClose} size="small" sx={{ mt: -0.5 }}>
                        <CloseRounded />
                    </IconButton>
                </Box>

                {isLoading || !f ? (
                    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                        <CircularProgress size={20} sx={{ color: ATLAS_PALETTE.brandBlue }} />
                    </Box>
                ) : (
                    <>
                        {/* Enable row */}
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 2,
                                p: 2,
                                mb: 3,
                                bgcolor: enabled ? 'rgba(0,122,201,.05)' : ATLAS_PALETTE.white,
                                border: `1px solid ${
                                    enabled ? 'rgba(0,122,201,.22)' : ATLAS_PALETTE.slate10
                                }`,
                                borderRadius: '10px',
                            }}
                        >
                            <Switch
                                checked={enabled}
                                onChange={(_, v) => update('enabled', v)}
                                sx={{ mt: -0.5 }}
                            />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: ATLAS_PALETTE.slate,
                                    }}
                                >
                                    Enable scheduled auto-fetch
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate60,
                                        mt: 0.5,
                                    }}
                                >
                                    Atlas runs{' '}
                                    <Box component="span" sx={{ fontFamily: MONO }}>
                                        git fetch &amp;&amp; git merge --ff-only
                                    </Box>{' '}
                                    on the default branch
                                </Typography>
                            </Box>
                        </Box>

                        {/* Schedule presets */}
                        <SectionHeader title="Schedule" hint="when to pull" />
                        <SchedulePresetFields
                            value={{
                                preset: f.preset,
                                weekday: f.weekday,
                                cronExpression: f.cron_expression,
                            }}
                            onChange={(patch) => {
                                if (patch.preset) update('preset', patch.preset);
                                if (patch.weekday !== undefined) update('weekday', patch.weekday);
                                if (patch.cronExpression !== undefined) {
                                    update('cron_expression', patch.cronExpression);
                                }
                            }}
                        />

                        {/* Time of day + Branch */}
                        <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
                            <LabeledField
                                label="Time of day"
                                hint="machine local time"
                                tag="schedule"
                                value={f.time_of_day}
                                onChange={(v) => update('time_of_day', v)}
                                mono
                            />
                            <LabeledField
                                label="Branch"
                                hint="locked to the repo's default branch"
                                tag="git_branch"
                                value={repo.default_branch}
                                readOnly
                            />
                        </Box>

                        {/* Guards */}
                        <Box sx={{ mb: 3 }}>
                            {GUARDS.map(({ key, label, sub }) => {
                                // skip_if_dirty is meaningless unless conflict
                                // policy is also `skip` — the stash/abort
                                // policies own the dirty-tree decision in the
                                // runner script.
                                const isSkipIfDirty = key === 'skip_if_dirty';
                                const overriddenByPolicy =
                                    isSkipIfDirty && f.conflict_policy !== 'skip';
                                const effectiveSub = overriddenByPolicy
                                    ? `overridden — "${POLICIES.find((p) => p.value === f.conflict_policy)?.label ?? 'policy'}" handles dirty trees`
                                    : sub;
                                return (
                                    <GuardRow
                                        key={key}
                                        label={label}
                                        sub={effectiveSub}
                                        checked={f[key]}
                                        onChange={(v) => update(key, v)}
                                        disabled={overriddenByPolicy}
                                    />
                                );
                            })}
                        </Box>

                        {/* On conflict */}
                        <SectionHeader
                            title="On conflict"
                            hint="when fast-forward isn't possible"
                        />
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, 1fr)',
                                gap: 1.5,
                                mb: 4,
                            }}
                        >
                            {POLICIES.map((p) => (
                                <SelectableCard
                                    key={p.value}
                                    title={p.label}
                                    sub={p.sub}
                                    selected={f.conflict_policy === p.value}
                                    onClick={() => update('conflict_policy', p.value)}
                                />
                            ))}
                        </Box>

                        {/* Save error */}
                        {saveError && (
                            <Box
                                role="alert"
                                sx={{
                                    mb: 2,
                                    px: 2,
                                    py: 1,
                                    borderRadius: '8px',
                                    bgcolor: 'rgba(199,83,47,.08)',
                                    border: '1px solid rgba(199,83,47,.20)',
                                    color: ATLAS_PALETTE.error,
                                    fontSize: 12,
                                }}
                            >
                                {saveError}
                            </Box>
                        )}

                        {/* Footer */}
                        <Box
                            sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                pt: 3,
                                borderTop: `1px solid ${ATLAS_PALETTE.slate10}`,
                            }}
                        >
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                {server?.enabled && (
                                    <Button
                                        onClick={() => void handleSave(false)}
                                        disabled={save.isPending}
                                        sx={{
                                            textTransform: 'none',
                                            color: ATLAS_PALETTE.slate60,
                                            fontWeight: 500,
                                        }}
                                    >
                                        Turn off
                                    </Button>
                                )}
                                <Button
                                    onClick={onClose}
                                    sx={{
                                        textTransform: 'none',
                                        color: ATLAS_PALETTE.slate60,
                                        fontWeight: 500,
                                    }}
                                >
                                    Cancel
                                </Button>
                            </Box>
                            <Button
                                variant="contained"
                                onClick={() => void handleSave(true)}
                                disabled={save.isPending}
                                startIcon={
                                    save.isPending ? (
                                        <CircularProgress size={14} color="inherit" />
                                    ) : (
                                        <CheckCircleOutline sx={{ fontSize: 18 }} />
                                    )
                                }
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    bgcolor: ATLAS_PALETTE.success,
                                    '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                                    px: 2.5,
                                }}
                            >
                                {server?.enabled ? 'Done' : 'Save schedule'}
                            </Button>
                        </Box>
                    </>
                )}
            </Box>
        </Dialog>
    );
}
