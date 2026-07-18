import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import BugReportRounded from '@mui/icons-material/BugReportRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import MenuBookRounded from '@mui/icons-material/MenuBookRounded';
import { useEnv, useUpdateEnv } from '../../hooks/useEnv.js';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { SettingsSection } from './SettingsSection.js';

const DEFAULT_FEEDBACK_URL = 'https://github.com/sspartorg/atlas/issues';
const REPO_URL = 'https://github.com/sspartorg/atlas';
const DOCS_URL = 'https://github.com/sspartorg/atlas/tree/main/docs';
const APP_VERSION = '1.0.0';
const RELEASE_TAG = 'v1.0';
const RELEASE_URL = 'https://github.com/sspartorg/atlas/releases/tag/v1.0';

type FactRowProps = {
    label: string;
    children: React.ReactNode;
};

function FactRow({ label, children }: FactRowProps) {
    return (
        <>
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate60 }}>{label}</Typography>
            <Box sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, minWidth: 0 }}>{children}</Box>
        </>
    );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <Box
            component="a"
            href={href}
            target="_blank"
            rel="noreferrer"
            sx={{
                color: ATLAS_PALETTE.brandBlue,
                textDecoration: 'none',
                wordBreak: 'break-all',
                '&:hover': { textDecoration: 'underline' },
            }}
        >
            {children}
        </Box>
    );
}

export function HelpAboutTab() {
    const { data, isLoading } = useEnv();
    const updateEnv = useUpdateEnv();
    const toast = useToast();

    if (isLoading || !data) {
        return (
            <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress size={24} sx={{ color: ATLAS_PALETTE.brandBlue }} />
            </Box>
        );
    }

    const feedbackUrl =
        data.vars.find((v) => v.key === 'ATLAS_FEEDBACK_URL')?.value?.trim() ?? '';
    const effectiveUrl = feedbackUrl || DEFAULT_FEEDBACK_URL;
    const isMailto = effectiveUrl.toLowerCase().startsWith('mailto:');

    async function restoreDefault() {
        try {
            await updateEnv.mutateAsync([
                { key: 'ATLAS_FEEDBACK_URL', value: DEFAULT_FEEDBACK_URL },
            ]);
            toast.show({
                message: 'Restored recommended feedback URL',
                detail: 'Report a bug link now points to the GitHub Issues tracker.',
            });
        } catch (err) {
            toast.show({
                message: 'Could not update .env',
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return (
        <Box>
            <SettingsSection
                title="About Atlas"
                subtitle="Atlas is a local-first, single-user workspace for coordinating AI coding agents against your own repos. It runs entirely on this machine — no cloud, no auth, no telemetry."
            >
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'max-content 1fr',
                        gap: '10px 24px',
                        fontSize: 13,
                        alignItems: 'baseline',
                    }}
                >
                    <FactRow label="Version">
                        <Typography
                            component="span"
                            sx={{
                                fontSize: 13,
                                fontFamily: '"JetBrains Mono", monospace',
                                color: ATLAS_PALETTE.slate,
                            }}
                        >
                            {APP_VERSION}
                        </Typography>
                        {' · '}
                        <ExternalLink href={RELEASE_URL}>{RELEASE_TAG} release notes</ExternalLink>
                    </FactRow>

                    <FactRow label="Repository">
                        <ExternalLink href={REPO_URL}>github.com/sspartorg/atlas</ExternalLink>
                    </FactRow>

                    <FactRow label="Documentation">
                        <ExternalLink href={DOCS_URL}>
                            Docs on GitHub
                        </ExternalLink>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 0.5 }}>
                            Root overview, section pages, and per-page walkthroughs for every route in Atlas.
                        </Typography>
                    </FactRow>
                </Box>

                <Box sx={{ mt: 4, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <Button
                        variant="outlined"
                        startIcon={<GitHubIcon />}
                        href={REPO_URL}
                        target="_blank"
                        rel="noreferrer"
                        sx={{ textTransform: 'none' }}
                    >
                        Open on GitHub
                    </Button>
                    <Button
                        variant="outlined"
                        startIcon={<MenuBookRounded />}
                        href={DOCS_URL}
                        target="_blank"
                        rel="noreferrer"
                        sx={{ textTransform: 'none' }}
                    >
                        Open docs
                    </Button>
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Credits"
                subtitle="Who built Atlas, and how it got here."
            >
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'max-content 1fr',
                        gap: '10px 24px',
                        fontSize: 13,
                        alignItems: 'baseline',
                    }}
                >
                    <FactRow label="Author">
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate, fontWeight: 500 }}>
                            sspart
                        </Typography>
                        {' · '}
                        <ExternalLink href="mailto:sspart.org@gmail.com">
                            sspart.org@gmail.com
                        </ExternalLink>
                    </FactRow>

                    <FactRow label="Built with">
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate }}>
                            Claude Code CLI (primary agent) · Playwright MCP (screenshots + verification)
                        </Typography>
                    </FactRow>

                    <FactRow label="Stack">
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate }}>
                            React 19 · MUI · Fastify · Postgres 16 · Knex · Zod · node-pty · xterm.js · MCP · pnpm monorepo
                        </Typography>
                    </FactRow>

                    <FactRow label="Timeline">
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate }}>
                            First commit May 2026 · v1.0 shipped July 2026 · ~2 months of nights &amp; weekends
                        </Typography>
                    </FactRow>

                    <FactRow label="Scope">
                        <Typography component="span" sx={{ fontSize: 13, color: ATLAS_PALETTE.slate }}>
                            32 user-facing pages · 16 seeded agent roles · 13 consolidated MCP tools · full SDLC hierarchy (projects → epics → stories → sub-tasks · bugs → sub-bugs)
                        </Typography>
                    </FactRow>
                </Box>
            </SettingsSection>

            <SettingsSection
                title="Report a bug"
                subtitle="Found something broken? Open the tracker below. Behaviour of the sidenav footer link (when configured) matches this button."
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Box>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mb: 1 }}>
                            Current feedback URL
                        </Typography>
                        <Typography
                            sx={{
                                fontSize: 13,
                                fontFamily: '"JetBrains Mono", monospace',
                                color: ATLAS_PALETTE.slate,
                                p: '10px 12px',
                                bgcolor: ATLAS_PALETTE.cloud,
                                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                                borderRadius: 1,
                                wordBreak: 'break-all',
                            }}
                        >
                            {feedbackUrl || (
                                <Box component="span" sx={{ color: ATLAS_PALETTE.slate60 }}>
                                    (unset — falls back to {DEFAULT_FEEDBACK_URL})
                                </Box>
                            )}
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: ATLAS_PALETTE.slate60, mt: 1 }}>
                            Edit under Settings → Environment ({'ATLAS_FEEDBACK_URL'}). Live-applied — no restart.
                        </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <Button
                            variant="contained"
                            startIcon={isMailto ? <BugReportRounded /> : <OpenInNewRounded />}
                            href={effectiveUrl}
                            {...(!isMailto && { target: '_blank', rel: 'noreferrer' })}
                            sx={{ textTransform: 'none' }}
                        >
                            {isMailto ? 'Email a bug report' : 'Open GitHub Issues'}
                        </Button>
                        {feedbackUrl !== DEFAULT_FEEDBACK_URL && (
                            <Button
                                variant="outlined"
                                startIcon={<RestartAltRounded />}
                                onClick={restoreDefault}
                                disabled={updateEnv.isPending}
                                sx={{ textTransform: 'none' }}
                            >
                                Restore recommended URL
                            </Button>
                        )}
                    </Box>
                </Box>
            </SettingsSection>
        </Box>
    );
}
