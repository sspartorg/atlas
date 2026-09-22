import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import { WORKFLOW_INPUT_KINDS, type IProject, type IWorkflow } from '@atlas/shared';
import { SelectableCard } from '../../components/SchedulePresetFields.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { INPUT_KIND_HINT, INPUT_KIND_LABEL } from './labels.js';
import { WorkflowTriggerFields } from './WorkflowTriggerFields.js';

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

            <WorkflowTriggerFields workflow={wf} onChange={onChange} />

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
