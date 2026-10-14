import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ICONS, ICON_FONT_URL, iconOr } from './icons.js';

// The icon font ships only the glyphs in ICONS (see icons.ts). An icon used
// but missing from the list would render as its raw ligature text, so this
// scans the sources the way the subset was built and fails on any gap.
//
// `scripts/material-symbols-rounded.names` is Google's full Material Symbols
// name list (from google/material-design-icons, variablefont codepoints). It
// is what tells an icon name apart from any other lowercase string.

const WEB = process.cwd();
const API = join(WEB, '..', 'api', 'src');
const SHARED = join(WEB, '..', 'shared', 'src');
const ALL_NAMES = new Set(
    readFileSync(join(WEB, 'scripts', 'material-symbols-rounded.names'), 'utf8')
        .split('\n')
        .filter(Boolean)
);

function sources(cwd: string, pattern: string): string[] {
    return globSync(pattern, { cwd })
        .filter((f) => !f.includes('.test.') && !f.includes('node_modules'))
        .map((f) => join(cwd, f));
}

function usedIcons(): Set<string> {
    const used = new Set<string>();
    const add = (name: string | undefined) => {
        if (name && ALL_NAMES.has(name)) used.add(name);
    };
    // Web and @atlas/shared: every quoted literal and JSX text node that is an
    // icon name. Icons reach the spans through props, config arrays and
    // shared UI constants (guardrail categories), so any literal counts.
    for (const file of [
        ...sources(join(WEB, 'src'), '**/*.{ts,tsx}'),
        ...sources(SHARED, '**/*.ts'),
    ]) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/(['"`])([a-z0-9_]+)\1/g)) add(m[2]);
        for (const m of src.matchAll(/>\s*([a-z0-9_]+)\s*</g)) add(m[1]);
    }
    // API: icons it hands the UI as data: marketplace glyphs, rule icons.
    for (const file of sources(API, '**/*.{ts,json}')) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(
            /(?:icon|glyph)['"]?\s*(?::|=|\?\?)\s*['"]([a-z0-9_]+)['"]/g
        )) {
            add(m[1]);
        }
    }
    return used;
}

describe('icon font subset', () => {
    it('carries every icon the web and API sources use', () => {
        const listed = new Set<string>(ICONS);
        const missing = [...usedIcons()].filter((n) => !listed.has(n)).sort();
        // Add these to ICONS in src/theme/icons.ts (sorted).
        expect(missing).toEqual([]);
    });

    it('lists only real Material Symbols names, sorted and unique, as Google requires', () => {
        expect(ICONS.filter((n) => !ALL_NAMES.has(n))).toEqual([]);
        expect([...ICONS]).toEqual([...new Set(ICONS)].sort());
        expect(ICON_FONT_URL).toContain(`icon_names=${ICONS.join(',')}`);
        expect(ICON_FONT_URL).toContain('display=block');
    });

    it('falls back for glyphs the subset does not carry', () => {
        expect(iconOr('smart_toy', 'x')).toBe('smart_toy');
        expect(iconOr('not_a_real_icon', 'smart_toy')).toBe('smart_toy');
        expect(iconOr('', 'smart_toy')).toBe('smart_toy');
        expect(iconOr(undefined, 'smart_toy')).toBe('smart_toy');
    });
});
