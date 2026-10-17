import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';
import type { MarkdownBody as MarkdownBodyComponent } from './MarkdownBody.js';

// The markdown parser (react-markdown + remark-gfm) is ~35 KB gz, so it lives
// on its own chunk instead of every detail page's first-visit bundle. The
// import starts as soon as this module loads; until it lands the text shows
// plain with its line breaks, then re-renders formatted.
let Body: typeof MarkdownBodyComponent | null = null;
export const markdownReady: Promise<void> = import('./MarkdownBody.js').then((m) => {
    Body = m.MarkdownBody;
});

export function MarkdownPreview({
    source,
    emptyText = 'Empty document. Start typing on the left.',
}: {
    source: string;
    /** Shown in place of an empty body. */
    emptyText?: string;
}) {
    const [, setLoaded] = useState(Body !== null);
    useEffect(() => {
        if (Body === null) void markdownReady.then(() => setLoaded(true));
    }, []);

    if (!source.trim()) {
        return (
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40, fontStyle: 'italic' }}>
                {emptyText}
            </Typography>
        );
    }
    return (
        // `overflowWrap: anywhere` is inherited, so it cascades to every block
        // below — paragraphs, headings, list items, links, and the monospace
        // inline-code spans. Without it, an unbroken token (a file path or a
        // long URL in `code`) has no break opportunity and runs off the right
        // edge of the comment column, past the viewport on narrow screens.
        // Code blocks and tables opt back out and scroll instead.
        <Box sx={{ color: ATLAS_PALETTE.slate80, overflowWrap: 'anywhere' }}>
            {Body ? (
                <Body source={source} />
            ) : (
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{source}</Typography>
            )}
        </Box>
    );
}
