import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { randomGreeting } from './greetingMessages.js';

interface IGreetingBlockProps {
    ownerFirstName: string;
    awaitingCount: number;
}

export function GreetingBlock({ ownerFirstName, awaitingCount }: IGreetingBlockProps) {
    // Pick a random greeting from the time-appropriate bucket once per
    // mount. Reading on each render would force a useEffect just to keep
    // the local clock fresh; once per mount is enough — the user re-enters
    // the Dashboard often enough to see the rotation.
    const [greeting] = useState(() => randomGreeting());
    const kicker = `${greeting.toUpperCase()}, ${ownerFirstName.toUpperCase()}`;

    const sentenceOne =
        awaitingCount === 0
            ? 'Nothing needs you.'
            : awaitingCount === 1
              ? '1 thing needs you.'
              : `${awaitingCount} things need you.`;
    const sentenceTwo =
        awaitingCount === 0 ? 'Everything is in motion.' : 'The rest is in motion.';

    return (
        <Box>
            <Typography
                sx={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: ATLAS_PALETTE.slate60,
                    mb: 1,
                }}
            >
                {kicker}
            </Typography>
            <Typography
                variant="h1"
                sx={{
                    fontSize: '2.25rem',
                    fontWeight: 700,
                    lineHeight: 1.2,
                    letterSpacing: '-0.01em',
                    color: ATLAS_PALETTE.slate,
                }}
            >
                {sentenceOne}{' '}
                <Box component="span" sx={{ color: ATLAS_PALETTE.orange }}>
                    {sentenceTwo}
                </Box>
            </Typography>
        </Box>
    );
}
