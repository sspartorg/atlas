import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import type { IEnvVar } from '@atlas/shared';
import { useToast } from '../../hooks/useToast.js';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

interface Props {
    env: IEnvVar;
    value: string;
    onChange: (next: string) => void;
}

export function EnvVarRow({ env, value, onChange }: Props) {
    const [revealed, setRevealed] = useState(false);
    const toast = useToast();
    const isSecret = env.secret;
    const isLogLevel = env.key === 'ATLAS_LOG_LEVEL';

    function copy() {
        void navigator.clipboard.writeText(value).then(
            () => toast.show({ message: `${env.key} copied` }),
            () => toast.show({ message: 'Clipboard blocked' })
        );
    }

    return (
        <Box
            sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '240px 1fr' },
                gap: { xs: 2, md: 4 },
                py: 3,
                alignItems: { xs: 'stretch', md: 'flex-start' },
            }}
        >
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                    <Typography
                        sx={{
                            fontFamily: MONO,
                            fontSize: 12,
                            fontWeight: 600,
                            color: ATLAS_PALETTE.slate,
                            letterSpacing: '0.02em',
                        }}
                    >
                        {env.key}
                    </Typography>
                    {env.restart_required && (
                        <Box
                            sx={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 0.5,
                                bgcolor: 'rgba(199,83,47,.10)',
                                color: ATLAS_PALETTE.warning,
                                fontFamily: MONO,
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '0.04em',
                                px: 1,
                                py: 0.25,
                                borderRadius: '4px',
                            }}
                        >
                            <RestartAltRounded sx={{ fontSize: 11 }} /> RESTART
                        </Box>
                    )}
                </Box>
                <Typography
                    sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60, mt: 1, lineHeight: 1.5 }}
                >
                    {env.description}
                </Typography>
            </Box>
            {isLogLevel ? (
                <TextField
                    select
                    fullWidth
                    size="small"
                    value={LOG_LEVELS.includes(value as (typeof LOG_LEVELS)[number]) ? value : ''}
                    onChange={(e) => onChange(e.target.value)}
                    inputProps={{ style: { fontFamily: MONO, fontSize: 13 } }}
                    SelectProps={{ displayEmpty: true }}
                >
                    <MenuItem value="" sx={{ fontFamily: MONO, fontSize: 13, fontStyle: 'italic' }}>
                        (default — info)
                    </MenuItem>
                    {LOG_LEVELS.map((level) => (
                        <MenuItem
                            key={level}
                            value={level}
                            sx={{ fontFamily: MONO, fontSize: 13 }}
                        >
                            {level}
                        </MenuItem>
                    ))}
                </TextField>
            ) : (
                <TextField
                    fullWidth
                    size="small"
                    type={isSecret && !revealed ? 'password' : 'text'}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    inputProps={{ style: { fontFamily: MONO, fontSize: 13 } }}
                    slotProps={{
                        input: {
                            endAdornment: (
                                <InputAdornment position="end">
                                    {isSecret && (
                                        <Tooltip title={revealed ? 'Hide' : 'Reveal'}>
                                            <IconButton size="small" onClick={() => setRevealed((v) => !v)}>
                                                {revealed ? (
                                                    <VisibilityOffOutlined sx={{ fontSize: 16 }} />
                                                ) : (
                                                    <VisibilityOutlined sx={{ fontSize: 16 }} />
                                                )}
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    {!isSecret && (
                                        <Tooltip title="Copy">
                                            <IconButton size="small" onClick={copy}>
                                                <ContentCopyRounded sx={{ fontSize: 16 }} />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </InputAdornment>
                            ),
                        },
                    }}
                />
            )}
        </Box>
    );
}
