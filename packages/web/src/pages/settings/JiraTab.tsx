import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import type { IJiraConfig, IJiraLabelWorkflow } from '@atlas/shared';
import type { JiraConfigUpdate } from '../../api/api.js';
import { FormRow } from '../../components/FormSection.js';
import {
    useJiraConfig,
    useSyncJira,
    useTestJira,
    useUpdateJiraConfig,
} from '../../hooks/useJira.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useToast } from '../../hooks/useToast.js';
import { useWorkflows } from '../../hooks/useWorkflows.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { SettingsSection } from './SettingsSection.js';

export function JiraTab() {
    const { data: cfg } = useJiraConfig();
    // Mount the form only once the saved config is in, so its fields start from it.
    return cfg ? <JiraForm cfg={cfg} /> : null;
}

function JiraForm({ cfg }: { cfg: IJiraConfig }) {
    const update = useUpdateJiraConfig();
    const test = useTestJira();
    const sync = useSyncJira();
    const toast = useToast();
    const { data: projects = [] } = useProjects();
    const { data: workflows = [] } = useWorkflows();

    const [siteUrl, setSiteUrl] = useState(cfg.site_url ?? '');
    const [email, setEmail] = useState(cfg.email ?? '');
    const [token, setToken] = useState('');
    const [jql, setJql] = useState(cfg.jql ?? '');
    const [interval, setIntervalMinutes] = useState(String(cfg.poll_interval_minutes));
    const [extra, setExtra] = useState(cfg.extra_fields.join(', '));
    const [newLabel, setNewLabel] = useState('');
    const [newProject, setNewProject] = useState('');
    const [newWorkflow, setNewWorkflow] = useState('');

    // A rule's workflow must be global or live in the project the rule sends the issue to.
    const ruleProject = newProject || cfg.project_id;
    const options = workflows.filter(
        (w) => w.input_kind === 'item' && (!w.project_id || w.project_id === ruleProject)
    );
    const workflowName = (id: string | null) =>
        id ? (workflows.find((w) => w.id === id)?.name ?? id) : 'No workflow: you pick one';
    const projectName = (id: string | null) =>
        id ? (projects.find((p) => p.id === id)?.name ?? id) : 'Default project';

    function save(patch: JiraConfigUpdate, message = 'Jira settings saved') {
        update.mutate(patch, {
            onSuccess: () => toast.show({ message }),
            onError: (err) => toast.show({ message: 'Could not save', detail: err.message }),
        });
    }

    function commitText(field: 'site_url' | 'email' | 'jql', value: string) {
        const next = value.trim() || null;
        if (next !== cfg[field]) save({ [field]: next });
    }

    function commitToken() {
        if (!token.trim()) return;
        // Sent with the site and email: the API drops a stored token whenever
        // either changes without one, so they must land together.
        save(
            {
                api_token: token.trim(),
                site_url: siteUrl.trim() || null,
                email: email.trim() || null,
            },
            'API token saved'
        );
        setToken('');
    }

    function commitInterval() {
        const minutes = Number(interval);
        if (!Number.isInteger(minutes) || minutes < 5) {
            setIntervalMinutes(String(cfg.poll_interval_minutes));
            return;
        }
        if (minutes !== cfg.poll_interval_minutes) save({ poll_interval_minutes: minutes });
    }

    function commitExtra() {
        const fields = extra
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean);
        if (fields.join('\n') !== cfg.extra_fields.join('\n')) save({ extra_fields: fields });
    }

    function saveMappings(next: IJiraLabelWorkflow[]) {
        save({ label_workflows: next }, 'Label mapping saved');
    }

    function addMapping() {
        const label = newLabel.trim();
        if (!label || (!newProject && !newWorkflow)) return;
        saveMappings([
            ...cfg.label_workflows.filter((m) => m.label !== label),
            { label, project_id: newProject || null, workflow_id: newWorkflow || null },
        ]);
        setNewLabel('');
        setNewProject('');
        setNewWorkflow('');
    }

    function runTest() {
        test.mutate(undefined, {
            onSuccess: (r) => toast.show({ message: `Connected to Jira as ${r.display_name}` }),
            onError: (err) =>
                toast.show({ message: 'Jira connection failed', detail: err.message }),
        });
    }

    function runSync() {
        sync.mutate(undefined, {
            onSuccess: (r) =>
                toast.show({
                    message: `Jira sync: ${r.imported} imported, ${r.comments_posted} comment(s) posted`,
                }),
            onError: (err) => toast.show({ message: 'Jira sync failed', detail: err.message }),
        });
    }

    return (
        <Box>
            <SettingsSection
                title="Jira connection"
                subtitle="Your Atlassian site and an API token from id.atlassian.com → Security → API tokens. The token is stored encrypted and never shown again."
            >
                <FormRow label="Site URL">
                    <TextField
                        fullWidth
                        size="small"
                        value={siteUrl}
                        placeholder="https://your-site.atlassian.net"
                        onChange={(e) => setSiteUrl(e.target.value)}
                        onBlur={() => commitText('site_url', siteUrl)}
                    />
                </FormRow>
                <FormRow label="Email">
                    <TextField
                        fullWidth
                        size="small"
                        type="email"
                        value={email}
                        placeholder="you@example.com"
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => commitText('email', email)}
                    />
                </FormRow>
                <FormRow label="API token">
                    <TextField
                        fullWidth
                        size="small"
                        type="password"
                        autoComplete="off"
                        value={token}
                        placeholder={
                            cfg.api_token_set
                                ? 'Stored. Type to replace.'
                                : 'Paste your Jira API token'
                        }
                        onChange={(e) => setToken(e.target.value)}
                        onBlur={commitToken}
                        slotProps={{ htmlInput: { 'aria-label': 'Jira API token' } }}
                    />
                </FormRow>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={runTest}
                        disabled={test.isPending || !cfg.api_token_set}
                    >
                        {test.isPending ? 'Testing…' : 'Test connection'}
                    </Button>
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Import"
                subtitle="Every poll runs the JQL and turns each new issue into a Task, with its description, comments and fields. Progress and the final PR are posted back as Jira comments; a Task reaching Done moves its issue to Done."
                rightAdornment={
                    <Switch
                        checked={cfg.enabled}
                        onChange={(e) =>
                            save(
                                { enabled: e.target.checked },
                                e.target.checked ? 'Jira sync on' : 'Jira sync off'
                            )
                        }
                        slotProps={{ input: { 'aria-label': 'Jira sync enabled' } }}
                    />
                }
            >
                <FormRow label="Default project">
                    <Select
                        size="small"
                        fullWidth
                        displayEmpty
                        // Until the projects list loads, an id with no matching option is out of range for MUI.
                        value={
                            projects.some((p) => p.id === cfg.project_id)
                                ? (cfg.project_id ?? '')
                                : ''
                        }
                        onChange={(e) => save({ project_id: e.target.value || null })}
                        inputProps={{ 'aria-label': 'Default project' }}
                    >
                        <MenuItem value="">Pick where unrouted issues go</MenuItem>
                        {projects.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
                            </MenuItem>
                        ))}
                    </Select>
                </FormRow>
                <FormRow label="JQL">
                    <TextField
                        fullWidth
                        size="small"
                        multiline
                        minRows={2}
                        value={jql}
                        placeholder='project = DHEQ AND status = "Selected for Development"'
                        onChange={(e) => setJql(e.target.value)}
                        onBlur={() => commitText('jql', jql)}
                        slotProps={{ htmlInput: { 'aria-label': 'JQL' } }}
                        sx={{
                            '& .MuiInputBase-input': {
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 13,
                            },
                        }}
                    />
                </FormRow>
                <FormRow label="Poll every">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <TextField
                            size="small"
                            type="number"
                            value={interval}
                            onChange={(e) => setIntervalMinutes(e.target.value)}
                            onBlur={commitInterval}
                            slotProps={{
                                htmlInput: { min: 5, 'aria-label': 'Poll interval in minutes' },
                            }}
                            sx={{ width: 120 }}
                        />
                        <Typography
                            component="span"
                            sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}
                        >
                            minutes
                        </Typography>
                    </Box>
                </FormRow>
                <FormRow label="Extra fields">
                    <TextField
                        fullWidth
                        size="small"
                        value={extra}
                        placeholder="Acceptance Criteria, customfield_10016"
                        helperText="Comma-separated Jira field names or ids to copy into the Task."
                        onChange={(e) => setExtra(e.target.value)}
                        onBlur={commitExtra}
                    />
                </FormRow>
                <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 2, pt: 1, flexWrap: 'wrap' }}
                >
                    <Typography
                        sx={{
                            flex: 1,
                            minWidth: 200,
                            fontSize: 12.5,
                            color:
                                cfg.last_sync_ok === false
                                    ? ATLAS_PALETTE.dangerFg
                                    : ATLAS_PALETTE.slate60,
                        }}
                    >
                        {cfg.last_sync_at ? (
                            <>
                                Last sync{' '}
                                <Box component="span" sx={{ fontFamily: 'mono' }}>
                                    {new Date(cfg.last_sync_at).toLocaleString()}
                                </Box>
                                {cfg.last_sync_message ? ` · ${cfg.last_sync_message}` : ''}
                            </>
                        ) : (
                            'Not synced yet'
                        )}
                    </Typography>
                    <Button
                        variant="contained"
                        size="small"
                        onClick={runSync}
                        disabled={sync.isPending || !cfg.api_token_set}
                    >
                        {sync.isPending ? 'Syncing…' : 'Sync now'}
                    </Button>
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Label → project and workflow"
                subtitle="An imported issue carrying one of these labels becomes a Task in that project and is queued on that workflow. The first matching rule wins. Issues matching no rule go to the default project. Issues without a workflow wait as drafts and notify you to pick one."
            >
                {cfg.label_workflows.map((m) => (
                    <FormRow key={m.label} label={m.label}>
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 2,
                            }}
                        >
                            <Typography sx={{ fontSize: 13 }}>
                                {projectName(m.project_id)} · {workflowName(m.workflow_id)}
                            </Typography>
                            <IconButton
                                size="small"
                                aria-label={`Remove mapping for ${m.label}`}
                                onClick={() =>
                                    saveMappings(
                                        cfg.label_workflows.filter((x) => x.label !== m.label)
                                    )
                                }
                            >
                                <DeleteOutlineRounded sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Box>
                    </FormRow>
                ))}
                <Box sx={{ display: 'flex', gap: 2, pt: 1, flexWrap: 'wrap' }}>
                    <TextField
                        size="small"
                        value={newLabel}
                        placeholder="Jira label"
                        onChange={(e) => setNewLabel(e.target.value)}
                        slotProps={{ htmlInput: { 'aria-label': 'Jira label' } }}
                        sx={{ flex: 1, minWidth: 160 }}
                    />
                    <Select
                        size="small"
                        displayEmpty
                        value={newProject}
                        onChange={(e) => {
                            setNewProject(e.target.value);
                            setNewWorkflow('');
                        }}
                        inputProps={{ 'aria-label': 'Project for label' }}
                        sx={{ flex: 1, minWidth: 180 }}
                    >
                        <MenuItem value="">Default project</MenuItem>
                        {projects.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
                            </MenuItem>
                        ))}
                    </Select>
                    <Select
                        size="small"
                        displayEmpty
                        value={newWorkflow}
                        onChange={(e) => setNewWorkflow(e.target.value)}
                        inputProps={{ 'aria-label': 'Workflow for label' }}
                        sx={{ flex: 1, minWidth: 180 }}
                    >
                        <MenuItem value="">No workflow: I pick</MenuItem>
                        {options.map((w) => (
                            <MenuItem key={w.id} value={w.id}>
                                {w.name}
                            </MenuItem>
                        ))}
                    </Select>
                    <Button
                        variant="outlined"
                        size="small"
                        onClick={addMapping}
                        disabled={!newLabel.trim() || (!newProject && !newWorkflow)}
                    >
                        Add
                    </Button>
                </Box>
            </SettingsSection>
        </Box>
    );
}
