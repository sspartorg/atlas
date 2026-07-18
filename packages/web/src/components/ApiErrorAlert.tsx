import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { ApiErrorKind } from '@atlas/shared';
import { AtlasApiError } from '../api/api.js';

interface Props {
    /** The thrown value from a useMutation/useQuery onError or a try/catch. */
    error: unknown;
    /** Optional extra context — appended to the human one-liner when present. */
    contextLabel?: string;
    /** Optional override for the dismiss/retry side button. */
    actionSlot?: ReactNode;
    sx?: object;
}

interface Copy {
    title: string;
    detail: ReactNode;
    cta?: ReactNode;
}

function detailsBinary(details: unknown): string | null {
    if (details && typeof details === 'object' && 'binary' in details) {
        const b = (details as { binary?: unknown }).binary;
        if (typeof b === 'string') return b;
    }
    return null;
}

// W4 — Per-kind copy for the actionable alert. Plain English, no i18n
// (binding scope). The CTA is a router link or external <a> when the user
// has an obvious next step; otherwise omitted and the detail text stands
// alone. Keep these short — banner UX, not a dialog.
function copyForKind(kind: ApiErrorKind, message: string, details: unknown): Copy {
    switch (kind) {
        case 'credentials_missing':
            return {
                title: 'Credentials not configured',
                detail:
                    "This integration doesn't have credentials yet. Open Settings → Credentials to add them.",
                cta: (
                    <Button
                        component={RouterLink}
                        to="/credentials"
                        variant="outlined"
                        size="small"
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Open Credentials
                    </Button>
                ),
            };
        case 'credentials_invalid':
            return {
                title: "Credentials aren't working",
                detail:
                    'The token Atlas has on file was rejected by the upstream service. Re-enter it in Settings → Credentials.',
                cta: (
                    <Button
                        component={RouterLink}
                        to="/credentials"
                        variant="outlined"
                        size="small"
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Open Credentials
                    </Button>
                ),
            };
        case 'rate_limited':
            return {
                title: 'Rate-limited by upstream',
                detail: 'Wait a minute and retry. ' + (message || ''),
            };
        case 'upstream_unavailable':
            return {
                title: "Can't reach upstream service",
                detail:
                    'If this run uses MCP, make sure the local MCP server is running. Otherwise the remote service is probably down — try again in a moment.',
            };
        case 'cli_not_installed': {
            const bin = detailsBinary(details);
            const binText = bin ? `\`${bin}\`` : 'the agent CLI';
            return {
                title: `${bin ?? 'Agent'} CLI isn't on your PATH`,
                detail: (
                    <>
                        Install {binText} and restart the API. See README →{' '}
                        <Box component="strong">Prerequisites</Box> for the install command for
                        your OS.
                    </>
                ),
            };
        }
        case 'unauthorized':
            return {
                title: 'MCP token mismatch',
                detail:
                    'The X-Atlas-Token header didn\'t match ATLAS_MCP_TOKEN. Check the value in your `.env` and restart the API.',
            };
        case 'not_found':
            return { title: 'Not found', detail: message || 'The resource is gone.' };
        case 'conflict':
            return { title: 'Conflict', detail: message || 'The request conflicts with current state.' };
        case 'validation_error':
            return { title: 'Invalid input', detail: message || 'The request didn\'t parse.' };
        case 'internal_error':
        default:
            return {
                title: 'Something went wrong',
                detail: (
                    <>
                        {message || 'Unexpected error.'} Check the API log at{' '}
                        <Box component="code" sx={{ fontFamily: 'mono', fontSize: 12 }}>
                            ./logs/atlas-api.log
                        </Box>{' '}
                        for the full trace.
                    </>
                ),
            };
    }
}

export function ApiErrorAlert({ error, contextLabel, actionSlot, sx }: Props): ReactNode {
    // Fall-through for non-AtlasApiError throws (network failure, sync
    // throw with no envelope). Render the stringified value so the user
    // sees *something* rather than the alert silently failing closed.
    if (!(error instanceof AtlasApiError)) {
        return (
            <Alert severity="error" sx={{ '& .MuiAlert-message': { fontSize: 12.5 }, ...sx }}>
                {contextLabel ? `${contextLabel}: ` : ''}
                {error === null || error === undefined ? 'Unknown error' : String(error)}
            </Alert>
        );
    }

    const { title, detail, cta } = copyForKind(error.kind, error.message, error.details);
    return (
        <Alert
            severity="error"
            sx={{ '& .MuiAlert-message': { fontSize: 12.5, width: '100%' }, ...sx }}
            action={cta ?? actionSlot}
        >
            <AlertTitle sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.5 }}>
                {contextLabel ? `${contextLabel} — ${title}` : title}
            </AlertTitle>
            <Box sx={{ fontSize: 12.5, lineHeight: 1.55 }}>{detail}</Box>
        </Alert>
    );
}
