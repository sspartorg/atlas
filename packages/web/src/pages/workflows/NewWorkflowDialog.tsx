import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import type { IAgent } from '@atlas/shared';
import { useProjects } from '../../hooks/useProjects.js';
import { useAgents } from '../../hooks/useAgents.js';
import {
    useCreateWorkflow,
    useCreateWorkflowFromTemplate,
    useWorkflowTemplates,
} from '../../hooks/useWorkflows.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { INPUT_KIND_LABEL, agentLabel, deliveryLabel, graphAgentIds } from './labels.js';

const BLANK = 'blank';

interface OptionCardProps {
    title: string;
    description: string;
    meta: string;
    selected: boolean;
    onClick: () => void;
    children?: React.ReactNode;
}

function OptionCard({ title, description, meta, selected, onClick, children }: OptionCardProps) {
    return (
        <Box
            role="radio"
            aria-checked={selected}
            aria-label={title}
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onClick();
            }}
            sx={{
                p: 3,
                borderRadius: '12px',
                cursor: 'pointer',
                border: `1.5px solid ${selected ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate10}`,
                background: selected ? ATLAS_PALETTE.accentSoft : ATLAS_PALETTE.white,
                transition: 'border-color 120ms ease, background 120ms ease',
                '&:hover': { borderColor: selected ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate30 },
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: ATLAS_PALETTE.slate }}>
                    {title}
                </Typography>
                <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, whiteSpace: 'nowrap' }}>
                    {meta}
                </Typography>
            </Box>
            <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                {description}
            </Typography>
            {children}
        </Box>
    );
}

export function AgentChips({ ids, agentsById }: { ids: string[]; agentsById: Map<string, Pick<IAgent, 'name' | 'accent_color'>> }) {
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
            {ids.map((id, i) => {
                const agent = agentsById.get(id);
                return (
                    <Box
                        key={`${id}-${i}`}
                        component="span"
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1.5,
                            height: 22,
                            px: 2,
                            borderRadius: '9999px',
                            fontSize: 11,
                            fontWeight: 500,
                            color: ATLAS_PALETTE.slate80,
                            background: ATLAS_PALETTE.white,
                            border: `1px ${agent ? 'solid' : 'dashed'} ${ATLAS_PALETTE.slate12}`,
                        }}
                    >
                        <Box
                            component="span"
                            sx={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: agent?.accent_color ?? ATLAS_PALETTE.slate30,
                            }}
                        />
                        {agentLabel(id, agentsById)}
                    </Box>
                );
            })}
        </Box>
    );
}

export function NewWorkflowDialog({
    open,
    onClose,
    templateId = BLANK,
}: {
    open: boolean;
    onClose: () => void;
    /** Pre-selects a template (the marketplace's "Use in a project"). */
    templateId?: string;
}) {
    const navigate = useNavigate();
    const { data: projects = [] } = useProjects();
    const { data: agents = [] } = useAgents();
    const { data: templates = [] } = useWorkflowTemplates({ enabled: open });
    const createBlank = useCreateWorkflow();
    const createFromTemplate = useCreateWorkflowFromTemplate();
    const [projectId, setProjectId] = useState('');
    const [choice, setChoice] = useState(templateId);

    const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
    const pending = createBlank.isPending || createFromTemplate.isPending;
    const error = createBlank.error ?? createFromTemplate.error;
    const selectedTemplate = templates.find((t) => t.id === choice);
    const missing = selectedTemplate
        ? [...new Set(graphAgentIds(selectedTemplate.graph))].filter((id) => !agentsById.has(id))
        : [];

    async function handleCreate() {
        const wf =
            choice === BLANK
                ? await createBlank.mutateAsync({ name: 'Untitled workflow', project_id: projectId })
                : await createFromTemplate.mutateAsync({ templateId: choice, projectId });
        onClose();
        navigate(`/workflows/${wf.id}`);
    }

    return (
        <Dialog open={open} onClose={pending ? undefined : onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pb: 2 }}>New workflow</DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 4, pt: '8px !important' }}>
                <TextField
                    select
                    label="Project"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    fullWidth
                    helperText="Workflows run on one project's repository and items."
                >
                    {projects.map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                            {p.name}
                        </MenuItem>
                    ))}
                </TextField>

                <Box
                    role="radiogroup"
                    aria-label="Start from"
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                        gap: 3,
                    }}
                >
                    <OptionCard
                        title="Blank"
                        description="A Start and an End node. Drag agents in and connect them yourself."
                        meta="Per Task · Push + PR"
                        selected={choice === BLANK}
                        onClick={() => setChoice(BLANK)}
                    />
                    {templates.map((t) => (
                        <OptionCard
                            key={t.id}
                            title={t.name}
                            description={t.description}
                            meta={`${INPUT_KIND_LABEL[t.input_kind]} · ${deliveryLabel(t)}`}
                            selected={choice === t.id}
                            onClick={() => setChoice(t.id)}
                        >
                            <AgentChips ids={graphAgentIds(t.graph)} agentsById={agentsById} />
                        </OptionCard>
                    ))}
                </Box>

                {missing.length > 0 && (
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        Installs from the marketplace: {missing.map((id) => agentLabel(id, agentsById)).join(', ')}
                    </Typography>
                )}
                {error && <Alert severity="error">{error.message}</Alert>}
            </DialogContent>
            <DialogActions sx={{ px: 6, pb: 4, gap: 2 }}>
                <Button variant="outlined" onClick={onClose} disabled={pending}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={() => void handleCreate().catch(() => undefined)}
                    disabled={!projectId || pending}
                    sx={{
                        bgcolor: ATLAS_PALETTE.green,
                        boxShadow: 'none',
                        '&:hover': { bgcolor: ATLAS_PALETTE.greenDark, boxShadow: 'none' },
                    }}
                >
                    {pending ? 'Creating…' : 'Create workflow'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
