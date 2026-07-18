import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// The URL is the single source of truth for which tab is active. Tab clicks
// write `?tab=<key>` via `setSearchParams(..., { replace: true })` — `replace`
// avoids littering history with one entry per click while still letting deep
// links, the standalone-page <Navigate> redirects, and the back/forward
// buttons land on the right tab. When `next === defaultTab`, the param is
// removed so the canonical URL stays clean.
export function useTabParam<T extends string>(
    allowed: readonly T[],
    defaultTab: T,
): [T, (next: T) => void] {
    const [searchParams, setSearchParams] = useSearchParams();
    const fromUrl = searchParams.get('tab');
    const currentTab: T =
        fromUrl && (allowed as readonly string[]).includes(fromUrl)
            ? (fromUrl as T)
            : defaultTab;

    // Functional form of `setSearchParams` so the callback's identity does not
    // depend on the current `searchParams` snapshot — keeps memo'd children
    // (e.g. `ProjectHeader`) from re-rendering on every parent render.
    const setTab = useCallback(
        (next: T) => {
            setSearchParams(
                (prev) => {
                    const params = new URLSearchParams(prev);
                    if (next === defaultTab) {
                        params.delete('tab');
                    } else {
                        params.set('tab', next);
                    }
                    return params;
                },
                { replace: true },
            );
        },
        [setSearchParams, defaultTab],
    );

    return [currentTab, setTab];
}
