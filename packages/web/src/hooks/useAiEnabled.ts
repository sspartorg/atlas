import { useSettings } from './useSettings.js';

interface AiEnabledResult {
    aiEnabled: boolean | undefined;
    isLoading: boolean;
}

// Delegates to useSettings so we never end up with two observers on the
// `['settings']` key. The previous standalone useQuery here inherited the
// global `refetchOnMount: 'always'` and clobbered useSettings's long-cache —
// settings was being fetched twice on every cold page load.
//
// Returns `aiEnabled: undefined` while loading so callers can distinguish
// "unknown" from "explicitly disabled" — that prevents the Simulator chip
// from flashing on first paint before /api/settings resolves. Only once the
// query settles does `aiEnabled` become a concrete boolean.
export function useAiEnabled(): AiEnabledResult {
    const q = useSettings();
    const aiEnabled =
        q.data === undefined ? undefined : q.data.ai_enabled === true;
    return {
        aiEnabled,
        isLoading: q.isLoading,
    };
}
