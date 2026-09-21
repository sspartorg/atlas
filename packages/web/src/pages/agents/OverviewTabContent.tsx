import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import { AGENT_CLIS, type IAgent } from '@atlas/shared';
import { useUpdateAgent } from '../../hooks/useAgents.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import type { AgentView } from './agentViewModel.js';
import { ModelSelect, modelsForCli } from '../../components/ModelSelect.js';
import { CliUnavailableAlert } from '../../components/CliUnavailableAlert.js';
import { useCliModels } from '../../hooks/useCliModels.js';
import { FormSection, FormRow } from '../../components/FormSection.js';
import { api } from '../../api/api.js';
import { QualityChecklistCard } from './QualityChecklistCard.js';

interface Props {
    agent: IAgent;
    view: AgentView;
}

export function OverviewTabContent({ agent, view }: Props) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const { data: cliModels = [] } = useCliModels();
    const [description, setDescription] = useState(view.description);
    const [editingDescription, setEditingDescription] = useState(false);
    const [cli, setCli] = useState(agent.cli);
    const [model, setModel] = useState(agent.model);
    const [effort, setEffort] = useState<IAgent['effort']>(agent.effort ?? 'medium');

    const isDirty =
        cli !== agent.cli || model !== agent.model || effort !== (agent.effort ?? 'medium');

    function handleSaveConfig() {
        updateAgent.mutate(
            { id: agent.id, data: { cli, model, effort } },
            { onSuccess: () => toast.show({ message: 'Configuration saved' }) }
        );
    }

    // The old CLI's model is never valid for the new one (walkthrough:
    // copilot→claude left "claude-sonnet-4.6 (not in registry)"), so jump
    // to the new CLI's registry default — ModelSelect's first option.
    function handleCliChange(next: IAgent['cli']) {
        setCli(next);
        if (next === agent.cli) {
            setModel(agent.model);
            return;
        }
        const first = modelsForCli(cliModels, next)[0];
        if (first) setModel(first.model_name);
    }

    function handleSaveDescription(next: string) {
        updateAgent.mutate(
            { id: agent.id, data: { description: next } },
            {
                onSuccess: () => {
                    toast.show({ message: 'Description saved' });
                    setEditingDescription(false);
                },
            }
        );
    }

    function handleDiscard() {
        setCli(agent.cli);
        setModel(agent.model);
        setEffort(agent.effort ?? 'medium');
    }

    return (
        <Box>
            <FormSection label="Description">
                {editingDescription ? (
                    <Box>
                        <TextField
                            fullWidth
                            multiline
                            minRows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            sx={{ '& .MuiOutlinedInput-root': { fontSize: 13.5 } }}
                        />
                        <Box
                            sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', mt: 1.5 }}
                        >
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={() => {
                                    setDescription(view.description);
                                    setEditingDescription(false);
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={() => handleSaveDescription(description)}
                                disabled={updateAgent.isPending || description === view.description}
                            >
                                {updateAgent.isPending ? 'Saving…' : 'Save'}
                            </Button>
                        </Box>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                        <Typography
                            sx={{
                                flex: 1,
                                fontSize: 13.5,
                                color: ATLAS_PALETTE.slate,
                                lineHeight: 1.6,
                            }}
                        >
                            {description}
                        </Typography>
                        <IconButton
                            size="small"
                            aria-label="Edit description"
                            onClick={() => setEditingDescription(true)}
                            sx={{ color: ATLAS_PALETTE.slate60 }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                aria-hidden="true"
                                sx={{ fontSize: 18 }}
                            >
                                edit
                            </Box>
                        </IconButton>
                    </Box>
                )}
            </FormSection>

            <RoleSection agent={agent} />

            <QualityChecklistCard agentId={agent.id} />

            <CommitDisciplineTile agentId={agent.id} />

            <FormSection label="Configuration">
                <CliUnavailableAlert cli={cli} sx={{ mb: 2 }} />
                <FormRow label="CLI">
                    <Select
                        size="small"
                        value={cli}
                        onChange={(e) => handleCliChange(e.target.value as IAgent['cli'])}
                        fullWidth
                        sx={{
                            fontSize: 13.5,
                            '& .MuiOutlinedInput-input': {
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12.5,
                                py: 1,
                            },
                        }}
                    >
                        {AGENT_CLIS.map((value) => (
                            <MenuItem key={value} value={value}>
                                {value}
                            </MenuItem>
                        ))}
                    </Select>
                </FormRow>
                <FormRow label="Model">
                    <ModelSelect
                        cli={cli}
                        value={model}
                        onChange={setModel}
                        fullWidth
                        size="dense"
                    />
                </FormRow>
                <FormRow label="Effort">
                    <Select
                        size="small"
                        value={effort}
                        onChange={(e) => setEffort(e.target.value as IAgent['effort'])}
                        fullWidth
                        sx={{
                            fontSize: 13.5,
                            '& .MuiOutlinedInput-input': {
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 12.5,
                                py: 1,
                            },
                        }}
                    >
                        <MenuItem value="none">none</MenuItem>
                        <MenuItem value="low">low</MenuItem>
                        <MenuItem value="medium">medium</MenuItem>
                        <MenuItem value="high">high</MenuItem>
                        <MenuItem value="xhigh">xhigh</MenuItem>
                        <MenuItem value="max">max</MenuItem>
                    </Select>
                </FormRow>

                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 1.5,
                        mt: 2,
                    }}
                >
                    <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60 }}>
                        {isDirty ? 'Unsaved changes' : 'No changes'}
                    </Typography>
                    {isDirty ? (
                        <Box
                            sx={{
                                display: 'flex',
                                gap: 1.5,
                                justifyContent: { xs: 'stretch', sm: 'flex-end' },
                                flexDirection: { xs: 'column', sm: 'row' },
                            }}
                        >
                            <Button
                                variant="outlined"
                                size="small"
                                onClick={handleDiscard}
                                sx={{ textTransform: 'none' }}
                            >
                                Discard
                            </Button>
                            <Button
                                variant="contained"
                                size="small"
                                onClick={handleSaveConfig}
                                disabled={updateAgent.isPending}
                                sx={{
                                    textTransform: 'none',
                                    bgcolor: ATLAS_PALETTE.green,
                                    '&:hover': { bgcolor: ATLAS_PALETTE.greenDark },
                                }}
                            >
                                Save changes
                            </Button>
                        </Box>
                    ) : null}
                </Box>
            </FormSection>
        </Box>
    );
}

// Role section: designation (human-readable role label) and memory_cadence
// (runs between automatic memory regenerations).
function RoleSection({ agent }: { agent: IAgent }) {
    const updateAgent = useUpdateAgent();
    const toast = useToast();
    const [designation, setDesignation] = useState(agent.designation ?? '');
    const [memoryCadence, setMemoryCadence] = useState<number>(agent.memory_cadence ?? 1);

    const dirty =
        designation !== (agent.designation ?? '') || memoryCadence !== (agent.memory_cadence ?? 1);

    function handleSave() {
        updateAgent.mutate(
            { id: agent.id, data: { designation, memory_cadence: memoryCadence } },
            { onSuccess: () => toast.show({ message: 'Role saved' }) }
        );
    }

    return (
        <FormSection label="Role">
            <FormRow label="Designation">
                <TextField
                    size="small"
                    fullWidth
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    placeholder="e.g. Product Owner"
                    helperText="Human-readable role shown next to the agent name."
                />
            </FormRow>

            <FormRow label="Memory cadence">
                <TextField
                    size="small"
                    type="number"
                    value={memoryCadence}
                    onChange={(e) =>
                        setMemoryCadence(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                    }
                    inputProps={{ min: 1, max: 100 }}
                    helperText="Runs between automatic memory regenerations (errors count double). Owner [lesson:] markers trigger high-signal regen regardless."
                />
            </FormRow>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                <Button
                    variant="contained"
                    size="small"
                    onClick={handleSave}
                    disabled={!dirty || updateAgent.isPending}
                >
                    {updateAgent.isPending ? 'Saving…' : 'Save role'}
                </Button>
            </Box>
        </FormSection>
    );
}

// Theme 11 — commit-discipline tile. Renders the agent's last 10
// commit verifications as colored dots. Tooltip per dot lists the
// run id, result, commit count, and any problems.
function CommitDisciplineTile({ agentId }: { agentId: string }) {
    const { data } = useQuery({
        queryKey: ['agents', agentId, 'commit-verifications'],
        queryFn: () => api.agents.getCommitVerifications(agentId, 10),
    });
    if (!data) return null;
    if (data.length === 0) {
        return (
            <FormSection label="Commit discipline">
                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                    No agent runs have been verified yet. The verifier audits commits every
                    issue-attached run completes.
                </Typography>
            </FormSection>
        );
    }
    const colorFor: Record<string, string> = {
        compliant: ATLAS_PALETTE.green,
        partial: '#D97706',
        silent: '#dc2626',
        clean: ATLAS_PALETTE.slate40,
    };
    return (
        <FormSection label="Commit discipline">
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
                {data.map((row) => {
                    const sha = row.problems[0]?.commit_sha ?? '';
                    const detail =
                        row.problems.length === 0
                            ? `run ${row.run_id.slice(0, 8)} · ${row.commit_count} commit(s)`
                            : row.problems
                                  .slice(0, 4)
                                  .map((p) =>
                                      p.commit_sha ? `${p.commit_sha}: ${p.reason}` : p.reason
                                  )
                                  .join('\n');
                    return (
                        <Tooltip
                            key={row.id}
                            arrow
                            title={
                                <Box sx={{ whiteSpace: 'pre-line', fontSize: 11.5 }}>
                                    <strong>{row.result}</strong>
                                    {'\n'}
                                    {detail}
                                    {sha && `\n[${sha}]`}
                                </Box>
                            }
                        >
                            <Box
                                sx={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: '50%',
                                    bgcolor: colorFor[row.result] ?? ATLAS_PALETTE.slate40,
                                    border: '1px solid rgba(0,0,0,0.08)',
                                }}
                            />
                        </Tooltip>
                    );
                })}
            </Box>
            <Typography sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                Newest first. Green = compliant, amber = partial (missing Refs or unconventional
                subject), red = silent (files changed, no commit), grey = clean (no work to verify).
            </Typography>
        </FormSection>
    );
}
