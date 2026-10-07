import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ITeamConfig, TeamConfigRole } from '@atlas/shared';
import type { TeamConfigUpdate } from '../../api/api.js';
import { FormRow } from '../../components/FormSection.js';
import { MarkdownPreview } from '../../components/MarkdownPreview.js';
import { useCredentials } from '../../hooks/useCredentials.js';
import {
    useSyncTeamConfig,
    useTeamConfig,
    useTeamConfigHelp,
    useUpdateTeamConfig,
} from '../../hooks/useTeamConfig.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE, TYPOGRAPHY } from '../../theme/tokens.js';
import { SettingsSection } from './SettingsSection.js';

const ROLES: Array<{ value: TeamConfigRole; label: string; help: string }> = [
    { value: 'off', label: 'Off', help: 'Nothing syncs.' },
    {
        value: 'publisher',
        label: 'Publisher',
        help: 'I maintain the team config. Projects I include (Project → Include in team config) are pushed within a minute of a change.',
    },
    {
        value: 'subscriber',
        label: 'Subscriber',
        help: 'I use the team config. Its projects, repos, workflows and agents are pulled in and kept up to date; my own items are never touched.',
    },
];

export function TeamConfigTab() {
    const { data: cfg } = useTeamConfig();
    return cfg ? <TeamConfigForm cfg={cfg} /> : null;
}

function TeamConfigForm({ cfg }: { cfg: ITeamConfig }) {
    const update = useUpdateTeamConfig();
    const sync = useSyncTeamConfig();
    const toast = useToast();
    const { data: credentials = [] } = useCredentials();
    const { data: help } = useTeamConfigHelp();
    const [repoUrl, setRepoUrl] = useState(cfg.repo_url ?? '');
    const [branch, setBranch] = useState(cfg.branch);
    const [interval, setIntervalMinutes] = useState(String(cfg.interval_minutes));

    function save(patch: TeamConfigUpdate, message = 'Team config saved') {
        update.mutate(patch, {
            onSuccess: () => toast.show({ message }),
            onError: (err) => toast.show({ message: 'Could not save', detail: err.message }),
        });
    }

    function commitRepoUrl() {
        const next = repoUrl.trim() || null;
        if (next !== cfg.repo_url) save({ repo_url: next });
    }

    function commitBranch() {
        const next = branch.trim();
        if (!next) return setBranch(cfg.branch);
        if (next !== cfg.branch) save({ branch: next });
    }

    function commitInterval() {
        const minutes = Number(interval);
        if (!Number.isInteger(minutes) || minutes < 5) {
            setIntervalMinutes(String(cfg.interval_minutes));
            return;
        }
        if (minutes !== cfg.interval_minutes) save({ interval_minutes: minutes });
    }

    function runSync() {
        sync.mutate(undefined, {
            onSuccess: (r) => toast.show({ message: 'Team config synced', detail: r.message }),
            onError: (err) => toast.show({ message: 'Team config sync failed', detail: err.message }),
        });
    }

    const ready = cfg.role !== 'off' && Boolean(cfg.repo_url) && Boolean(cfg.credential_id);

    return (
        <Box>
            <SettingsSection
                title="Team config repo"
                subtitle="A private git repo that holds my team's project setup: repos, guardrails, scripts, Jira queries, workflows and agents. Secrets never go in it; each person adds their own credentials, Jira token and .env secrets."
            >
                <FormRow label="Role">
                    <TextField
                        select
                        fullWidth
                        size="small"
                        value={cfg.role}
                        helperText={ROLES.find((r) => r.value === cfg.role)?.help}
                        onChange={(e) => save({ role: e.target.value as TeamConfigRole })}
                        slotProps={{ htmlInput: { 'aria-label': 'Team config role' } }}
                    >
                        {ROLES.map((r) => (
                            <MenuItem key={r.value} value={r.value}>
                                {r.label}
                            </MenuItem>
                        ))}
                    </TextField>
                </FormRow>
                <FormRow label="Repo URL">
                    <TextField
                        fullWidth
                        size="small"
                        value={repoUrl}
                        placeholder="https://github.com/your-org/atlas-team-config.git"
                        onChange={(e) => setRepoUrl(e.target.value)}
                        onBlur={commitRepoUrl}
                    />
                </FormRow>
                <FormRow label="Credential">
                    <TextField
                        select
                        fullWidth
                        size="small"
                        value={cfg.credential_id ?? ''}
                        helperText="My own GitHub credential with access to the repo (write access for a publisher). Also used to clone the team's project repos."
                        onChange={(e) => save({ credential_id: e.target.value || null })}
                        slotProps={{ htmlInput: { 'aria-label': 'Team config credential' } }}
                    >
                        {credentials.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                                {c.label}
                            </MenuItem>
                        ))}
                    </TextField>
                </FormRow>
                <FormRow label="Branch">
                    <TextField
                        size="small"
                        value={branch}
                        helperText="A publisher's credential needs push rights here — an admin bypass on a protected branch, or a dedicated sync branch."
                        onChange={(e) => setBranch(e.target.value)}
                        onBlur={commitBranch}
                        sx={{ width: 240 }}
                    />
                </FormRow>
                <FormRow label="Sync every">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <TextField
                            size="small"
                            type="number"
                            value={interval}
                            onChange={(e) => setIntervalMinutes(e.target.value)}
                            onBlur={commitInterval}
                            slotProps={{ htmlInput: { min: 5, 'aria-label': 'Sync interval in minutes' } }}
                            sx={{ width: 120 }}
                        />
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                            minutes
                        </Typography>
                    </Box>
                </FormRow>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, pt: 1, flexWrap: 'wrap' }}>
                    <Typography
                        sx={{
                            flex: 1,
                            minWidth: 200,
                            fontSize: 12.5,
                            whiteSpace: 'pre-line',
                            color: cfg.last_sync_ok === false ? ATLAS_PALETTE.dangerFg : ATLAS_PALETTE.slate60,
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
                    <Button variant="contained" size="small" onClick={runSync} disabled={sync.isPending || !ready}>
                        {sync.isPending ? 'Syncing…' : 'Sync now'}
                    </Button>
                </Box>
            </SettingsSection>

            {help?.readme_md ? (
                <SettingsSection title="Team guide" subtitle="The README in the team config repo.">
                    <MarkdownPreview source={help.readme_md} />
                </SettingsSection>
            ) : null}
        </Box>
    );
}
