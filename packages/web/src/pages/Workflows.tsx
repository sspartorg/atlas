import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import type { IWorkflow } from '@atlas/shared';
import { useWorkflows } from '../hooks/useWorkflows.js';
import { useProjects } from '../hooks/useProjects.js';
import { EmptyState } from '../components/EmptyState.js';
import { PageFab, useSetPageTitle } from '../components/shell/index.js';
import { ATLAS_PALETTE, ELEVATION, TYPOGRAPHY } from '../theme/tokens.js';
import { formatAbsolute, relativeTime } from '../utils/time.js';
import { NewWorkflowDialog } from './workflows/NewWorkflowDialog.js';
import { ImportWorkflowDialog } from './workflows/ImportWorkflowDialog.js';
import { INPUT_KIND_LABEL, TRIGGER_LABEL, graphAgentIds } from './workflows/labels.js';

const GRID_SX = {
    display: 'grid',
    gridTemplateColumns: {
        xs: '1fr',
        sm: 'repeat(2, minmax(0, 1fr))',
        lg: 'repeat(3, minmax(0, 1fr))',
    },
    gap: 3,
} as const;

function StatusPill({ active }: { active: boolean }) {
    return (
        <Box
            component="span"
            sx={{
                px: 2,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: '9999px',
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.02em',
                background: active ? ATLAS_PALETTE.successSoft : ATLAS_PALETTE.slate06,
                color: active ? ATLAS_PALETTE.successFg : ATLAS_PALETTE.slate60,
                flexShrink: 0,
            }}
        >
            {active ? 'Active' : 'Inactive'}
        </Box>
    );
}

function Meta({ label, value }: { label: string; value: string }) {
    return (
        <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: ATLAS_PALETTE.slate60, lineHeight: 1.6 }}>
                {label}
            </Typography>
            <Typography
                sx={{
                    fontSize: 12.5,
                    color: ATLAS_PALETTE.slate,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                }}
            >
                {value}
            </Typography>
        </Box>
    );
}

function WorkflowCard({ wf, projectName, onOpen }: { wf: IWorkflow; projectName: string; onOpen: () => void }) {
    const steps = graphAgentIds(wf.graph).length;
    const trigger =
        wf.trigger === 'schedule' && wf.next_run_at
            ? `${TRIGGER_LABEL.schedule} · next ${formatAbsolute(wf.next_run_at)}`
            : TRIGGER_LABEL[wf.trigger];
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen();
            }}
            sx={{
                p: 4,
                borderRadius: '12px',
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                minWidth: 0,
                transition: 'box-shadow 150ms ease, transform 150ms ease',
                '&:hover': { boxShadow: ELEVATION.mid, transform: 'translateY(-1px)' },
                '&:focus-visible': { outline: `2px solid ${ATLAS_PALETTE.brandBlue}`, outlineOffset: '-2px' },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2.5 }}>
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{
                        fontSize: 20,
                        p: 1.5,
                        borderRadius: '8px',
                        color: ATLAS_PALETTE.accentFg,
                        background: ATLAS_PALETTE.accentSoft,
                    }}
                >
                    account_tree
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        {wf.name}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {projectName} ·{' '}
                        <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                            {steps}
                        </Box>{' '}
                        {steps === 1 ? 'agent' : 'agents'}
                    </Typography>
                </Box>
                <StatusPill active={wf.status === 'active'} />
            </Box>
            {wf.description && (
                <Typography
                    sx={{
                        fontSize: 12.5,
                        color: ATLAS_PALETTE.slate70,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                    }}
                >
                    {wf.description}
                </Typography>
            )}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 2,
                    pt: 3,
                    mt: 'auto',
                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                }}
            >
                <Meta label="Trigger" value={trigger} />
                <Meta label="Input" value={INPUT_KIND_LABEL[wf.input_kind]} />
                <Meta label="Last run" value={relativeTime(wf.last_run_at)} />
            </Box>
        </Box>
    );
}

export function Workflows() {
    useSetPageTitle('Workflows');
    const navigate = useNavigate();
    const { data: workflows, isLoading, error } = useWorkflows();
    const { data: projects = [] } = useProjects();
    const [newOpen, setNewOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);

    const projectName = useMemo(() => {
        const byId = new Map(projects.map((p) => [p.id, p.name]));
        return (id: string | null) => (id ? (byId.get(id) ?? 'Unknown project') : 'No project');
    }, [projects]);
    const activeCount = workflows?.filter((w) => w.status === 'active').length ?? 0;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    gap: 4,
                    mb: 5,
                    flexWrap: 'wrap',
                }}
            >
                <Box>
                    <Typography variant="h2" sx={{ color: ATLAS_PALETTE.slate }}>
                        Workflows
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 1.5 }}>
                        <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                            {workflows?.length ?? 0}
                        </Box>{' '}
                        workflows ·{' '}
                        <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
                            {activeCount}
                        </Box>{' '}
                        active
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                        variant="outlined"
                        onClick={() => setImportOpen(true)}
                        startIcon={
                            <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 18 }}>
                                upload
                            </Box>
                        }
                        sx={{ textTransform: 'none', fontWeight: 600, fontSize: 13.5, px: 3, py: 1.25 }}
                    >
                        Import
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => setNewOpen(true)}
                        startIcon={
                            <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 18 }}>
                                add
                            </Box>
                        }
                        sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            fontSize: 13.5,
                            px: 3,
                            py: 1.25,
                            bgcolor: ATLAS_PALETTE.green,
                            boxShadow: 'none',
                            display: { xs: 'none', md: 'inline-flex' },
                            '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                        }}
                    >
                        New workflow
                    </Button>
                </Box>
            </Box>

            {error ? (
                <Alert severity="error">Couldn&apos;t load workflows: {error.message}</Alert>
            ) : isLoading ? (
                <Box sx={GRID_SX}>
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} variant="rounded" height={168} sx={{ borderRadius: '12px' }} />
                    ))}
                </Box>
            ) : !workflows || workflows.length === 0 ? (
                <EmptyState
                    variant="dashed"
                    icon={
                        <Box component="span" className="material-symbols-rounded" sx={{ fontSize: 32 }}>
                            account_tree
                        </Box>
                    }
                    title="No workflows yet"
                    description="A workflow decides which agents run on your items, in what order, and what happens when a step passes, fails or needs you. Start blank or from a template."
                    actions={
                        <Button variant="outlined" onClick={() => setNewOpen(true)}>
                            New workflow
                        </Button>
                    }
                />
            ) : (
                <Box sx={GRID_SX}>
                    {workflows.map((wf) => (
                        <WorkflowCard
                            key={wf.id}
                            wf={wf}
                            projectName={projectName(wf.project_id)}
                            onOpen={() => navigate(`/workflows/${wf.id}`)}
                        />
                    ))}
                </Box>
            )}

            {newOpen && <NewWorkflowDialog open onClose={() => setNewOpen(false)} />}
            {importOpen && <ImportWorkflowDialog open onClose={() => setImportOpen(false)} />}
            <PageFab onClick={() => setNewOpen(true)} label="New workflow" />
        </Box>
    );
}
