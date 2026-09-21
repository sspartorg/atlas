import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// G-015 — two coupled invariants about Material-Symbols icons, enforced over
// the source because the failure is a *convention* drifting rather than one
// component breaking.
//
// 1. Every icon span carries `aria-hidden="true"`. The ligature text IS the
//    glyph, so without it a screen reader reads it as part of the control's
//    accessible name — the Workflows header announced "addNew workflow" and
//    "uploadImport" rather than "New workflow" / "Import".
//
// 2. No `<IconButton>` whose only content is a hidden icon is left nameless.
//    Hiding the glyph is the right fix for (1) and the wrong one alone: it
//    turns an icon-only button from badly-named into *unnamed*, which is
//    worse. An explicit `aria-label` is required; a wrapping `<Tooltip>` is
//    NOT accepted, because it names only its immediate child and
//    `RefreshButton` puts a `<span>` in between.
//
// A source assertion rather than a lint rule because it is two coupled facts,
// and jsx-a11y cannot see through the `<Box component="span">` indirection
// that `packages/web/AGENTS.md` mandates.

const SRC = join(process.cwd(), 'src');
const ICON_CLASS = 'className="material-symbols-rounded"';

function tsxFiles(): string[] {
    return globSync('**/*.tsx', { cwd: SRC }).map((f) => join(SRC, f));
}

/**
 * Index of the `>` that closes the JSX opening tag starting at `start`.
 *
 * A naive `indexOf('>')` is wrong and was wrong here first: `onClick={(e) =>
 * …}` puts a `>` inside the attribute list, so the scan stopped early, read a
 * truncated attribute set, and reported a button as unnamed when its
 * `aria-label` sat further down. That produced a duplicate-attribute
 * typecheck error before it was caught. Track brace depth and quotes.
 */
function openingTagEnd(src: string, start: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i]!;
        if (quote) {
            if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) return i;
    }
    return -1;
}

function lineOf(src: string, idx: number): number {
    return src.slice(0, idx).split('\n').length;
}

describe('Material-Symbols icon accessibility (G-015)', () => {
    it('scans a meaningful number of files', () => {
        // Both assertions below pass vacuously if the glob finds nothing —
        // which is exactly how the second one shipped silently broken the
        // first time. Pin the scan itself.
        const files = tsxFiles();
        expect(files.length).toBeGreaterThan(100);
        const withIcons = files.filter((f) => readFileSync(f, 'utf8').includes(ICON_CLASS));
        expect(withIcons.length).toBeGreaterThan(50);
    });

    it('every icon span is aria-hidden', () => {
        const offenders: string[] = [];
        for (const file of tsxFiles()) {
            const src = readFileSync(file, 'utf8');
            let idx = src.indexOf(ICON_CLASS);
            while (idx !== -1) {
                const tagStart = src.lastIndexOf('<', idx);
                const tagEnd = openingTagEnd(src, tagStart);
                const tag = tagEnd === -1 ? src.slice(tagStart) : src.slice(tagStart, tagEnd);
                if (!tag.includes('aria-hidden')) {
                    offenders.push(`${file.replace(SRC, 'src')}:${lineOf(src, idx)}`);
                }
                idx = src.indexOf(ICON_CLASS, idx + 1);
            }
        }
        expect(offenders, `icon spans missing aria-hidden:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('no icon-only IconButton is left without an accessible name', () => {
        const offenders: string[] = [];
        for (const file of tsxFiles()) {
            const src = readFileSync(file, 'utf8');
            for (const m of src.matchAll(/<IconButton\b/g)) {
                const openEnd = openingTagEnd(src, m.index);
                if (openEnd === -1) continue;
                const attrs = src.slice(m.index, openEnd);
                // An explicit `aria-label` (or `title`) is REQUIRED — a
                // wrapping `<Tooltip>` is deliberately not accepted. MUI
                // forwards `title` to its immediate child only, and
                // `RefreshButton` wraps its button in a `<span>` (a disabled
                // button fires no events for the tooltip to hear), so the
                // label landed on the span and the button was left unnamed.
                // A heuristic that looked for a nearby Tooltip passed it.
                // Requiring the attribute is unambiguous and cheap.
                if (attrs.includes('aria-label') || attrs.includes('title=')) continue;
                // `openEnd` is the index OF the '>', so the body starts after it.
                const close = src.indexOf('</IconButton>', openEnd);
                const body = close === -1 ? '' : src.slice(openEnd + 1, close);
                if (!body.includes('material-symbols-rounded')) continue;
                // Drop the icon element entirely, glyph text included — it is
                // aria-hidden — then see what is left to name the button.
                const withoutIcon = body.replace(/<Box[^>]*material-symbols-rounded[\s\S]*?<\/Box>/g, '');
                if (withoutIcon.replace(/<[^>]*>/g, '').trim().length > 0) continue;
                offenders.push(`${file.replace(SRC, 'src')}:${lineOf(src, m.index)}`);
            }
        }
        expect(offenders, `icon-only IconButtons with no name:\n${offenders.join('\n')}`).toEqual([]);
    });
});
