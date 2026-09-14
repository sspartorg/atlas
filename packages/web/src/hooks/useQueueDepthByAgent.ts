import { useMemo } from 'react';
import { useBugs } from './useBugs.js';
import { useEpics } from './useEpics.js';
import { useStories } from './useStories.js';
import { countQueueDepthByAgent } from '../pages/queue/queueViewModel.js';

// Same query keys as the Queue page, so both screens share one cache and one count.
export function useQueueDepthByAgent(): Map<string, number> {
    const { data: epics } = useEpics();
    const { data: stories } = useStories();
    const { data: bugs } = useBugs();
    return useMemo(
        () => countQueueDepthByAgent([...(epics ?? []), ...(stories ?? []), ...(bugs ?? [])]),
        [epics, stories, bugs]
    );
}
