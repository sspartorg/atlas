import { useMemo, useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { IProject, IAgent } from '@atlas/shared';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import {
    highlightQuery,
    parseQuery,
    autocompleteSuggestions,
    EXAMPLE_QUERIES,
} from './searchViewModel.js';

const MONO = '"JetBrains Mono", monospace';

const KIND_COLOR: Record<string, string> = {
    field: ATLAS_PALETTE.brandBlue,
    op: ATLAS_PALETTE.slate60,
    value: ATLAS_PALETTE.green,
    'value-string': ATLAS_PALETTE.green,
    connector: ATLAS_PALETTE.purple,
    unknown: ATLAS_PALETTE.slate,
    space: 'transparent',
};

interface Props {
    query: string;
    setQuery: (q: string) => void;
    projects: IProject[];
    agents: IAgent[];
    ownerName: string;
    onSubmit: () => void;
    resultCount: number;
    resultTypeCount: number;
}

export function SearchQueryInput({
    query,
    setQuery,
    projects,
    agents,
    ownerName,
    onSubmit,
    resultCount,
    resultTypeCount,
}: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [focused, setFocused] = useState(false);

    const tokens = useMemo(() => highlightQuery(query), [query]);
    const parsed = useMemo(
        () => parseQuery(query, { projects, agents, ownerName }),
        [query, projects, agents, ownerName]
    );
    const suggestions = useMemo(
        () => (focused ? autocompleteSuggestions(query, { projects, agents }).slice(0, 6) : []),
        [query, focused, projects, agents]
    );

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
        } else if (e.key === 'Tab' && suggestions.length > 0) {
            e.preventDefault();
            const first = suggestions[0];
            /* v8 ignore next -- defensive only: `suggestions.length > 0` (checked above) guarantees index 0 exists. */
            if (!first) return;
            // Append/replace the trailing partial with the suggestion.
            const fieldMatch = /([A-Za-z_]+)\s*=\s*"?([^"]*)$/.exec(query);
            const lastWord = /([A-Za-z_]+)$/.exec(query.trim());
            let next = query;
            if (fieldMatch) {
                next = query.replace(/"?[^"]*$/, first.text);
            } else if (lastWord) {
                next = query.replace(/[A-Za-z_]+$/, first.text);
                if (first.kind === 'field') next += ' = ';
            } else {
                next = (query.trimEnd() + ' ' + first.text).trim();
                if (first.kind === 'field') next += ' = ';
            }
            setQuery(next);
        }
    }

    function applyExample(q: string) {
        setQuery(q);
        inputRef.current?.focus();
    }

    useEffect(() => {
        /* placeholder for cursor sync if needed */
    }, [query]);

    return (
        <Box
            sx={{
                background: ATLAS_PALETTE.white,
                border: `1px solid ${ATLAS_PALETTE.slate10}`,
                borderRadius: '12px',
                p: 4,
                mb: 4,
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    mb: 3,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <Box
                        sx={{
                            width: 28,
                            height: 28,
                            borderRadius: '6px',
                            background: `${ATLAS_PALETTE.brandBlue}14`,
                            border: `1px solid ${ATLAS_PALETTE.brandBlue}30`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <Box
                            component="span"
                            className="material-symbols-rounded"
                            sx={{ fontSize: 16, color: ATLAS_PALETTE.brandBlue }}
                        >
                            code
                        </Box>
                    </Box>
                    <Box>
                        <Typography
                            sx={{ fontSize: 13, fontWeight: 600, color: ATLAS_PALETTE.slate }}
                        >
                            JQL-lite
                        </Typography>
                        <Typography
                            sx={{ fontSize: 11.5, color: ATLAS_PALETTE.slate60, mt: 0.25 }}
                        >
                            Press{' '}
                            <Box
                                component="span"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 10.5,
                                    background: ATLAS_PALETTE.slate08,
                                    px: 0.75,
                                    py: 0.25,
                                    borderRadius: '4px',
                                }}
                            >
                                Tab
                            </Box>{' '}
                            to autocomplete,{' '}
                            <Box
                                component="span"
                                sx={{
                                    fontFamily: MONO,
                                    fontSize: 10.5,
                                    background: ATLAS_PALETTE.slate08,
                                    px: 0.75,
                                    py: 0.25,
                                    borderRadius: '4px',
                                }}
                            >
                                Enter
                            </Box>{' '}
                            to run
                        </Typography>
                    </Box>
                </Box>
                {!parsed.ok && query.trim() && (
                    <Box
                        sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.5,
                            color: ATLAS_PALETTE.error,
                        }}
                    >
                        <Box
                            sx={{
                                width: 6,
                                height: 6,
                                borderRadius: '9999px',
                                background: ATLAS_PALETTE.error,
                            }}
                        />
                        <Typography
                            sx={{
                                fontFamily: MONO,
                                fontSize: 11,
                                color: 'inherit',
                                fontWeight: 500,
                            }}
                        >
                            {/* v8 ignore next -- defensive fallback: parseQuery only reaches ok:false with a populated errorMessage string, so every failing branch already sets one. */}
                            {parsed.errorMessage ?? 'invalid'}
                        </Typography>
                    </Box>
                )}
            </Box>

            {/* Input field with overlay syntax */}
            <Box
                sx={{
                    position: 'relative',
                    border: `1px solid ${focused ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate12}`,
                    borderRadius: '8px',
                    background: ATLAS_PALETTE.white,
                    transition: 'border-color 150ms ease',
                    '&:hover': {
                        borderColor: focused ? ATLAS_PALETTE.brandBlue : ATLAS_PALETTE.slate30,
                    },
                }}
            >
                <Box
                    sx={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        px: 2,
                        py: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        className="material-symbols-rounded"
                        sx={{ fontSize: 18, color: ATLAS_PALETTE.slate40, flexShrink: 0 }}
                    >
                        search
                    </Box>
                    <Box sx={{ position: 'relative', flex: 1 }}>
                        {/* Syntax overlay */}
                        <Box
                            aria-hidden
                            sx={{
                                position: 'absolute',
                                inset: 0,
                                fontFamily: MONO,
                                fontSize: 14,
                                lineHeight: '24px',
                                whiteSpace: 'pre',
                                overflow: 'hidden',
                                pointerEvents: 'none',
                                color: ATLAS_PALETTE.slate,
                            }}
                        >
                            {tokens.length === 0
                                ? null
                                : tokens.map((t, idx) => (
                                      <Box
                                          key={idx}
                                          component="span"
                                          sx={{
                                              /* v8 ignore next -- defensive fallback: SyntaxToken['kind'] is a closed union and KIND_COLOR has an entry for every member, so the ?? fallback can never trigger. */
                                              color: KIND_COLOR[t.kind] ?? ATLAS_PALETTE.slate,
                                              fontWeight:
                                                  t.kind === 'field' || t.kind === 'connector'
                                                      ? 600
                                                      : 400,
                                          }}
                                      >
                                          {t.text}
                                      </Box>
                                  ))}
                        </Box>
                        <Box
                            component="input"
                            ref={inputRef}
                            autoComplete="off"
                            value={query}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setQuery(e.target.value)
                            }
                            onFocus={() => setFocused(true)}
                            onBlur={() => setTimeout(() => setFocused(false), 120)}
                            onKeyDown={handleKeyDown}
                            placeholder={'type = "story" AND status = "Ready for Dev"'}
                            sx={{
                                position: 'relative',
                                width: '100%',
                                border: 'none',
                                outline: 'none',
                                background: 'transparent',
                                color: query.length > 0 ? 'transparent' : ATLAS_PALETTE.slate40,
                                caretColor: ATLAS_PALETTE.slate,
                                fontFamily: MONO,
                                fontSize: 14,
                                lineHeight: '24px',
                                p: 0,
                                '&::placeholder': { color: ATLAS_PALETTE.slate40 },
                            }}
                        />
                    </Box>
                </Box>

                {/* Autocomplete */}
                {focused && suggestions.length > 0 ? (
                    <Box
                        sx={{
                            borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                            background: ATLAS_PALETTE.cloud,
                            px: 2,
                            py: 1.5,
                        }}
                    >
                        <Typography
                            sx={{
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: '.06em',
                                textTransform: 'uppercase',
                                color: ATLAS_PALETTE.slate60,
                                mb: 1.5,
                            }}
                        >
                            Autocomplete · {suggestions.length} match
                            {suggestions.length === 1 ? '' : 'es'}
                        </Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            {suggestions.map((s, i) => (
                                <Box
                                    key={i}
                                    role="button"
                                    tabIndex={0}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                    }}
                                    onClick={() => {
                                        // Replace the trailing partial with the suggestion text.
                                        const fieldMatch = /([A-Za-z_]+)\s*=\s*"?([^"]*)$/.exec(
                                            query
                                        );
                                        const lastWord = /([A-Za-z_]+)$/.exec(query.trim());
                                        let next = query;
                                        if (fieldMatch) {
                                            next = query.replace(/"?[^"]*$/, s.text);
                                        } else if (lastWord) {
                                            next = query.replace(/[A-Za-z_]+$/, s.text);
                                            if (s.kind === 'field') next += ' = ';
                                        } else {
                                            next = (query.trimEnd() + ' ' + s.text).trim();
                                            if (s.kind === 'field') next += ' = ';
                                        }
                                        setQuery(next);
                                        inputRef.current?.focus();
                                    }}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '60px 1fr auto',
                                        gap: 2,
                                        alignItems: 'center',
                                        px: 1.5,
                                        py: 1,
                                        borderRadius: '6px',
                                        cursor: 'pointer',
                                        background:
                                            i === 0
                                                ? `${ATLAS_PALETTE.brandBlue}10`
                                                : 'transparent',
                                        '&:hover': { background: `${ATLAS_PALETTE.brandBlue}14` },
                                    }}
                                >
                                    <Box
                                        component="span"
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 10,
                                            color: ATLAS_PALETTE.slate60,
                                            fontWeight: 600,
                                            textTransform: 'uppercase',
                                            letterSpacing: '.06em',
                                        }}
                                    >
                                        {s.kind}
                                    </Box>
                                    <Typography
                                        sx={{
                                            fontFamily: MONO,
                                            fontSize: 12,
                                            color:
                                                s.kind === 'field'
                                                    ? ATLAS_PALETTE.brandBlue
                                                    : ATLAS_PALETTE.green,
                                            fontWeight: 500,
                                        }}
                                    >
                                        {s.text}
                                    </Typography>
                                    {s.note ? (
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                color: ATLAS_PALETTE.slate60,
                                                textAlign: 'right',
                                            }}
                                        >
                                            {s.note}
                                        </Typography>
                                    ) : null}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                ) : null}
            </Box>

            {/* Example queries */}
            <Box sx={{ mt: 3 }}>
                <Typography
                    sx={{
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        color: ATLAS_PALETTE.slate60,
                        mb: 1.5,
                    }}
                >
                    Example queries
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {EXAMPLE_QUERIES.map((eq) => (
                        <Box
                            key={eq.query}
                            role="button"
                            tabIndex={0}
                            onClick={() => applyExample(eq.query)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') applyExample(eq.query);
                            }}
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: '20px 1fr',
                                gap: 2,
                                alignItems: 'flex-start',
                                px: 1.5,
                                py: 1.25,
                                borderRadius: '6px',
                                cursor: 'pointer',
                                transition: 'background 150ms ease',
                                '&:hover': { background: ATLAS_PALETTE.cloud },
                            }}
                        >
                            <Box
                                component="span"
                                className="material-symbols-rounded"
                                sx={{
                                    fontSize: 14,
                                    color: ATLAS_PALETTE.slate40,
                                    mt: '2px',
                                }}
                            >
                                play_circle
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography
                                    sx={{
                                        fontFamily: MONO,
                                        fontSize: 12,
                                        color: ATLAS_PALETTE.slate,
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    {eq.query}
                                </Typography>
                                <Typography
                                    sx={{
                                        fontSize: 11.5,
                                        color: ATLAS_PALETTE.slate60,
                                        mt: 0.5,
                                        lineHeight: 1.5,
                                    }}
                                >
                                    {eq.description}
                                </Typography>
                            </Box>
                        </Box>
                    ))}
                </Box>
            </Box>

            {/* Count summary for the current query */}
            <Box
                sx={{
                    mt: 3,
                    pt: 3,
                    borderTop: `1px solid ${ATLAS_PALETTE.slate06}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    flexWrap: 'wrap',
                }}
            >
                <Box
                    component="span"
                    className="material-symbols-rounded"
                    sx={{ fontSize: 14, color: ATLAS_PALETTE.slate60 }}
                >
                    visibility
                </Box>
                <Typography
                    sx={{ fontFamily: MONO, fontSize: 11.5, color: ATLAS_PALETTE.slate60 }}
                >
                    Showing{' '}
                    <Box component="b" sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600 }}>
                        {resultCount} result{resultCount === 1 ? '' : 's'}
                    </Box>{' '}
                    across{' '}
                    <Box component="b" sx={{ color: ATLAS_PALETTE.slate, fontWeight: 600 }}>
                        {resultTypeCount} type{resultTypeCount === 1 ? '' : 's'}
                    </Box>
                </Typography>
            </Box>
        </Box>
    );
}
