import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import EditOutlined from '@mui/icons-material/EditOutlined';
import VpnKeyOutlined from '@mui/icons-material/VpnKeyOutlined';
import GitHubIcon from '@mui/icons-material/GitHub';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { ICredential } from '@atlas/shared';
import { CredentialRowMenu } from './CredentialRowMenu.js';
import { relativeTime } from '../../utils/time.js';

const MONO = '"JetBrains Mono", monospace';

interface Props {
    rows: ICredential[];
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
}

type StatusKind = 'active' | 'expiring' | 'unused';

function deriveStatus(c: ICredential): { kind: StatusKind; label: string } {
    const now = Date.now();
    if (c.expires_at) {
        const expMs = new Date(c.expires_at).getTime();
        if (!Number.isNaN(expMs)) {
            const days = Math.round((expMs - now) / (1000 * 60 * 60 * 24));
            if (days >= 0 && days <= 60) {
                return { kind: 'expiring', label: `Expires in ${days} d` };
            }
        }
    }
    if (c.last_used_at) {
        const days = Math.round((now - new Date(c.last_used_at).getTime()) / (1000 * 60 * 60 * 24));
        if (days >= 30) return { kind: 'unused', label: `Unused ${days} d` };
    } else {
        const created = new Date(c.created_at).getTime();
        const days = Math.round((now - created) / (1000 * 60 * 60 * 24));
        if (days >= 30) return { kind: 'unused', label: `Unused 30 d` };
    }
    return { kind: 'active', label: 'Active' };
}

function StatusChip({ status }: { status: { kind: StatusKind; label: string } }) {
    const palette = {
        active: { bg: 'rgba(49,171,70,.12)', fg: ATLAS_PALETTE.green },
        expiring: { bg: 'rgba(223,172,45,.14)', fg: ATLAS_PALETTE.gold },
        unused: { bg: ATLAS_PALETTE.slate08, fg: ATLAS_PALETTE.slate60 },
    }[status.kind];
    return (
        <Box
            sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: palette.bg,
                color: palette.fg,
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                px: 2,
                py: 0.5,
                borderRadius: '9999px',
            }}
        >
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: palette.fg }} />
            {status.label}
        </Box>
    );
}

const HEADER_SX = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: ATLAS_PALETTE.slate60,
};

export function CredentialsTable({ rows, onEdit, onDelete }: Props) {
    return (
        <Box
            sx={{
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                bgcolor: ATLAS_PALETTE.white,
                overflow: 'hidden',
            }}
        >
            <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 1100 }}>
            {/* Header row */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: '1.4fr 1fr 0.7fr 1.2fr 1.4fr 0.9fr 0.9fr 80px',
                    alignItems: 'center',
                    gap: 4,
                    px: 4,
                    py: 3,
                    bgcolor: ATLAS_PALETTE.slate08,
                    borderBottom: `1px solid ${ATLAS_PALETTE.slate10}`,
                }}
            >
                <Typography sx={HEADER_SX}>Label</Typography>
                <Typography sx={HEADER_SX}>Host</Typography>
                <Typography sx={HEADER_SX}>Kind</Typography>
                <Typography sx={HEADER_SX}>Scope</Typography>
                <Typography sx={HEADER_SX}>Fingerprint</Typography>
                <Typography sx={HEADER_SX}>Status</Typography>
                <Typography sx={HEADER_SX}>Last used</Typography>
                <Box />
            </Box>

            {rows.map((c) => {
                const status = deriveStatus(c);
                return (
                    <Box
                        key={c.id}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '1.4fr 1fr 0.7fr 1.2fr 1.4fr 0.9fr 0.9fr 80px',
                            alignItems: 'center',
                            gap: 4,
                            px: 4,
                            py: 4,
                            borderBottom: `1px solid ${ATLAS_PALETTE.slate06}`,
                            '&:last-of-type': { borderBottom: 'none' },
                            '&:hover': { bgcolor: ATLAS_PALETTE.cloud },
                            transition: 'background 120ms ease',
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                            <Box
                                sx={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: '8px',
                                    bgcolor: ATLAS_PALETTE.cloud,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <VpnKeyOutlined
                                    sx={{ fontSize: 14, color: ATLAS_PALETTE.brandBlue }}
                                />
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontSize: 13,
                                        fontWeight: 500,
                                        color: ATLAS_PALETTE.slate,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {c.label}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 11,
                                        color: ATLAS_PALETTE.slate60,
                                    }}
                                >
                                    cred-{c.id.slice(0, 4)}
                                </Typography>
                            </Box>
                        </Box>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <GitHubIcon sx={{ fontSize: 14, color: ATLAS_PALETTE.slate70 }} />
                            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate }}>
                                GitHub
                            </Typography>
                        </Box>

                        <Box
                            sx={{
                                display: 'inline-flex',
                                px: 1.5,
                                py: 0.5,
                                bgcolor: ATLAS_PALETTE.slate08,
                                borderRadius: '4px',
                                fontFamily: MONO,
                                fontSize: 10,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate70,
                                letterSpacing: '0.04em',
                                justifySelf: 'start',
                            }}
                        >
                            PAT
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {(c.scope || 'repo')
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean)
                                .map((s) => (
                                    <Box
                                        key={s}
                                        sx={{
                                            px: 1.5,
                                            py: 0.25,
                                            bgcolor: ATLAS_PALETTE.cloud,
                                            color: ATLAS_PALETTE.slate70,
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            borderRadius: '4px',
                                        }}
                                    >
                                        {s}
                                    </Box>
                                ))}
                        </Box>

                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 12,
                                color: ATLAS_PALETTE.slate70,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {c.token_fingerprint}
                        </Typography>

                        <Box>
                            <StatusChip status={status} />
                        </Box>

                        <Typography
                            sx={{ fontFamily: MONO, fontSize: 11, color: ATLAS_PALETTE.slate60 }}
                        >
                            {relativeTime(c.last_used_at)}
                        </Typography>

                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                            <Tooltip title="Edit">
                                <IconButton size="small" onClick={() => onEdit(c.id)}>
                                    <EditOutlined
                                        sx={{ fontSize: 16, color: ATLAS_PALETTE.slate60 }}
                                    />
                                </IconButton>
                            </Tooltip>
                            <CredentialRowMenu
                                onEdit={() => onEdit(c.id)}
                                onDelete={() => onDelete(c.id)}
                            />
                        </Box>
                    </Box>
                );
            })}
                </Box>
            </Box>
        </Box>
    );
}
