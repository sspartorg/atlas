import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../theme/tokens.js';

/**
 * Marks an item an agent test run made (ADR 0023 amendment).
 *
 * Test items used to be hidden everywhere, which made "the test created EXI-2
 * and I can't find it" a bug report. They are shown now, and this tag is what
 * tells them apart from real work.
 */
export function TestItemTag() {
    return (
        <Tooltip title="Created by an agent test run" arrow placement="top">
            <Box
                component="span"
                role="img"
                aria-label="Test item"
                sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: 0.75,
                    py: 0.25,
                    borderRadius: '9999px',
                    border: `1px solid ${ATLAS_PALETTE.slate12}`,
                    color: ATLAS_PALETTE.slate60,
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    lineHeight: 1,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    cursor: 'help',
                }}
            >
                <Box component="span" className="material-symbols-rounded" aria-hidden="true" sx={{ fontSize: 12 }}>
                    science
                </Box>
                Test
            </Box>
        </Tooltip>
    );
}
