import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { WORKFLOW_TRIGGERS, type IWorkflow } from '@atlas/shared';
import { SchedulePresetFields } from '../../components/SchedulePresetFields.js';
import { TRIGGER_LABEL } from './labels.js';

interface Props {
    workflow: IWorkflow;
    onChange: (patch: Partial<IWorkflow>) => void;
    columns?: number;
}

/**
 * Trigger + cadence. Shared by the Start node inspector and the header's
 * schedule dialog so the two can't drift — the canvas was the only place this
 * existed, which is why per-workflow scheduling went unnoticed.
 *
 * Renders nothing for a sub-workflow: `assertDeliveryRules` in the API forces
 * `input_kind='sub_task'` to `manual`, since it only ever runs from a Task
 * workflow's Sub-tasks step.
 */
export function WorkflowTriggerFields({ workflow: wf, onChange, columns = 2 }: Props) {
    if (wf.input_kind === 'sub_task') return null;
    const needsTime = wf.schedule_preset === 'daily' || wf.schedule_preset === 'weekly';

    return (
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
                            ? { trigger, schedule_preset: 'daily', schedule_time_of_day: '09:00' }
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
                        columns={columns}
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
    );
}
