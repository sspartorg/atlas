import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { IJiraConfig } from '@atlas/shared';
import type { JiraConfigUpdate } from '../../api/api.js';
import { FormRow } from '../../components/FormSection.js';
import {
    useJiraConfig,
    useSyncJira,
    useTestJira,
    useUpdateJiraConfig,
} from '../../hooks/useJira.js';
import { useToast } from '../../hooks/useToast.js';
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
    const [siteUrl, setSiteUrl] = useState(cfg.site_url ?? '');
    const [email, setEmail] = useState(cfg.email ?? '');
    const [token, setToken] = useState('');
    const [interval, setIntervalMinutes] = useState(String(cfg.poll_interval_minutes));
    const [extra, setExtra] = useState(cfg.extra_fields.join(', '));

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
                subtitle="Every poll runs each source's JQL and turns each new issue into a Task, with its description, comments and fields. Progress and the final PRs are posted back as Jira comments; a Task reaching Done moves its issue to Done. Sources live on each project — open a project and its Jira tab to add a query, the workflow that works it, and the repos it touches."
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
                                <Box
                                    component="span"
                                    sx={{ fontFamily: TYPOGRAPHY.fontFamilyMono }}
                                >
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
                        disabled={sync.isPending || !cfg.api_token_set || !cfg.enabled}
                        title={
                            cfg.enabled
                                ? undefined
                                : 'Turn on Import to sync — a sync writes comments to the matched Jira issues.'
                        }
                    >
                        {sync.isPending ? 'Syncing…' : 'Sync now'}
                    </Button>
                </Box>
            </SettingsSection>

        </Box>
    );
}
