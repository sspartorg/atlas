import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ReactFlowProvider,
    applyEdgeChanges,
    applyNodeChanges,
    useReactFlow,
    type Connection,
    type EdgeChange,
    type NodeChange,
    type OnSelectionChangeFunc,
} from '@xyflow/react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
    validateWorkflowGraph,
    type IWorkflow,
    type IWorkflowGraphError,
    type UpdateWorkflowInput,
} from '@atlas/shared';
import { AtlasApiError } from '../../api/api.js';
import {
    useWorkflow,
    useWorkflows,
    useStartWorkflowRun,
    useUpdateWorkflow,
    useDeleteWorkflow,
} from '../../hooks/useWorkflows.js';
import { useAgents } from '../../hooks/useAgents.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useTabParam } from '../../hooks/useTabParam.js';
import { useDraftGuard } from '../../hooks/useDraftGuard.js';
import { useToast } from '../../hooks/useToast.js';
import { useSetPageTitle } from '../../components/shell/index.js';
import { ConfirmActionModal } from '../../components/ConfirmActionModal.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { WorkflowCanvas } from './WorkflowCanvas.js';
import { WorkflowHeader } from './WorkflowHeader.js';
import { WorkflowInspector } from './WorkflowInspector.js';
import { NodePalette, PALETTE_MIME, type IPaletteItem } from './NodePalette.js';
import { RunWorkflowDialog } from './RunWorkflowDialog.js';
import { WorkflowRunsTab } from './WorkflowRunsTab.js';
import {
    connectEdges,
    newNodeId,
    normalizeGraph,
    toFlow,
    toGraph,
    type IWfNodeData,
    type WfEdge,
    type WfNode,
} from './graph.js';

const TAB_KEYS = ['builder', 'runs'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function toUpdate(w: IWorkflow): UpdateWorkflowInput {
    return {
        name: w.name.trim(),
        description: w.description,
        project_id: w.project_id,
        status: w.status,
        graph: normalizeGraph(w.graph),
        input_kind: w.input_kind,
        trigger: w.trigger,
        use_worktree: w.use_worktree,
        push_code: w.push_code,
        raises_pr: w.raises_pr,
        push_to_default: w.push_to_default,
        max_loops: w.max_loops,
        max_parallel_runs: w.max_parallel_runs,
        schedule_preset: w.schedule_preset,
        schedule_time_of_day: w.schedule_time_of_day,
        schedule_weekday: w.schedule_weekday,
        cron_expr: w.cron_expr,
    };
}

function graphErrorsOf(err: unknown): IWorkflowGraphError[] {
    if (!(err instanceof AtlasApiError)) return [];
    const details = err.details as { graph_errors?: IWorkflowGraphError[] } | undefined;
    return details?.graph_errors ?? [];
}

function GraphErrors({ errors }: { errors: IWorkflowGraphError[] }) {
    if (errors.length === 0) return null;
    return (
        <Alert severity="error" sx={{ mb: 3 }} data-testid="graph-errors">
            <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>Fix before saving</Typography>
            <Box component="ul" sx={{ m: 0, pl: 4 }}>
                {errors.map((e, i) => (
                    <Box component="li" key={`${e.node_id ?? 'graph'}-${i}`} sx={{ fontSize: 13 }}>
                        {e.message}
                    </Box>
                ))}
            </Box>
        </Alert>
    );
}

function WorkflowEditor({ initial }: { initial: IWorkflow }) {
    const navigate = useNavigate();
    const toast = useToast();
    const theme = useTheme();
    const phone = useMediaQuery(theme.breakpoints.down('sm'));
    const { screenToFlowPosition } = useReactFlow<WfNode, WfEdge>();
    const canvasRef = useRef<HTMLDivElement>(null);
    const [tab, setTab] = useTabParam<TabKey>(TAB_KEYS, 'builder');

    const { data: agents = [] } = useAgents();
    const { data: projects = [] } = useProjects();
    const { data: workflows = [] } = useWorkflows();
    const update = useUpdateWorkflow();
    const remove = useDeleteWorkflow();
    const start = useStartWorkflowRun();

    const [baseline, setBaseline] = useState(initial);
    const [settings, setSettings] = useState(initial);
    const [nodes, setNodes] = useState<WfNode[]>(() => toFlow(initial.graph).nodes);
    const [edges, setEdges] = useState<WfEdge[]>(() => toFlow(initial.graph).edges);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [serverErrors, setServerErrors] = useState<IWorkflowGraphError[]>([]);
    const [runOpen, setRunOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
    const draft = useMemo(() => ({ ...settings, graph }), [settings, graph]);
    const dirty = useMemo(
        () => JSON.stringify(toUpdate(draft)) !== JSON.stringify(toUpdate(baseline)),
        [draft, baseline]
    );
    useDraftGuard(dirty);

    // Another tab (or an SSE-driven refetch) saved this workflow: adopt it
    // unless the Owner has edits in flight. Keyed on updated_at only — the
    // draft must not reset on every render.
    useEffect(() => {
        if (dirty || initial.updated_at === baseline.updated_at) return;
        setBaseline(initial);
        setSettings(initial);
        const flow = toFlow(initial.graph);
        setNodes(flow.nodes);
        setEdges(flow.edges);
    }, [initial.updated_at]);

    useEffect(() => setServerErrors((prev) => (prev.length ? [] : prev)), [graph]);

    const clientErrors = useMemo(
        () => validateWorkflowGraph(graph, settings.input_kind),
        [graph, settings.input_kind]
    );
    const errors = clientErrors.length ? clientErrors : serverErrors;
    const errorNodeIds = useMemo(
        () => new Set(errors.flatMap((e) => (e.node_id ? [e.node_id] : []))),
        [errors]
    );

    const context = useMemo(
        () => ({
            agentsById: new Map(agents.map((a) => [a.id, a])),
            workflowsById: new Map(workflows.map((w) => [w.id, w])),
            errorNodeIds,
            runStates: null,
            delivery: settings,
        }),
        [agents, workflows, errorNodeIds, settings]
    );

    const onNodesChange = useCallback(
        (c: NodeChange<WfNode>[]) => setNodes((ns) => applyNodeChanges(c, ns)),
        []
    );
    const onEdgesChange = useCallback(
        (c: EdgeChange<WfEdge>[]) => setEdges((es) => applyEdgeChanges(c, es)),
        []
    );
    const onConnect = useCallback((c: Connection) => setEdges((es) => connectEdges(es, c)), []);
    const onSelectionChange = useCallback<OnSelectionChangeFunc<WfNode, WfEdge>>(
        ({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null),
        []
    );

    const addNode = useCallback(
        (item: IPaletteItem, screen?: { x: number; y: number }) => {
            const rect = canvasRef.current?.getBoundingClientRect();
            const at = screen ?? {
                x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
                y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
            };
            const p = screenToFlowPosition(at);
            const id = newNodeId(item.type);
            setNodes((ns) => {
                // Palette clicks all target the canvas centre; step each new
                // node down past any node already sitting there so they
                // never stack invisibly on top of each other.
                const position = { x: p.x, y: p.y - 32 };
                while (
                    ns.some(
                        (n) =>
                            Math.abs(n.position.x - position.x) < 40 &&
                            Math.abs(n.position.y - position.y) < 40
                    )
                ) {
                    position.y += 80;
                }
                const node: WfNode = {
                    id,
                    type: item.type,
                    position,
                    data: item.agent_id ? { agent_id: item.agent_id } : {},
                    selected: true,
                };
                return [...ns.map((n) => ({ ...n, selected: false })), node];
            });
            setSelectedId(id);
        },
        [screenToFlowPosition]
    );

    const onDrop = useCallback(
        (e: DragEvent<HTMLDivElement>) => {
            const raw = e.dataTransfer.getData(PALETTE_MIME);
            if (!raw) return;
            e.preventDefault();
            addNode(JSON.parse(raw) as IPaletteItem, { x: e.clientX, y: e.clientY });
        },
        [addNode]
    );

    const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
    const onNodeData = useCallback(
        (patch: IWfNodeData) =>
            setNodes((ns) =>
                ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n))
            ),
        [selectedId]
    );
    const onSettings = useCallback(
        (patch: Partial<IWorkflow>) => setSettings((s) => ({ ...s, ...patch })),
        []
    );

    async function save() {
        try {
            const saved = await update.mutateAsync({ id: baseline.id, input: toUpdate(draft) });
            setBaseline(saved);
            setSettings(saved);
            toast.show({ message: 'Workflow saved' });
        } catch (err) {
            setServerErrors(graphErrorsOf(err));
            toast.show({
                message: 'Could not save workflow',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async function runNow() {
        if (baseline.input_kind === 'item') {
            setRunOpen(true);
            return;
        }
        try {
            const { run_id } = await start.mutateAsync({ workflowId: baseline.id });
            navigate(`/workflows/${baseline.id}/runs/${run_id}`);
        } catch (err) {
            toast.show({
                message: 'Could not start run',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async function confirmDelete() {
        try {
            await remove.mutateAsync(baseline.id);
            toast.show({ message: `${baseline.name} deleted` });
            navigate('/workflows');
        } catch (err) {
            setDeleteOpen(false);
            toast.show({
                message: 'Could not delete workflow',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const projectName = projects.find((p) => p.id === settings.project_id)?.name ?? 'No project';
    const runDisabledReason =
        settings.input_kind === 'sub_task'
            ? 'Runs from a Task workflow’s Sub-tasks step'
            : dirty
              ? 'Save your changes before running'
              : start.isPending
                ? 'Starting…'
                : null;

    return (
        <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
            <WorkflowHeader
                workflow={draft}
                projectName={projectName}
                dirty={dirty}
                saveDisabled={!dirty || clientErrors.length > 0 || !settings.name.trim()}
                saving={update.isPending}
                runDisabledReason={runDisabledReason}
                onSave={() => void save()}
                onRun={() => void runNow()}
                onDelete={() => setDeleteOpen(true)}
            />

            <Box sx={{ borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`, mb: 3 }}>
                <Tabs
                    value={tab}
                    onChange={(_, v: TabKey) => setTab(v)}
                    sx={{
                        minHeight: 42,
                        '& .MuiTabs-indicator': {
                            backgroundColor: ATLAS_PALETTE.brandBlue,
                            height: 2,
                        },
                        '& .MuiTab-root': {
                            minHeight: 42,
                            textTransform: 'none',
                            fontWeight: 500,
                            fontSize: 13.5,
                            color: ATLAS_PALETTE.slate60,
                            '&.Mui-selected': { color: ATLAS_PALETTE.brandBlue, fontWeight: 600 },
                        },
                    }}
                >
                    <Tab value="builder" label="Builder" />
                    <Tab value="runs" label="Runs" />
                </Tabs>
            </Box>

            {tab === 'runs' ? (
                <WorkflowRunsTab workflowId={baseline.id} />
            ) : (
                <>
                    <GraphErrors errors={errors} />
                    {phone && (
                        <Alert severity="info" sx={{ mb: 3 }}>
                            The canvas is read-only on a phone. Open this workflow on a tablet or
                            desktop to edit it.
                        </Alert>
                    )}
                    <Box
                        sx={{
                            display: 'grid',
                            gap: 3,
                            gridTemplateColumns: {
                                xs: 'minmax(0, 1fr)',
                                md: '200px minmax(0, 1fr)',
                                lg: '220px minmax(0, 1fr) 320px',
                            },
                            gridTemplateRows: { lg: 'minmax(520px, calc(100vh - 300px))' },
                        }}
                    >
                        {!phone && (
                            <Box
                                sx={{
                                    display: 'flex',
                                    minHeight: 0,
                                    maxHeight: { xs: 280, md: 'calc(100vh - 300px)' },
                                }}
                            >
                                <NodePalette
                                    agents={agents}
                                    showSubtasks={settings.input_kind === 'item'}
                                    onAdd={(item) => addNode(item)}
                                />
                            </Box>
                        )}
                        <Box
                            ref={canvasRef}
                            sx={{ height: { xs: 420, md: 'calc(100vh - 300px)' }, minHeight: 420 }}
                        >
                            <WorkflowCanvas
                                nodes={nodes}
                                edges={edges}
                                context={context}
                                readOnly={phone}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onSelectionChange={onSelectionChange}
                                onDrop={onDrop}
                            />
                        </Box>
                        {!phone && (
                            <Box
                                sx={{
                                    gridColumn: { md: '1 / -1', lg: 'auto' },
                                    minHeight: 0,
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                <WorkflowInspector
                                    workflow={settings}
                                    node={selectedNode}
                                    agents={agents}
                                    projects={projects}
                                    workflows={workflows}
                                    onChange={onSettings}
                                    onNodeData={onNodeData}
                                />
                            </Box>
                        )}
                    </Box>
                </>
            )}

            {runOpen && <RunWorkflowDialog workflow={baseline} onClose={() => setRunOpen(false)} />}
            <ConfirmActionModal
                open={deleteOpen}
                title="Delete workflow?"
                body={`${baseline.name} and its run history will be removed. Items queued for it go back to unassigned.`}
                confirmLabel="Delete"
                tone="destructive"
                busy={remove.isPending}
                onCancel={() => setDeleteOpen(false)}
                onConfirm={() => void confirmDelete()}
            />
        </Box>
    );
}

export function WorkflowBuilder() {
    const { id = '' } = useParams<{ id: string }>();
    const { data: workflow, isLoading, error } = useWorkflow(id);
    useSetPageTitle(workflow?.name ?? 'Workflow', 'Workflow');

    if (isLoading) {
        return (
            <Box sx={{ p: 8, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={32} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }
    if (!workflow) {
        return (
            <Box sx={{ px: { xs: 3, md: 8 }, py: 4 }}>
                <Typography sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}>
                    {error instanceof AtlasApiError && error.status !== 404
                        ? error.message
                        : 'Workflow not found.'}
                </Typography>
            </Box>
        );
    }
    return (
        <ReactFlowProvider>
            <WorkflowEditor key={workflow.id} initial={workflow} />
        </ReactFlowProvider>
    );
}
