import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import type { IProject } from '@atlas/shared';
import { MarkdownPreview } from '../../components/MarkdownPreview.js';
import { TeamManagedAlert } from '../../components/TeamManagedAlert.js';
import { useUpdateProject } from '../../hooks/useProjects.js';
import { useTeamConfig, useTeamConfigHelp } from '../../hooks/useTeamConfig.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

/**
 * Team config on a project: the publisher's "include" switch, the subscriber's
 * overwrite warning, and the project's HELP.md from the team repo.
 */
export function ProjectTeamCard({ project }: { project: IProject }) {
    const { data: cfg } = useTeamConfig();
    const { data: help } = useTeamConfigHelp();
    const update = useUpdateProject();
    const toast = useToast();
    if (!cfg || cfg.role === 'off') return null;
    const helpMd = project.team_managed
        ? help?.projects.find((p) => p.issue_key_prefix === project.issue_key_prefix)?.help_md
        : undefined;

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
            {helpMd?.trim() ? (
                <Accordion disableGutters variant="outlined">
                    <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Team help for this project</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                        <MarkdownPreview source={helpMd} />
                    </AccordionDetails>
                </Accordion>
            ) : null}
        </Box>
    );
}
