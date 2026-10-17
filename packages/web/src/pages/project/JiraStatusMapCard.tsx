import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { IJiraStatusMap, IProject, IssueStatus } from '@atlas/shared';
import { useUpdateProject } from '../../hooks/useProjects.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const ROWS: { status: IssueStatus; label: string; hint: string; example: string }[] = [
    {
        status: 'draft',
        label: 'Draft',
        hint: 'Optional. Imported, not queued — edit freely.',
        example: 'Backlog',
    },
    {
        status: 'ready',
        label: 'Ready',
        hint: 'Queued: the workflow picks it up.',
        example: 'Selected for Development',
    },
    {
        status: 'in_progress',
        label: 'In Progress',
        hint: 'Atlas is working on it.',
        example: 'Development in Progress, Dev Completed, Ready for QA, QA in Progress',
    },
    {
        status: 'waiting_for_info',
        label: 'Waiting for Info',
        hint: 'Atlas needs an answer.',
        example: 'Info Needed, Blocked',
    },
    {
        status: 'in_review',
        label: 'In Review',
        hint: 'Work is up for review.',
        example: 'In Review',
    },
    { status: 'done', label: 'Done', hint: 'Finished.', example: 'Done' },
];

const split = (v: string) =>
    v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

/** The problems with a draft mapping, by Atlas status ('' = fine). */
export function mappingProblems(
    values: Record<IssueStatus, string>
): Partial<Record<IssueStatus, string>> {
    const out: Partial<Record<IssueStatus, string>> = {};
    if (split(values.ready).length === 0) out.ready = 'Map at least one Jira status to Ready';
    const seen = new Map<string, string>();
    for (const row of ROWS) {
        for (const name of split(values[row.status])) {
            const other = seen.get(name.toLowerCase());
            if (other && other !== row.label)
                out[row.status] = `"${name}" is already mapped to ${other}`;
            seen.set(name.toLowerCase(), row.label);
        }
    }
    return out;
}

/**
 * Which Jira statuses mean each Atlas status, for this project. Drives what
 * imports (only Draft and Ready do), what queues, where Atlas moves the Jira
 * issue as work progresses, and reopening a Done item from either side.
 */
export function JiraStatusMapCard({ project }: { project: IProject }) {
    const update = useUpdateProject();
    const toast = useToast();
    const initial = useMemo(
        () =>
            Object.fromEntries(
                ROWS.map((r) => [r.status, (project.jira_status_map?.[r.status] ?? []).join(', ')])
            ) as Record<IssueStatus, string>,
        [project.jira_status_map]
    );
    const [values, setValues] = useState(initial);
    const [touched, setTouched] = useState(false);
    const problems = mappingProblems(values);
    const dirty = ROWS.some((r) => values[r.status] !== initial[r.status]);

    function save(map: IJiraStatusMap | null) {
        update.mutate(
            { id: project.id, data: { jira_status_map: map } },
            {
                onSuccess: () => {
                    setTouched(false);
                    toast.show({
                        message: map ? 'Status mapping saved' : 'Status mapping cleared',
                    });
                    if (!map)
                        setValues(
                            Object.fromEntries(ROWS.map((r) => [r.status, ''])) as Record<
                                IssueStatus,
                                string
                            >
                        );
                },
                onError: (e) =>
                    toast.show({ message: 'Could not save the mapping', detail: e.message }),
            }
        );
    }

    function submit() {
        setTouched(true);
        if (Object.keys(problems).length > 0) return;
        save(
            Object.fromEntries(
                ROWS.map((r) => [r.status, split(values[r.status])])
            ) as IJiraStatusMap
        );
    }

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
                mt: 4,
            }}
        >
            <Typography sx={{ fontSize: 16, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                Status mapping
            </Typography>
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5, mb: 3 }}>
                Which Jira statuses mean each Atlas status on this project's board, comma-separated.
                Only issues in a Draft or Ready status import (leave Draft empty if your board has
                no backlog column); moving one to Ready in Jira queues it; Atlas moves the Jira
                issue to the first status listed as work progresses; and moving a Done issue back to
                Draft or Ready (in Jira or here) reopens the same Task. A mapping needs at least one
                Ready status; to ignore Jira's status, don't save one (or use Clear mapping).
            </Typography>
            {!project.jira_status_map && (
                <Alert severity="info" sx={{ mb: 3 }}>
                    Not set: Jira's status is ignored and every issue the JQL finds imports.
                </Alert>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {ROWS.map((r) => (
                    <Box
                        key={r.status}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' },
                            gap: { xs: 1, sm: 3 },
                            alignItems: 'start',
                        }}
                    >
                        <Box sx={{ pt: { sm: 1 } }}>
                            <Typography
                                sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                            >
                                {r.label}
                            </Typography>
                            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                                {r.hint}
                            </Typography>
                        </Box>
                        <TextField
                            size="small"
                            fullWidth
                            value={values[r.status]}
                            placeholder={r.example}
                            onChange={(e) => setValues({ ...values, [r.status]: e.target.value })}
                            error={touched && Boolean(problems[r.status])}
                            helperText={touched ? problems[r.status] : undefined}
                            slotProps={{
                                htmlInput: { 'aria-label': `Jira statuses for ${r.label}` },
                            }}
                        />
                    </Box>
                ))}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 3 }}>
                {project.jira_status_map && (
                    <Button
                        color="error"
                        size="small"
                        onClick={() => save(null)}
                        disabled={update.isPending}
                        sx={{ textTransform: 'none' }}
                    >
                        Clear mapping
                    </Button>
                )}
                <Button
                    variant="contained"
                    size="small"
                    onClick={submit}
                    disabled={!dirty || update.isPending}
                    sx={{ textTransform: 'none' }}
                >
                    Save mapping
                </Button>
            </Box>
        </Box>
    );
}
