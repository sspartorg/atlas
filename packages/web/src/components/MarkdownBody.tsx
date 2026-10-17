import { useMemo, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ATLAS_PALETTE } from '../theme/tokens.js';

const MONO = '"JetBrains Mono", monospace';

// Agent-authored comments and descriptions flow through here verbatim, so the
// renderer is the trust boundary:
// - Raw HTML is never rendered (react-markdown's default; no rehype-raw), it
//   shows as text.
// - Links: only http(s), mailto and same-origin `/path` keep their href. A
//   `javascript:` / `data:` / `vbscript:` / protocol-relative `//host` link
//   renders as its plain text, since it would run in the Owner's origin.
// - Images: only Atlas's own copies of Jira attachments render; any other
//   image URL shows its alt text, so a description can't load third-party
//   images.
const isSafeHref = (href: string): boolean =>
    /^https?:\/\//i.test(href) || /^mailto:/i.test(href) || /^\/(?!\/)/.test(href);
const isJiraAttachment = (src: string): boolean => /^\/api\/jira-attachments\/[^/?#]+$/.test(src);

const body = { fontSize: 13.5, lineHeight: 1.7, color: ATLAS_PALETTE.slate80 } as const;

const components: Components = {
    h1: ({ children }) => (
        <Typography
            sx={{
                fontSize: 20,
                fontWeight: 700,
                color: ATLAS_PALETTE.slate,
                mt: 4,
                mb: 2,
                letterSpacing: '-0.01em',
                '&:first-of-type': { mt: 0 },
            }}
        >
            {children}
        </Typography>
    ),
    h2: ({ children }) => (
        <Typography
            sx={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: ATLAS_PALETTE.purple,
                mt: 4,
                mb: 1.5,
                '&:first-of-type': { mt: 0 },
            }}
        >
            {children}
        </Typography>
    ),
    h3: ({ children }) => <Heading size={14}>{children}</Heading>,
    h4: ({ children }) => <Heading size={13.5}>{children}</Heading>,
    h5: ({ children }) => <Heading size={13}>{children}</Heading>,
    h6: ({ children }) => <Heading size={13}>{children}</Heading>,
    p: ({ children }) => <Typography sx={{ ...body, mb: 2, '&:last-of-type': { mb: 0 } }}>{children}</Typography>,
    ul: ({ children }) => <List component="ul">{children}</List>,
    ol: ({ children, start }) => (
        <List component="ol" {...(start !== undefined ? { start } : {})}>
            {children}
        </List>
    ),
    li: ({ children }) => (
        <Box component="li" sx={{ ...body, '& > p': { mb: 0 } }}>
            {children}
        </Box>
    ),
    strong: ({ children }) => (
        <Box component="strong" sx={{ fontWeight: 700, color: ATLAS_PALETTE.slate }}>
            {children}
        </Box>
    ),
    em: ({ children }) => (
        <Box component="em" sx={{ fontStyle: 'italic' }}>
            {children}
        </Box>
    ),
    hr: () => <Box component="hr" sx={{ border: 0, borderTop: `1px solid ${ATLAS_PALETTE.slate10}`, my: 2 }} />,
    // Fenced code: keep every line and its whitespace (CLI / test output is
    // the common agent payload), scroll sideways instead of wrapping.
    pre: ({ children }) => (
        <Box
            component="pre"
            // A block that scrolls must take keyboard focus, or its overflow
            // is out of reach without a mouse (WCAG 2.1.1).
            tabIndex={0}
            sx={{
                m: 0,
                mb: 2,
                p: 1.5,
                // Long CLI / test output scrolls inside the block instead of
                // pushing the rest of the thread off screen.
                maxHeight: 420,
                overflow: 'auto',
                overflowWrap: 'normal',
                background: ATLAS_PALETTE.slate08,
                borderRadius: '6px',
                fontFamily: MONO,
                fontSize: 12.5,
                lineHeight: 1.6,
                color: ATLAS_PALETTE.slate,
                '& code': { background: 'none', p: 0, fontSize: 'inherit' },
            }}
        >
            {children}
        </Box>
    ),
    code: ({ children }) => (
        <Box
            component="code"
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
            {children}
        </Box>
    ),
    // Wide tables scroll inside their own box instead of pushing the page
    // past the viewport on a phone.
    table: ({ children }) => (
        <Box tabIndex={0} sx={{ overflowX: 'auto', mb: 2 }}>
            <Box
                component="table"
                sx={{
                    borderCollapse: 'collapse',
                    fontSize: 13,
                    overflowWrap: 'normal',
                    '& th, & td': {
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                        px: 1.25,
                        py: 0.75,
                        textAlign: 'left',
                        verticalAlign: 'top',
                        color: ATLAS_PALETTE.slate80,
                    },
                    '& th': { fontWeight: 600, color: ATLAS_PALETTE.slate, background: ATLAS_PALETTE.slate08 },
                }}
            >
                {children}
            </Box>
        </Box>
    ),
    a: ({ href, children }) => {
        if (!href || !isSafeHref(href)) return <>{children}</>;
        const external = /^https?:\/\//i.test(href);
        return (
            <Box
                component="a"
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                sx={{
                    color: ATLAS_PALETTE.purple,
                    textDecoration: 'underline',
                    textUnderlineOffset: '2px',
                    '&:hover': { color: ATLAS_PALETTE.purple, textDecorationThickness: '2px' },
                }}
            >
                {children}
            </Box>
        );
    },
    img: ({ src, alt }) => {
        if (typeof src !== 'string' || !isJiraAttachment(src)) return <>{alt ?? ''}</>;
        return (
            <Box
                component="a"
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: 'inline-block', maxWidth: '100%' }}
            >
                <Box
                    component="img"
                    src={src}
                    alt={alt ?? ''}
                    loading="lazy"
                    sx={{
                        display: 'block',
                        maxWidth: '100%',
                        maxHeight: 360,
                        borderRadius: '6px',
                        border: `1px solid ${ATLAS_PALETTE.slate10}`,
                    }}
                />
            </Box>
        );
    },
    input: ({ checked }) => (
        <Box component="input" type="checkbox" checked={Boolean(checked)} disabled readOnly sx={{ mr: 0.75 }} />
    ),
};

function Heading({ size, children }: { size: number; children: ReactNode }) {
    return (
        <Typography sx={{ fontSize: size, fontWeight: 600, color: ATLAS_PALETTE.slate, mt: 3, mb: 1, '&:first-of-type': { mt: 0 } }}>
            {children}
        </Typography>
    );
}

function List({ component, children, start }: { component: 'ul' | 'ol'; children: ReactNode; start?: number }) {
    return (
        <Box
            component={component}
            {...(start !== undefined ? { start } : {})}
            sx={{ pl: 3, my: 1.5, display: 'flex', flexDirection: 'column', gap: 1, '& ul, & ol': { my: 0.5 } }}
        >
            {children}
        </Box>
    );
}

// Our own checks above decide what a link or image may point at; react-markdown's
// default transform would blank the href before they see it.
const keepUrl = (url: string): string => url;

/** The rendered markdown. Loaded on its own chunk by MarkdownPreview. */
// Quotes hold imported Jira text (ADR 0016), which is wiki markup, not
// markdown: "# step" is a numbered item and "||a||b||" a table there. So a
// quote renders its own source lines with every block marker escaped, keeping
// the inline marks (bold, code, links, Jira attachment images) and its line
// breaks, and never turning into headings, lists or tables.
// Only what opens a block: a bullet needs its space, a fence its three marks,
// so a line starting with **bold** or `code` keeps its inline formatting.
const BLOCK_START = /^([#>|=]|[*+-](\s|$)|-{3,}|`{3}|~{3})/;
export function quoteAsInline(quoteSource: string): string {
    return quoteSource
        .split('\n')
        .map((line) => line.replace(/^\s*>\s?/, ''))
        .map((line) => {
            const indent = line.match(/^\s*/)?.[0] ?? '';
            const rest = line.slice(indent.length);
            // Leading spaces stay visible without becoming a code block.
            const escaped = BLOCK_START.test(rest)
                ? `\\${rest}`
                : rest.replace(/^(\d+)([.)])/, '$1\\$2'); // "1." would start a list
            return '\u00a0'.repeat(indent.length) + escaped;
        })
        .join('\n')
        .replace(/([^\n])\n(?=[^\n])/g, '$1\\\n');
}

function Quote({ source }: { source: string }) {
    return (
        <Box
            component="blockquote"
            sx={{
                m: 0,
                mb: 2,
                pl: 2,
                borderLeft: `3px solid ${ATLAS_PALETTE.slate10}`,
                '& p': { mb: 1 },
                '& p:last-of-type': { mb: 0 },
            }}
        >
            <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={keepUrl}>
                {quoteAsInline(source)}
            </Markdown>
        </Box>
    );
}

/** The rendered markdown. Loaded on its own chunk by MarkdownPreview. */
export function MarkdownBody({ source }: { source: string }) {
    const withQuotes = useMemo<Components>(
        () => ({
            ...components,
            blockquote: ({ node }) => {
                const start = node?.position?.start.offset ?? 0;
                const end = node?.position?.end.offset ?? 0;
                return <Quote source={source.slice(start, end)} />;
            },
        }),
        [source]
    );
    return (
        <Markdown remarkPlugins={[remarkGfm]} components={withQuotes} urlTransform={keepUrl}>
            {source}
        </Markdown>
    );
}
