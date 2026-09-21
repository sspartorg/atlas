import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import {
    WORKFLOW_INPUT_KINDS,
    WORKFLOW_TRIGGERS,
    type IProject,
    type IWorkflow,
} from '@atlas/shared';
import { SchedulePresetFields, SelectableCard } from '../../components/SchedulePresetFields.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { INPUT_KIND_HINT, INPUT_KIND_LABEL, TRIGGER_LABEL } from './labels.js';

interface Props {
    workflow: IWorkflow;
    projects: IProject[];
    onChange: (patch: Partial<IWorkflow>) => void;
}

export function SectionLabel({ children }: { children: string }) {
    return (
        <Typography
            variant="overline"
            sx={{ display: 'block', color: ATLAS_PALETTE.slate60, mb: 1.5 }}
        >
            {children}
        </Typography>
    );
}

export function StartInspector({ workflow: wf, projects, onChange }: Props) {
    const needsTime = wf.schedule_preset === 'daily' || wf.schedule_preset === 'weekly';
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <TextField
                label="Name"
                size="small"
                value={wf.name}
                onChange={(e) => onChange({ name: e.target.value })}
                error={!wf.name.trim()}
                fullWidth
            />
            <TextField
                label="Description"
                size="small"
                value={wf.description ?? ''}
                onChange={(e) => onChange({ description: e.target.value || null })}
                multiline
                minRows={2}
                fullWidth
            />
            <TextField
                select
                label="Project"
                size="small"
                // Until projects load, an id with no matching option makes MUI warn.
                value={projects.some((p) => p.id === wf.project_id) ? (wf.project_id ?? '') : ''}
                onChange={(e) => onChange({ project_id: e.target.value || null })}
                fullWidth
            >
                {projects.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                        {p.name}
                    </MenuItem>
                ))}
            </TextField>

            <Box>
                <SectionLabel>Input</SectionLabel>
                <Box sx={{ display: 'grid', gap: 1.5 }}>
                    {WORKFLOW_INPUT_KINDS.map((k) => (
                        <SelectableCard
                            key={k}
                            title={INPUT_KIND_LABEL[k]}
                            sub={INPUT_KIND_HINT[k]}
                            selected={wf.input_kind === k}
                            // A sub-workflow only ever starts from a Task run's
                            // Sub-tasks step, so it has no trigger of its own.
                            onClick={() =>
                                onChange(
                                    k === 'sub_task'
                                        ? { input_kind: k, trigger: 'manual' }
                                        : { input_kind: k }
                                )
                            }
                        />
                    ))}
                </Box>
            </Box>

            {wf.input_kind !== 'sub_task' && (
                <Box>
                    <TextField
                        select
                        label="Trigger"
                        size="small"
                        value={wf.trigger}
                        onChange={(e) => {
                            const trigger = e.target.value as IWorkflow['trigger'];
                            // The API rejects a schedule trigger without a preset.
                            onChange(
                                trigger === 'schedule' && !wf.schedule_preset
                                    ? {
                                          trigger,
                                          schedule_preset: 'daily',
                                          schedule_time_of_day: '09:00',
                                      }
                                    : { trigger }
                            );
                        }}
                        fullWidth
                        sx={{ mb: wf.trigger === 'schedule' ? 3 : 0 }}
                    >
                        {WORKFLOW_TRIGGERS.map((t) => (
                            <MenuItem key={t} value={t}>
                                {TRIGGER_LABEL[t]}
                            </MenuItem>
                        ))}
                    </TextField>
                    {wf.trigger === 'schedule' && (
                        <>
                            <SchedulePresetFields
                                columns={2}
                                value={{
                                    preset: wf.schedule_preset,
                                    weekday: wf.schedule_weekday,
                                    cronExpression: wf.cron_expr ?? '',
                                }}
                                onChange={(patch) =>
                                    onChange({
                                        ...(patch.preset ? { schedule_preset: patch.preset } : {}),
                                        ...(patch.weekday !== undefined
                                            ? { schedule_weekday: patch.weekday }
                                            : {}),
                                        ...(patch.cronExpression !== undefined
                                            ? { cron_expr: patch.cronExpression || null }
                                            : {}),
                                    })
                                }
                            />
                            {needsTime && (
                                <TextField
                                    label="Time of day"
                                    type="time"
                                    size="small"
                                    value={wf.schedule_time_of_day ?? '09:00'}
                                    onChange={(e) =>
                                        onChange({ schedule_time_of_day: e.target.value || null })
                                    }
                                    fullWidth
                                />
                            )}
                        </>
                    )}
                </Box>
            )}

            {wf.input_kind === 'item' && (
                <TextField
                    label="Tasks in parallel"
                    type="number"
                    size="small"
                    value={wf.max_parallel_runs}
                    onChange={(e) =>
                        onChange({
                            max_parallel_runs: Math.min(
                                10,
                                Math.max(1, Math.round(Number(e.target.value) || 1))
                            ),
                        })
                    }
                    helperText="Each Task runs on its own branch; its sub-tasks always run one at a time"
                    slotProps={{ htmlInput: { min: 1, max: 10 } }}
                    fullWidth
                />
            )}

            <TextField
                label="Max loops"
                type="number"
                size="small"
                value={wf.max_loops}
                onChange={(e) =>
                    onChange({
                        max_loops: Math.min(
                            20,
                            Math.max(1, Math.round(Number(e.target.value) || 1))
                        ),
                    })
                }
                helperText="Fail connections taken before the item goes back to you"
                slotProps={{ htmlInput: { min: 1, max: 20 } }}
                fullWidth
            />

            <FormControlLabel
                control={
                    <Switch
                        checked={wf.status === 'active'}
                        onChange={(_, on) => onChange({ status: on ? 'active' : 'inactive' })}
                    />
                }
                label={
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate }}>
                        Active — starts runs from its trigger
                    </Typography>
                }
            />
        </Box>
    );
}
