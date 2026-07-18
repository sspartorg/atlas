import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import type { IAgent } from '@atlas/shared';
import { useUpdateAgent } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY, MOTION, MOTION_EASING } from '../../theme/tokens.js';
import type { AgentView, ScheduleDraftPreset } from './agentViewModel.js';
import {
    previewNextSlot,
    formatNextPassDelta,
    isCronExpressionValid,
} from './agentViewModel.js';
import { ModelSelect } from '../../components/ModelSelect.js';
import { FormSection, FormRow } from '../../components/FormSection.js';
import { api } from '../../api/api.js';

interface Props {
    agent: IAgent;
    view: AgentView;
}

interface ScheduleDraft {
    // The fifth value 'cron' is UI-only; on save we map it back to the
    // persisted `cron_expr` column and leave `schedule_preset` untouched
    // so toggling cron off restores the previous clock preset cleanly.
    preset: ScheduleDraftPreset;
    hours: number;
    hoursInput: string;
    timeOfDay: string;
    weekdays: number[];
    dayOfMonth: number;
    cronExpr: string;
}

// ISO weekday display rows, ordered Mon→Sun.
const WEEKDAYS: { iso: number; short: string; full: string }[] = [
    { iso: 1, short: 'M', full: 'Mon' },
    { iso: 2, short: 'T', full: 'Tue' },
    { iso: 3, short: 'W', full: 'Wed' },
    { iso: 4, short: 'T', full: 'Thu' },
    { iso: 5, short: 'F', full: 'Fri' },
    { iso: 6, short: 'S', full: 'Sat' },
    { iso: 7, short: 'S', full: 'Sun' },
];

const PRESETS: { id: ScheduleDraftPreset; title: string; sub: string }[] = [
    { id: 'every_n_hours', title: 'Every N hours', sub: 'Fires on a fixed interval — the original cadence.' },
    { id: 'daily', title: 'Daily', sub: 'Fires once a day at the same time.' },
    { id: 'weekly', title: 'Weekly', sub: 'Fires on selected days of the week at the same time.' },
    { id: 'monthly', title: 'Monthly', sub: 'Fires once a month on the chosen day — clamps to the last day in short months.' },
    {
        id: 'cron',
        title: 'Custom cron',
        sub: 'Fires on any croner-compatible expression — for cadences the four presets above can\'t express.',
    },
];

const DEFAULT_CRON = '0 9 * * 1-5';

export function OverviewTabContent({ agent, view }: Props) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const [description, setDescription] = useState(view.description);
    const [editingDescription, setEditingDescription] = useState(false);
    const [cli, setCli] = useState(agent.cli);
    const [model, setModel] = useState(agent.model);
    const [effort, setEffort] = useState<IAgent['effort']>(agent.effort ?? 'medium');
    const [concurrentRuns, setConcurrentRuns] = useState(view.concurrentRuns);

    // Schedule draft state. Inactive presets keep their values so cycling
    // through them in the picker is non-destructive until Save. The active
    // preset is inferred: if the persisted row carries a non-empty
    // cron_expr, the cron card is active; otherwise the saved preset.
    const initialCron = agent.cron_expr?.trim() ?? '';
    const initialPreset: ScheduleDraftPreset =
        initialCron !== '' ? 'cron' : (agent.schedule_preset ?? 'every_n_hours');
    const [draft, setDraft] = useState<ScheduleDraft>(() => ({
        preset: initialPreset,
        hours: view.cadenceHours,
        hoursInput: String(view.cadenceHours),
        timeOfDay: agent.schedule_time_of_day ?? '09:00',
        weekdays:
            agent.schedule_weekdays && agent.schedule_weekdays.length > 0
                ? [...agent.schedule_weekdays]
                : [1, 2, 3, 4, 5],
        dayOfMonth: agent.schedule_day_of_month ?? 1,
        cronExpr: initialCron !== '' ? initialCron : DEFAULT_CRON,
    }));

    const hoursValid = draft.hoursInput.trim() !== '' && Number(draft.hoursInput) > 0;
    const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(draft.timeOfDay);
    const cronValid = draft.preset === 'cron' ? isCronExpressionValid(draft.cronExpr) : true;
    const presetValid =
        (draft.preset === 'every_n_hours' && hoursValid) ||
        (draft.preset === 'daily' && timeValid) ||
        (draft.preset === 'weekly' && timeValid && draft.weekdays.length > 0) ||
        (draft.preset === 'monthly' &&
            timeValid &&
            draft.dayOfMonth >= 1 &&
            draft.dayOfMonth <= 31) ||
        (draft.preset === 'cron' && cronValid);

    const scheduleDirty =
        draft.preset !== initialPreset ||
        (draft.preset === 'every_n_hours' && draft.hours !== view.cadenceHours) ||
        (draft.preset === 'daily' &&
            draft.timeOfDay !== (agent.schedule_time_of_day ?? '09:00')) ||
        (draft.preset === 'weekly' &&
            (draft.timeOfDay !== (agent.schedule_time_of_day ?? '09:00') ||
                !sameWeekdays(draft.weekdays, agent.schedule_weekdays))) ||
        (draft.preset === 'monthly' &&
            (draft.timeOfDay !== (agent.schedule_time_of_day ?? '09:00') ||
                draft.dayOfMonth !== (agent.schedule_day_of_month ?? 1))) ||
        (draft.preset === 'cron' && draft.cronExpr.trim() !== initialCron);

    const isDirty =
        cli !== agent.cli ||
        model !== agent.model ||
        effort !== (agent.effort ?? 'medium') ||
        concurrentRuns !== view.concurrentRuns ||
        scheduleDirty;

    // Live preview of next fire — runs against the current draft.
    const nextSlot = useMemo(() => {
        if (!presetValid) return null;
        try {
            return previewNextSlot(new Date(), {
                preset: draft.preset,
                hours: draft.hours,
                timeOfDay: draft.timeOfDay,
                weekdays: draft.weekdays,
                dayOfMonth: draft.dayOfMonth,
                cronExpr: draft.cronExpr,
            });
        } catch {
            return null;
        }
    }, [draft, presetValid]);
    const nextSlotDelta = nextSlot
        ? formatNextPassDelta(nextSlot.getTime() - Date.now())
        : '—';
    const nextSlotAbsolute = nextSlot ? formatNextSlotAbsolute(nextSlot) : '';

    function handleSaveConfig() {
        const scheduleFields = buildScheduleUpdate(draft);
        updateAgent.mutate(
            {
                id: agent.id,
                data: {
                    cli,
                    model,
                    effort,
                    concurrent_runs: concurrentRuns,
                    ...scheduleFields,
                },
            },
            { onSuccess: () => toast.show({ message: 'Configuration saved' }) },
        );
    }

    function handleSaveDescription(next: string) {
        updateAgent.mutate(
            { id: agent.id, data: { description: next } },
            {
                onSuccess: () => {
                    toast.show({ message: 'Description saved' });
                    setEditingDescription(false);
                },
            },
        );
    }

    function handleDiscard() {
        setCli(agent.cli);
        setModel(agent.model);
        setConcurrentRuns(view.concurrentRuns);
        setDraft({
            preset: initialPreset,
            hours: view.cadenceHours,
            hoursInput: String(view.cadenceHours),
            timeOfDay: agent.schedule_time_of_day ?? '09:00',
            weekdays:
                agent.schedule_weekdays && agent.schedule_weekdays.length > 0
                    ? [...agent.schedule_weekdays]
                    : [1, 2, 3, 4, 5],
            dayOfMonth: agent.schedule_day_of_month ?? 1,
            cronExpr: initialCron !== '' ? initialCron : DEFAULT_CRON,
        });
    }

    return (
        <Box>
            <FormSection label="Description">
                {editingDescription ? (
                    <Box>
                        <TextField
                            fullWidth
                            multiline
                            minRows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            sx={{ '& .MuiOutlinedInput-root': { fontSize: 13.5 } }}
                        />
                        <Box
                            sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1.5 }}
                        >
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={() => {
                                    setDescription(view.description);
                                    setEditingDescription(false);
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={() => handleSaveDescription(description)}
                                disabled={
                                    updateAgent.isPending || description === view.description
                                }
                            >
                                {updateAgent.isPending ? 'Saving…' : 'Save'}
                            </Button>
                        </Box>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                        <Typography
                            sx={{
                                flex: 1,
                                fontSize: 13.5,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: 1.6,
                            }}
                        >
                            {description}
                        </Typography>
                        <IconButton
                            size="small"
                            onClick={() => setEditingDescription(true)}
                            sx={{ color: ATLAS_PALETTE.slate60 }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{ fontSize: 18 }}
                            >
                                edit
                            </Box>
                        </IconButton>
                    </Box>
                )}
            </FormSection>

            <RoleSection agent={agent} />

            <CommitDisciplineTile agentId={agent.id} />

            <FormSection label="Configuration">
                <FormRow label="CLI">
                    <Select
                        size="small"
                        value={cli}
                        onChange={(e) => setCli(e.target.value as IAgent['cli'])}
                        fullWidth
                        sx={{
                            fontSize: 13.5,
                            '& .MuiOutlinedInput-input': {
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12.5,
                                py: 1,
                            },
                        }}
                    >
                        <MenuItem value="claude">claude</MenuItem>
                        <MenuItem value="copilot">copilot</MenuItem>
                    </Select>
                </FormRow>
                <FormRow label="Model">
                    <ModelSelect
                        cli={cli}
                        value={model}
                        onChange={setModel}
                        fullWidth
                        size="dense"
                    />
                </FormRow>
                <FormRow label="Effort">
                    <Select
                        size="small"
                        value={effort}
                        onChange={(e) => setEffort(e.target.value as IAgent['effort'])}
                        fullWidth
                        sx={{
                            fontSize: 13.5,
                            '& .MuiOutlinedInput-input': {
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12.5,
                                py: 1,
                            },
                        }}
                    >
                        <MenuItem value="none">none</MenuItem>
                        <MenuItem value="low">low</MenuItem>
                        <MenuItem value="medium">medium</MenuItem>
                        <MenuItem value="high">high</MenuItem>
                        <MenuItem value="xhigh">xhigh</MenuItem>
                        <MenuItem value="max">max</MenuItem>
                    </Select>
                </FormRow>
                <FormRow label="Schedule">
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {PRESETS.map((p) => {
                            const active = draft.preset === p.id;
                            return (
                                <SchedulePresetCard
                                    key={p.id}
                                    active={active}
                                    title={p.title}
                                    subtitle={p.sub}
                                    summary={renderPresetSummary(p.id, draft)}
                                    onSelect={() =>
                                        setDraft((d) => ({ ...d, preset: p.id }))
                                    }
                                >
                                    {active && p.id === 'every_n_hours' ? (
                                        <EveryNHoursControls
                                            draft={draft}
                                            setDraft={setDraft}
                                            valid={hoursValid}
                                        />
                                    ) : null}
                                    {active && p.id === 'daily' ? (
                                        <DailyControls draft={draft} setDraft={setDraft} />
                                    ) : null}
                                    {active && p.id === 'weekly' ? (
                                        <WeeklyControls draft={draft} setDraft={setDraft} />
                                    ) : null}
                                    {active && p.id === 'monthly' ? (
                                        <MonthlyControls draft={draft} setDraft={setDraft} />
                                    ) : null}
                                    {active && p.id === 'cron' ? (
                                        <CronControls
                                            draft={draft}
                                            setDraft={setDraft}
                                            valid={cronValid}
                                        />
                                    ) : null}
                                    {active && nextSlot ? (
                                        <NextPassPreview
                                            absolute={nextSlotAbsolute}
                                            delta={nextSlotDelta}
                                        />
                                    ) : null}
                                </SchedulePresetCard>
                            );
                        })}
                    </Box>
                </FormRow>
                <FormRow label="Concurrent runs">
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            columnGap: 1,
                            rowGap: 0.75,
                        }}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                flexShrink: 0,
                            }}
                        >
                            <IconButton
                                size="small"
                                onClick={() => setConcurrentRuns((n) => Math.max(1, n - 1))}
                                sx={{ width: 28, height: 28, color: ATLAS_PALETTE.slate60 }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    remove
                                </Box>
                            </IconButton>
                            <Typography
                                sx={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    minWidth: 40,
                                    px: 1,
                                    textAlign: 'center',
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                }}
                            >
                                {concurrentRuns}
                            </Typography>
                            <IconButton
                                size="small"
                                onClick={() =>
                                    setConcurrentRuns((n) => Math.min(view.concurrentMax, n + 1))
                                }
                                sx={{ width: 28, height: 28, color: ATLAS_PALETTE.slate60 }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 16 }}
                                >
                                    add
                                </Box>
                            </IconButton>
                        </Box>
                        <Typography
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate40,
                                ml: { xs: 0, md: 1 },
                                flexBasis: { xs: '100%', md: 'auto' },
                            }}
                        >
                            Max {view.concurrentMax}
                        </Typography>
                    </Box>
                </FormRow>

                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 1.5,
                        mt: 2,
                    }}
                >
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {isDirty ? 'Unsaved changes' : 'No changes'}
                    </Typography>
                    {isDirty ? (
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 1.5,
                                justifyContent: { xs: 'stretch', sm: 'flex-end' },
                                flexDirection: { xs: 'column', sm: 'row' },
                            }}
                        >
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={handleDiscard}
                                sx={{ textTransform: 'none' }}
                            >
                                Discard
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={handleSaveConfig}
                                disabled={!presetValid || updateAgent.isPending}
                                sx={{
                                    textTransform: 'none',
                                    bgcolor: ATLAS_PALETTE.green,
                                    '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                                }}
                            >
                                Save changes
                            </Button>
                        </Box>
                    ) : null}
                </Box>
            </FormSection>
        </Box>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Picker primitives
// ──────────────────────────────────────────────────────────────────────────

interface SchedulePresetCardProps {
    active: boolean;
    title: string;
    subtitle: string;
    summary: string;
    onSelect: () => void;
    children?: React.ReactNode;
}

function SchedulePresetCard({
    active,
    title,
    subtitle,
    summary,
    onSelect,
    children,
}: SchedulePresetCardProps) {
    return (
        <Box
            onClick={active ? undefined : onSelect}
            role="button"
            tabIndex={active ? -1 : 0}
            onKeyDown={(e) => {
                if (!active && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelect();
                }
            }}
            sx={{
                position: 'relative',
                borderRadius: '10px',
                // Selection signal is JUST the border color stepping from
                // slate10 (inactive) → slate60 (active). No accent bar, no
                // tinted background — just a darker outline.
                border: `1px solid ${active ? ATLAS_PALETTE.slate60 : ATLAS_PALETTE.slate10}`,
                bgcolor: ATLAS_PALETTE.white,
                px: 2,
                py: active ? 2 : 1.5,
                cursor: active ? 'default' : 'pointer',
                transition: `border-color ${MOTION.dropdown}ms ${MOTION_EASING.standard}, padding ${MOTION.dropdown}ms ${MOTION_EASING.standard}`,
                '&:hover': active
                    ? undefined
                    : {
                          borderColor: ATLAS_PALETTE.slate40,
                      },
                '&:focus-visible': {
                    outline: `2px solid ${ATLAS_PALETTE.slate60}`,
                    outlineOffset: 2,
                },
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 2,
                }}
            >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: active ? 14.5 : 13.5,
                            fontWeight: active ? 600 : 500,
                            color: active ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate80,
                            letterSpacing: active ? '-0.005em' : 0,
                            transition: `font-size ${MOTION.dropdown}ms ${MOTION_EASING.standard}, color ${MOTION.dropdown}ms ${MOTION_EASING.standard}`,
                        }}
                    >
                        {title}
                    </Typography>
                    {active ? (
                        <Typography
                            sx={{
                                fontSize: 11.5,
                                color: ATLAS_PALETTE.slate60,
                                mt: 0.25,
                                lineHeight: 1.4,
                            }}
                        >
                            {subtitle}
                        </Typography>
                    ) : (
                        <Typography
                            sx={{
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate60,
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                mt: 0.25,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {summary}
                        </Typography>
                    )}
                </Box>
                {!active ? (
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{
                            fontSize: 18,
                            color: ATLAS_PALETTE.slate40,
                            flexShrink: 0,
                        }}
                        aria-hidden="true"
                    >
                        chevron_right
                    </Box>
                ) : null}
            </Box>
            {active && children ? (
                <Box sx={{ mt: 2 }}>
                    <Box
                        sx={{
                            borderRadius: '8px',
                            border: `1px solid ${ATLAS_PALETTE.slate10}`,
                            bgcolor: ATLAS_PALETTE.white,
                            p: 2,
                        }}
                    >
                        {children}
                    </Box>
                </Box>
            ) : null}
        </Box>
    );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return (
        <Typography
            sx={{
                fontSize: 10.5,
                fontWeight: 600,
                color: ATLAS_PALETTE.slate60,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                mb: 1,
            }}
        >
            {children}
        </Typography>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Per-preset control blocks
// ──────────────────────────────────────────────────────────────────────────

function EveryNHoursControls({
    draft,
    setDraft,
    valid,
}: {
    draft: ScheduleDraft;
    setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
    valid: boolean;
}) {
    return (
        <Box>
            <FieldLabel>Interval</FieldLabel>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    Every
                </Typography>
                <TextField
                    size="small"
                    type="number"
                    value={draft.hoursInput}
                    onChange={(e) => {
                        const raw = e.target.value;
                        const n = Number(raw);
                        setDraft((d) => ({
                            ...d,
                            hoursInput: raw,
                            ...(raw.trim() !== '' && n > 0 ? { hours: n } : {}),
                        }));
                    }}
                    onBlur={() =>
                        setDraft((d) =>
                            d.hoursInput.trim() === '' || Number(d.hoursInput) <= 0
                                ? { ...d, hoursInput: String(d.hours) }
                                : d,
                        )
                    }
                    error={!valid}
                    inputProps={{
                        min: 0.5,
                        max: 168,
                        step: 0.5,
                    }}
                    sx={{
                        width: 96,
                        // Kill the browser's native up/down spinner buttons.
                        // They overlap a centered, bold mono digit and the
                        // value is more comfortable to type than to click.
                        '& input[type=number]': {
                            MozAppearance: 'textfield',
                            textAlign: 'center',
                            fontFamily: TYPOGRAPHY.fontFamilyMono,
                            fontSize: 16,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                        },
                        '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button':
                            {
                                WebkitAppearance: 'none',
                                margin: 0,
                            },
                    }}
                />
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    hours
                </Typography>
            </Box>
            <Typography
                sx={{
                    fontSize: 11.5,
                    color: ATLAS_PALETTE.slate40,
                    mt: 1,
                }}
            >
                0.5 (30 min) – 168 (one week). Step 0.5 h.
            </Typography>
        </Box>
    );
}

function DailyControls({
    draft,
    setDraft,
}: {
    draft: ScheduleDraft;
    setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
}) {
    return (
        <Box>
            <FieldLabel>Time of day</FieldLabel>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                    at
                </Typography>
                <TimeInput
                    value={draft.timeOfDay}
                    onChange={(t) => setDraft((d) => ({ ...d, timeOfDay: t }))}
                />
            </Box>
        </Box>
    );
}

function WeeklyControls({
    draft,
    setDraft,
}: {
    draft: ScheduleDraft;
    setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
}) {
    function toggleDay(iso: number) {
        setDraft((d) => {
            const has = d.weekdays.includes(iso);
            const next = has ? d.weekdays.filter((x) => x !== iso) : [...d.weekdays, iso];
            // Disallow zeroing out — keep the previous selection if user
            // tries to deselect their last day.
            if (next.length === 0) return d;
            return { ...d, weekdays: next.sort((a, b) => a - b) };
        });
    }
    return (
        <Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                    <FieldLabel>Time of day</FieldLabel>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            at
                        </Typography>
                        <TimeInput
                            value={draft.timeOfDay}
                            onChange={(t) => setDraft((d) => ({ ...d, timeOfDay: t }))}
                        />
                    </Box>
                </Box>
                <Box>
                    <FieldLabel>Days of week</FieldLabel>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        {WEEKDAYS.map((d) => {
                            const active = draft.weekdays.includes(d.iso);
                            return (
                                <Box
                                    key={d.iso}
                                    role="button"
                                    aria-pressed={active}
                                    aria-label={d.full}
                                    tabIndex={0}
                                    onClick={() => toggleDay(d.iso)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            toggleDay(d.iso);
                                        }
                                    }}
                                    sx={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: '50%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        fontSize: 12.5,
                                        fontWeight: 700,
                                        letterSpacing: '0.02em',
                                        userSelect: 'none',
                                        border: `1.5px solid ${
                                            active
                                                ? ATLAS_PALETTE.green
                                                : ATLAS_PALETTE.slate10
                                        }`,
                                        bgcolor: active
                                            ? ATLAS_PALETTE.green
                                            : ATLAS_PALETTE.white,
                                        color: active
                                            ? ATLAS_PALETTE.white
                                            : ATLAS_PALETTE.slate60,
                                        transition: `all ${MOTION.micro}ms ${MOTION_EASING.standard}`,
                                        '&:hover': active
                                            ? { bgcolor: ATLAS_PALETTE.greenDark }
                                            : {
                                                  borderColor: ATLAS_PALETTE.slate30,
                                                  color: ATLAS_PALETTE.slate,
                                              },
                                        '&:focus-visible': {
                                            outline: `2px solid ${ATLAS_PALETTE.green}`,
                                            outlineOffset: 2,
                                        },
                                    }}
                                >
                                    {d.short}
                                </Box>
                            );
                        })}
                    </Box>
                    <Typography
                        sx={{
                            fontSize: 11.5,
                            color: ATLAS_PALETTE.slate40,
                            mt: 1,
                        }}
                    >
                        Tap to toggle. At least one day required.
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
}

function MonthlyControls({
    draft,
    setDraft,
}: {
    draft: ScheduleDraft;
    setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
}) {
    return (
        <Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                    <FieldLabel>Time of day</FieldLabel>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            at
                        </Typography>
                        <TimeInput
                            value={draft.timeOfDay}
                            onChange={(t) => setDraft((d) => ({ ...d, timeOfDay: t }))}
                        />
                    </Box>
                </Box>
                <Box>
                    <FieldLabel>Day of month</FieldLabel>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            on day
                        </Typography>
                        <Select
                            size="small"
                            value={draft.dayOfMonth}
                            onChange={(e) =>
                                setDraft((d) => ({ ...d, dayOfMonth: Number(e.target.value) }))
                            }
                            sx={{
                                fontSize: 14,
                                minWidth: 84,
                                '& .MuiOutlinedInput-input': {
                                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                                    fontSize: 16,
                                    fontWeight: 600,
                                    color: ATLAS_PALETTE.slate,
                                    py: 1,
                                    textAlign: 'center',
                                },
                            }}
                        >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                                <MenuItem key={n} value={n}>
                                    {n}
                                </MenuItem>
                            ))}
                        </Select>
                    </Box>
                    <Typography
                        sx={{
                            fontSize: 11.5,
                            color: ATLAS_PALETTE.slate40,
                            mt: 1,
                        }}
                    >
                        Days 29–31 clamp to the month's last day (Feb 28/29 in leap years).
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
}

function CronControls({
    draft,
    setDraft,
    valid,
}: {
    draft: ScheduleDraft;
    setDraft: React.Dispatch<React.SetStateAction<ScheduleDraft>>;
    valid: boolean;
}) {
    const trimmed = draft.cronExpr.trim();
    const showError = trimmed !== '' && !valid;
    return (
        <Box>
            <FieldLabel>Expression</FieldLabel>
            <TextField
                size="small"
                fullWidth
                value={draft.cronExpr}
                onChange={(e) => setDraft((d) => ({ ...d, cronExpr: e.target.value }))}
                error={showError}
                placeholder="0 9 * * 1-5"
                helperText={
                    showError
                        ? "Croner can't parse this expression."
                        : 'Five fields: minute hour day-of-month month day-of-week. e.g. 0 9 * * 1-5 = Mon–Fri 9 AM.'
                }
                inputProps={{ maxLength: 200 }}
                sx={{
                    '& .MuiOutlinedInput-input': {
                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                        fontSize: 14,
                        fontWeight: 500,
                        color: ATLAS_PALETTE.slate,
                    },
                }}
            />
        </Box>
    );
}

function TimeInput({
    value,
    onChange,
}: {
    value: string;
    onChange: (t: string) => void;
}) {
    return (
        <TextField
            size="small"
            type="time"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputProps={{
                step: 60,
            }}
            sx={{
                width: 160,
                '& .MuiOutlinedInput-root': {
                    bgcolor: ATLAS_PALETTE.white,
                },
                // Don't center the text — the browser's native clock-picker
                // indicator sits at the right edge and centering causes the
                // HH:MM to drift into its hit area. Left-align with mono so
                // the time and the icon stay in their own lanes.
                '& input[type=time]': {
                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                    fontSize: 16,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate,
                    letterSpacing: '0.04em',
                    textAlign: 'left',
                    paddingRight: '8px',
                },
                '& input[type=time]::-webkit-calendar-picker-indicator': {
                    cursor: 'pointer',
                    opacity: 0.6,
                    marginLeft: '4px',
                },
            }}
        />
    );
}

function NextPassPreview({ absolute, delta }: { absolute: string; delta: string }) {
    return (
        <Box
            sx={{
                mt: 2,
                pt: 1.5,
                borderTop: `1px dashed ${ATLAS_PALETTE.slate10}`,
                display: 'flex',
                alignItems: 'baseline',
                gap: 1.25,
                flexWrap: 'wrap',
            }}
        >
            <Typography
                sx={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: ATLAS_PALETTE.slate60,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                }}
            >
                Next pass
            </Typography>
            <Typography
                sx={{
                    fontSize: 13,
                    color: ATLAS_PALETTE.slate,
                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                    fontWeight: 600,
                }}
            >
                {absolute}
            </Typography>
            <Typography
                sx={{
                    fontSize: 12,
                    color: ATLAS_PALETTE.green,
                    fontFamily: TYPOGRAPHY.fontFamilyMono,
                }}
            >
                · {delta}
            </Typography>
        </Box>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// One-line summary of what each preset WOULD do under the current draft
// state. Used for inactive cards so the user can see "if I pick this, here's
// what it'd be" without expanding.
function renderPresetSummary(id: ScheduleDraftPreset, draft: ScheduleDraft): string {
    if (id === 'every_n_hours') {
        const h = draft.hours;
        if (h < 1) return `every ${Math.round(h * 60)}m`;
        if (h === 1) return 'every hour';
        if (h < 24) return `every ${h}h`;
        return `every ${Math.round(h / 24)}d`;
    }
    if (id === 'cron') {
        const expr = draft.cronExpr.trim();
        return expr === '' ? 'cron expression…' : `cron: ${expr}`;
    }
    const time = formatTimeOfDay12h(draft.timeOfDay);
    if (id === 'daily') return `every day at ${time}`;
    if (id === 'weekly') {
        const days = formatWeekdaysShort(draft.weekdays);
        return `${days} at ${time}`;
    }
    return `day ${draft.dayOfMonth} of the month at ${time}`;
}

function formatTimeOfDay12h(hhmm: string): string {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
    if (!m) return hhmm;
    const h = Number(m[1]);
    const mm = m[2];
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${suffix}`;
}

const SHORT_WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; // ISO 1..7

function formatWeekdaysShort(iso: number[]): string {
    const sorted = [...iso].sort((a, b) => a - b);
    if (sorted.length === 7) return 'every day';
    if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) return 'weekdays';
    if (sorted.length === 2 && sorted[0] === 6 && sorted[1] === 7) return 'weekends';
    return sorted.map((d) => SHORT_WEEKDAY[d]).join(' · ');
}

// Format the next-fire date for the active card preview. Today / Tomorrow /
// dayname for nearby fires; abbreviated month for further out.
function formatNextSlotAbsolute(when: Date): string {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const whenStart = new Date(when);
    whenStart.setHours(0, 0, 0, 0);
    const dayDelta = Math.round(
        (whenStart.getTime() - todayStart.getTime()) / 86_400_000,
    );
    const hh = when.getHours().toString().padStart(2, '0');
    const mm = when.getMinutes().toString().padStart(2, '0');
    if (dayDelta === 0) return `today ${hh}:${mm}`;
    if (dayDelta === 1) return `tomorrow ${hh}:${mm}`;
    if (dayDelta < 7) {
        const dayName = SHORT_WEEKDAY[isoWeekday(when)];
        return `${dayName} ${hh}:${mm}`;
    }
    const monthName = when.toLocaleString(undefined, { month: 'short' });
    return `${monthName} ${when.getDate()} · ${hh}:${mm}`;
}

function isoWeekday(d: Date): number {
    const dow = d.getDay();
    return dow === 0 ? 7 : dow;
}

function sameWeekdays(
    next: number[],
    stored: number[] | null | undefined,
): boolean {
    if (!stored || stored.length === 0) return next.length === 0;
    if (next.length !== stored.length) return false;
    const a = [...next].sort();
    const b = [...stored].sort();
    return a.every((v, i) => v === b[i]);
}

function buildScheduleUpdate(draft: ScheduleDraft): Partial<IAgent> {
    // When switching away from cron, clear `cron_expr` so the preset is
    // not still being overridden by a stale expression. When switching to
    // cron, set `cron_expr` and leave the clock-preset fields untouched so
    // toggling cron back off restores the previous schedule.
    if (draft.preset === 'cron') {
        return { cron_expr: draft.cronExpr.trim() };
    }
    if (draft.preset === 'every_n_hours') {
        return {
            schedule_preset: 'every_n_hours',
            schedule_hours: draft.hours,
            schedule_time_of_day: null,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            cron_expr: null,
        };
    }
    if (draft.preset === 'daily') {
        return {
            schedule_preset: 'daily',
            schedule_time_of_day: draft.timeOfDay,
            schedule_weekdays: null,
            schedule_day_of_month: null,
            cron_expr: null,
        };
    }
    if (draft.preset === 'weekly') {
        return {
            schedule_preset: 'weekly',
            schedule_time_of_day: draft.timeOfDay,
            schedule_weekdays: [...draft.weekdays].sort((a, b) => a - b),
            schedule_day_of_month: null,
            cron_expr: null,
        };
    }
    return {
        schedule_preset: 'monthly',
        schedule_time_of_day: draft.timeOfDay,
        schedule_weekdays: null,
        schedule_day_of_month: draft.dayOfMonth,
        cron_expr: null,
    };
}

// Role section. Configures the agent's identity + lifecycle in one place
// without hunting through other tabs:
//   - designation: human-readable role label
//   - max_rounds: cap on CLI invocations of this agent per item; when
//     the count exceeds the cap, the orchestrator escalates to the
//     Owner instead of bouncing again

//   - requires_item: false = freedom mode (no queued item required)
//   - memory_cadence: runs between automatic memory regenerations
function RoleSection({ agent }: { agent: IAgent }) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const [designation, setDesignation] = useState(agent.designation ?? '');
    const [maxRounds, setMaxRounds] = useState<number>(agent.max_rounds ?? 5);
    const [requiresItem, setRequiresItem] = useState<boolean>(agent.requires_item ?? true);
    const [memoryCadence, setMemoryCadence] = useState<number>(agent.memory_cadence ?? 1);
    const [raisesPr, setRaisesPr] = useState<boolean>(agent.raises_pr ?? false);
    const [pushCode, setPushCode] = useState<boolean>(agent.push_code ?? false);
    const [requiresWorktree, setRequiresWorktree] = useState<boolean>(
        agent.requires_worktree ?? false,
    );

    const dirty =
        designation !== (agent.designation ?? '') ||
        maxRounds !== (agent.max_rounds ?? 5) ||
        requiresItem !== (agent.requires_item ?? true) ||
        memoryCadence !== (agent.memory_cadence ?? 1) ||
        raisesPr !== (agent.raises_pr ?? false) ||
        pushCode !== (agent.push_code ?? false) ||
        requiresWorktree !== (agent.requires_worktree ?? false);

    function handleSave() {
        updateAgent.mutate(
            {
                id: agent.id,
                data: {
                    designation,
                    max_rounds: maxRounds,
                    requires_item: requiresItem,
                    memory_cadence: memoryCadence,
                    raises_pr: raisesPr,
                    push_code: pushCode,
                    requires_worktree: requiresWorktree,
                },
            },
            { onSuccess: () => toast.show({ message: 'Role saved' }) },
        );
    }

    return (
        <FormSection label="Role">
            <FormRow label="Designation">
                <TextField
                    size="small"
                    fullWidth
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Product Owner"
                    helperText="Human-readable role shown next to the agent name."
                />
            </FormRow>

            <FormRow label="Max rounds">
                <TextField
                    size="small"
                    type="number"
                    value={maxRounds}
                    onChange={(e) => setMaxRounds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    inputProps={{ min: 1, max: 20 }}
                    helperText="Cap on CLI invocations of this agent per item. When the count exceeds this value, the orchestrator escalates the item to the Owner with status `waiting_for_info` instead of re-running."
                />
            </FormRow>

            <FormRow label="Item required">
                <FormControlLabel
                    control={
                        <Switch
                            checked={requiresItem}
                            onChange={(e) => setRequiresItem(e.target.checked)}
                        />
                    }
                    label={
                        requiresItem
                            ? 'Requires a queued item before dispatch'
                            : 'Freedom mode — dispatches on schedule even with no item'
                    }
                />
            </FormRow>

            <FormRow label="Requires worktree">
                <FormControlLabel
                    control={
                        <Switch
                            checked={requiresWorktree}
                            onChange={(e) => setRequiresWorktree(e.target.checked)}
                        />
                    }
                    label={
                        requiresWorktree
                            ? 'Orchestrator provisions an isolated git worktree before dispatch'
                            : 'No worktree — agent runs directly in project.git_path (push and PR creation are both skipped)'
                    }
                />
            </FormRow>

            <FormRow label="Push code">
                <FormControlLabel
                    control={
                        <Switch
                            checked={pushCode}
                            onChange={(e) => setPushCode(e.target.checked)}
                        />
                    }
                    label={
                        pushCode
                            ? requiresWorktree
                                ? 'Orchestrator pushes the worktree branch to origin at run-end'
                                : 'Will not push — enable Requires worktree first'
                            : 'No push — branch stays local (cleanup deletes the worktree at run-end)'
                    }
                />
            </FormRow>

            <FormRow label="Raises PR">
                <FormControlLabel
                    control={
                        <Switch
                            checked={raisesPr}
                            onChange={(e) => setRaisesPr(e.target.checked)}
                        />
                    }
                    label={
                        raisesPr
                            ? pushCode && requiresWorktree
                                ? 'Orchestrator opens a PR at run-end after a successful push'
                                : 'Will not raise a PR — enable Requires worktree + Push code first'
                            : 'No PR creation — agent only commits'
                    }
                />
            </FormRow>

            <FormRow label="Memory cadence">
                <TextField
                    size="small"
                    type="number"
                    value={memoryCadence}
                    onChange={(e) =>
                        setMemoryCadence(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                    }
                    inputProps={{ min: 1, max: 100 }}
                    helperText="Runs between automatic memory regenerations (errors count double). Owner [lesson:] markers trigger high-signal regen regardless."
                />
            </FormRow>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                    variant="contained"
                    size="small"
                    onClick={handleSave}
                    disabled={!dirty || updateAgent.isPending}
                >
                    {updateAgent.isPending ? 'Saving…' : 'Save role'}
                </Button>
            </Box>
        </FormSection>
    );
}

// Theme 11 — commit-discipline tile. Renders the agent's last 10
// commit verifications as colored dots. Tooltip per dot lists the
// run id, result, commit count, and any problems.
function CommitDisciplineTile({ agentId }: { agentId: string }) {
    const { data } = useQuery({
        queryKey: ['agents', agentId, 'commit-verifications'],
        queryFn: () => api.agents.getCommitVerifications(agentId, 10),
    });
    if (!data) return null;
    if (data.length === 0) {
        return (
            <FormSection label="Commit discipline">
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                    No agent runs have been verified yet. The verifier audits commits
                    every issue-attached run completes.
                </Typography>
            </FormSection>
        );
    }
    const colorFor: Record<string, string> = {
        compliant: ATLAS_PALETTE.green,
        partial: '#D97706',
        silent: '#dc2626',
        clean: ATLAS_PALETTE.slate40,
    };
    return (
        <FormSection label="Commit discipline">
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
                {data.map((row) => {
                    const sha = row.problems[0]?.commit_sha ?? '';
                    const detail = row.problems.length === 0
                        ? `run ${row.run_id.slice(0, 8)} · ${row.commit_count} commit(s)`
                        : row.problems
                              .slice(0, 4)
                              .map((p) => (p.commit_sha ? `${p.commit_sha}: ${p.reason}` : p.reason))
                              .join('\n');
                    return (
                        <Tooltip
                            key={row.id}
                            arrow
                            title={
                                <Box sx={{ whiteSpace: 'pre-line', fontSize: 11.5 }}>
                                    <strong>{row.result}</strong>
                                    {'\n'}
                                    {detail}
                                    {sha && `\n[${sha}]`}
                                </Box>
                            }
                        >
                            <Box
                                sx={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: '50%',
                                    bgcolor: colorFor[row.result] ?? ATLAS_PALETTE.slate40,
                                    border: '1px solid rgba(0,0,0,0.08)',
                                }}
                            />
                        </Tooltip>
                    );
                })}
            </Box>
            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                Newest first. Green = compliant, amber = partial (missing Refs or unconventional subject),
                red = silent (files changed, no commit), grey = clean (no work to verify).
            </Typography>
        </FormSection>
    );
}
