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
import type { IJiraConfig, IJiraSource } from '@atlas/shared';
import type { JiraConfigUpdate } from '../../api/api.js';
import { FormRow } from '../../components/FormSection.js';
import {
    useJiraConfig,
    useSyncJira,
    useTestJira,
    useUpdateJiraConfig,
} from '../../hooks/useJira.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useAllRepos } from '../../hooks/useProjectRepos.js';
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
    const { data: repos = [] } = useAllRepos();
    const { data: workflows = [] } = useWorkflows();

    const [siteUrl, setSiteUrl] = useState(cfg.site_url ?? '');
    const [email, setEmail] = useState(cfg.email ?? '');
    const [token, setToken] = useState('');
    const [interval, setIntervalMinutes] = useState(String(cfg.poll_interval_minutes));
    const [extra, setExtra] = useState(cfg.extra_fields.join(', '));
    const [newRepo, setNewRepo] = useState('');
    const [newJql, setNewJql] = useState('');
    const [newWorkflow, setNewWorkflow] = useState('');

    // A source's workflow must be global or live in the project of the source's repo.
    const newRepoProject = repos.find((r) => r.id === newRepo)?.project_id;
    const options = workflows.filter(
        (w) => w.input_kind === 'item' && (!w.project_id || w.project_id === newRepoProject)
    );
    const workflowName = (id: string | null) =>
        id ? (workflows.find((w) => w.id === id)?.name ?? id) : 'No workflow: you pick one';
    const repoLabel = (id: string) => {
        const repo = repos.find((r) => r.id === id);
        if (!repo) return id;
        const project = projects.find((p) => p.id === repo.project_id)?.name ?? repo.project_id;
        return `${project} / ${repo.name}`;
    };

    function save(patch: JiraConfigUpdate, message = 'Jira settings saved') {
        update.mutate(patch, {
            onSuccess: () => toast.show({ message }),
            onError: (err) => toast.show({ message: 'Could not save', detail: err.message }),
        });
    }

    function commitText(field: 'site_url' | 'email', value: string) {
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

    function saveSources(next: IJiraSource[], message: string) {
        save({ sources: next }, message);
    }

    function addSource() {
        const jql = newJql.trim();
        if (!newRepo || !jql) return;
        saveSources(
            [...cfg.sources, { repo_id: newRepo, jql, workflow_id: newWorkflow || null }],
            'Jira source added'
        );
        setNewRepo('');
        setNewJql('');
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
                subtitle="Every poll runs each source's JQL and turns each new issue into a Task, with its description, comments and fields. Progress and the final PRs are posted back as Jira comments; a Task reaching Done moves its issue to Done."
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
                                <Box component="span" sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}>
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
                title="Sources"
                subtitle="One JQL per repo. An issue matching several sources becomes one Task spanning those repos, in the project of the first source it matches; its repos in other projects are named in the notification. The first matching source with a workflow queues it; without one it waits as a draft and notifies you to pick one."
            >
                {cfg.sources.map((s, i) => (
                    <FormRow key={`${i}:${s.repo_id}:${s.jql}`} label={repoLabel(s.repo_id)}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontFamily: TYPOGRAPHY.fontFamilyMono,
                                        fontSize: 13,
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere',
                                    }}
                                >
                                    {s.jql}
                                </Typography>
                                <Typography sx={{ fontSize: 12.5, color: ATLAS_PALETTE.slate60 }}>
                                    {workflowName(s.workflow_id)}
                                </Typography>
                            </Box>
                            <IconButton
                                size="small"
                                aria-label={`Remove source ${i + 1}`}
                                onClick={() =>
                                    saveSources(
                                        cfg.sources.filter((_, j) => j !== i),
                                        'Jira source removed'
                                    )
                                }
                            >
                                <DeleteOutlineRounded sx={{ fontSize: 18 }} />
                            </IconButton>
                        </Box>
                    </FormRow>
                ))}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}>
                    <Select
                        size="small"
                        fullWidth
                        displayEmpty
                        value={newRepo}
                        onChange={(e) => {
                            setNewRepo(e.target.value);
                            setNewWorkflow('');
                        }}
                        inputProps={{ 'aria-label': 'Source repo' }}
                    >
                        <MenuItem value="">Pick a repo</MenuItem>
                        {repos.map((r) => (
                            <MenuItem key={r.id} value={r.id}>
                                {repoLabel(r.id)}
                            </MenuItem>
                        ))}
                    </Select>
                    <TextField
                        fullWidth
                        size="small"
                        multiline
                        minRows={2}
                        value={newJql}
                        placeholder='project = ATL AND status = "Selected for Development"'
                        onChange={(e) => setNewJql(e.target.value)}
                        slotProps={{ htmlInput: { 'aria-label': 'Source JQL' } }}
                        sx={{
                            '& .MuiInputBase-input': {
                                fontFamily: TYPOGRAPHY.fontFamilyMono,
                                fontSize: 13,
                            },
                        }}
                    />
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <Select
                            size="small"
                            displayEmpty
                            value={newWorkflow}
                            onChange={(e) => setNewWorkflow(e.target.value)}
                            inputProps={{ 'aria-label': 'Source workflow' }}
                            sx={{ flex: 1, minWidth: 0 }}
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
                            onClick={addSource}
                            disabled={!newRepo || !newJql.trim()}
                        >
                            Add source
                        </Button>
                    </Box>
                </Box>
            </SettingsSection>
        </Box>
    );
}
