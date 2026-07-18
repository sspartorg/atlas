import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IProject } from '@atlas/shared';
import { Breadcrumb } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ProjectActionsMenu } from './ProjectActionsMenu.js';

interface Props {
    project: IProject;
    displayId: string;
    guardrailsActive: boolean;
    lastActivity: string;
    onRename: () => void;
    onEditGuardrails: () => void;
    onManageSecrets: () => void;
    onDelete: () => void;
    // Theme 09b — AI-Readiness Agent trigger
    onGenerateAiScaffold?: () => void;
    aiScaffoldEnabled?: boolean;
}

const MONO = '"JetBrains Mono", monospace';

function repoLabel(url: string): string {
    if (!url) return '—';
    return url.replace(/^https?:\/\//, '').replace(/\.git\/?$/, '');
}

export const ProjectHeader = memo(function ProjectHeader({
    project,
    displayId,
    guardrailsActive,
    lastActivity,
    onRename,
    onEditGuardrails,
    onManageSecrets,
    onDelete,
    onGenerateAiScaffold,
    aiScaffoldEnabled,
}: Props) {
    return (
        <Box sx={{ mb: 5 }}>
            {/* MobileAppBar already shows the project name + "Project" subtitle;
                the breadcrumb's last segment would repeat that. Hide on small. */}
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <Breadcrumb items={[{ label: 'Projects', to: '/projects' }, { label: project.name }]} />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 2,
                            mb: 1.5,
                            flexWrap: 'wrap',
                        }}
                    >
                        <Typography
                            sx={{
                                // Hide on mobile — MobileAppBar already renders the project name
                                // as the page title, so this h1 would be the third repeat.
                                display: { xs: 'none', md: 'block' },
                                fontSize: 26,
                                fontWeight: 700,
                                color: ATLAS_PALETTE.slate,
                                letterSpacing: '-0.01em',
                                lineHeight: 1.2,
                            }}
                        >
                            {project.name}
                        </Typography>
                        <Typography
                            sx={{ fontSize: 12, color: ATLAS_PALETTE.slate40, fontFamily: MONO }}
                        >
                            {displayId}
                        </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap' }}>
                        {project.git_url ? (
                            <Box
                                component="a"
                                href={project.git_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12.5,
                                    color: ATLAS_PALETTE.brandBlue,
                                    textDecoration: 'none',
                                    '&:hover': { textDecoration: 'underline' },
                                }}
                            >
                                {repoLabel(project.git_url)}
                            </Box>
                        ) : (
                            <Typography
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 12.5,
                                    color: ATLAS_PALETTE.slate40,
                                }}
                            >
                                no repo URL set
                            </Typography>
                        )}

                        <Box
                            sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                height: 22,
                                px: 1.25,
                                borderRadius: '6px',
                                background: ATLAS_PALETTE.slate08,
                                color: ATLAS_PALETTE.slate,
                                fontFamily: MONO,
                                fontSize: 11.5,
                                fontWeight: 500,
                            }}
                        >
                            {project.default_branch || 'main'}
                        </Box>

                        {guardrailsActive && (
                            <Box
                                component="button"
                                type="button"
                                onClick={onEditGuardrails}
                                sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 0.75,
                                    height: 22,
                                    px: 1.25,
                                    border: 'none',
                                    borderRadius: '6px',
                                    background: 'rgba(70,33,124,.08)',
                                    color: ATLAS_PALETTE.purple,
                                    fontSize: 11.5,
                                    fontWeight: 600,
                                    fontFamily: 'inherit',
                                    textDecoration: 'none',
                                    cursor: 'pointer',
                                    '&:hover': { background: 'rgba(70,33,124,.14)' },
                                }}
                            >
                                <Box
                                    component="span"
                                    className="material-symbols-rounded"
                                    sx={{ fontSize: 14 }}
                                >
                                    shield
                                </Box>
                                Guard-rails active
                            </Box>
                        )}

                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                            Last activity {lastActivity}
                        </Typography>
                    </Box>
                </Box>

                <ProjectActionsMenu
                    onRename={onRename}
                    onEditGuardrails={onEditGuardrails}
                    onManageSecrets={onManageSecrets}
                    onDelete={onDelete}
                    {...(onGenerateAiScaffold ? { onGenerateAiScaffold } : {})}
                    {...(aiScaffoldEnabled !== undefined ? { aiScaffoldEnabled } : {})}
                />
            </Box>
        </Box>
    );
});
