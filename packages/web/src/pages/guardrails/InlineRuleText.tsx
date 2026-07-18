import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../../theme/tokens.js';

interface Props {
    text: string;
}

// Render rule text with inline backtick chips (`foo` → <code>foo</code>).
// Single-pass split; literal escaped backticks not supported (acceptable for
// rule text — flagged in the plan).
export function InlineRuleText({ text }: Props) {
    const parts = text.split('`');
    return (
        <>
            {parts.map((part, i) =>
                i % 2 === 0 ? (
                    <span key={i}>{part}</span>
                ) : (
                    <Box
                        key={i}
                        component="code"
                        sx={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: '0.85em',
                            bgcolor: ATLAS_PALETTE.slate08,
                            color: ATLAS_PALETTE.slate,
                            px: 0.75,
                            py: 0.125,
                            borderRadius: '4px',
                            mx: 0.25,
                        }}
                    >
                        {part}
                    </Box>
                )
            )}
        </>
    );
}
