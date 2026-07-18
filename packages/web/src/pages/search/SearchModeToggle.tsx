import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

export type SearchMode = 'filters' | 'query';

interface Props {
    mode: SearchMode;
    onChange: (mode: SearchMode) => void;
}

export function SearchModeToggle({ mode, onChange }: Props) {
    return (
        <Box
            sx={{
                display: 'inline-flex',
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '8px',
                p: 0.5,
            }}
        >
            {(['filters', 'query'] as const).map((m) => {
                const active = mode === m;
                return (
                    <Box
                        key={m}
                        role="button"
                        tabIndex={0}
                        onClick={() => onChange(m)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onChange(m);
                            }
                        }}
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 1,
                            px: 2,
                            py: 1,
                            borderRadius: '6px',
                            background: active ? ATLAS_PALETTE.slate08 : 'transparent',
                            cursor: 'pointer',
                            transition: 'background 150ms ease',
                            '&:hover': {
                                background: active ? ATLAS_PALETTE.slate08 : ATLAS_PALETTE.cloud,
                            },
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{
                                fontSize: 16,
                                color: active ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate60,
                            }}
                        >
                            {m === 'filters' ? 'tune' : 'code'}
                        </Box>
                        <Typography
                            component="span"
                            sx={{
                                fontSize: 12.5,
                                fontWeight: 500,
                                color: active ? ATLAS_PALETTE.slate : ATLAS_PALETTE.slate60,
                            }}
                        >
                            {m === 'filters' ? 'Filters' : 'Query'}
                        </Typography>
                    </Box>
                );
            })}
        </Box>
    );
}
