import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import type { ITask, IWorkflow } from '@atlas/shared';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { itemPath } from '../../utils/itemPath.js';

interface Props {
    tasks: ITask[];
    /** Workflows that take Tasks; each Task is offered its own project's. */
    workflows: IWorkflow[];
    projectName: (id: string) => string;
    onPick: (taskId: string, workflowId: string) => void;
}

export function UnassignedTasks({ tasks, workflows, projectName, onPick }: Props) {
    if (tasks.length === 0) return null;
    return (
        <Box component="section" aria-label="Needs a workflow" sx={{ mt: 8 }}>
            <Typography variant="overline" sx={{ color: ATLAS_PALETTE.slate }}>
                Needs a workflow{' '}
                <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                    {tasks.length}
                </Box>
            </Typography>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 2 }}>
                These Tasks are ready, but no workflow will pick them up. Pick one to queue each.
            </Typography>
            <Box
                component="ul"
                sx={{
                    listStyle: 'none',
                    m: 0,
                    p: 0,
                    background: ATLAS_PALETTE.white,
                    border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    borderRadius: '12px',
                }}
            >
                {tasks.map((t, i) => {
                    const options = workflows.filter((w) => w.project_id === t.project_id);
                    return (
                        <Box
                            component="li"
                            key={t.id}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: 2,
                                px: 3,
                                py: 2,
                                borderTop: i === 0 ? 'none' : `1px solid ${ATLAS_PALETTE.slate06}`,
                            }}
                        >
                            <Link
                                component={RouterLink}
                                to={itemPath('task', t.id)}
                                underline="hover"
                                sx={{ display: 'flex', gap: 1.5, minWidth: 0, flex: 1, color: ATLAS_PALETTE.slate }}
                            >
                                <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono, fontSize: 12, color: ATLAS_PALETTE.slate60, flexShrink: 0 }}>
                                    {t.id}
                                </Box>
                                <Box component="span" sx={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {t.title}
                                </Box>
                            </Link>
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>{projectName(t.project_id)}</Typography>
                            {options.length === 0 ? (
                                <Link component={RouterLink} to="/workflows" sx={{ fontSize: 12 }}>
                                    Create a workflow
                                </Link>
                            ) : (
                                <Select
                                    size="small"
                                    value=""
                                    displayEmpty
                                    onChange={(e) => onPick(t.id, e.target.value)}
                                    inputProps={{ 'aria-label': `Workflow for ${t.id}` }}
                                    sx={{ fontSize: 12.5, minWidth: 160 }}
                                >
                                    <MenuItem value="" disabled>
                                        Pick a workflow
                                    </MenuItem>
                                    {options.map((w) => (
                                        <MenuItem key={w.id} value={w.id}>
                                            {w.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            )}
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}
