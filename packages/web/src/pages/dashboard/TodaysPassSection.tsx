import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import type { TodaysPass } from '../../api/types.js';
import { TodaysPassCard } from './TodaysPassCard.js';
import { FormHeading } from '../../components/FormHeading.js';
import { useLabelColor } from '../../hooks/useLabelColor.js';

interface ITodaysPassSectionProps {
    todaysPass: TodaysPass | undefined;
}

const MONO_FONT = '"JetBrains Mono", monospace';

function currentClockLabel(): string {
    const d = new Date();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
}

export function TodaysPassSection({ todaysPass }: ITodaysPassSectionProps) {
    const items = todaysPass?.items ?? [];
    const total = todaysPass?.total ?? items.length;

    // Marketing is intentionally not its own card per the mockup; bucket only DEV / CONTENT / DESIGN.
    const dev = items.filter((i) => i.agent_category === 'software-dev');
    const content = items.filter((i) => i.agent_category === 'content');
    const design = items.filter((i) => i.agent_category === 'design');

    // Mode-aware category accents — mirror the dashboard KPI strip so the
    // same category reads as the same colour across the page.
    const devColor = useLabelColor('emerald');
    const contentColor = useLabelColor('indigo');
    const designColor = useLabelColor('rose');

    return (
        <Box>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <FormHeading>Today's Pass</FormHeading>
                <Typography
                    sx={{
                        fontFamily: MONO_FONT,
                        fontSize: '0.6875rem',
                        color: ATLAS_PALETTE.slate60,
                    }}
                >
                    {currentClockLabel()} · {total} outputs
                </Typography>
            </Box>
            <Box
                sx={{
                    mt: 4,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
                    gap: 6,
                }}
            >
                <TodaysPassCard
                    label="Software dev"
                    color={devColor.border}
                    icon="code"
                    items={dev}
                />
                <TodaysPassCard
                    label="Content"
                    color={contentColor.border}
                    icon="menu_book"
                    items={content}
                />
                <TodaysPassCard
                    label="Design"
                    color={designColor.border}
                    icon="brush"
                    items={design}
                />
            </Box>
        </Box>
    );
}
