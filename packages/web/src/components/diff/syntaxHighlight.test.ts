import { describe, expect, it } from 'vitest';
import {
    detectLanguage,
    tokenizeLine,
    HIGHLIGHT_CHAR_CAP,
    MAX_SPANS_PER_LINE,
    type LanguageId,
} from './syntaxHighlight.js';

/** The tiling invariant: spans are sorted, disjoint, and cover the whole line. */
function expectTiles(line: string, lang: LanguageId): void {
    const spans = tokenizeLine(line, lang);
    if (line.length === 0) {
        expect(spans).toEqual([]);
        return;
    }
    let cursor = 0;
    for (const s of spans) {
        expect(s.start).toBe(cursor);
        expect(s.end).toBeGreaterThan(s.start);
        cursor = s.end;
    }
    expect(cursor).toBe(line.length);
}

const tokensOf = (line: string, lang: LanguageId) =>
    tokenizeLine(line, lang).map((s) => [line.slice(s.start, s.end), s.token]);

describe('detectLanguage', () => {
    it.each([
        ['src/a.ts', 'ts'],
        ['src/a.tsx', 'ts'],
        ['src/a.mts', 'ts'],
        ['a.js', 'js'],
        ['a.jsx', 'js'],
        ['pkg.json', 'json'],
        ['run.py', 'py'],
        ['style.css', 'css'],
        ['style.scss', 'css'],
        ['README.md', 'md'],
        ['ci.yaml', 'yaml'],
        ['ci.yml', 'yaml'],
        ['run.sh', 'sh'],
        ['run.bash', 'sh'],
    ])('maps %s to %s', (path, lang) => {
        expect(detectLanguage(path)).toBe(lang);
    });

    it('is case-insensitive on the extension', () => {
        expect(detectLanguage('A.TS')).toBe('ts');
    });

    it('uses the LAST extension', () => {
        expect(detectLanguage('foo.bar.ts')).toBe('ts');
        expect(detectLanguage('foo.ts.bak')).toBe('plain');
    });

    it.each([
        ['Dockerfile'],
        ['Makefile'],
        ['.gitignore'],
        [''],
        ['dir/noext'],
        ['weird.zzz'],
    ])('falls back to plain for %s', (path) => {
        expect(detectLanguage(path)).toBe('plain');
    });

    it('ignores directory segments when looking for the extension', () => {
        expect(detectLanguage('my.dir/file')).toBe('plain');
    });
});

describe('tokenizeLine — tiling invariant', () => {
    const samples: Array<[LanguageId, string]> = [
        ['ts', 'const foo = "bar"; // note'],
        ['js', 'let x = 42 + y;'],
        ['json', '{ "key": 12, "ok": true }'],
        ['py', 'def run(x): # go'],
        ['css', '.cls { color: #fff; }'],
        ['md', '# Title with **bold** and `code`'],
        ['yaml', 'key: value # note'],
        ['sh', 'if [ -f "$HOME/x" ]; then echo hi; fi'],
        ['plain', 'anything at all'],
    ];

    it.each(samples)('tiles %s lines completely', (lang, line) => {
        expectTiles(line, lang);
    });

    it('returns [] for an empty line in every language', () => {
        for (const [lang] of samples) expect(tokenizeLine('', lang)).toEqual([]);
    });

    it('returns exactly one plain span for the plain language', () => {
        const spans = tokenizeLine('const foo = 1;', 'plain');
        expect(spans).toEqual([{ start: 0, end: 14, token: 'plain' }]);
    });
});

describe('tokenizeLine — classification', () => {
    it('classifies ts keywords, strings, comments and numbers', () => {
        expect(tokensOf('const x = 1;', 'ts')).toContainEqual(['const', 'keyword']);
        expect(tokensOf('const x = 1;', 'ts')).toContainEqual(['1', 'number']);
        expect(tokensOf('a = "hi";', 'ts')).toContainEqual(['"hi"', 'string']);
        expect(tokensOf('x // note', 'ts')).toContainEqual(['// note', 'comment']);
        expect(tokensOf('a = `tpl`;', 'ts')).toContainEqual(['`tpl`', 'string']);
    });

    it('classifies python comments and keywords', () => {
        expect(tokensOf('def go(): # hi', 'py')).toContainEqual(['def', 'keyword']);
        expect(tokensOf('def go(): # hi', 'py')).toContainEqual(['# hi', 'comment']);
    });

    it('classifies json literals', () => {
        const t = tokensOf('{"a": true, "b": null, "c": 3}', 'json');
        expect(t).toContainEqual(['true', 'keyword']);
        expect(t).toContainEqual(['null', 'keyword']);
        expect(t).toContainEqual(['"a"', 'string']);
    });

    it('classifies css hex colours as numbers and at-rules as keywords', () => {
        expect(tokensOf('a { color: #ff0000; }', 'css')).toContainEqual(['#ff0000', 'number']);
        expect(tokensOf('@media screen {', 'css')).toContainEqual(['@media', 'keyword']);
    });

    it('classifies yaml keys and comments', () => {
        const t = tokensOf('name: value # note', 'yaml');
        expect(t).toContainEqual(['name', 'keyword']);
        expect(t).toContainEqual(['# note', 'comment']);
    });

    it('classifies shell variables and keywords', () => {
        const t = tokensOf('echo $HOME', 'sh');
        expect(t).toContainEqual(['echo', 'keyword']);
        expect(t).toContainEqual(['$HOME', 'keyword']);
    });

    it('classifies markdown headings and inline code', () => {
        expect(tokensOf('# Title', 'md')).toContainEqual(['# Title', 'keyword']);
        expect(tokensOf('use `x` here', 'md')).toContainEqual(['`x`', 'string']);
    });

    it('runs an unterminated string to end of line', () => {
        const t = tokensOf('a = "unterminated', 'ts');
        expect(t).toContainEqual(['"unterminated', 'string']);
    });

    it('runs an unterminated template literal to end of line', () => {
        const t = tokensOf('a = `unterminated', 'ts');
        expect(t).toContainEqual(['`unterminated', 'string']);
    });

    it('collapses to one plain span above the char cap', () => {
        const line = 'const '.repeat(HIGHLIGHT_CHAR_CAP);
        expect(tokenizeLine(line, 'ts')).toEqual([
            { start: 0, end: line.length, token: 'plain' },
        ]);
    });

    it('still tiles when the span cap trips', () => {
        // Alternating punct/identifier maximises span count.
        const line = Array.from({ length: MAX_SPANS_PER_LINE + 50 }, (_, i) => `a${i},`).join('');
        expectTiles(line, 'ts');
    });
});

// The unrolled string form `"(?:[^"\\]|\\.)*"` has disjoint branches, so every
// prefix has exactly one parse. These are the inputs that blow up the naive
// `"([^"]|\\")*"` form.
describe('tokenizeLine — ReDoS regressions', () => {
    const under = (fn: () => void, ms = 50): void => {
        const t0 = performance.now();
        fn();
        expect(performance.now() - t0).toBeLessThan(ms);
    };

    it('survives a long run of escaped backslashes', () => {
        const line = '"' + 'a\\'.repeat(5_000);
        under(() => tokenizeLine(line.slice(0, HIGHLIGHT_CHAR_CAP), 'ts'));
    });

    it('survives an unterminated block comment', () => {
        under(() => tokenizeLine('/*' + '*'.repeat(HIGHLIGHT_CHAR_CAP - 3), 'ts'));
    });

    it('survives a run of quotes', () => {
        under(() => tokenizeLine("'".repeat(HIGHLIGHT_CHAR_CAP - 1), 'ts'));
    });

    it('survives a run of open braces', () => {
        under(() => tokenizeLine('{'.repeat(HIGHLIGHT_CHAR_CAP - 1), 'ts'));
    });

    it('survives pathological json', () => {
        under(() => tokenizeLine('"' + '\\'.repeat(HIGHLIGHT_CHAR_CAP - 2), 'json'));
    });
});
