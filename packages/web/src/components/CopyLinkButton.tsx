import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import LinkRounded from '@mui/icons-material/LinkRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface Props {
    url?: string | undefined;
    size?: number | undefined;
}

export function CopyLinkButton({ url, size = 16 }: Props) {
    const [copied, setCopied] = useState(false);

    const handleClick = async () => {
        const target = url ?? (typeof window !== 'undefined' ? window.location.href : '');
        if (!target) return;
        try {
            await navigator.clipboard.writeText(target);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard write can fail in non-secure contexts; silently no-op
            // rather than throwing — the user can still copy the URL bar.
        }
    };

    return (
        <Tooltip title={copied ? 'Copied' : 'Copy link'} placement="top">
            <IconButton
                size="small"
                onClick={handleClick}
                sx={{
                    p: 0.25,
                    color: copied ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate40,
                    '&:hover': { color: ATLAS_PALETTE.slate },
                }}
            >
                {copied ? (
                    <CheckRounded sx={{ fontSize: size }} />
                ) : (
                    <LinkRounded sx={{ fontSize: size }} />
                )}
            </IconButton>
        </Tooltip>
    );
}
