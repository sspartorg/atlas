import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Line, LineChart } from 'recharts';
import { ATLAS_PALETTE } from '../theme/tokens.js';

interface TrendSparklineProps {
    /** Oldest first. A null is a week with nothing measurable, drawn as a gap. */
    values: Array<number | null>;
    /** Read out in full to a screen reader, since the line itself says nothing. */
    label: string;
    color?: string;
    width?: number;
    height?: number;
}

// A fixed-size recharts line rather than a `ResponsiveContainer`: a sparkline
// sits in a table cell or beside a number and never needs to reflow, and a
// fixed size renders in jsdom without the resize-observer mocks the Analytics
// charts need.
//
// One point is not a trend. Below two weeks the component says so in words
// instead of drawing a dot that reads as a flat line.
export function TrendSparkline({
    values,
    label,
    color = ATLAS_PALETTE.brandBlue,
    width = 96,
    height = 24,
}: TrendSparklineProps) {
    const summary = `${label}: ${values.map((v) => (v === null ? 'none' : String(v))).join(', ')}`;
    if (values.length < 2) {
        return (
            <Typography title={summary} sx={{ fontSize: 11, color: ATLAS_PALETTE.slate60 }}>
                {values.length === 0 ? 'no weeks yet' : 'one week so far'}
            </Typography>
        );
    }
    return (
        <Box role="img" aria-label={summary} sx={{ width, height, lineHeight: 0 }}>
            <LineChart width={width} height={height} data={values.map((v) => ({ v }))} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
        </Box>
    );
}
