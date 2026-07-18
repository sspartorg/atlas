import { Fragment, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

function renderInline(text: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let i = 0;
    let keyCounter = 0;
    while (i < text.length) {
        const remaining = text.slice(i);
        const code = remaining.match(/^`([^`]+)`/);
        if (code && code[1] !== undefined) {
            parts.push(
                <Box
                    key={`c-${keyCounter++}`}
                    component="span"
                    sx={{
                        fontFamily: MONO,
                        fontSize: '0.9em',
                        background: ATLAS_PALETTE.slate08,
                        color: ATLAS_PALETTE.slate,
                        px: 0.75,
                        py: 0.25,
                        borderRadius: '4px',
                    }}
                >
                    {code[1]}
                </Box>
            );
            i += code[0].length;
            continue;
        }
        const bold = remaining.match(/^\*\*([^*]+)\*\*/);
        if (bold && bold[1] !== undefined) {
            parts.push(
                <Box
                    key={`b-${keyCounter++}`}
                    component="strong"
                    sx={{ fontWeight: 700, color: ATLAS_PALETTE.slate }}
                >
                    {bold[1]}
                </Box>
            );
            i += bold[0].length;
            continue;
        }
        const italic = remaining.match(/^\*([^*]+)\*/);
        if (italic && italic[1] !== undefined) {
            parts.push(
                <Box key={`i-${keyCounter++}`} component="em" sx={{ fontStyle: 'italic' }}>
                    {italic[1]}
                </Box>
            );
            i += italic[0].length;
            continue;
        }
        const link = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
        if (link && link[1] !== undefined && link[2] !== undefined) {
            const href = link[2];
            // Reject XSS-capable schemes. Agent-authored comments and
            // markdown descriptions flow through this renderer verbatim; a
            // `[click](javascript:...)` link would run in the Owner's
            // origin on click with full session credentials. Also reject
            // `data:` (can be text/html), `vbscript:`, and protocol-
            // relative (`//evil.example`) which slips past a naive
            // `isExternal` check. Only allow `http://`, `https://`,
            // `mailto:`, and same-origin `/…` paths — anything else is
            // rendered as plain text.
            const isSafeAbsolute = /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
            const isSafeInternal = /^\/(?!\/)/.test(href); // "/foo" but NOT "//foo"
            if (!isSafeAbsolute && !isSafeInternal) {
                // Unsafe scheme → render the link text as plain text and
                // discard the href entirely. Consumes the same span so
                // the parser advances.
                parts.push(<Fragment key={`t-${keyCounter++}`}>{link[1]}</Fragment>);
                i += link[0].length;
                continue;
            }
            const isExternal = /^https?:\/\//i.test(href);
            parts.push(
                <Box
                    key={`l-${keyCounter++}`}
                    component="a"
                    href={href}
                    {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    sx={{
                        color: ATLAS_PALETTE.purple,
                        textDecoration: 'underline',
                        textUnderlineOffset: '2px',
                        '&:hover': {
                            color: ATLAS_PALETTE.purple,
                            textDecorationThickness: '2px',
                        },
                    }}
                >
                    {link[1]}
                </Box>
            );
            i += link[0].length;
            continue;
        }
        parts.push(<Fragment key={`t-${keyCounter++}`}>{remaining[0]}</Fragment>);
        i += 1;
    }
    return parts;
}

interface Block {
    kind: 'h1' | 'h2' | 'h3' | 'p' | 'ul' | 'blank';
    content: string;
    items?: string[];
}

function parseBlocks(md: string): Block[] {
    const lines = md.split('\n');
    const blocks: Block[] = [];
    let bulletBuffer: string[] = [];
    let paraBuffer: string[] = [];

    function flushBullets() {
        if (bulletBuffer.length === 0) return;
        blocks.push({ kind: 'ul', content: '', items: bulletBuffer });
        bulletBuffer = [];
    }
    function flushPara() {
        if (paraBuffer.length === 0) return;
        blocks.push({ kind: 'p', content: paraBuffer.join(' ') });
        paraBuffer = [];
    }

    for (const raw of lines) {
        const line = raw;
        if (line.trim() === '') {
            flushBullets();
            flushPara();
            continue;
        }
        const h1 = line.match(/^#\s+(.*)$/);
        const h2 = line.match(/^##\s+(.*)$/);
        const h3 = line.match(/^###\s+(.*)$/);
        if (h2) {
            flushBullets();
            flushPara();
            blocks.push({ kind: 'h2', content: h2[1] ?? '' });
            continue;
        }
        if (h3) {
            flushBullets();
            flushPara();
            blocks.push({ kind: 'h3', content: h3[1] ?? '' });
            continue;
        }
        if (h1) {
            flushBullets();
            flushPara();
            blocks.push({ kind: 'h1', content: h1[1] ?? '' });
            continue;
        }
        const bullet = line.match(/^\s*-\s+(.*)$/);
        if (bullet) {
            flushPara();
            bulletBuffer.push(bullet[1] ?? '');
            continue;
        }
        flushBullets();
        paraBuffer.push(line);
    }
    flushBullets();
    flushPara();

    return blocks;
}

export function MarkdownPreview({ source }: { source: string }) {
    if (!source.trim()) {
        return (
            <Typography sx={{ fontSize: 13, color: ATLAS_PALETTE.slate40, fontStyle: 'italic' }}>
                Empty document. Start typing on the left.
            </Typography>
        );
    }
    const blocks = parseBlocks(source);
    return (
        // `overflowWrap: anywhere` is inherited, so it cascades to every block
        // below — paragraphs, headings, list items, links, and the monospace
        // inline-code spans. Without it, an unbroken token (a file path or a
        // long URL in `code`) has no break opportunity and runs off the right
        // edge of the comment column, past the viewport on narrow screens.
        <Box sx={{ color: ATLAS_PALETTE.slate80, overflowWrap: 'anywhere' }}>
            {blocks.map((b, idx) => {
                if (b.kind === 'h1') {
                    return (
                        <Typography
                            key={idx}
                            sx={{
                                fontSize: 20,
                                fontWeight: 700,
                                color: ATLAS_PALETTE.slate,
                                mt: idx === 0 ? 0 : 4,
                                mb: 2,
                                letterSpacing: '-0.01em',
                            }}
                        >
                            {renderInline(b.content)}
                        </Typography>
                    );
                }
                if (b.kind === 'h2') {
                    return (
                        <Typography
                            key={idx}
                            sx={{
                                fontSize: 12,
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.purple,
                                mt: idx === 0 ? 0 : 4,
                                mb: 1.5,
                            }}
                        >
                            {renderInline(b.content)}
                        </Typography>
                    );
                }
                if (b.kind === 'h3') {
                    return (
                        <Typography
                            key={idx}
                            sx={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: ATLAS_PALETTE.slate,
                                mt: 3,
                                mb: 1,
                            }}
                        >
                            {renderInline(b.content)}
                        </Typography>
                    );
                }
                if (b.kind === 'ul') {
                    return (
                        <Box
                            key={idx}
                            component="ul"
                            sx={{
                                pl: 3,
                                my: 1.5,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 1,
                            }}
                        >
                            {(b.items ?? []).map((item, j) => (
                                <Box
                                    key={j}
                                    component="li"
                                    sx={{
                                        fontSize: 13.5,
                                        lineHeight: 1.7,
                                        color: ATLAS_PALETTE.slate80,
                                    }}
                                >
                                    {renderInline(item)}
                                </Box>
                            ))}
                        </Box>
                    );
                }
                return (
                    <Typography
                        key={idx}
                        sx={{
                            fontSize: 13.5,
                            lineHeight: 1.7,
                            color: ATLAS_PALETTE.slate80,
                            mb: 2,
                        }}
                    >
                        {renderInline(b.content)}
                    </Typography>
                );
            })}
        </Box>
    );
}
