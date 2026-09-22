import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IProject, IProjectRepo } from '@atlas/shared';
import { Breadcrumb } from '../../components/index.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ProjectActionsMenu } from './ProjectActionsMenu.js';

interface Props {
    project: IProject;
    /** ADR 0018 — the project's repos; 0..N, all equal. */
    repos: IProjectRepo[];
    displayId: string;
    guardrailsActive: boolean;
    lastActivity: string;
    onRename: () => void;
    onEditGuardrails: () => void;
    onViewRepos: () => void;
    onManageSecrets: () => void;
    onDelete: () => void;
    // Theme 09b — AI-Readiness Agent trigger
    onGenerateAiScaffold?: () => void;
    aiScaffoldEnabled?: boolean;
}

const MONO = '"JetBrains Mono", monospace';

const PILL_SX = {
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
} as const;

function repoCountLabel(n: number): string {
    if (n === 0) return 'Add a repo';
    return n === 1 ? '1 repo' : `${n} repos`;
}

export const ProjectHeader = memo(function ProjectHeader({
    project,
    repos,
    displayId,
    guardrailsActive,
    lastActivity,
    onRename,
    onEditGuardrails,
    onViewRepos,
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
                <Breadcrumb
                    items={[{ label: 'Projects', to: '/projects' }, { label: project.name }]}
                />
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
                        {/* ADR 0018 — a project holds 0..N equal repos, so the
                            header counts them and sends you to the Repos tab.
                            It used to special-case exactly one repo and print
                            its URL + branch, which read as "the project's
                            repo"; with a repo-less project now the normal
                            first state, the old "no repo URL set" was a dead
                            end on every new project. */}
                        <Box
                            component="button"
                            type="button"
                            onClick={onViewRepos}
                            sx={{ ...PILL_SX, border: 'none', cursor: 'pointer' }}
                        >
                            {repoCountLabel(repos.length)}
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
                                    aria-hidden="true"
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
