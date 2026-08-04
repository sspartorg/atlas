// 2026-08-04 — Terminal finalize diff. A ~2 KB gz hand-rolled tokenizer.
//
// No third-party highlighter: the web bundle budget is a hard CI gate and
// shiki/prism would blow it on their own. This follows the same
// build-it-small precedent as `DiffViewer.tsx` and `MarkdownPreview.tsx`.
//
// `tokenizeLine` is LINE-SCOPED AND STATELESS, and that is a correctness
// requirement rather than a size compromise. Rows are virtualized, so row 900
// can mount before row 899 exists; a tokenizer carrying multi-line string or
// block-comment state would colour the same line differently depending on
// scroll history. Accepted consequence: a `/* … */` spanning lines is only
// coloured from the opener to the end of its first line.
//
// ReDoS discipline (agent-generated content flows through these):
//   * No nested quantifiers.
//   * String literals use the unrolled form `"(?:[^"\\]|\\.)*"`. The two
//     inner branches are disjoint on their first character, so every prefix
//     has exactly one parse — linear, no backtracking. NEVER `"([^"]|\\")*"`,
//     which IS exponential because `\\` matches both branches.
//   * The scanner is sticky (`/y`) and advances by hand; a no-match emits a
//     one-char plain span and advances by 1, so forward progress is
//     guaranteed and the worst case is O(line length).

export type TokenType = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'punct';

export interface SyntaxSpan {
    start: number;
    end: number;
    token: TokenType;
}

export type LanguageId = 'ts' | 'js' | 'json' | 'py' | 'css' | 'md' | 'yaml' | 'sh' | 'plain';

/** Skip highlighting AND word-diff above this — minified bundles, base64, one-line JSON. */
export const HIGHLIGHT_CHAR_CAP = 2_000;
/** Runaway guard; the remainder collapses to one plain span. */
export const MAX_SPANS_PER_LINE = 400;

const EXT_TO_LANG: Record<string, LanguageId> = {
    ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
    js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
    json: 'json', jsonc: 'json',
    py: 'py', pyi: 'py',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    md: 'md', mdx: 'md', markdown: 'md',
    yaml: 'yaml', yml: 'yaml',
    sh: 'sh', bash: 'sh', zsh: 'sh',
};

export function detectLanguage(path: string): LanguageId {
    const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const dot = base.lastIndexOf('.');
    // No extension, or a dotfile with no extension (`.gitignore`) -> plain.
    // Deliberately no Dockerfile/Makefile special-casing: the table stays honest.
    if (dot <= 0) return 'plain';
    return EXT_TO_LANG[base.slice(dot + 1).toLowerCase()] ?? 'plain';
}

const KW = {
    ts:
        'const|let|var|function|return|if|else|for|while|do|import|export|from|as|type|interface|' +
        'class|extends|implements|new|await|async|try|catch|finally|throw|switch|case|default|' +
        'break|continue|typeof|instanceof|in|of|this|super|null|undefined|true|false|void|delete|' +
        'yield|static|public|private|protected|readonly|enum|namespace|declare|satisfies|keyof|infer',
    py:
        'def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|lambda|' +
        'pass|raise|yield|async|await|None|True|False|and|or|not|in|is|global|nonlocal|assert|del',
    sh:
        'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|echo|set|' +
        'source|shift|trap|exit|read|cd',
    json: 'true|false|null',
} as const;

// One combined sticky regex per family. Named groups keep the scanner generic.
// The `stringOpen` branch catches an UNTERMINATED literal and runs to end of
// line — which is both linear and the right rendering.
function buildRe(source: string): RegExp {
    return new RegExp(source, 'y');
}

const STR_DQ = '"(?:[^"\\\\]|\\\\.)*"';
const STR_SQ = "'(?:[^'\\\\]|\\\\.)*'";
const STR_BQ = '`(?:[^`\\\\]|\\\\.)*`';

const RE_BY_LANG: Record<Exclude<LanguageId, 'plain'>, RegExp> = {
    ts: buildRe(
        `(?<comment>\\/\\/[^\\n]*|\\/\\*[^\\n]*)` +
            `|(?<string>${STR_DQ}|${STR_SQ}|${STR_BQ})` +
            `|(?<stringOpen>["'\`][^\\n]*)` +
            `|(?<number>\\b\\d[\\w.]*)` +
            `|(?<keyword>\\b(?:${KW.ts})\\b)` +
            `|(?<punct>[{}()[\\].,;:?!<>=+\\-*/%&|^~]+)`,
    ),
    js: buildRe(
        `(?<comment>\\/\\/[^\\n]*|\\/\\*[^\\n]*)` +
            `|(?<string>${STR_DQ}|${STR_SQ}|${STR_BQ})` +
            `|(?<stringOpen>["'\`][^\\n]*)` +
            `|(?<number>\\b\\d[\\w.]*)` +
            `|(?<keyword>\\b(?:${KW.ts})\\b)` +
            `|(?<punct>[{}()[\\].,;:?!<>=+\\-*/%&|^~]+)`,
    ),
    json: buildRe(
        `(?<string>${STR_DQ})` +
            `|(?<stringOpen>"[^\\n]*)` +
            `|(?<number>-?\\b\\d[\\w.+\\-]*)` +
            `|(?<keyword>\\b(?:${KW.json})\\b)` +
            `|(?<punct>[{}[\\],:]+)`,
    ),
    py: buildRe(
        `(?<comment>#[^\\n]*)` +
            `|(?<string>${STR_DQ}|${STR_SQ})` +
            `|(?<stringOpen>["'][^\\n]*)` +
            `|(?<number>\\b\\d[\\w.]*)` +
            `|(?<keyword>\\b(?:${KW.py})\\b)` +
            `|(?<punct>[{}()[\\].,;:=+\\-*/%<>!&|^~]+)`,
    ),
    css: buildRe(
        `(?<comment>\\/\\*[^\\n]*)` +
            `|(?<string>${STR_DQ}|${STR_SQ})` +
            `|(?<number>#[0-9a-fA-F]{3,8}\\b|\\b\\d[\\w.%]*)` +
            `|(?<keyword>@[a-zA-Z-]+|[a-zA-Z-]+(?=\\s*:))` +
            `|(?<punct>[{}()[\\].,;:>+~*]+)`,
    ),
    md: buildRe(
        `(?<comment>^\\s*>[^\\n]*)` +
            `|(?<keyword>^\\s*#{1,6}\\s[^\\n]*|\\*\\*[^*\\n]*\\*\\*|__[^_\\n]*__)` +
            `|(?<string>\`[^\`\\n]*\`)` +
            `|(?<number>\\]\\([^)\\n]*\\))` +
            `|(?<punct>[*_[\\]()#>\`-]+)`,
    ),
    yaml: buildRe(
        `(?<comment>#[^\\n]*)` +
            `|(?<string>${STR_DQ}|${STR_SQ})` +
            `|(?<keyword>^\\s*-?\\s*[\\w.\\-/]+(?=\\s*:))` +
            `|(?<number>\\b\\d[\\w.\\-:+]*)` +
            `|(?<punct>[:\\-[\\]{},]+)`,
    ),
    sh: buildRe(
        `(?<comment>#[^\\n]*)` +
            `|(?<string>${STR_DQ}|${STR_SQ})` +
            `|(?<stringOpen>["'][^\\n]*)` +
            `|(?<keyword>\\$\\{[^}\\n]*\\}|\\$[A-Za-z_][A-Za-z0-9_]*|\\b(?:${KW.sh})\\b)` +
            `|(?<number>\\b\\d[\\w.]*)` +
            `|(?<punct>[|&;()<>{}[\\]=]+)`,
    ),
};

function groupToToken(groups: Record<string, string | undefined>): TokenType | null {
    if (groups['comment'] !== undefined) return 'comment';
    if (groups['string'] !== undefined || groups['stringOpen'] !== undefined) return 'string';
    if (groups['number'] !== undefined) return 'number';
    if (groups['keyword'] !== undefined) return 'keyword';
    if (groups['punct'] !== undefined) return 'punct';
    return null;
}

/**
 * TILES the line — every character is covered by exactly one span, including
 * `plain` runs. `composeSpans` needs total coverage or the gaps drop text.
 */
export function tokenizeLine(line: string, lang: LanguageId): SyntaxSpan[] {
    if (line.length === 0) return [];
    if (lang === 'plain' || line.length > HIGHLIGHT_CHAR_CAP) {
        return [{ start: 0, end: line.length, token: 'plain' }];
    }
    const re = RE_BY_LANG[lang];
    const spans: SyntaxSpan[] = [];
    let plainStart = 0;
    let i = 0;

    const flushPlain = (upto: number): void => {
        if (upto > plainStart) spans.push({ start: plainStart, end: upto, token: 'plain' });
    };

    while (i < line.length) {
        if (spans.length >= MAX_SPANS_PER_LINE) break;
        re.lastIndex = i;
        const m = re.exec(line);
        if (m && m.index === i && m[0].length > 0) {
            const token = groupToToken(m.groups ?? {});
            if (token) {
                flushPlain(i);
                spans.push({ start: i, end: i + m[0].length, token });
                i += m[0].length;
                plainStart = i;
                continue;
            }
        }
        // No match at this position: advance one char. Guaranteed forward
        // progress — this is what makes the worst case linear.
        i++;
    }
    flushPlain(line.length);
    // Runaway guard tripped mid-line: dump the remainder as one plain span so
    // the output still tiles.
    const covered = spans.length > 0 ? spans[spans.length - 1]!.end : 0;
    if (covered < line.length) {
        spans.push({ start: covered, end: line.length, token: 'plain' });
    }
    return spans;
}
