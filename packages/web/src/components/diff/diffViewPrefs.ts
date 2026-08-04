// 2026-08-04 — Terminal finalize diff. Sticky preferences for the Stop modal.
//
// Versioned single-blob key, matching `atlas.terminal-filters.v1` and
// `atlas.terminal-layout.v1`. Every access is wrapped in try/catch: Safari in
// private mode throws on `setItem`, and a corrupt blob must degrade to
// defaults rather than break the modal.

export type DiffViewMode = 'split' | 'unified';

export interface DiffPrefs {
    /** Open a PR on stop. Defaults true — the behaviour that predates the toggle. */
    openPr: boolean;
    viewMode: DiffViewMode;
    /**
     * Wrap long lines. Defaults ON because split view is the default and its
     * columns are ~45% of the viewport, where wrapping is what a reviewer
     * actually wants.
     */
    wrap: boolean;
}

export const DIFF_PREFS_KEY = 'atlas.stop-session-prefs.v1';

export const DEFAULT_DIFF_PREFS: DiffPrefs = {
    openPr: true,
    viewMode: 'split',
    wrap: true,
};

export function loadDiffPrefs(): DiffPrefs {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_DIFF_PREFS };
        const raw = window.localStorage.getItem(DIFF_PREFS_KEY);
        if (!raw) return { ...DEFAULT_DIFF_PREFS };
        const parsed = JSON.parse(raw) as Partial<DiffPrefs>;
        return {
            openPr: typeof parsed.openPr === 'boolean' ? parsed.openPr : DEFAULT_DIFF_PREFS.openPr,
            viewMode:
                parsed.viewMode === 'unified' || parsed.viewMode === 'split'
                    ? parsed.viewMode
                    : DEFAULT_DIFF_PREFS.viewMode,
            wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : DEFAULT_DIFF_PREFS.wrap,
        };
    } catch {
        return { ...DEFAULT_DIFF_PREFS };
    }
}

export function saveDiffPrefs(next: DiffPrefs): void {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem(DIFF_PREFS_KEY, JSON.stringify(next));
    } catch {
        // Private-mode quota errors are not worth surfacing — the modal still
        // works, the choice just doesn't stick.
    }
}
