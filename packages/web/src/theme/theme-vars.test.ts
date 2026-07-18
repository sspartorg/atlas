import { describe, expect, it } from 'vitest';
import { applyThemeVars } from './theme-vars.js';

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
