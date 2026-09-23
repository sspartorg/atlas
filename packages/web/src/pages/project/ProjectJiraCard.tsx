import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import SyncRounded from '@mui/icons-material/SyncRounded';
import type { IJiraSource, IProject } from '@atlas/shared';
import { Link as RouterLink } from 'react-router-dom';
import {
    useCreateJiraSource,
    useDeleteJiraSource,
    useJiraConfig,
    useSyncJira,
    useUpdateJiraSource,
    useProjectJiraSources,
} from '../../hooks/useJira.js';
import { useProjectRepos } from '../../hooks/useProjectRepos.js';
import { useWorkflows } from '../../hooks/useWorkflows.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { ConfirmActionModal } from '../../components/ConfirmActionModal.js';
import { RowActionMenu } from '../../components/RowActionMenu.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    project: IProject;
}

/**
 * A project's Jira sources: query + workflow + repos, one row per combo.
 *
 * These used to be a single global list in Settings → Jira, each entry naming
 * ONE repo, with the project inferred from that repo. The Owner's model is a
 * combo per query, so they live on the project they feed.
 */
export function ProjectJiraCard({ project }: Props) {
    const projectId = project.id;
    const { data: sources, isLoading, error } = useProjectJiraSources(projectId);
    const { data: cfg } = useJiraConfig();
    const { data: repos = [] } = useProjectRepos(projectId);
    const { data: workflows = [] } = useWorkflows();
    const remove = useDeleteJiraSource(projectId);
    const sync = useSyncJira();
    const toast = useToast();
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<IJiraSource | null>(null);
    const [removing, setRemoving] = useState<IJiraSource | null>(null);

    const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? id;
    const workflowName = (id: string | null) =>
        id ? (workflows.find((w) => w.id === id)?.name ?? id) : null;

    async function confirmRemove() {
        if (!removing) return;
        try {
            await remove.mutateAsync(removing.id);
            toast.show({ message: 'Source removed' });
        } catch (e) {
            toast.show({
                message: e instanceof Error ? e.message : 'Could not remove the source',
            });
        }
        setRemoving(null);
    }

    async function runSync() {
        try {
            const r = await sync.mutateAsync();
            // Same wording as Settings → Jira: one sync, one sentence.
            toast.show({
                message: `Jira sync: ${r.imported} imported, ${r.comments_posted} comment(s) posted`,
            });
        } catch (e) {
            toast.show({ message: e instanceof Error ? e.message : 'Sync failed' });
        }
    }

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                        sx={{ fontSize: 16, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                    >
                        Jira sources
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        Each source is one JQL, the workflow that works what it finds, and the
                        repos those Tasks touch. Every poll runs each one and turns new issues
                        into Tasks. A source with no workflow leaves its Tasks as drafts and
                        notifies you. An issue matching sources in two projects becomes one Task,
                        under the source that was created first. Scope each JQL narrowly on a
                        board you share with other people.
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<SyncRounded />}
                        onClick={() => void runSync()}
                        disabled={sync.isPending || !cfg?.api_token_set || !cfg?.enabled}
                        title={
                            cfg?.enabled
                                ? undefined
                                : 'Turn on Import in Settings → Jira to sync — a sync writes comments to the matched Jira issues.'
                        }
                        sx={{ textTransform: 'none' }}
                    >
                        {sync.isPending ? 'Syncing…' : 'Sync now'}
                    </Button>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<AddRounded />}
                        onClick={() => setAdding(true)}
                        sx={{ textTransform: 'none' }}
                    >
                        Add source
                    </Button>
                </Box>
            </Box>

            {cfg && !cfg.api_token_set && (
                <Alert severity="info" sx={{ mb: 3 }}>
                    Connect your Jira site in{' '}
                    <RouterLink to="/settings?tab=jira">Settings → Jira</RouterLink> first — one
                    site and token is shared by every project.
                </Alert>
            )}

            {cfg?.api_token_set && !cfg.enabled && (
                <Alert severity="warning" sx={{ mb: 3 }}>
                    Import is switched off, so these sources are not polled and no progress
                    reaches Jira. Turn it on in{' '}
                    <RouterLink to="/settings?tab=jira">Settings → Jira</RouterLink>.
                </Alert>
            )}

            {isLoading && (
                <Skeleton variant="rectangular" height={64} sx={{ borderRadius: '8px' }} />
            )}
            {error && (
                <Alert severity="error">
                    {error instanceof Error ? error.message : 'Could not load the sources'}
                </Alert>
            )}

            {sources?.length === 0 && (
                <Box sx={{ py: 5, textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                        No Jira sources yet
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                        Add a query and the workflow that should work what it finds.
                    </Typography>
                </Box>
            )}

            {sources?.map((s) => (
                <Box
                    key={s.id}
                    data-testid={`jira-source-${s.id}`}
                    sx={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 2,
                        py: 2,
                        borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                        '&:first-of-type': { borderTop: 0 },
                    }}
                >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 13,
                                color: ATLAS_PALETTE.slate,
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {s.jql}
                        </Typography>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                mt: 1,
                                flexWrap: 'wrap',
                            }}
                        >
                            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                                {workflowName(s.workflow_id) ?? 'No workflow — you pick one'}
                            </Typography>
                            {s.repo_ids.map((id) => (
                                <Chip
                                    key={id}
                                    label={repoName(id)}
                                    size="small"
                                    sx={{ fontFamily: MONO, fontSize: 11 }}
                                />
                            ))}
                        </Box>
                    </Box>
                    <RowActionMenu
                        ariaLabel={`Actions for source ${s.id}`}
                        items={[
                            {
                                label: 'Edit',
                                icon: <EditRounded fontSize="small" />,
                                onClick: () => setEditing(s),
                            },
                            {
                                label: 'Remove',
                                icon: <DeleteOutlineRounded fontSize="small" />,
                                onClick: () => setRemoving(s),
                                danger: true,
                                dividerAbove: true,
                            },
                        ]}
                    />
                </Box>
            ))}

            {(adding || editing) && (
                <JiraSourceDialog
                    projectId={projectId}
                    source={editing}
                    onClose={() => {
                        setAdding(false);
                        setEditing(null);
                    }}
                />
            )}
            <ConfirmActionModal
                open={removing !== null}
                title="Remove this source?"
                body="Atlas stops importing issues that match it. Tasks it already created stay."
                confirmLabel="Remove"
                tone="destructive"
                busy={remove.isPending}
                onCancel={() => setRemoving(null)}
                onConfirm={() => void confirmRemove()}
            />
        </Box>
    );
}

function JiraSourceDialog({
    projectId,
    source,
    onClose,
}: {
    projectId: string;
    source: IJiraSource | null;
    onClose: () => void;
}) {
    const { data: repos = [] } = useProjectRepos(projectId);
    const { data: workflows = [] } = useWorkflows();
    const create = useCreateJiraSource(projectId);
    const update = useUpdateJiraSource(projectId);
    const toast = useToast();

    const [jql, setJql] = useState(source?.jql ?? '');
    const [workflowId, setWorkflowId] = useState(source?.workflow_id ?? '');
    // A Task must name at least one repo, so a new source starts with all of
    // them — the common case is a project whose every repo is in scope.
    const [repoIds, setRepoIds] = useState<string[]>(
        source?.repo_ids ?? repos.map((r) => r.id)
    );
    const [error, setError] = useState<string | null>(null);

    // Only workflows that take Tasks, and only this project's (or global) ones.
    const options = workflows.filter(
        (w) => w.input_kind === 'item' && (!w.project_id || w.project_id === projectId)
    );
    const busy = create.isPending || update.isPending;
    const canSave = jql.trim().length > 0 && repoIds.length > 0 && !busy;

    async function save() {
        setError(null);
        const data = {
            jql: jql.trim(),
            workflow_id: workflowId || null,
            repo_ids: repoIds,
        };
        try {
            if (source) await update.mutateAsync({ id: source.id, data });
            else await create.mutateAsync(data);
            toast.show({ message: source ? 'Source saved' : 'Source added' });
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the source');
        }
    }

    return (
        <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600 }}>
                {source ? 'Edit source' : 'Add source'}
            </DialogTitle>
            <DialogContent
                sx={{ display: 'flex', flexDirection: 'column', gap: 4, pt: '8px !important' }}
            >
                <TextField
                    label="JQL"
                    value={jql}
                    onChange={(e) => setJql(e.target.value)}
                    multiline
                    minRows={2}
                    fullWidth
                    placeholder="project = ATL AND labels = api"
                    slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 13 } } }}
                    helperText="Issues this query returns become Tasks in this project."
                />
                <TextField
                    select
                    label="Workflow"
                    value={workflowId}
                    onChange={(e) => setWorkflowId(e.target.value)}
                    fullWidth
                    helperText="Leave empty to review each Task before it runs."
                >
                    <MenuItem value="">No workflow</MenuItem>
                    {options.map((w) => (
                        <MenuItem key={w.id} value={w.id}>
                            {w.name}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    select
                    label="Repos"
                    value={repoIds}
                    onChange={(e) =>
                        setRepoIds(
                            typeof e.target.value === 'string'
                                ? e.target.value.split(',')
                                : (e.target.value as unknown as string[])
                        )
                    }
                    slotProps={{ select: { multiple: true } }}
                    fullWidth
                    error={repoIds.length === 0}
                    helperText="The repos these Tasks work on; the first holds the Task-wide files."
                >
                    {repos.map((r) => (
                        <MenuItem key={r.id} value={r.id}>
                            {r.name}
                        </MenuItem>
                    ))}
                </TextField>
                {error && <Alert severity="error">{error}</Alert>}
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                <Button variant="outlined" onClick={onClose} disabled={busy}>
                    Cancel
                </Button>
                <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
                    {busy ? 'Saving…' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
