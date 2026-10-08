import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import type { IProject } from '@atlas/shared';
import { TeamManagedAlert } from '../../components/TeamManagedAlert.js';
import { useUpdateProject } from '../../hooks/useProjects.js';
import { useTeamConfig } from '../../hooks/useTeamConfig.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

/**
 * Team config on a project: the publisher's "include" switch and the
 * subscriber's overwrite warning.
 */
export function ProjectTeamCard({ project }: { project: IProject }) {
    const { data: cfg } = useTeamConfig();
    const update = useUpdateProject();
    const toast = useToast();
    if (!cfg || cfg.role === 'off') return null;

    function toggle(on: boolean) {
        update.mutate(
            { id: project.id, data: { team_managed: on } },
            {
                onSuccess: () =>
                    toast.show({ message: on ? 'Included in team config' : 'Removed from team config' }),
                onError: (err) => toast.show({ message: 'Could not save', detail: err.message }),
            },
        );
    }

    return (
        <Box sx={{ mb: 4, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {cfg.role === 'publisher' ? (
                <FormControlLabel
                    control={
                        <Switch
                            checked={project.team_managed}
                            disabled={update.isPending}
                            onChange={(e) => toggle(e.target.checked)}
                        />
                    }
                    label={
                        <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            Include in team config — publishes this project's repos, guardrails, scripts, Jira
                            queries, workflows and their agents. Never its secrets.
                        </Typography>
                    }
                />
            ) : (
                <TeamManagedAlert managed={project.team_managed} noun="project" />
            )}
        </Box>
    );
}
