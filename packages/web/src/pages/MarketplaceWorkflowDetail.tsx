import { Suspense, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import type { IPublishedWorkflowDetail, IWorkflowGraph, IWorkflowTemplate } from '@atlas/shared';
import { api } from '../api/api.js';
import { ConfirmActionModal } from '../components/ConfirmActionModal.js';
import { useSetPageTitle } from '../components/shell/index.js';
import { useAgents } from '../hooks/useAgents.js';
import { useProjects } from '../hooks/useProjects.js';
import { useToast } from '../hooks/useToast.js';
import {
    useImportPublishedWorkflow,
    usePublishedWorkflow,
    useUnpublishWorkflow,
    useWorkflowTemplates,
} from '../hooks/useWorkflows.js';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import {
    useCliAvailability,
    findMissingCli,
    cliUnavailableMessage,
} from '../hooks/useCliAvailability.js';
import { formatDate } from '../utils/time.js';
import { lazyNamed } from '../utils/lazyNamed.js';
import { useCatalogAgentsById, useKnownAgentsById } from './marketplace/MarketplaceWorkflows.js';
import { importDetail } from './workflows/ImportWorkflowDialog.js';
import { NewWorkflowDialog } from './workflows/NewWorkflowDialog.js';
import type { ICanvasContext } from './workflows/WorkflowNodes.js';
import {
    INPUT_KIND_LABEL,
    TRIGGER_LABEL,
    agentLabel,
    deliveryLabel,
    subTemplates,
    templateAgentIds,
} from './workflows/labels.js';

const WorkflowGraphPreview = lazyNamed(
    () => import('./marketplace/WorkflowGraphPreview.js'),
    'WorkflowGraphPreview'
);

const SECTION_LABEL_SX = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: ATLAS_PALETTE.slate60,
    mb: 2,
} as const;

const GREEN_BUTTON_SX = {
    textTransform: 'none',
    fontWeight: 600,
    bgcolor: ATLAS_PALETTE.green,
    boxShadow: 'none',
    '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
} as const;

/** What the page shows, the same for a starter template and a published workflow. */
interface IView {
    name: string;
    description: string | null;
    delivery: NonNullable<ICanvasContext['delivery']>;
    graph: IWorkflowGraph;
    agentIds: string[];
    /** `ref` is a Sub-tasks step's `sub_workflow_id`; `to` links a starter sub-workflow's page. */
    subs: Array<{ ref: string; name: string; to: string | null }>;
    subNames: Map<string, string>;
    exportHref: string;
    publishedAt: string | null;
}

function templateView(
    templateId: string,
    templates: IWorkflowTemplate[] | undefined
): IView | null {
    const t = templates?.find((x) => x.id === templateId);
    if (!t || !templates) return null;
    const subs = subTemplates(t, templates).map((s) => ({
        ref: `template:${s.id}`,
        name: s.name,
        to: `/agents/marketplace/workflows/${s.id}`,
    }));
    return {
        name: t.name,
        description: t.description,
        delivery: { ...t, push_to_default: t.push_to_default ?? false },
        graph: t.graph,
        agentIds: templateAgentIds(t, templates),
        subs,
        subNames: new Map(subs.map((s) => [s.ref, s.name])),
        exportHref: api.workflows.templateExportZipUrl(t.id),
        publishedAt: null,
    };
}

function publishedView(p: IPublishedWorkflowDetail | undefined): IView | null {
    if (!p) return null;
    return {
        name: p.name,
        description: p.description,
        delivery: p,
        graph: p.graph,
        agentIds: p.agent_ids,
        subs: p.sub_workflows.map((s) => ({ ...s, to: null })),
        subNames: new Map(p.sub_workflows.map((s) => [s.ref, s.name])),
        exportHref: api.publishedWorkflows.exportZipUrl(p.id),
        publishedAt: p.published_at,
    };
}

function UsePublishedWorkflowDialog({ id, onClose }: { id: string; onClose: () => void }) {
    const navigate = useNavigate();
    const toast = useToast();
    const { data: projects = [] } = useProjects();
    const importer = useImportPublishedWorkflow();
    const [projectId, setProjectId] = useState('');

    async function handleUse() {
        const result = await importer.mutateAsync({ id, projectId });
        const detail = importDetail(result);
        toast.show({ message: `Imported ${result.workflow.name}`, ...(detail ? { detail } : {}) });
        onClose();
        navigate(`/workflows/${result.workflow.id}`);
    }

    return (
        <Dialog open onClose={importer.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pb: 2 }}>
                Use in a project
            </DialogTitle>
            <DialogContent
                sx={{ display: 'flex', flexDirection: 'column', gap: 4, pt: '8px !important' }}
            >
                <TextField
                    select
                    label="Project"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    fullWidth
                >
                    {projects.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                            {p.name}
                        </MenuItem>
                    ))}
                </TextField>
                {importer.error && <Alert severity="error">{importer.error.message}</Alert>}
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                <Button variant="outlined" onClick={onClose} disabled={importer.isPending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={() => void handleUse().catch(() => undefined)}
                    disabled={!projectId || importer.isPending}
                    sx={GREEN_BUTTON_SX}
                >
                    {importer.isPending ? 'Adding…' : 'Add workflow'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/**
 * A starter template (`/agents/marketplace/workflows/:templateId`) or a
 * workflow the Owner published (`…/workflows/published/:publishedId`).
 */
export function MarketplaceWorkflowDetail() {
    const { templateId = '', publishedId = '' } = useParams<{
        templateId: string;
        publishedId: string;
    }>();
    const navigate = useNavigate();
    const toast = useToast();
    useSetPageTitle('Marketplace workflow');
    const templates = useWorkflowTemplates({ enabled: !publishedId });
    const published = usePublishedWorkflow(publishedId);
    const unpublish = useUnpublishWorkflow();
    const { data: agents = [] } = useAgents();
    const catalogById = useCatalogAgentsById();
    const knownById = useKnownAgentsById();
    const installedById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
    const [useOpen, setUseOpen] = useState(false);
    const [unpublishOpen, setUnpublishOpen] = useState(false);
    const view = useMemo(
        () =>
            publishedId ? publishedView(published.data) : templateView(templateId, templates.data),
        [publishedId, published.data, templateId, templates.data]
    );
    const { isLoading, isError } = publishedId ? published : templates;
    // A published workflow was built from your agents; a template names catalog ones.
    const namesById = publishedId ? knownById : catalogById;

    // F-010 — a template installs its whole agent roster in one click. If a
    // roster agent's CLI has no binary on this machine the install still
    // succeeds and the first real run dies at that step, so say so here, while
    // the Owner can still choose a different template or install the CLI.
    // `pnpm doctor` already knows; this surface just never asked.
    const { data: cliRows } = useCliAvailability();
    const missingCliAgents = useMemo(() => {
        if (!view) return [];
        return view.agentIds.flatMap((id) => {
            const cli = namesById.get(id)?.cli ?? installedById.get(id)?.cli;
            const missing = findMissingCli(cliRows, cli);
            return missing ? [{ id, cli, missing }] : [];
        });
    }, [view, namesById, installedById, cliRows]);

    const back = () => navigate('/agents/marketplace?tab=workflows');

    async function confirmUnpublish() {
        try {
            await unpublish.mutateAsync(publishedId);
            toast.show({ message: `Unpublished ${view?.name ?? 'workflow'}` });
            back();
        } catch (err) {
            setUnpublishOpen(false);
            toast.show({
                message: 'Could not unpublish workflow',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    if (isLoading) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Skeleton variant="rectangular" height={48} sx={{ mb: 4 }} />
                <Skeleton variant="rectangular" height={300} />
            </Box>
        );
    }
    if (isError || !view) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Typography sx={{ color: ATLAS_PALETTE.error }}>
                    Marketplace workflow not found.
                </Typography>
                <Button onClick={back} sx={{ mt: 2 }}>
                    Back to marketplace
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <Button
                startIcon={<ArrowBackRounded sx={{ fontSize: 18 }} />}
                onClick={back}
                sx={{ textTransform: 'none', mb: 3, color: ATLAS_PALETTE.slate60 }}
            >
                Marketplace
            </Button>

            <Box
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, flexWrap: 'wrap', mb: 3 }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    aria-hidden="true"
                    sx={{
                        fontSize: 32,
                        p: 1.5,
                        borderRadius: 2,
                        color: ATLAS_PALETTE.accentFg,
                        background: ATLAS_PALETTE.accentSoft,
                    }}
                >
                    account_tree
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        variant="h1"
                        sx={{
                            fontSize: { xs: '1.5rem', sm: '2rem' },
                            fontWeight: 700,
                            color: ATLAS_PALETTE.slate,
                            mb: 1,
                        }}
                    >
                        {view.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Chip size="small" label={INPUT_KIND_LABEL[view.delivery.input_kind]} />
                        <Chip
                            size="small"
                            label={TRIGGER_LABEL[view.delivery.trigger]}
                            variant="outlined"
                        />
                        <Chip
                            size="small"
                            label={deliveryLabel(view.delivery)}
                            variant="outlined"
                        />
                        {view.publishedAt && (
                            <Chip
                                size="small"
                                label={`Published ${formatDate(view.publishedAt)}`}
                                variant="outlined"
                            />
                        )}
                    </Box>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    <Button
                        startIcon={<DownloadRounded sx={{ fontSize: 18 }} />}
                        href={view.exportHref}
                        sx={{ textTransform: 'none' }}
                    >
                        Export
                    </Button>
                    {publishedId && (
                        <Button
                            variant="outlined"
                            color="error"
                            onClick={() => setUnpublishOpen(true)}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                            Unpublish
                        </Button>
                    )}
                    <Button
                        variant="contained"
                        onClick={() => setUseOpen(true)}
                        sx={GREEN_BUTTON_SX}
                    >
                        Use in a project
                    </Button>
                </Box>
            </Box>

            {view.description && (
                <Typography sx={{ fontSize: 14, color: ATLAS_PALETTE.slate70, maxWidth: 820 }}>
                    {view.description}
                </Typography>
            )}

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '2fr 1fr' },
                    gap: 4,
                    mt: 5,
                }}
            >
                <Box sx={{ height: { xs: 420, md: 560 } }}>
                    <Suspense
                        fallback={
                            <Skeleton
                                variant="rounded"
                                height="100%"
                                sx={{ borderRadius: '12px' }}
                            />
                        }
                    >
                        <WorkflowGraphPreview
                            graph={view.graph}
                            subNames={view.subNames}
                            delivery={view.delivery}
                            agentsById={installedById}
                        />
                    </Suspense>
                </Box>
                <Box>
                    <Typography sx={SECTION_LABEL_SX}>Agents</Typography>
                    {missingCliAgents.length > 0 && missingCliAgents[0] && (
                        <Alert severity="warning" sx={{ mb: 3 }}>
                            {missingCliAgents.length === 1
                                ? `${agentLabel(missingCliAgents[0].id, namesById)} runs on ${missingCliAgents[0].cli}. `
                                : `${missingCliAgents.length} of these agents run on a CLI that isn't installed. `}
                            {cliUnavailableMessage(missingCliAgents[0].missing, {
                                beforeInstall: true,
                            })}
                        </Alert>
                    )}
                    <Box
                        component="ul"
                        aria-label="Agents"
                        sx={{
                            listStyle: 'none',
                            p: 0,
                            m: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                        }}
                    >
                        {view.agentIds.map((id) => (
                            <Box
                                component="li"
                                key={id}
                                sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
                            >
                                <Box
                                    component="span"
                                    sx={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        flexShrink: 0,
                                        background:
                                            namesById.get(id)?.accent_color ??
                                            ATLAS_PALETTE.slate30,
                                    }}
                                />
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        color: ATLAS_PALETTE.slate,
                                        flex: 1,
                                        minWidth: 0,
                                    }}
                                >
                                    {agentLabel(id, namesById)}
                                </Typography>
                                <Typography sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}>
                                    {installedById.has(id)
                                        ? 'Installed'
                                        : publishedId
                                          ? 'Installs with this workflow'
                                          : 'Installs from the marketplace'}
                                </Typography>
                            </Box>
                        ))}
                    </Box>
                    {view.subs.length > 0 && (
                        <Box sx={{ mt: 5 }}>
                            <Typography sx={SECTION_LABEL_SX}>Sub-workflows</Typography>
                            {view.subs.map((s) =>
                                s.to ? (
                                    <Button
                                        key={s.ref}
                                        onClick={() => navigate(s.to ?? '')}
                                        sx={{ textTransform: 'none', display: 'flex', px: 0 }}
                                    >
                                        {s.name}
                                    </Button>
                                ) : (
                                    <Typography
                                        key={s.ref}
                                        sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, py: 0.5 }}
                                    >
                                        {s.name}
                                    </Typography>
                                )
                            )}
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                                {publishedId
                                    ? 'Created with this workflow.'
                                    : 'Created with this workflow unless the project already has them.'}
                            </Typography>
                        </Box>
                    )}
                </Box>
            </Box>

            {useOpen &&
                (publishedId ? (
                    <UsePublishedWorkflowDialog
                        id={publishedId}
                        onClose={() => setUseOpen(false)}
                    />
                ) : (
                    <NewWorkflowDialog
                        open
                        templateId={templateId}
                        onClose={() => setUseOpen(false)}
                    />
                ))}
            <ConfirmActionModal
                open={unpublishOpen}
                title={`Unpublish ${view.name}?`}
                body="It leaves the marketplace. Workflows already created from it stay as they are."
                confirmLabel="Unpublish"
                tone="destructive"
                busy={unpublish.isPending}
                onConfirm={() => void confirmUnpublish()}
                onCancel={() => setUnpublishOpen(false)}
            />
        </Box>
    );
}
