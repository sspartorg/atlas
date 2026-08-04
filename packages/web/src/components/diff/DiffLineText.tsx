import { memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import { ATLAS_PALETTE } from '../../theme/tokens.js';
import { composeSpans } from './spanCompose.js';
import { detectLanguage, tokenizeLine, HIGHLIGHT_CHAR_CAP, type LanguageId, type TokenType } from './syntaxHighlight.js';
import { diffWords, type WordSpan } from './wordDiff.js';

// 2026-08-04 — Terminal finalize diff. One line of code, syntax-coloured and
// word-diff highlighted. `memo`'d because a virtualized pane re-renders the
// whole visible window on every scroll tick, and the tokenizer + LCS run in
// `useMemo` here rather than upstream so we only pay for visible rows.

const TOKEN_COLOR: Record<TokenType, string> = {
    plain: ATLAS_PALETTE.slate,
    keyword: ATLAS_PALETTE.diffTokKeyword,
    string: ATLAS_PALETTE.diffTokString,
    comment: ATLAS_PALETTE.diffTokComment,
    number: ATLAS_PALETTE.diffTokNumber,
    punct: ATLAS_PALETTE.diffTokPunct,
};

interface Props {
    text: string;
    /** Path of the file being rendered — drives language detection. */
    path: string;
    /** Which side this line is on; picks the word-highlight colour. */
    side: 'add' | 'del' | 'context';
    /** The paired line on the other side, or null when unpaired. */
    counterpart: string | null;
}

export const DiffLineText = memo(function DiffLineText({
    text,
    path,
    side,
    counterpart,
}: Props) {
    const lang: LanguageId = useMemo(() => detectLanguage(path), [path]);

    const spans = useMemo(() => {
        // One guard covers both passes: a 2 000+ char line is minified code,
        // a base64 blob, or one-line JSON. Nobody reads it and both passes
        // are wasted work.
        if (text.length > HIGHLIGHT_CHAR_CAP) {
            return [{ text, token: 'plain' as TokenType, changed: false }];
        }
        const syntax = tokenizeLine(text, lang);
        let changed: WordSpan[] = [];
        if (counterpart !== null && side !== 'context') {
            const res = diffWords(side === 'del' ? text : counterpart, side === 'del' ? counterpart : text);
            changed = side === 'del' ? res.left : res.right;
        }
        return composeSpans(text, syntax, changed);
    }, [text, lang, side, counterpart]);

    // A blank line still needs to occupy its row height.
    if (text.length === 0) return <>{' '}</>;

    const wordBg = side === 'add' ? ATLAS_PALETTE.diffAddWord : ATLAS_PALETTE.diffDelWord;

    return (
        <>
            {spans.map((s, i) => (
                <Box
                    component="span"
                    key={i}
                    sx={{
                        color: TOKEN_COLOR[s.token],
                        ...(s.changed
                            ? { bgcolor: wordBg, borderRadius: '2px' }
                            : {}),
                    }}
                >
                    {s.text}
                </Box>
            ))}
        </>
    );
});
