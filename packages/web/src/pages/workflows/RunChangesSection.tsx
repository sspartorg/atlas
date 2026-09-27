import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import type { CliSessionDiffScopeName, WorkflowRunRepoDiff } from '@atlas/shared';
import { useWorkflowRunDiff } from '../../hooks/useWorkflows.js';
import { StopSessionReviewPanel } from '../../components/StopSessionReviewPanel.js';
import { loadDiffPrefs, saveDiffPrefs, type DiffPrefs } from '../../components/diff/diffViewPrefs.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

// The run's code changes, reviewed here instead of on GitHub. The two-pane
// body is the terminal Stop modal's panel in read-only mode; this section only
// adds the repo picker and the states that are specific to a run: which copy
// of the work was read (live worktree, or the pushed branch after delivery
// removed it), and an honest "unavailable" once the branch is gone.

const NO_SELECTION: Record<string, boolean> = {};
const noop = () => undefined;

function RepoBody({ runId, repo }: { runId: string; repo: WorkflowRunRepoDiff }) {
    const [scope, setScope] = useState<CliSessionDiffScopeName>('committed');
    const [prefs, setPrefs] = useState<DiffPrefs>(loadDiffPrefs);
    const update = (patch: Partial<DiffPrefs>) => {
        const next = { ...prefs, ...patch };
        setPrefs(next);
        saveDiffPrefs(next);
    };

    if (!repo.summary) {
        return (
            <Box sx={{ p: 2 }}>
                <Alert severity="info">{repo.reason}</Alert>
            </Box>
        );
    }
    return (
        <>
            <Typography variant="caption" sx={{ display: 'block', px: 2, pt: 1.5, color: ATLAS_PALETTE.slate60 }}>
                {repo.source === 'branch'
                    ? "Read from the run's branch — its checkout was removed after delivery."
                    : "Read from the run's checkout."}
                {repo.summary.base_ref ? ` Compared with ${repo.summary.base_ref}.` : ''}
            </Typography>
            <Box sx={{ height: { xs: 520, md: 640 }, display: 'flex' }}>
                <StopSessionReviewPanel
                    sessionId=""
                    runRepo={{ runId, repoId: repo.repo_id }}
                    summary={repo.summary}
                    isLoading={false}
                    error={null}
                    scope={scope}
                    onScopeChange={setScope}
                    selected={NO_SELECTION}
                    onToggle={noop}
                    onToggleAll={noop}
                    viewMode={prefs.viewMode}
                    onViewModeChange={(viewMode) => update({ viewMode })}
                    wrap={prefs.wrap}
                    onWrapChange={(wrap) => update({ wrap })}
                />
            </Box>
        </>
    );
}

export function RunChangesSection({ runId }: { runId: string }) {
    const { data, isLoading, error } = useWorkflowRunDiff(runId);
    const [repoId, setRepoId] = useState<string | null>(null);
    const ref = useRef<HTMLElement>(null);
    const { hash } = useLocation();

    // The Task page links here as `#changes`; the router does not scroll to
    // hashes, and this section renders after the run loads.
    useEffect(() => {
        if (hash === '#changes') ref.current?.scrollIntoView?.({ block: 'start' });
    }, [hash]);

    const repos = data?.repos ?? [];
    const active = repos.find((r) => r.repo_id === repoId) ?? repos[0] ?? null;

    let body: React.ReactNode;
    if (isLoading) {
        body = (
            <Stack spacing={1} sx={{ p: 2 }}>
                <Skeleton variant="rectangular" height={24} />
                <Skeleton variant="rectangular" height={200} />
            </Stack>
        );
    } else if (error) {
        body = (
            <Box sx={{ p: 2 }}>
                <Alert severity="error">Could not load the changes. {error.message}</Alert>
            </Box>
        );
    } else if (!active) {
        body = (
            <Typography sx={{ p: 2, fontSize: 13, color: ATLAS_PALETTE.slate60 }}>
                This run has no repository checkout, so there are no code changes to review.
            </Typography>
        );
    } else {
        body = (
            <>
                {repos.length > 1 && (
                    <Tabs
                        value={active.repo_id}
                        onChange={(_e, v: string) => setRepoId(v)}
                        aria-label="Repository"
                        sx={{
                            px: 1.5,
                            minHeight: 40,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate08}`,
                            '& .MuiTab-root': { minHeight: 40, textTransform: 'none' },
                        }}
                    >
                        {repos.map((r) => (
                            <Tab key={r.repo_id} value={r.repo_id} label={r.repo_name} />
                        ))}
                    </Tabs>
                )}
                {/* Keyed so scope and file selection reset per repo. */}
                <RepoBody key={active.repo_id} runId={runId} repo={active} />
            </>
        );
    }

    return (
        <Box
            component="section"
            id="changes"
            ref={ref}
            aria-label="Changes"
            sx={{
                mt: 3,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                background: ATLAS_PALETTE.white,
                overflow: 'hidden',
            }}
        >
            <Typography variant="overline" sx={{ display: 'block', px: 2, pt: 1.5, color: ATLAS_PALETTE.slate60 }}>
                Changes
            </Typography>
            {body}
        </Box>
    );
}
