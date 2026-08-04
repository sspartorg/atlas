import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
    DEFAULT_DIFF_PREFS,
    DIFF_PREFS_KEY,
    loadDiffPrefs,
    saveDiffPrefs,
} from './diffViewPrefs.js';

beforeEach(() => {
    window.localStorage.removeItem(DIFF_PREFS_KEY);
});

afterEach(() => {
    window.localStorage.removeItem(DIFF_PREFS_KEY);
    vi.restoreAllMocks();
});

describe('loadDiffPrefs', () => {
    it('returns defaults when storage is empty', () => {
        expect(loadDiffPrefs()).toEqual(DEFAULT_DIFF_PREFS);
    });

    // openPr defaults TRUE so existing users keep today's auto-PR behaviour.
    it('defaults openPr to true', () => {
        expect(loadDiffPrefs().openPr).toBe(true);
    });

    it('round-trips a saved blob', () => {
        const next = { openPr: false, viewMode: 'unified' as const, wrap: false };
        saveDiffPrefs(next);
        expect(loadDiffPrefs()).toEqual(next);
    });

    it('falls back to defaults on corrupt JSON', () => {
        window.localStorage.setItem(DIFF_PREFS_KEY, '{not json');
        expect(loadDiffPrefs()).toEqual(DEFAULT_DIFF_PREFS);
    });

    it('fills in defaults for missing keys', () => {
        window.localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify({ openPr: false }));
        expect(loadDiffPrefs()).toEqual({ openPr: false, viewMode: 'split', wrap: true });
    });

    it('rejects an unknown viewMode value', () => {
        window.localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify({ viewMode: 'sideways' }));
        expect(loadDiffPrefs().viewMode).toBe('split');
    });

    it('rejects non-boolean openPr and wrap', () => {
        window.localStorage.setItem(
            DIFF_PREFS_KEY,
            JSON.stringify({ openPr: 'yes', wrap: 1 }),
        );
        const prefs = loadDiffPrefs();
        expect(prefs.openPr).toBe(true);
        expect(prefs.wrap).toBe(true);
    });

    it('returns defaults when getItem throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(loadDiffPrefs()).toEqual(DEFAULT_DIFF_PREFS);
    });
});

describe('saveDiffPrefs', () => {
    it('does not throw when setItem throws (Safari private mode)', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        expect(() => saveDiffPrefs(DEFAULT_DIFF_PREFS)).not.toThrow();
    });

    it('writes under the versioned key', () => {
        saveDiffPrefs({ openPr: false, viewMode: 'unified', wrap: false });
        expect(window.localStorage.getItem(DIFF_PREFS_KEY)).toContain('unified');
    });
});
