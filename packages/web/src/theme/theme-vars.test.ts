import { describe, expect, it } from 'vitest';
import { applyThemeVars } from './theme-vars.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUN_STATUS_PALETTE, DEFAULT_RUN_STATUS_PALETTE_ENTRY } from './runStatusPalette.js';

describe('applyThemeVars', () => {
    it('sets data-theme="light" on documentElement', () => {
        applyThemeVars('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
        expect(document.documentElement.style.colorScheme).toBe('light');
    });

    it('sets data-theme="dark" on documentElement', () => {
        applyThemeVars('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('switches from dark back to light', () => {
        applyThemeVars('dark');
        applyThemeVars('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
});

// WCAG AA (4.5:1) for chip text: every status pill's fg on its bg, in the CSS
// tokens and in the run-status palette that mirrors them.

function luminance(hex: string): number {
    const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

describe('status pill contrast', () => {
    const css = readFileSync(resolve(__dirname, 'theme-vars.css'), 'utf8');
    const pairs = [...css.matchAll(/--atlas-status-([a-z_]+)-fg:\s*(#[0-9a-f]{6})/gi)].map((m) => {
        const bg = new RegExp(`--atlas-status-${m[1]}-bg:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1];
        return [m[1], m[2]!, bg!] as const;
    });

    it('finds every status token', () => {
        expect(pairs.length).toBeGreaterThanOrEqual(12);
    });

    it.each(pairs)('%s text meets 4.5:1 on its fill', (_name, fg, bg) => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it.each(Object.entries({ ...RUN_STATUS_PALETTE, default: DEFAULT_RUN_STATUS_PALETTE_ENTRY }))(
        'run status %s text meets 4.5:1 on its fill',
        (_name, { fg, bg }) => {
            expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
        }
    );
});
